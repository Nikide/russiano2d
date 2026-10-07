# Russiano2D — высокоуровневое API `$`

Полный справочник по игровому API движка. Всё, что нужно игре, живёт на одном
объекте `$`: он доступен **глобально**, импортировать ничего не нужно.

```js
// game/main.js — целиком
$.ready(() => {
    $.world.gravity(0, 1200).color('#101820').bounds(0, 0, 4000, 1200);

    $('<player>', { id: 'hero' })
        .at(100, 300).size(32, 48).health(100).speed(250)
        .controls('wasd')
        .on('death', () => $.scene.load('gameOver'))
        .appendTo($.world);

    $.camera.follow('#hero').zoom(1.5);
});

$.update(dt => {
    $('.goblin').each((i, e) => { if (e.distanceTo('#hero') < 200) e.moveTowards('#hero', 120); });
});
```

Низкоуровневый объект `engine` (текстуры, тела, батчинг, RmlUi, BSP, свет)
никуда не исчез — см. [API.md](API.md). `$` построен поверх него, и оба доступны
одновременно.

---

## 1. Философия

* **`$` — единственная точка входа.** Один объект, одно пространство имён.
* **Всё возвращает обёртку** (`wrapper`) — поэтому работают цепочки.
* **Создание — как в HTML:** `$('<player>', { id: 'hero', hp: 100 })`.
* **Поиск — как в CSS:** `$('#hero')`, `$('.enemy')`, `$('enemy:alive')`.
* **Неявная итерация:** `$('.enemy').damage(10)` бьёт всех найденных.
* **Никаких `new`, `extends`, `this`** в игровом коде. `$.fn` — если нужно
  добавить свой метод.
* **Асинхронность — через `Promise`:** `.moveTo(...)` возвращает `Promise`,
  который разрешается по завершении анимации.
* **Весь интерфейс — только RmlUi.** Меню, HUD, диалоги, экраны и оверлеи —
  документы `.rml` + `.rcss` (`$.ui.doc('ui/menu.rml')`, §20); низкий уровень —
  `engine.ui.*` ([API.md](API.md) §9). Другого UI-пути у движка нет: узлы
  `<ui.*>` — быстрый рисователь HUD в координатах окна, а не интерфейсный слой,
  поэтому новые меню и экраны на них не строятся. Полностью —
  [UI_RMLUI_LAW.md](UI_RMLUI_LAW.md).

---

## 2. Жизненный цикл

| Хук | Когда вызывается |
|---|---|
| `$.ready(fn)` | один раз, на первом кадре (после `$` создан) |
| `$.update(fn)` | каждый кадр; `fn(dt, $)` |
| `$.render(fn)` | каждый кадр перед отрисовкой мира |
| `$.exit(fn)` | при завершении движка |

```js
$.ready(() => { /* построить мир */ });
$.update(dt => { /* логика */ });
$.render(() => { /* поверх сцены, до интерфейса */ });
$.exit(() => { $.store.save(); });
```

Пачка узлов (очередь выстрелов, волна врагов) — одним вызовом:

```js
$.batch(() => {
    for (let i = 0; i < 50; i++) $('<bullet>').at(x, y).appendTo($.world);
    $('.bullet').filter(':dead').remove();   // K удалений — одна уборка реестра
});
```

Порядок одного кадра внутри `$`:
`$world.sync` (свежие трансформы из физики) → смена сцены → время (твины,
таймеры, камера, события ввода) → `$.ready` → `update` сцены → `$.update` →
спрайт-анимации → встроенное управление → наведение интерфейса →
`render` сцены → `$.render` → отрисовка.

---

## 3. Создание узлов

```js
$('<player>', { id: 'hero' })        // атрибуты — вторым аргументом
$('<enemy>', { class: 'goblin boss' })
$('<ui.button>', { id: 'play', text: 'Играть' })
```

Атрибуты применяются по имени свойства. Знакомые имена (`id`, `x`, `y`, `w`,
`h`, `hp`, `speed`, `sprite`, `color`, `alpha`, `visible`, `layer`, `team`,
`body`, `text`, `size`, `value`, `max`, `radius`, `intensity`, `gravity`,
`controls`, `collision`, `hoverColor`, `textColor`, `fillColor`) попадают в
поля узла и действуют сразу. Всё остальное складывается в `attrs` и доступно
через `.attr('ключ')` — то есть свой атрибут всегда можно завести, не трогая
движок.

Два ключа ведут себя как методы, потому что за ними стоит работа, а не поле:

```js
$('<sprite>', { src: 'art/hero.png' })          // то же, что .sprite('art/hero.png')
$('<sprite>', { frames: { src: 'sheet.png', cols: 8, rows: 4, cw: 16, ch: 16 } })
```

`src` грузит текстуру у всех спрайтовых тегов (`<sprite>`, `<player>`,
`<enemy>`, `<npc>`, `<pickup>`, `<bullet>`, `<ui.image>`) — и его же
показывает `.attr('src')`. У `<tilemap>` и `<particles>` `src` остаётся
обычным атрибутом: его читают их собственные отрисовщики.

### Теги

| Тег | Тело | Назначение |
|---|---|---|
| `<player>` | динамическое | игрок: 28×40, 100 HP, скорость 250 (выбор — `$('player')`; класс появляется только после `.addClass()`) |
| `<enemy>` | динамическое | враг: 28×40, 30 HP, скорость 90, `team` 2 |
| `<npc>` | динамическое | нейтральный персонаж |
| `<pickup>` | нет | подбираемый предмет |
| `<bullet>` | динамическое | снаряд (гравитация выключена) |
| `<sprite>` | нет | картинка |
| `<rect>` | нет | прямоугольник (белый спрайт 1×1) |
| `<circle>` | нет | круг (рисуется треугольниками) |
| `<text>` | нет | текст в мировых координатах |
| `<light>` | нет | мягкое свечение радиусом `radius` |
| `<wall>` | статическое | препятствие |
| `<tilemap>` | нет | карта из тайлов: слои, автотайл, коллизии (раздел 30) |
| `<particles>` | нет | CPU-частицы: эмиттер, рампы, пресеты (раздел 30) |
| `<layer>` | нет | канвас-слой: порядок, параллакс, затемнение (раздел 30) |
| `<trigger>` | нет | зона, событие `enter` / `leave` |
| `<area>` | нет | невидимая зона без отрисовки |
| `<ui.panel>`, `<ui.label>`, `<ui.button>`, `<ui.bar>`, `<ui.image>` | нет | базовые элементы интерфейса в координатах окна |
| `<ui.row>`, `<ui.col>`, `<ui.grid>` | нет | контейнеры раскладки (раздел 30) |
| `<ui.scroll>`, `<ui.list>`, `<ui.checkbox>`, `<ui.slider>`, `<ui.input>`, `<ui.dialog>` | нет | контролы с вводом и фокусом (раздел 30) |

Теги `ui.panel`, `ui.label`, `ui.button`, `ui.bar`, `ui.image` живут в
координатах окна: камера на них не влияет, в `$.world.count()` они не входят.

---

## 4. Селекторы

| Селектор | Что находит |
|---|---|
| `'#hero'` | по `id` |
| `'.enemy'` | по классу |
| `'enemy'` | по тегу |
| `'*'` | все узлы |
| `'#hero, .boss'` | объединение |
| `'#hero .weapon'` | потомок |
| `'#hero > .weapon'` | прямой потомок |
| `'enemy.goblin'` | тег + класс |
| `'[hp<20]'`, `'[team=1]'`, `'[speed>=100]'` | условие на свойство |
| `':alive'` / `':dead'` | по здоровью |
| `':visible'` / `':hidden'` | по видимости |
| `':onScreen'` / `':offScreen'` | в кадре камеры |
| `':first'`, `':last'`, `':eq(n)'`, `':even'`, `':odd'` | по позиции в реестре |
| `':has(.item)'`, `':parent'`, `':empty'` | по детям |
| `':paused'` | когда время на паузе |
| `':picked'` | под курсором |

Свои фильтры:

```js
$.selectors.register(':boss', node => node.attrs.rank === 'boss');
$(':boss').hp(1000);
```

---

## 5. Обёртка (коллекция)

Всё, что возвращает `$`, — коллекция узлов с общими методами.

```js
$('.enemy').length          // сколько нашлось (свойство)
$('.enemy').get(0)          // узел-объект
$('.enemy').toArray()       // массив узлов
$('.enemy').each((i, e) => { })      // e — обёртка одного узла (методы-цепочки)
$('.enemy').eachNode((i, n) => { })  // n — сам узел: быстрее, обёртка не создаётся
$.batch(() => { … })                 // пачка спавна/удаления: реестр чистится один раз
$('.enemy').map((i, e) => e.hp())    // массив значений; колбэк — (индекс, обёртка)
$('.enemy').filter((i, e) => e.hp() < 10)
$('.enemy').filter('.goblin')        // фильтр селектором
$('.enemy').not('.boss')
$('.enemy').first() / .last() / .eq(2) / .slice(1, 3)
$('.enemy').add('.boss')             // объединить
$('.enemy').is('.goblin')            // bool: все подходят
$('.enemy').has('.weapon')           // bool: есть такой потомок
$('.enemy').every((i, e) => e.alive())    // bool; колбэк — (индекс, обёртка)
$('.enemy').some((i, e) => e.hp() < 5)    // bool
$('.enemy').reduce((sum, e) => sum + e.hp(), 0)
$('.enemy').index()                  // позиция первого узла в реестре мира
$('.enemy').within('#hero', 500)     // кто ближе 500 px: нативный запрос broadphase
$('.enemy').within({ x: 0, y: 0 }, 200)   // цель — точка, узел, обёртка или селектор
```

`.within(цель, радиус)` считает расстояние **по центру узла**. Узлы с телом
отбирает `engine.queryCircle` (broadphase Box2D) — перебора всех узлов в JS нет;
узлы без тела (спрайты, зоны, свет) проверяются по координатам, поэтому не
теряются. Порядок результата — порядок выборки. Диагностика запроса —
`$.debug.queryStats()` (§24).

Предел нативного запроса — 256 тел (`R2D_MAX_QUERY`, §14 в
[API.md](API.md)). Если кандидатов больше, выборка обрезана: признак виден в
`$.debug.queryStats().truncated`. Для очень плотных сцен это значит, что
`within()` — про «кто рядом», а не про полный перебор мира.

**Массовые операции работают всегда:** `$('.enemy').damage(10)`, `.stopAll()`,
`.at(0, 0)` (телепорт всей толпы), `.remove()`.

---

## 6. Трансформ и геометрия

```js
.at(x, y)                  // задать позицию (и переместить тело)
.move(dx, dy)              // сдвинуть
.moveTo(x, y, ms, ease?)   // плавно переехать → Promise (без ms — мгновенно)
.moveTo('#hero', speed)    // двигаться к цели со скоростью, px/с
.moveTowards('#hero', 120) // то же, но явным методом
.pos()                     // → { x, y }
.size(w, h) / .size(w)     // размер
.width(w) / .height(h)     // по одной стороне
.rotate(deg)               // довернуть (градусы)
.angle(rad)                // задать угол в радианах
.rotation()                // → радианы
.scale(1.5) / .scale(sx, sy)
.lookAt('#hero')           // повернуться к цели
.flip(true, false)         // отразить по осям
.layer(2) .depth(z)        // порядок отрисовки
.depthRelative(true)       // depth СКЛАДЫВАЕТСЯ с родителем
.distanceTo('#enemy')      // → число
.directionTo('#enemy')     // → { x, y } единичный вектор
.angleTo('#enemy')         // → радианы
.rayTo('#enemy')           // → { hit, point, normal, distance } | null
.sweepTo('#enemy')         // свип формы хитбоксом узла → как $.world.castShape
.toGlobal({x,y}) .toLocal({x,y})   // мировые ↔ экранные
```

## 7. Визуал

```js
.sprite('demos/assets/art/hero.png')      // путь к картинке (расширение обязательно)
.sprite({ src: 'sheet.png', cols: 8, rows: 4, cw: 176, ch: 176 })
.frames({ src: 'sheet.png', cols: 8, rows: 4, cw: 176, ch: 176 })
.frame(3)                                 // показать конкретный кадр
.animate({ from: 0, to: 5, speed: 12, loop: true })
.stopAnim() .playing(false)
.color('#ff0000') .alpha(0.5) .opacity(0.5)
// alpha и visible НАСЛЕДУЮТСЯ: скрытый родитель скрывает детей,
// прозрачности перемножаются (modulate)
.visible(false) .show() .hide()
.fadeIn(200) .fadeOut(300)                // → Promise
.shader('flash', { color: '#ff8080', amount: 0.7 })   // шейдер узла (эффект)
.shaderParam('amount', 0.4)               // один параметр эффекта
.region(x, y, w, h)                        // вырезать область из текстуры узла
.outline(2, '#000')                       // рамка вокруг спрайта (по хитбоксу)
.shadow({ x: 4, y: 4, color: 'rgba(0,0,0,0.4)' })   // смещённая копия под спрайтом
.fontSize(24)                             // кегль текста у <text> и <ui.label>
.pivot(0.5, 1)                           // точка вращения: низ по центру (у ног)
$.gfx.filter(true)                        // линейная фильтрация спрайтов (по умолчанию nearest)
.slice({ left: 8, right: 8, top: 8, bottom: 8 })   // nine-slice: углы целые, края тянутся
.font('title')                            // семейство шрифта узла и его детей
.radius(200) .intensity(1)                // свет: радиус и яркость у <light>
```

Цвет принимает `'#f00'`, `'#ff0000'`, `'#ff0000cc'`, `'red'`, `'rgba(255,0,0,0.5)'`,
`[255, 0, 0, 128]` или число от `$.color(...)`.

`.blend('alpha' | 'add' | 'multiply' | 'none')` задаёт режим смешивания узла,
`$.blend(name)` — режим по умолчанию для всего кадра. **Пользовательские
шейдеры поддержаны** (v0.1.10+): `$.gfx.defineShader(name, { frag })` компилирует
фрагментный шейдер в рантайме, и `.shader(name)` включает его у узла. На
платформах, где живые шейдеры выключены сборкой (`R2D_ENABLE_LIVE_SHADERS=OFF`),
`.shader()` безопасен и пишет предупреждение в журнал.

## 8. Физика

```js
.body('dynamic' | 'static' | 'kinematic')   // создать/сменить тело
.velocity(vx, vy) .velocity()               // задать / прочитать, px/с
.applyImpulse(ix, iy) .applyForce(fx, fy)
.gravity(false)                             // выключить гравитацию узла
.collision(w, h) .collisionCircle(r)        // хитбокс (и пересоздать тело)
.shape('box' | 'circle' | 'capsule' | 'polygon')   // форма тела
.oneWay(true)                               // односторонняя платформа
.sensor(true)                               // зона: ловит, но не толкает
.contacts(true | false)                     // события контакта
.sleeping()                                 // → bool: усыпил ли Box2D тело
.bullet(true | false)                       // CCD для быстрых тел (см. API.md §8)
.joint('#other', { type: 'revolute' })      // сустав, → id
.onFloor() .onWall()                        // → bool (луч вниз/вбок)
.jump(640)                                  // импульс вверх с гашением падения
.moveAndSlide(vx, vy)                       // синоним .velocity() — скольжение делает Box2D
.stopAll() .pause() .wake()
.overlaps('.wall')                          // → bool по пересечению прямоугольников
.overlaps('.wall', (hit, self) => { })      // колбэк каждый кадр (hit | null)
.inside('#zone')                            // → bool
.layerBits(bits)                            // слой тела: 1, 2, 4, … (по умолчанию 1)
.mask(bits | узел | селектор)               // с какими слоями сталкиваться (по умолчанию все)
.collidesWith('#wall')                      // → bool: столкнутся ли узлы по слоям и маскам
.collidesWith('#wall', false)               // убрать слои цели из своей маски
```

### Слои и маски коллизий

`layerBits` — в каком слое лежит тело, `mask` — с какими слоями оно
сталкивается. Тела A и B сталкиваются, если непусты **оба** пересечения:
`A.mask & B.layerBits` и `B.mask & A.layerBits`. Маски — 32-битные числа
(`0x1`, `0x2`, `0x4`, …): побитовые операторы JavaScript всё равно 32-битные.
Дополнительно есть группы Box2D (`.attr('group', n)`): одинаковый
положительный номер сталкивает тела вопреки маскам, одинаковый отрицательный —
запрещает столкновение.

```js
$('<wall>', { layerBits: 0x1 });                      // стены — слой 1
$('<enemy>', { layerBits: 0x2, mask: 0x1 | 0x2 });    // враги: стены и друг друга
$('<bullet>', { layerBits: 0x4, mask: 0x1 });         // пули: только стены
$('#hero').mask(0);                                   // …и ни с кем не сталкиваться

$('#hero').collidesWith('#wall');                     // true — слои пересекаются
$('#hero').collidesWith('#lava', false);              // убрать слой лавы из маски
$.world.raycast(a, b, { mask: 0x1 });                 // луч видит только стены
$.world.bodyAt(x, y, { mask: 0x2 });                  // кто из врагов под точкой
```

Смена слоя или маски применяется к уже созданному телу (пересоздавать не
нужно) и переживает пересоздание тела из-за `.size()`/`.collision()`, а также
сохранение в prefab. `.onFloor()` и `.onWall()` проверяют опору по маске узла:
на том, с чем тело не сталкивается, оно и не стоит.

**Формы.** `box` — прямоугольник по хитбоксу (по умолчанию); `circle` —
настоящий круг (`.collisionCircle(r)` включает его сам); `capsule` — капсула,
не цепляется за стыки тайлов; `polygon` — силуэт до 8 точек
(`.shape('polygon', [x0,y0,x1,y1,…])`, локальные пиксели). Смена формы
пересоздаёт тело; скорость при этом сохраняется.

**Односторонние платформы.** `.oneWay(true)` — тело проходит сквозь снизу и
встаёт сверху. Второй аргумент задаёт направление лицевой стороны
(`.oneWay(true, -Math.PI / 2)` — вверх по умолчанию).

**Суставы.** `.joint(цель, opts)` возвращает id; `opts` — как в
[API.md](API.md#enginecreatejointopts--engineestroyjointid), плюс сокращения:
`a`/`b` — точки крепления в мировых пикселях. Для `revolute` и `weld` вторая
точка по умолчанию совпадает с первой (крепление в одну точку), для
`distance` — берутся центры тел. Уничтожение: `$.world.destroyJoint(id)`,
состояние: `$.world.jointAlive(id)`, `$.world.jointCount()`.

### События контакта

Динамическим телам события включены сразу; `.contacts(true)` включает их и
остальным (например, стене, которая хочет знать, что в неё врезались).

```js
$('#hero').on('collide', e => {          // начали касаться
    $.log(`столкнулся с ${e.data.other ? e.data.other.tag : '?'}, скорость ${e.data.speed}`);
});
$('#hero').on('separate', e => { });     // перестали касаться
$('#hero').on('hit', e => {              // удар быстрее порога Box2D
    $.camera.shake(Math.min(6, e.data.speed / 40), 120);
});
```

В `e.data`: `kind` (`'begin'`/`'end'`/`'hit'`), `self`, `other` (обёртки или
`null`, если узла уже нет), точка контакта `x`/`y`, нормаль `nx`/`ny` и
`speed` (скорость сближения, для `hit`). Сырой список за кадр —
`$.world.contacts()`.

Встроенное управление: `.controls('wasd')`, `.controls('arrows')`,
`.controls({ axis: 'both', jump: 'space' })` — двигает узел или его тело,
прыжок по `space`/`w`/`↑` только когда узел на земле.

## 9. Здоровье

```js
.health(100)        // задать максимум и текущее
.hp() / .hp(50)     // прочитать / задать
.maxHp(120)
.damage(10) .heal(5) .kill() .respawn(x, y)
.alive()            // → bool
.team(2)            // своя команда
.invulnerable(500)  // неуязвимость на 500 мс
```

При изменении здоровья мир сам рассылает события `hit`, `heal`, `death`,
`respawn`, `show`/`hide`.

## 10. События

```js
$('#hero').on('hit', e => { /* e.self, e.data, e.stop() */ });
$('#hero').off('hit');            // снять все
$('#hero').off('hit', handler);   // снять конкретный
$('#hero').emit('custom:foo', { });  // локальное событие
$.on('kill', e => { });              // глобальное
$.on('entity:enemy:death', e => { }); // по тегу и событию
$.emit('score:+', { points: 10 });    // своё глобальное событие
```

Встроенные события узла: `hit`, `heal`, `death`, `respawn`, `remove`, `show`,
`hide`, `enter`/`leave` (для `<trigger>`), `jump`, `fire`, `arrived`, `animEnd`,
`click`, `mouseenter`, `mouseleave`, `mousedown`, `mouseup`.

Объект события: `{ self, target, source, name, data, dt, frame, stop() }`.

## 11. Твины и эффекты

```js
await $('#hero').moveTo(400, 200, 600);         // Promise
$('#hero').tween({ alpha: 0, y: 100 }, 300, 'easeOutBack');
// rotateTo/scaleTo/fadeTo возвращают Promise, поэтому цепочкой их не соединить:
// ждём все три сразу. (В прежнем примере была цепочка — она падала с TypeError.)
await Promise.all([
    $('#hero').rotateTo(90, 400),
    $('#hero').scaleTo(2, 200),
    $('#hero').fadeTo(0, 300),
]);
$('#hero').shake(6, 250);                       // тряска картинки
$('#hero').flash('#ff0000', 120);               // вспышка цвета
await $('#hero').bounce(20, 300);
await $('#hero').delay(200);
$('#hero').pauseTweens().resumeTweens().clearTweens();
await $.sequence([() => step1(), 300, () => step2()]);
```

Плавности: `linear`, `ease`, `easeIn`, `easeOut`, `easeInOut`, `easeInCubic`,
`easeOutCubic`, `easeInOutCubic`, `easeInQuad`, `easeOutQuad`, `easeInQuart`,
`easeOutQuart`, `easeInBack`, `easeOutBack`, `easeInOutBack`,
`easeOutElastic`, `easeInElastic`, `easeOutBounce`, `easeInBounce`,
`easeInSine`, `easeOutSine`, `step`.

## 12. Звук на узле

```js
$('#hero').sound('jump.wav').playSound();   // привязать и проиграть
.sound('hit.wav', { max: 500 })
```

## 13. Иерархия

```js
$('<sprite>').appendTo('#hero');       // стать ребёнком узла
$('#hero').append($('<sprite>'));      // добавить ребёнка
$('#hero').prepend(child)
$('#hero').children('.limb')           // обёртка детей по классу
$('#hero').find('.grip')               // поиск среди потомков
$('#hero').closest('player')           // ближайший подходящий предок
$('#hero').siblings()                  // соседи
$('#hero').parent()
$('#hero').detach()                    // отсоединить, оставив живым
$('#hero').remove()                    // уничтожить узел и его детей
```

`.appendTo($.world)` — «в мир» (родителя нет, узел и так в реестре мира).

## 14. Данные, классы, теги

```js
.data('hp', 100) .data('hp') .data({ a: 1 })   // своё хранилище
.attr('speed', 120) .attr('speed') .attr({ })  // свойства и атрибуты
.addClass('boss') .removeClass('boss') .toggleClass('boss') .hasClass('boss')
.tag('friendly') .addTag('x') .removeTag('x')
.text('Привет') .value(0.5) .max(1)            // для текста и полос
```

`.attr('имя')` читает и свойства узла, и свободные атрибуты: `.attr('id')` и
`.attr('hp')` возвращают то же, что `.id()` и `.hp()`, а `.attr('x')` — число
(тогда как `.pos()` отдаёт сразу `{ x, y }`). Неизвестный ключ — значение из
`attrs`. `.attr()` без аргумента отдаёт только свободные атрибуты.
`.attr('имя', значение)` пишет так же, как одноимённый атрибут в
`$('<тег>', { … })`.

---

## 15. `$.world` — мир

```js
$.world.gravity(0, 1200)          // ускорение свободного падения, px/с²
$.world.bounds(0, 0, 4000, 1200)  // границы: ставит четыре стены (класс world-bound)
$.world.clearBounds()
$.world.color('#101820')          // цвет очистки кадра
$.world.background('bg.png', { parallax: 0.2 })
$.world.pause() .resume() .isPaused()   // «мир без гравитации» — для космоса и аркад сверху
$.world.freeze() .thaw()                // остановить все тела, не трогая гравитацию
$.world.timeScale(0.5)
$.world.spawn('<enemy>', 100, 200)          // → обёртка
$.world.all()                               // все узлы (обёртка)
$.world.count(sel?)                         // узлов в мире (без интерфейса и границ)
$.world.query(x, y, r?)                     // узлы в точке или радиусе
$.world.bodyAt(x, y, { mask })                // узлы тел в точке
$.world.bodiesIn(x, y, w, h, { mask })       // узлы тел в прямоугольнике
$.world.raycast({x,y}, {x,y}, { mask })      // → { hit, point, normal, distance, body, self } | null
$.world.castShape(from, to, { w, h })        // свип формы: пролезет ли объём
$.world.particlesAt(x, y, { r })             // частицы под точкой (см. particles.md)
$.world.particlesIn(x, y, w, h, { r })       // частицы в прямоугольнике
$.world.raycastAll(from, to, { mask })       // → [{ node, t, point, self }, …]
$.world.lineOfSight(from, to, { mask })      // → bool
$.world.sort('layer' | 'y')                 // порядок отрисовки ('layer' = 'z')
$.world.sortWith((a, b) => a.y - b.y)       // свой порядок
```

**Свип формы.** `$.world.castShape(from, to, opts)` везёт объём из `from` в `to`
и возвращает первое препятствие (`{ hit, point, normal, distance, fraction,
body, node, self }` или `null`). Луч отвечает «что на линии», свип — «пролезет
ли мой объём»: им проверяют проёмы, задевание углов плечом, место для
телепорта. Форма задаётся как `{ w, h }` (прямоугольник), `{ radius }` (круг),
`{ capsule: [радиус, половина отрезка] }` или явно (`shape` + `halfW`/`halfH`/
`radius`); `angle` поворачивает её, `mask` и `ignore` работают как у луча.
`fraction = 0` значит «объём уже перекрывается с препятствием».

```js
// Пролезет ли герой в проём: у луча и у объёма ответы разные.
if ($('#hero').sweepTo({ x: 900, y: 200 })) $.log('плечом заденет');
const wide = $.world.castShape({x: 0, y: 0}, {x: 200, y: 0}, { w: 48, h: 64, mask: 0x1 });
```

Лучи и запросы принимают точку, узел-объект, обёртку или селектор:
`$.world.raycast($('#hero'), '#enemy')`. В результате `raycast` есть и `node`
(узел-владелец тела), и `self` — та же обёртка для удобства.

`opts.mask` — биты слоёв, которые запрос принимает (как `collision_mask` у
`RayCast2D` в Godot). Не задан или `0` — все слои. Свой слой у запроса не
спрашивается: маска самого тела на луч не влияет, только маска запроса.

> **`$.world.pause()` — это не пауза игры.** Он выключает гравитацию мира (тела
> продолжают лететь по инерции); пауза игры — `$.time.pause()`, полная остановка
> тел — `$.world.freeze()`. Гравитация и масштаб времени — глобальные: при смене
> сцены `$` возвращает их сам, но если сцена выключала гравитацию, полагаться на
> это в своём `exit()` не нужно — состояние уже сброшено.

## 16. `$.camera` — камера

```js
$.camera.follow('#hero', { smooth: 0.15, offset: [0, -50], zoom: 1.5 })
$.camera.unfollow() .followed()
$.camera.zoom(1.5) .zoomTo(2, 300)
$.camera.panTo(x, y, 500)
$.camera.shake(6, 300)
$.camera.limits(0, 0, 4000, 1200) .limits(null)
$.camera.deadzone(200, 120)
$.camera.at(x, y) .pos()
$.camera.worldToScreen(p) .screenToWorld(p)
$.camera.isOnScreen('#hero') .viewport()
```

## 17. `$.input` — ввод

```js
$.input.down('space') .pressed('space') .released('space')
$.input.axis('a', 'd')                 // -1..1
$.input.vec('wasd' | 'arrows' | 'both')// { x, y } с учётом геймпада
$.input.mouse() .mouseDelta() .mouseWorld()
$.input.mouseDown('left') .mousePressed('left')
$.input.wheel()                        // { x: 0, y: wheel }
$.input.padAxis('leftx') .padDown('a')
$.input.gamepad(0).button('a') .axis('leftx') .connected()
$.input.rumble({ weak: 0.3, strong: 0.8, duration: 400 })   // виброотклик → bool
$.input.rumble(0) .stopRumble() .rumbleSupported()
$.input.bind('jump', ['space', 'w', 'gamepad.a'])
$.input.unbind('jump') .bindings()
$.input.down('jump')                   // имён действий тоже работает
$.input.on('key', e => { })            // e.key, e.pressed, e.shift/ctrl/alt
$.input.on('mouse', e => { }) .on('wheel', e => { }) .on('gamepadOn', e => { })
$.input.off()
$.input.text()                         // символы, набранные за этот кадр
```

`$.input.text()` отдаёт готовый UTF-8 с учётом раскладки и IME — из него
построен контрол `<ui.input>` (см. [widgets.md](highlevel/widgets.md)). Скан-коды
для текстовых полей не годятся: они не знают ни раскладки, ни compose.
В агентском режиме текст набирается командой `text` (см. [AGENT_API.md](AGENT_API.md)).

Имена клавиш человеческие: `'space'`, `'w'`, `'left'`, `'escape'`, `'f1'`,
`'enter'` (=Return), `'leftshift'`. Регистр не важен.

**Виброотклик.** `$.input.rumble(opts)` трясёт первый подключённый геймпад и
возвращает `true`, только если тряска действительно ушла в устройство — без
геймпада (или если он не умеет вибрировать) будет `false`. `weak` — слабый
(высокочастотный) мотор, `strong` — сильный (низкочастотный), значения 0..1,
`duration` — миллисекунды (по умолчанию 250). `triggers: [left, right]` трясёт
курки. `$.input.rumble(0)`, `$.input.stopRumble()` останавливают вибрацию,
`$.input.rumbleSupported()` отвечает, есть ли кому трясти. Адресно —
`$.input.gamepad(0).rumble(...)`; движок открывает один геймпад, поэтому для
`gamepad(1)` и дальше вызов честно вернёт `false`.

```js
$('#hero').on('hit', (e) => $.input.rumble({ weak: 0.2, strong: 0.9, duration: 150 }));
```

## 18. `$.sound` — звук

```js
$.sound.play('hit.wav', { volume: 0.7, loop: false })
$.sound.play('shot.wav', { pitch: 1.2, volume: 0.9 })   // выше и быстрее
$.sound.playAt('boom.wav', x, y, { max: 700 })     // позиционно
$.sound.playAt('boom.wav', '#hero')                // от узла
$.sound.music('theme.ogg', { loop: true, volume: 0.5 })
$.sound.music('theme.ogg', { pitch: 0.8 })         // музыка медленнее и ниже
$.sound.musicPitch() .musicPitch(1.1)
$.sound.crossfade('boss.ogg', 1000) .stopMusic(500)
$.sound.volume(0.8) .mute(true) .sfxVolume(0.5) .musicVolume(0.5)
$.sound.stopAll() .playing(ch) .activeChannels() .duration('x.ogg') .preload(['a.ogg'])
```

Расширение можно не писать: движок сам ищет `.wav`, `.ogg`, `.mp3`, `.flac`.

`{ pitch }` — скорость воспроизведения: `1.0` как записано, `2.0` вдвое быстрее
и на октаву выше. Скорость — свойство канала, а каналы переиспользуются, поэтому
без `pitch` она сбрасывается в `1.0`.

**Комната.** Звук выстрела в комнате 5×5 и в зале 20×20 отличается хвостом
реверберации. Комната задаётся зонами, а слушатель — точкой, узлом или
селектором (см. [audiobus.md](highlevel/audiobus.md) §8):

```js
$.audio.zone('hall',   { rect: [0, 0, 640, 640], height: 6, material: 'concrete' });
$.audio.zone('closet', { rect: [700, 0, 160, 160], height: 2.4, material: 'tile' });
$.audio.listener('#hero');
$.audio.room();          // { wet, room, damp, width } — что сейчас звучит
```

## 19. `$.scene` — сцены

```js
$.scene.add('menu', { enter($) {}, exit() {}, update(dt, $) {}, render($) {} });
$.scene.add('level1', $ => { /* построить мир */ });   // сцена-функция
$.scene.load('level1', { transition: 'fade', ms: 300 });
$.scene.restart();
$.scene.push('pause') .pop() .stack();
$.scene.current()          // имя или null
$.scene.names() .has('x') .remove('x');
$.scene.transition('fade', 300) .busy();
```

Смена сцены **отложена на начало следующего кадра** — поэтому её можно
вызывать прямо из обработчика клика. При смене мир очищается (узлы, тела,
твины, таймеры), кроме узлов с классом `scene-persistent` и интерфейса при
`{ keepUI: true }`.

## 20. `$.ui` — интерфейс

**Весь интерфейс — RmlUi** (§1): меню, экраны, диалоги и оверлеи делаются
документами `.rml` + `.rcss` через `$.ui.doc(...)` — это основной путь.
Узлы `<ui.*>` ниже — быстрый рисователь HUD в координатах окна, а не
интерфейсный слой; они остаются рабочими, но новые меню и экраны на них не
строятся.

```js
$('<ui.bar>', { id: 'hp', value: 100, max: 100 }).at(120, 30).appendTo($.ui);
$.ui.bar('#hp', 50, 100);
$.ui.label('#score', 'Очки: 120');
$('<ui.button>', { id: 'play', text: 'Играть' }).at(640, 400);
$('#play').on('click', () => $.scene.load('level1'));
```

Документы RmlUi — интерфейс игры (вёрстка, стили, шрифты):

```js
const menu = $.ui.doc('ui/menu.rml').show();
menu.text('score', '120').cls('panel', 'hidden', true).style('bar', 'width', '50%');
menu.on('btn-play', 'click', () => $.scene.load('level1'));   // вешается один раз
menu.hide() .visible() .unload();
$.ui.icon('directions_run')    // иконка Material Design (2235 штук встроены)
$.ui.hasIcon('home') .iconNames() .iconCount() .fps()
```

`on()` подписывает **конкретный** элемент документа. Для нескольких кнопок
вызывайте его для каждой (можно цепочкой) — одного обработчика «на весь
документ» с ветвлением по id не бывает:

```js
menu.on('btn-play', 'click', play)
    .on('btn-settings', 'click', settings)
    .on('btn-quit', 'click', quit);
```

## 20.1. `$.window` — окно

Окно игры целиком: имя, размер, режим, курсор и события. Значения по
умолчанию берутся из `project.json` рядом с точкой входа (см. `docs/BUILD.md`),
флаги `--title/--width/--height` их перекрывают, а из игры всё меняется на ходу.

```js
$.window.title('Моя игра');        // заголовок окна и подпись в доке
$.window.title();                  // → 'Моя игра'

$.window.size();                   // { w, h } в точках
$.window.pixels();                 // { w, h } в пикселях (Retina: вдвое больше)
$.window.resize(1600, 900);        // высоту можно не указывать — сохраним пропорции

$.window.fullscreen(true);         // во весь экран
$.window.fullscreen();             // → true
$.window.toggleFullscreen();

$.window.cursor('hidden');         // спрятать курсор (для прицела)
$.window.cursor('crosshair');      // 'normal' | 'hidden' | 'crosshair' | 'hand' | 'text' | 'wait'
$.window.cursor();                 // → 'hidden'

$.window.vsync(false);             // больше кадров, но возможен разрыв
$.window.resizable(false);         // запретить менять размер мышью

$.window.minimize(); $.window.maximize(); $.window.restore();
$.window.show(); $.window.hide(); $.window.focus();
$.window.visible(); $.window.focused();

$.window.position();               // { x, y } на экране
$.window.move(100, 80);
$.window.center();
```

События: `resize`, `focus`, `blur`, `show`, `hide`, `fullscreen`. Движок
опрашивает состояние окна раз в кадр, поэтому событие приходит с точностью до
кадра — для интерфейса этого достаточно.

```js
$.window.on('resize', ({ w, h }) => {
    $('#menu').size(w * 0.6, h * 0.5);      // переложить интерфейс
});

$.window.on('blur', () => $.time.pause());   // ушли в другое окно — пауза
$.window.on('focus', () => $.time.resume());
```

Полное состояние окна — `$.window.state()`, оно же лежит в снимке агента
(`state.window`: имя, размер, режим, курсор, фокус), поэтому автотест может
проверить и имя окна, и реакцию на разворот.

## 21. `$.time` — время

```js
$.time.delta()      // секунды с прошлого кадра (с учётом паузы и scale)
$.time.rawDelta()   // без масштабирования
$.time.now()        // игровое время в секундах
$.time.realNow()    // время с запуска движка
$.time.fps() .frame()
$.time.scale(0.5) .pause() .resume() .toggle() .isPaused()
await $.time.wait(500)
const id = $.time.after(200, fn) / $.time.every(1000, fn)
$.time.cancel(id) .cancelAll()
```

Пауза и масштаб действуют на **игровое время** `$.time.delta()`: твины,
таймеры, `$.time.wait/every/after`, анимацию кадров (`.animate()`), клипы
`$.anim` (включая `$.anim.player`) и машину состояний `$.state`. Реальным
временем живут `$.time.rawDelta()`, `$.gfx.post`-эффекты кадра и тряска
камеры — их пауза не останавливает. Логика игры в `$.update` по-прежнему
вызывается: это её собственное дело — решать, что делать на паузе.

## 22. `$.store` и `$.fs` — сохранения и файлы

```js
$.store.set('highscore', 1200).get('highscore', 0)
$.store.has('x') .remove('x') .clear() .keys() .all() .setAll({ … })
$.store.file('save2.json').save()       // запись файла (→ bool, не цепочка)
$.store.file('save2.json').load()       // чтение файла (→ bool)
$.store.autoSave(30000) .stopAutoSave()

$.fs.readText('data/level.json')      // строка или null
$.fs.readJSON('data/level.json', {})  // объект или значение по умолчанию
$.fs.write('out.txt', 'текст') .writeJSON('out.json', obj)
$.fs.exists('x') .list('data') .remove('x') .basePath()
```

Пути — от корня запуска; абсолютные принимаются как есть.

## 23. `$.gfx` — графика и отладочный слой

```js
$.gfx.color('#101820')          // цвет очистки
$.gfx.size() { w, h }
$.gfx.rgba(255, 0, 0, 128)
$.gfx.color4('#ff0000', 0.5)
$.gfx.culling(false)            // рисовать всё, даже за экраном
$.gfx.stats()                   // { sprites, triangles, texts, nodes }
$.gfx.text('Привет', 100, 640, { size: 20, color: '#fff', align: 'center' })
$.gfx.measureText('Привет', 20) // → [ширина, высота]
$.gfx.textureSize('art/hero.png')// → [ширина, высота] картинки
$.gfx.draw.line(x1, y1, x2, y2, color, width)
$.gfx.draw.rect(x, y, w, h, color)
$.gfx.draw.circle(x, y, r, color)
$.gfx.draw.ring(x, y, r, color, width)
$.gfx.draw.text('hi', x, y, color, size)
$.gfx.draw.arrow(x1, y1, x2, y2, color)
$.gfx.draw.clear()
```

Всё из `$.gfx.draw` и `$.gfx.text` рисуется **поверх сцены**, в координатах окна,
и попадает на скриншот агента.

**Пост-обработка кадра** (сцена уходит в offscreen-текстуру, поверх неё —
эффекты; HUD движок рисует уже после них, поэтому интерфейс остаётся чистым):

```js
$.gfx.post({ glow: 0.25, vignette: 0.3 })            // свечение и вигнетка
$.gfx.post({ lens: 1.1, centerX: 0.5, centerY: 0.5 }) // линза: взрыв, чёрная дыра
$.gfx.post({ chromatic: 0.005, grain: 0.08, scanline: 0.1 })
$.gfx.post({ saturation: 0.3, contrast: 1.2, tint: [1.3, 0.5, 0.5], blood: 0.2 })
$.gfx.post()          // текущие параметры
$.gfx.postOff()       // выключить (кадр идёт прямо на экран)

// Готовые камерные наборы: adventure, forest_night, horror, bloodmoon,
// retro, noir, dream, neutral. Второй аргумент — плавный переход.
$.gfx.postPreset('forest_night')
$.gfx.postPreset('bloodmoon', { ms: 90 })
$.gfx.postPresets()   // список имён
```

**Шейдер узла.** `.shader(вид, параметры)` включает эффект поверх спрайта, не
трогая остальные узлы: `flash` (подсветка цветом), `dissolve` (растворение с
кромкой), `chroma` (расхождение каналов), `wave` (волна по UV). `.shader()`
читает текущий вид, `.shader(null)` выключает; `.shaderParam(имя)` читает
параметр, `.shaderParam(имя, значение)` задаёт. Узлы с одинаковым эффектом и
одинаковыми параметрами рисуются одним вызовом, поэтому эффект почти ничего не
стоит; узлы без шейдера идут прежним конвейером.

```js
$('#hero').shader('flash', { color: '#ff8080', amount: 0.8 });   // попадание
$('#ghost').shader('dissolve', { threshold: 0.45 });             // призрак
$('#glitch').shader('chroma', { offset: 0.006 });                // помехи
$('#lava').shader('wave', { amplitude: 0.04, frequency: 30, phase: $.time.now() * 3 });
$.gfx.fxKinds();   // ['none', 'flash', 'dissolve', 'chroma', 'wave']
```

**Свой шейдер.** `$.gfx.defineShader(имя, исходник)` компилирует фрагментный
шейдер прямо в игре (glslang → SPIR-V, spirv-cross → MSL для Metal), после
чего имя работает везде, где работают встроенные эффекты: `.shader(имя)`,
`.shader(имя, { p1, p2, p3, color })`, `.shaderParam(...)`. Шапку с привязками
движок подставляет сам — `$.gfx.shaderPreamble()` её показывает:

```glsl
#version 450
layout(set = 2, binding = 0) uniform sampler2D u_texture;   // спрайт узла
layout(set = 3, binding = 0) uniform NodeParams { vec4 p; vec4 c; } u;
layout(location = 0) in vec2 v_texcoord;                    // UV внутри спрайта
layout(location = 1) in vec4 v_color;                       // цвет узла
layout(location = 0) out vec4 o_color;                      // результат
```

```js
$.gfx.defineShader('scanline', `
    void main() {
        vec4 c = texture(u_texture, v_texcoord) * v_color;
        float g = step(0.5, fract(v_texcoord.y * 60.0 + u.p.x));
        o_color = vec4(c.rgb * (0.6 + 0.4 * g), c.a);
    }`);
$('#tv').shader('scanline', { p1: $.time.now() * 2 });   // p1 → u.p.y

$.gfx.shadersSupported();   // есть ли компилятор в этой сборке
$.gfx.userShaders();        // ['scanline']
$.gfx.shaderError();        // текст ошибки компилятора или ''
$.gfx.defineShader('плохой', 'void main() { o_color = broken(); }');   // false
```

**Render target игры (`.viewport`).** Кадр можно рисовать не в окно, а в свою
текстуру: `.bind(vp)` делает её целью кадра, `.sprite(vp)` отдаёт спрайт
прошлого кадра, который игра рисует как обычную картинку (шлейфы, накопление,
порталы). Текстур две — текущий кадр и история, поэтому чтения и записи одной
текстуры в одном проходе не бывает. Пока кадр связан, пост-обработка не
применяется, а на экран движок показывает кадр блитом.

```js
const trail = $.viewport.create(800, 600);
// в кадре:
$.viewport.bind(trail);
$.gfx.draw.sprite($.viewport.sprite(trail), 0, 0, 800, 600, { alpha: 0.9 });  // шлейф
$('#hero').at(400, 300);                                                       // сцена
$.gfx.postOff();                       // с связанным viewport'ом пост не считается
```

`$.viewport.supported`, `.count()`, `.size(id)`, `.bind(id)`, `.bind(null)`,
`.bound()`, `.destroy(id)`, `.draw(id, x, y, w, h, opts)`.

**Свечение (bloom) — честное.** Яркий проход с понижением разрешения, два
размытия (горизонталь и вертикаль) и композит — отдельными проходами; в
пост-обработку приходит уже готовая размытая текстура. `glow` — сила
свечения, `bloom_threshold` — порог яркости (по умолчанию `0.75`),
`bloom_radius` — толщина ореола (по умолчанию `1`). Если буферы свечения не
создались (слабый GPU, конец памяти), движок честно откатывается на прежний
однопроходный вариант с восемью выборками — кадр не пропадает.

```js
$.gfx.post({ glow: 0.8, bloom_threshold: 0.6, bloom_radius: 1.6 });
engine.getPost().bloom_ready;    // считалось ли свечение проходами в этом кадре
engine.renderInfo();             // { post, bloom, bloom_w, bloom_h, passes, … }
```

Подробности, ограничения и внутренности — [highlevel/render.md](highlevel/render.md) §3.1.

## 24. `$.debug` и `$.console`

```js
$.debug.on() .off() .toggle() .isOn()      // оверлей движка (F1)
$.debug.stats()                            // { fps, frame_ms, sprites, nodes, bodies, … }
$.debug.profile()                          // { frame_ms, zones_ms, unaccounted_ms, zones: [{name, ms, peak}] }
$.debug.queryStats()                       // { calls, candidates, results, ms, cap, truncated } — последний $().within()
$.debug.profileReset()                     // сбросить накопленное
$.debug.profiling(false)                   // выключить замеры (по умолчанию включены)
$.debug.profiler.start('моё') / .end('моё') / .report()   // свои замеры, время — engine.now()
$.debug.profiler.on(true) .isOn()          // покадровый профайлер подсистем (по умолчанию выключен)
$.debug.draw.line('#hero', '#exit', 'yellow')   // принимает селекторы и узлы
$.debug.draw.rect('#zone', '#door', 'red')
$.debug.watch('hp', () => $('#hero').hp())
$.debug.unwatch('hp') .watches()
$.debug.profiler.start('ai') .end('ai') .report() .reset()

$.console.register('spawn', (args) => $('<enemy>').at(args[0], args[1]), 'spawn x y')
$.console.run('spawn 100 200') .list() .help('spawn') .toggle()
```

## 25. `$.agent` и `$.test` — доступ для программы

```js
$.agent.active      // true в режиме --agent
$.agent.headless .seed .frame() .time()
$.agent.node('#hero')      // краткое описание узла
$.agent.nodes('.enemy')    // список описаний
$.agent.nodes('.enemy', 10)  // …с пределом (его же использует команда query)
$.agent.snapshot()         // полный снимок мира (уходит агенту в ответе на state)
$.agent.install()          // зарегистрировать снимок и инспекцию в движке (зовётся сам)
$.agent.expose('score', () => Global.score)   // своё поле в снимке
$.agent.describe()         // строка для лога

$.test.check($('.enemy').length === 5, 'врагов пятеро')
$.test.equal($('#hero').hp(), 100, 'здоровье целое')
$.test.near(x, 100, 0.5, 'игрок у отметки')
$.test.truthy(...) .falsy(...)
$.test.reset() .results() .report()
```

Снимок содержит `frame`, `time`, `fps`, `scene`, `window`, `camera`, `world`,
`entities` (массив узлов с позицией, здоровьем, видимостью), `ui`, `player` и
всё, что добавлено через `.expose()`.

## 26. Расширение

```js
// fadeOut возвращает Promise, поэтому цепочкой за ним не пойти: собираем шаги.
$.fn.flashAndDie = function () {
    this.flash('#fff', 100);
    return this.fadeOut(200).then(() => this.remove());
};
$('.enemy').flashAndDie();
```

Внутри `$.fn`-метода `this` — обёртка; чтобы применить что-то к каждому узлу,
используйте `this.each((i, e) => { … })`.

## 27. Прочее в `$`

```js
$.color('#f00')        // упакованный цвет
$.alpha(color, 0.5)    // сменить альфу
$.vec(1, 0)            // { x, y }
$.random               // ГПСЧ с зерном из --seed: .next() .range(a,b) .int(a,b) .pick(list) .chance(p)
$.find(sel) .count(sel)
$.log('текст')         // в журнал движка
$.quit()
$.isAgent()            // true в режиме агента
$.fn .selectors .ctx   // внутренности для расширений
```

---

## 28. Ограничения (честно)

Таблица, которая здесь была, закрыта: слои и маски коллизий, виброотклик,
игровое время для клипов, свип формы, частицы в запросах, габарит агента у
tilemap, шейдеры на узел, свои шейдеры, render target игры, честный bloom,
DSP-эффекты и реверб-шины — всё это есть (см. §7, §8, §15, §17, §22, §23 и
`docs/highlevel/*.md`).

Ограничения, которые остались, — не «не сделано», а устройство движка:

| Ограничение | Почему так и что делать |
|---|---|
| DXIL не генерируется (Windows/D3D12) | Встроенные и пользовательские шейдеры собираются в SPIR-V и MSL; для DXIL нужен DXC, которого в зависимостях нет. На D3D12 движок честно пишет об этом в журнал — используйте Vulkan-бэкенд |
| Свой шейдер — только фрагментный | Вершинный шейдер общий (спрайтовый конвейер: позиция, UV, цвет), у шейдера один сэмплер (`u_texture`) и один блок параметров (`u`, два vec4). Этого хватает для эффектов поверхности; своя геометрия — правкой `shaders/sprite_vert.glsl` и пересборкой |
| Компилятор шейдеров занимает место в бинарнике | glslang и SPIRV-Cross линкуются статически. Нужна минимальная сборка — `-DR2D_ENABLE_LIVE_SHADERS=OFF`: тогда `.shader()` работает только со встроенными эффектами, а `$.gfx.shadersSupported()` вернёт `false` |
| Render target — цель всего кадра | Произвольный проход посреди кадра из JS не начать: проходы открывает `main.c`. Связали viewport — пост-обработка в этом кадре не считается (см. §23) |
| Компиляция шейдера синхронная | `$.gfx.defineShader()` компилирует в вызывающем кадре (десятки миллисекунд). Регистрируйте шейдеры на загрузке уровня, а не в игровом цикле |

Формы тел, суставы (`revolute`/`distance`/`weld`), события контакта,
`.width()`/`.height()` как геттеры — всё это есть, см. разделы 6–8.

Ошибки в игровом коде не роняют движок: они уходят в журнал вместе со стеком
(`$: ошибка в $.update: …`) и в отладочный оверлей.

### Грабли, на которых уже спотыкались

Три штуки, которые «молча не работают», уже починены — но в старых сборках и
примерах могут встречаться:

| Как писали | Что было | Сейчас |
|---|---|---|
| `$('<sprite>', { src: 'hero.png' })` | `src` оседал в `attrs`, текстура не грузилась — работал только `.sprite()` | Грузится, как `.sprite()`; то же для `{ frames }` |
| `.attr('id')`, `.attr('hp')`, `.attr('x')` | Возвращали `undefined`: `.attr()` смотрел только в `attrs`, хотя `.attr('src')` работал | Читают свойства узла, а если такого свойства нет — атрибут |
| `.tag('friendly')` | Добавлял **класс**, а не тег | Добавляет тег, как и написано в разделе 14 |

Ещё два места, где легко ошибиться уже сейчас:

* `$.world.pause()` — это выключенная гравитация, а не пауза игры (пауза — `$.time.pause()`);
* `.attr('имя')` и `.data('имя')` — разные хранилища: первое читает свойства и атрибуты узла, второе только собственный словарь `.data()`.

---

## 29. Полный пример

```js
// game/main.js — платформер на 60 строк
const MASCOT = { src: 'demos/assets/art/mascot/russiano_mascot_sheet.png',
                 cols: 8, rows: 4, cw: 176, ch: 176 };

$.ready(() => {
    $.world.gravity(0, 1600).color('#0d1117').bounds(-200, -400, 4000, 1600);

    $('<player>', { id: 'hero' })
        .at(200, 400).size(48, 64)
        .frames(MASCOT).animate({ from: 0, to: 7, speed: 10 })
        .health(100).controls('both').collision(40, 60)
        .appendTo($.world);

    for (let i = 0; i < 6; i++) {
        $('<sprite>', { class: 'coin' })
            .at(400 + i * 120, 300).size(24, 24).color('#ffd54a')
            .on('pickup', e => { e.self.remove(); $.sound.play('pickup.ogg'); })
            .appendTo($.world);
    }

    $('<wall>').at(0, 620).size(4000, 40).color('#2a3240').appendTo($.world);
    $('<ui.bar>', { id: 'hp', value: 100, max: 100 }).at(120, 28).appendTo($.ui);

    $.camera.follow('#hero', { smooth: 0.2 }).limits(-200, -400, 4000, 1600);
});

$.update(() => {
    $.ui.bar('#hp', $('#hero').hp(), 100);
    $('.coin').each((i, c) => {
        if (c.distanceTo('#hero') < 40) c.emit('pickup');
    });
    if ($('#hero').hp() <= 0) $.scene.restart();
});
```

---

## 30. Подсистемы после аудита API

Эти подсистемы добавлены по итогам сверки с Godot 4.x (2D) — разбор пробелов
и приоритетов в [GAP_ANALYSIS.md](GAP_ANALYSIS.md). Каждая живёт в своём файле
`src/highlevel/<имя>.js`, ставится из `api.js` и обновляется в кадре своей
`tick`-функцией.

> **Про интерфейсные подсистемы ниже** (`$.ui`-контролы, `$.screen`, `$.dialog`,
> `$.story`, `$.timeline`, `$.loading`): они работают на узлах `<ui.*>` и
> остаются для существующих игр, но закон интерфейса — RmlUi
> ([UI_RMLUI_LAW.md](UI_RMLUI_LAW.md)): новые меню, экраны и диалоги делаются
> документами `.rml` + `.rcss` через `$.ui.doc`.

| Подсистема | Пространство имён | Теги | Подробно |
|---|---|---|---|
| Анимация клипами и машина состояний | `$.anim` | — | [anim.md](highlevel/anim.md) |
| Анимационный плеер: таймлайны в мс, события, микширование | `$.anim.player`, `$.anim.clip` | — | [animplayer.md](highlevel/animplayer.md) |
| Свет в стиле Candle: тени, конус, площадной свет, туман | `$.gfx.light`, `$.gfx.fog` | `<light>`, `<lightarea>`, `<fog>` | [render.md](highlevel/render.md) §3.0 |
| TileMap: слои, автотайл, террейны, Y-sort | `$.tilemap` | `<tilemap>` | [tilemap.md](highlevel/tilemap.md) |
| CPU-частицы | `$.particles` | `<particles>` | [particles.md](highlevel/particles.md) |
| Навигация: A*, агент, navmesh | `$.nav` | — | [nav.md](highlevel/nav.md) |
| Prefab и сериализация сцен | `$.prefab` | — | [prefab.md](highlevel/prefab.md) |
| Аудио-шины и эффекты | `$.audio` | — | [audiobus.md](highlevel/audiobus.md) |
| Комната и акустика помещений | `$.audio.room/zone/listener`, `$.sound.play({ pitch })` | — | [audiobus.md](highlevel/audiobus.md) §8 |
| VFX: ленты, молнии, волны, поля сил | `$.fx` | — | [fx.md](highlevel/fx.md) |
| Канвас-слои, параллакс, fade | `$.layers` | `<layer>` | [layers.md](highlevel/layers.md) |
| UI-контролы: контейнеры, ввод, якоря, темы | `$.ui` (дополнение) | `<ui.row>` и др. | [widgets.md](highlevel/widgets.md) |
| Таймлайн-сцены: диалоги и визуальные новеллы | `$.timeline`, `$.animatedTimelineScene2d` | — | [timeline.md](highlevel/timeline.md) |
| Tween в стиле Godot | `$.tween` | — | [tween.md](highlevel/tween.md) |
| Зоны `enter`/`leave` | `$.triggers` | `<trigger>` | [triggers.md](highlevel/triggers.md) |
| Локализация | `$.i18n`, `$.tr` | — | [i18n.md](highlevel/i18n.md) |
| Пул объектов | `$.pool` | — | [pool.md](highlevel/pool.md) |
| HTTP-запросы | `$.http` | — | [http.md](highlevel/http.md) |
| Blend-режимы и подвьюпорты | `$.blend`, `$.gfx.blend`, `$.viewport` | — | [render.md](highlevel/render.md) |
| Сохранения: слоты, версии, миграции, автосейв | `$.save` | — | [save.md](highlevel/save.md) |
| Реестр ресурсов: ленивая загрузка, ссылки, выгрузка | `$.resource` | — | [resource.md](highlevel/resource.md) |
| Математика, векторы, прямоугольники | `$.math` | — | [mathx.md](highlevel/mathx.md) |
| Детерминированный ГПСЧ и шум | `$.random` | — | [random.md](highlevel/random.md) |
| Сеточные помощники: клетки, линии, заливка | `$.grid` | — | [grid.md](highlevel/grid.md) |
| CSV/TSV и безопасный JSON | `$.csv` | — | [csv.md](highlevel/csv.md) |
| Русские имена API: теги, атрибуты, методы | `$.ru` | `<свет>` и др. | [ru.md](highlevel/ru.md) |
| Машина состояний игры | `$.state`, `.fsm()`, `.fsmSend()` | — | [state.md](highlevel/state.md) |
| Сигналы: шина событий | `$.signal` | — | [signal.md](highlevel/signal.md) |
| Потоки и таймеры на игровом времени | `$.flow` | — | [flow.md](highlevel/flow.md) |
| Диалоги: ветки, условия, печатная машинка | `$.dialog` | `<ui.dialog>` | [dialog.md](highlevel/dialog.md) |
| Экраны и меню: раскладка, фокус | `$.screen` | `<ui.row>` и др. | [screen.md](highlevel/screen.md) |
| Именованные текстовые стили | `$.font` | — | [font.md](highlevel/font.md) |
| Спрайтовые атласы из JSON (Aseprite, TexturePacker) | `$.atlas` | — | [atlas.md](highlevel/atlas.md) |
| Кривые плавности и градиенты (общий `ease` для твинов) | `$.curve` | — | [curve.md](highlevel/curve.md) |
| Работа кусками по кадрам (генерация, тёплая загрузка) | `$.task`, `$.scene.loadAsync` | — | [task.md](highlevel/task.md) |
| Перезапуск скриптов на границе кадра (hot reload) | `$.script` | — | [script.md](highlevel/script.md) |
| Сценки и катсцены: текстовый DSL, реплики, выборы, флаги | `$.story` | — | [story.md](highlevel/story.md) |
| Задания: цели, условия открытия, события рейда, награда | `$.quest` | — | [quest.md](highlevel/quest.md) |
| Банки звуков, шаги по материалу, реплики NPC | `$.sound.playBank`, `$.steps`, `$.barks` | — | [sound_bank.md](highlevel/sound_bank.md) |
| Предметы и инвентарь: клетки, стопки, вес, ношение | `$.items`, `$.inv` | — | [items.md](highlevel/items.md) |
| Здоровье по зонам, урон, кровь, броня | `$.combat` | — | [combat.md](highlevel/combat.md) |
| Оружие: база стволов, магазин, темп, отдача, навесное | `$.weapons` | — | [weapons.md](highlevel/weapons.md) |
| Генерация рейда: районы, рельеф, постройки, стриминг чанков | `$.raid` | — | [raid.md](highlevel/raid.md) |
| Граф кадров персонажа (псевдо-3D): водители, узлы, зеркало | `$.cels` | — | [cels.md](highlevel/cels.md) |
| Z-буфер и псевдо-3D: глубина, меш, управление тестом | `$.gfx.depth` | — | [depth.md](highlevel/depth.md) |
| Процедурный пиксель-арт: палитры, силуэт, свет, лист | `$.proc` | — | [proc.md](highlevel/proc.md) |
| Психика NPC и режиссёр рейда: страх, срывы, давление | `$.alive` | — | [alive.md](highlevel/alive.md) |
| Сеть, только авторитарная: id, владение, снапшоты | `$.net` | — | [net.md](highlevel/net.md) |
| Время, окно, файлы, сцены, ввод, мир, камера, интерфейс, звук, BSP | `$.time`, `$.window`, `$.fs`, `$.scene`, `$.input`, `$.world`, `$.camera`, `$.ui`, `$.sound`, `$.world.bsp` | — | [time](highlevel/time.md), [window](highlevel/window.md), [store](highlevel/store.md), [scene](highlevel/scene.md), [input](highlevel/input.md), [world](highlevel/world.md), [camera](highlevel/camera.md), [ui](highlevel/ui.md), [sound](highlevel/sound.md), [bsp](highlevel/bsp.md), [replay](highlevel/replay.md) |
| Текст в сцене и шрифты: растеризация глифов, атлас, семейства | `$.font.load`, `.font()`, `<text>` | — | [text.md](highlevel/text.md) |

Физика в этой таблице не отдельной подсистемой, а частью ядра: формы тел,
односторонние платформы, события контакта и суставы описаны в разделе 8 выше
и в [API.md](API.md).

### Свет в стиле Candle (`<light>`, `<lightarea>`, `<fog>`)

Узел `<light>` умеет не только мягкое пятно, но и честные тени: из центра
выпускаются лучи, каждый упирается в препятствие, и по этим расстояниям
строится концентрический веер — градиент мягкий, кромка тени резкая.

```js
$.gfx.light.occluders([{ x: 400, y: 200, w: 32, h: 200 }]);   // или .tiles(...)

$('<light>', { radius: 320, color: '#ffd9a0' })
    .at(200, 300).blend('add')
    .shadows(true)            // тени от препятствий
    .cone(70, 0.3)            // конус 70° с растушёвкой кромки
    .flicker(0.18, 9)         // дрожание, как у свечи
    .appendTo($.world);

$('<lightarea>', { radius: 150, samples: 4, shadows: true })
    .at(620, 480).size(220, 12).blend('add').appendTo($.world);

$('<fog>', { color: '#8899bb', density: 0.4, layers: 4 })
    .at(400, 300).size(800, 600).appendTo($.world);
$.gfx.fog({ color: '#8899bb', density: 0.25, ground: 0.6 });   // экранный слой
```

Свет с `.punch(true)` рисуется поверх тумана: фонарь «прорезает» дымку.
Подробности, таблицы полей и ограничения — [render.md](highlevel/render.md) §3.0.

### Анимационный плеер (`$.anim.player`)

Дополняет `$.anim` (anim.js), ничего в ней не заменяя: клипы-таймлайны с
дорожками `position`/`scale`/`rotation`/`alpha`/`color`/`sprite`/`value`,
время ключей в миллисекундах, события-ключи (`call` и подписки), собственные
часы (`play`, `stop`, `seek`, `speed`, `loop`, `pause`) и микширование клипов.

```js
$.anim.clip('run', {
    duration: 600, loop: 'loop',
    tracks: [
        { type: 'sprite', fps: 12, from: 0, to: 5 },
        { type: 'value', name: 'stamina', keys: [{ t: 0, v: 100 }, { t: 600, v: 40 }] },
        { type: 'event', keys: [{ t: 300, name: 'step', call: () => $.sound.play('step') }] },
    ],
});
$.anim.target('#hero').play('run').speed(1.5);
$.anim.player('hero').blend('walk', 'run', 0.5);   // кроссфейд
$.anim.player('hero').on('step', () => $.log('шаг'));
```

Время берётся только из `dt` кадра (детерминизм в `--fixed-dt`), реестр клипов
плеера отдельный от `$.anim.define`. Подробно — [animplayer.md](highlevel/animplayer.md).

Короткий пример, где заняты сразу несколько:

```js
$.ready(() => {
    $.anim.define('hit', {
        duration: 160, loop: 'once',
        tracks: [{ prop: 'scale_x', keys: [{ t: 0, v: 1 }, { t: 1, v: 1.5, ease: 'quadOut' }] }],
    });

    $.tilemap.fromASCII(['###......', '###..###.'], { '#': 1, '.': 0 },
                        { src: 'tiles.png', tile: 32, solid: true })
        .at(0, 0).appendTo($.world);

    const boom = $('<particles>', { amount: 24, lifetime: 500, speed: [60, 180] })
        .at(200, 200).appendTo($.world);

    const grid = $.nav.grid({ x: 0, y: 0, w: 1280, h: 720, cell: 32, agentRadius: 16 });
    grid.buildFromWalls({ tags: ['wall'], agentRadius: 16 });

    $('#hero').navigateTo('#goal', { speed: 240, onArrive: () => boom.burst(24) });
    $('#hero').playClip('hit');
});
```

Ключевые правила:

* **`agentRadius` у навигационной сетки** — запас на габарит агента. Без него
  путь идёт вплотную к стене, и тело в неё упирается: сетка описывает точки, а
  не объём.
* **Коллизии TileMap** пересобираются по позиции узла на момент `.rebuild()`:
  подвинули карту — вызовите `.rebuild()`.
* **`<particles>` и `<tilemap>` рисуются модулями** через реестр
  `registerNodeRenderer` и общий батч `$.gfx.push`, поэтому лишних draw call'ов
  не появляется.
* **Аудио-шины** пересчитывают громкость живых каналов через новые
  `engine.audio.setChannelVolume/setChannelEffect` (см. [API.md](API.md)).
* **Blend-режимы** работают на уровне узла (`.blend('add')`) и кадра
  (`$.blend('add')`); движок сам режет батч на участки с одинаковым режимом,
  так что порядок отрисовки не меняется.
* **Текст в `<ui.input>`** приходит через `$.input.text()`
  (`engine.textInput()`), в агентском режиме — командой `text`.

---

## 31. `$.fx` — эффекты своими руками

Ленты, молнии, ударные волны, вспышки и поля сил. Всё рисуется тем же батчем,
что и спрайты, поэтому эффекты попадают в кадр сцены и не добавляют draw call'ов.
Подробности и параметры — [highlevel/fx.md](highlevel/fx.md).

```js
// Трассер и вспышка у дула
$.fx.ribbon([muzzle, hitPoint], { ms: 90, width: 5, color: '#ffd27f', blend: 'add' });
$.fx.pulse(muzzle.x, muzzle.y, { radius: 28, ms: 90, color: '#ffe0a0' });

// Удар: волна + тряска камеры + микро-стоп кадра
$.fx.impact(point.x, point.y, { radius: 60, shake: 4, hitStop: 60 });

// Молния и лента за целью
$.fx.lightning('#hero', '#enemy', { life: 120, jitter: 12, branches: 2 });
const trail = $.fx.trail('#hero', { ms: 350, width: 10, color: '#8fd8ff' });
trail.stop();

// Чёрная дыра: поле тянет частицы, потом схлопывается
$.fx.attractor(x, y, { radius: 280, strength: 1600, swirl: 1.2, life: 2800 });
$.fx.shockwave(x, y, { radius: 420, ms: 520, width: 16, color: '#c9a6ff' });
```

Что важно помнить:

* `$.fx.attractor` действует на **частицы** (`$.particles`), а не на тела Box2D —
  тела тянут обычными силами;
* эффекты принадлежат сцене: при `$.scene.load()` они сбрасываются сами;
* `<light>` теперь рисуется мягким радиальным пятном, а не плоским кругом.

## 32. Утилиты, данные и русские имена

Подсистемы ниже добавлены после аудита: закрывают то, что каждая игра писала
себе сама. Каждая живёт в своём файле `src/highlevel/<имя>.js`.

### `$.math` — математика, векторы и прямоугольники

Чистые функции для игровой логики: интерполяция, сглаживание, углы, векторы
и прямоугольники. Состояния нет, к движку не обращается.

```js
const k   = $.math.clamp(hp / maxHp, 0, 1);
const t   = $.math.smoothstep(0, 0.4, elapsed);
cam.x     = $.math.approach(cam.x, target.x, 12, $.time.delta());
const dir = $.math.vecNormalize($.math.vecSub(hero.pos(), enemy.pos()));
const hit = $.math.rectOverlap(view, $.math.rect(node.x, node.y, 32, 32));
```

Числа: `clamp lerp inverseLerp remap moveTowards smoothstep approach wrap
pingPong snap angleDiff deg rad sign roundTo`. Векторы: `vec2 vecLength
vecLengthSq vecNormalize vecAdd vecSub vecScale vecDot vecDist vecLerp
vecRotate vecFromAngle vecAngle`. Прямоугольники: `rect rectContains
rectOverlap rectIntersect rectCenter rectGrow`.
Подробности — [mathx.md](highlevel/mathx.md).

### `$.random` — детерминированный ГПСЧ и шум

Тот же генератор, что и раньше (`next/range/int/pick/chance`), плюс
`shuffle gaussian weighted noise1D noise2D`. Один seed → одна
последовательность: воспроизводимость тестов и `--fixed-dt` сохраняется.

```js
$.random.seed(level.seed);
const type = $.random.weighted([{ value: 'goblin', weight: 10 }, { value: 'dragon', weight: 1 }]);
const x    = $.random.range(0, arena.w);
const h    = 0.6 * $.random.noise2D(x / 64, y / 64) + 0.4 * $.random.noise2D(x / 16, y / 16, 777);
```

`$.random.seed(n)` перезапускает серию, `seed()` без аргумента возвращает
текущее зерно. Шум — чистая функция координаты, от состояния ГПСЧ не
зависит. Подробности — [random.md](highlevel/random.md).

### `$.grid` — сеточные помощники

Плоский массив значений + явная система координат (левый верхний угол, размер
клетки). Не заменяет `$.nav`: путь ищет `$.nav`, а `$.grid` — «что под
курсором», заливка, линии, соседи.

```js
const g = $.grid.make({ x: 0, y: 0, cell: 16, cols: 40, rows: 30, fill: 0 });
const c = $.grid.toCell(g, mouse.x, mouse.y);
if ($.grid.inBounds(g, c.cx, c.cy)) $.grid.set(g, c.cx, c.cy, 'wall');
$.grid.line(g, 0, 0, 39, 29, 'ray');          // Брезенхэм
$.grid.flood(g, 10, 10, 'water');             // заливка, 4/8 связная
```

Полный список: `make toCell toWorld cellRect bounds inBounds at set fill clear
count rect line bresenham flood forEach neighbors`.
Подробности — [grid.md](highlevel/grid.md).

### `$.csv` — CSV/TSV и безопасный JSON

```js
const weapons = $.csv.parseTable($.fs.readText('data/weapons.csv'));   // [{ name, damage }, …]
const rows    = $.csv.parse('a,"b,c"\n1,2');                          // [['a','b,c'], ['1','2']]
const text    = $.csv.stringify(rows, { delimiter: '\t', eol: '\r\n' });
const cfg     = $.csv.jsonParse($.fs.readText('config.json'), { volume: 1 });   // битый файл → запасное
$.fs.write('config.json', $.csv.jsonStringify(cfg, true));
```

`parse` понимает кавычки, `""`, переводы строк внутри поля и CRLF, сам
определяет разделитель (`detectDelimiter`), `parseTable` берёт ключи из первой
строки. `jsonParse`/`jsonStringify` не бросают исключений: ошибка уходит в
журнал, наружу — запасное значение или `null`.
Подробности — [csv.md](highlevel/csv.md).

### `$.save` — сохранения: слоты, версии, миграции, автосейв

Снимок состояния игры в файл-слот: данные `$.store`, мир в формате `$.prefab`
и метаданные (кадр, время, сцена). У слота есть версия, старые сохранения
доезжают через миграции, а `export()`/`import()` дают ту же запись строкой —
для `$.http`, буфера обмена и тестов.

```js
$.save.dir('saves');                        // каталог слотов (по умолчанию saves)
$('#save-1').on('click', () => $.save.slot(1).save());
$('#load-1').on('click', () => $.save.slot(1).load());
$.save.autosave(60000);                     // автосейв в слот 0, текущий не трогает

const text = $.save.export();               // та же запись строкой
$.save.import(text, { store: 'merge' });    // дополнить данные, не заменяя
```

| Функция | Назначение |
|---|---|
| `$.save.save(slotOrOpts?, opts?)` / `.load(...)` | записать / прочитать слот |
| `$.save.slot(n)` / `.dir(path?)` / `.path(slot?)` | текущий слот, каталог, путь |
| `$.save.exists(slot?)` / `.list(opts?)` / `.info(slot?)` / `.remove(slot?)` | слоты каталога |
| `$.save.snapshot(opts?)` / `.apply(payload, opts?)` | снимок и его применение без диска |
| `$.save.export(opts?)` / `.import(text, opts?)` | строка JSON |
| `$.save.autosave(ms?, slot?)` / `.stopAutosave()` | автосейв по игровому времени |
| `$.save.counter(key, delta?)` | счётчик в `$.store` |
| `$.save.stats()` | сводка модуля и `last_error` |

`opts` записи: `world`, `store`, `speeds`, `meta`; загрузки — те же плюс
`clear` (чистить мир перед восстановлением) и `store: 'merge'`.
Формат слота, миграции и ограничения — [save.md](highlevel/save.md).

### `$.resource` — реестр ресурсов

Имена для ассетов: текстуры, спрайты, кадры листов, звуки, json/text и
значения из кода. Загрузка ленивая, значения кэшируются по имени, у каждого
ресурса счётчик ссылок, а `free()` выгружает его, когда ссылок не осталось.

```js
const tiles = $.resource.load('tiles', 'assets/tiles.png');          // ссылок 1
$.resource.define('shot', { kind: 'sound', path: 'sfx/shot.wav' }); // лениво
$.resource.get('shot');                                             // загрузка здесь
$.resource.get('hero-sheet');                                       // массив кадров
$.resource.preload();                                               // экран загрузки
$.resource.free('tiles');                                           // 0 → выгружен
```

| Функция | Назначение |
|---|---|
| `$.resource.define(name, spec)` | описать ресурс, не загружая |
| `$.resource.load(name, spec?)` | взять ресурс (+1 ссылка), кэш по имени |
| `$.resource.get(name, fallback?)` | значение без ссылки (ленивая загрузка) |
| `$.resource.reload(name)` / `.free(name)` / `.freeAll()` | перезагрузить, отпустить, выгрузить |
| `$.resource.preload(names?)` | прогреть кэш → `{ loaded, failed, total }` |
| `$.resource.has/names/list/stats/info/error` | состояние реестра |
| `$.resource.remove(name)` / `.clear()` | забыть ресурс(ы) |

Виды: `texture`, `sprite`, `sheet`, `sound`, `json`, `text`, `data`
(`inferKind` выводит вид по расширению). Ограничения (движок не отдаёт API
выгрузки текстур и звуков) — [resource.md](highlevel/resource.md).

### `$.ru` — русские имена API

Второй полноценный набор имён: теги, атрибуты конструктора, методы узлов и
пространства имён. Латиница остаётся основным набором, русский — надстройкой,
причём это **ссылки**, а не копии: `$.мир === $.world`, а `.цвет()` — та же
функция, что `.color()`.

```js
$.мир.gravity(0, 0).bounds(0, 0, 800, 600);

$('<свет>', { 'радиус': 280, 'цвет': '#ffd9a0', 'тени': true })
    .в(200, 300).смешать('add').конус(70).добавитьВ($.мир);

$('<игрок>', { id: 'герой' }).в(100, 300).скорость(220).управление('wasd')
    .на('смерть', () => $.сцена.load('конец')).добавитьВ($.мир);

$('игрок').цвет('#ffd9a0');          // селектор тоже по-русски
```

Узел при этом создаётся с **каноническим** тегом: отрисовка, селекторы,
префабы и снимок для агента видят обычный `<light>`. Свои псевдонимы —
`$.aliasTag('камень', 'wall')`. Таблицы имён и ограничения —
[ru.md](highlevel/ru.md).

### `$.state`, `$.signal`, `$.flow` — логика и состояния

Три подсистемы про «что происходит в игре»: машина состояний, шина событий и
сценарные последовательности. Они ничего не рисуют и не зависят от физики,
поэтому проверяются юнит-тестами без движка.

* `$.state` — FSM для узлов и игры: переходы по событиям, `guard`-условия,
  `can()` без побочных эффектов, составные состояния, история и хуки
  `onEnter/onExit/onTransition`. Привязка к узлу — `.fsm('hero')`, текущее
  состояние — `$('#hero').fsm()`, событие — `$('#hero').fsmSend('jump')`.
* `$.signal` — именованные сигналы: `on/once/off/emit/clear`, приоритеты,
  отложенная доставка (`emit` внутри `emit` встаёт в очередь) и
  `waitFor('x').then(...)`.
* `$.flow` — `series/parallel/delay/after/repeat/cancel/cancelAll` поверх
  игрового времени: пауза и `$.time.scale` на них действуют, а при
  `--fixed-dt` прогон детерминирован.

```js
$.ready(() => {
    $.state.create({
        name: 'hero', initial: 'idle',
        states: {
            idle: { on: { jump: 'air', move: { target: 'run', guard: (m) => m.data.moving } } },
            run:  { on: { stop: 'idle', jump: 'air' } },
            air:  { initial: 'up', states: { up: { on: { land: 'down' } },
                                            down: { on: { land: 'idle' } } } },
        },
    });
    $('#hero').fsm('hero').fsmSend('jump');                 // сейчас air.up
    $.state.get('#hero').onEnter('air', () => $.sound.play('whoosh'));

    $.signal.on('enemy:died', (enemy, score) => {
        $.store.set('score', ($.store.get('score') || 0) + score);
    }, { priority: 100 });

    const intro = $.flow.series([
        400,
        () => $.sound.play('rumble'),
        () => $.flow.parallel([$.flow.delay(600), () => $.camera.shake(6, 300)]),
    ]).then(() => $.log('дверь открыта'));

    $.signal.on('player:died', () => intro.cancel());
});
```

Что помнить:

* **`.fsm()` — метод узла, а не `.state()`**: `.state()`/`.stateMachine()`
  заняты анимацией клипов (`$.anim`); это разные машины, они не конфликтуют.
* **`guard` и динамическая цель вызываются в `can()`** — побочные эффекты
  держите в `action`/`enter`/`exit`.
* **Потоки идут по игровому времени**, `Date.now()` нигде не используется.
* **Сигналы живут дольше сцены**: чистите их `$.signal.clear()` при смене
  сцены, иначе старые замыкания будут держать удалённые узлы.

Подробности — [state.md](highlevel/state.md), [signal.md](highlevel/signal.md),
[flow.md](highlevel/flow.md).

### `$.dialog`, `$.screen`, `$.font` — диалоги, экраны и текст

* `$.dialog` — ветвящиеся диалоги: реплики описываются данными
  (`nodes: { start: { text, speaker, choices: [{ text, to, if, do }] } }`),
  есть выбор по индексу и по тексту, условия на ветках, эффект печатной машинки
  (`speed`, `skip()`), портреты, события `start/end/choice` и работа с ключами
  `$.i18n` вместо готового текста.
* `$.screen` — вёрстка экрана из `ui.*`-узлов без ручных координат: строки,
  колонки, сетка, отступы, якоря, навигация фокусом с клавиатуры
  (`next/prev/activate`) и мышью.
* `$.font` — именованные текстовые стили (`$.font.define('hud', { size, color,
  align })`, `$.font.apply(node, 'hud')`), чтобы не повторять одни и те же
  параметры текста по коду. Существующие `$.gfx.text`, `.fontSize()` и `.text()`
  не заменяются — это надстройка.

```js
$.ready(() => {
    $.font.define('speech', { size: 22, color: '#f4e9d0', align: 'left' });
    $.dialog.define({
        start: { speaker: 'Ведьма', text: 'Кто здесь?',
                 choices: [{ text: 'Я', to: 'me', do: () => $.sound.play('ui') },
                           { text: 'Уйти', to: 'end', if: (s) => !s.flags.brave }] },
        me:    { text: 'Свои.', to: 'end' },
    });
    $.dialog.play('start');
    $.dialog.on('end', () => $.screen.open('pause'));

    $.screen.define('pause', { center: true, rows: [
        { text: 'Пауза' },
        { text: 'Продолжить', action: () => $.screen.close() },
        { text: 'Выход', action: () => $.scene.load('menu') },
    ] });
});
```

Подробности — [dialog.md](highlevel/dialog.md),
[screen.md](highlevel/screen.md), [font.md](highlevel/font.md).

Дальше: [AGENT_API.md](AGENT_API.md) — как этим управлять программой,
[RECIPES](tutorial-platformer.md) и [API.md](API.md) — низкий уровень.
