# Моя первая игра: платформер с маскотом

За 15 минут — от пустой папки до играбельного уровня, а затем до меню, смены
сцен и сборки в один исполняемый файл. Героиня — зелёноволосая маскот
Russiano2D. Всё построено на одном объекте `$`: без классов и вызовов
`engine.*`.

**Шаг 0** даёт результат за минуту, **шаги 1–12** собирают уровень,
**шаги 13–15** — меню, сцены и сборку. В конце — листинг целиком.

Справочник — [HIGH_LEVEL_API.md](HIGH_LEVEL_API.md); глубже про меню и сцены —
[tutorial-menus.md](tutorial-menus.md); сборка — [BUILD.md](BUILD.md); живой
пример — [`demos/platformer/index.js`](../demos/platformer/index.js).

![Платформер](screenshots/platformer.png)

**План:** 0 hello world · 1 каталог · 2 мир · 3 маскот · 4 ввод · 5 анимация ·
6 платформы · 7 монеты · 8 HUD · 9 камера · 10 смерть и финиш · 11 звук ·
12 сохранение · 13 меню и кнопки · 14 сцены · 15 сборка.

---

## Шаг 0. Hello world: игра за минуту

Создайте `mygame/main.js` и запустите — больше ничего не нужно:

```js
// mygame/main.js — самая маленькая запускаемая игра
$.ready(() => {
    $.world.color('#101820');
    $('<rect>', { id: 'box' }).at(100, 100).size(64, 64)
        .color('#4fd166').appendTo($.world);
    let x = 100, dir = 1;
    $.update(dt => {
        x += dir * 160 * dt;                  // 160 px/с
        if (x > 500) dir = -1;
        if (x < 100) dir = 1;
        $('#box').at(x, 100);
    });
});
```

Запуск: `./build/russiano2d --game mygame`; точка входа — `<каталог>/main.js`,
пути к ассетам — от корня запуска. Камера по умолчанию стоит в `(0, 0)` —
центре окна, поэтому, например, `(5000, 0)` уже за кадром.

**На экране:** тёмный фон, зелёный квадрат едет вправо и обратно.

## Шаг 1. Каталог и запуск

```
mygame/
  project.json     имя окна и стартовый размер
  main.js          вся игра
```

Запуск: `./build/russiano2d --game mygame`; точка входа — `<каталог>/main.js`.
Манифест рядом с ней необязателен:

```json
{ "title": "Моя первая игра", "width": 1280, "height": 720 }
```

Ассеты уже лежат в репозитории движка. **Пути считаются от корня запуска**,
поэтому пишутся целиком: `demos/assets/art/mascot/...` (в сборке — `--add`, шаг 15).

**На экране:** пустое окно с заголовком «Моя первая игра».

## Шаг 2. Мир и гравитация

```js
// mygame/main.js
let coins = [], animState = '';
let score = 0, collected = 0, lives = 3, won = false;
const W = 1920, DEATH_Y = 420, SPAWN = { x: 0, y: 150 };
$.ready(() => {
    $.world.gravity(0, 2000).color('#5fcde4');   // «вниз» — положительное Y
});
```

`$.ready` вызывается один раз, на первом кадре: `$` уже готов. `$.update(fn)`
выполняется каждый кадр, `fn(dt, $)`.

**На экране:** однотонный голубой фон — мир пока пуст.

## Шаг 3. Маскот: лист кадров

Лист маскота — 8×4 кадров по 176×176; номер кадра `строка * 8 + столбец`.
Строки — состояния: 0 покой, 1 ходьба, 2 прыжок и полёт.

```js
const MASCOT = {
    src: 'demos/assets/art/mascot/russiano_mascot_sheet.png',
    cols: 8, rows: 4, cw: 176, ch: 176,
};
const ANIM = {
    idle: { from: 0,  to: 3,  speed: 5,  loop: true },   // ряд 0
    walk: { from: 8,  to: 13, speed: 13, loop: true },   // ряд 1
    air:  { from: 21, to: 23, speed: 9,  loop: true },   // ряд 2
};
function buildHero() {
    return $('<player>', { id: 'hero' })
        .at(SPAWN.x, SPAWN.y)
        .size(48, 64)          // как рисуется
        .collision(28, 56)     // хитбокс: тело пересоздаётся под него
        .health(100)
        .frames(MASCOT)        // задать лист
        .animate(ANIM.idle)    // и запустить анимацию
        .appendTo($.world);
}
// в $.ready: buildHero();
```

`.frames({ src, cols, rows, cw, ch })` запоминает кадры, `.frame(n)` показывает
один, `.animate({ from, to, speed, loop })` листает диапазон.

**На экране:** маскот стоит на земле, кадры покоя сменяются — она «дышит».

## Шаг 4. Ввод и управление

Проще всего отдать управление движку — добавьте в цепочку `buildHero()`:

```js
        .controls({ axis: 'both', jump: 'space' })
```

Движок сам читает WASD и стрелки, двигает тело и прыгает по Space/W/↑, только
когда узел на земле. Свой контроллер пишется тоже коротко:

```js
$.update(dt => {
    const v = $.input.vec('both');                 // { x, y }, -1..1
    $('#hero').velocity(v.x * 250, $('#hero').velocity().y);
    if ($.input.pressed('space') && $('#hero').onFloor()) $('#hero').jump(640);
});
```

`$.input.down('a')` — клавиша удерживается, `.pressed('space')` — нажата в этом
кадре. Имена человеческие: `'space'`, `'a'`, `'left'`, `'escape'`.

**На экране:** маскот ходит влево-вправо и прыгает; падает обратно на землю.

## Шаг 5. Анимация по состояниям

Держите состояние в переменной и меняйте клип листа только при переключении:

```js
$.update(() => {
    const hero = $('#hero');
    const v = hero.velocity();
    const state = !hero.onFloor() ? 'air' : (Math.abs(v.x) > 20 ? 'walk' : 'idle');
    if (state !== animState) {
        animState = state;
        hero.animate(ANIM[state]);       // покой / ходьба / полёт
    }
    hero.flip(v.x < -10, false);         // смотрит туда, куда бежит
});
```

`.velocity()` без аргументов читает `{ x, y }`, `.onFloor()` — луч вниз,
`.flip(true, false)` отражает картинку по X.

**На экране:** на ходу включается ходьба, в прыжке — кадры полёта, маскот
разворачивается по направлению движения.

## Шаг 6. Платформы: `<wall>` и `<tilemap>`

`<wall>` — статичный прямоугольник. Соберём землю с ямой и четыре платформы:

```js
const PLATFORMS = [
    [360, 200, 720, 40],  [1560, 200, 720, 40],   // земля: две половины, между ними яма
    [420, 100, 180, 24],  [960, 100, 220, 24],
    [1320, 100, 180, 24], [1680, 100, 200, 24],
];
function buildLevel() {
    for (const [x, y, w, h] of PLATFORMS) {
        $('<wall>').at(x, y).size(w, h).color('#2a3240').appendTo($.world);
    }
}
// в $.ready: buildLevel();
```

`.at(x, y)` — центр узла, `.size(w, h)` — размер. Если платформ много, уровень
удобнее рисовать текстом: `<tilemap>` — один узел на весь уровень.

```js
const LEVEL = [
    '................',
    '.......###......',
    '................',
    '####........####',
    '####........####',
];
$.tilemap.fromASCII(LEVEL, { '#': 1, '.': 0 }, {
    src: 'demos/assets/tiles/platformer_tileset_16x16.png',
    tile: 16,          // размер клетки в мире = клетке тайлсета
    cols: 16,          // сколько тайлов в строке текстуры
    solid: true,       // тайлы 1 непроходимы, id 0 — пусто
}).at(400, 200);       // x/y — центр карты
```

После создания карту правят `.setTile()`, `.tileSize()`, `.autotile()`,
`.rebuild()`.

**На экране:** земля и парящие платформы; маскот стоит на них, а в яму падает.

## Шаг 7. Монеты и событие подбора

Монета — обычный узел. Подбор оформим событием `pickup`: подписка и проверка
расстояния не знают друг о друге.

```js
const COINS = [[200, 130], [420, 40], [560, 130], [960, 40],
               [1200, 130], [1320, 40], [1680, 40], [1820, 130]];
function buildCoins() {
    coins = COINS.map(([x, y]) => $('<sprite>', { class: 'coin' })
        .at(x, y).size(22, 22).color('#ffd54a')
        .on('pickup', e => {
            e.self.data('taken', true).hide();   // монета исчезает
            collected++;
            score += 10;
            $.sound.play(SFX.pickup, { volume: 0.8 });
        })
        .appendTo($.world));
}
// в $.ready: buildCoins();
$.update(() => {
    for (const c of coins) {
        if (c.data('taken')) continue;
        if (c.distanceTo('#hero') < 32) c.emit('pickup');
    }
});
```

`e.self` — обёртка узла-источника, `.data(key, value)` — хранилище на узле,
`.distanceTo('#hero')` — расстояние в px. Монеты прячутся, а не удаляются.

**На экране:** маскот касается монет, они пропадают со звуком.

## Шаг 8. Счёт и HUD

Узлы `<ui.*>` рисуются в координатах окна: камера на них не влияет, в мир они
не попадают. `x`/`y` — центр узла, у `ui.label` текст идёт от него вправо,
а `align: 'center'` центрирует.

```js
function buildHud() {
    const s = $.window.size();          // { w, h } текущего окна
    $('<ui.bar>', { id: 'hp', value: 100, max: 100 })
        .at(140, 34).size(220, 16).appendTo($.ui);
    $('<ui.label>', { id: 'score', text: 'Очки: 0', size: 20, color: '#ffd54a' })
        .at(24, 72).appendTo($.ui);
    $('<ui.label>', { id: 'coins', text: 'Монеты: 0/8', size: 20 })
        .at(24, 100).appendTo($.ui);
    $('<ui.label>', { id: 'hint', text: 'A/D или ←/→ — идти · Space — прыжок',
                       size: 16, color: '#8fa3bf' })
        .at(24, s.h - 30).appendTo($.ui);
}
// в $.ready: buildHud();
function refreshHud() {
    $.ui.bar('#hp', $('#hero').hp(), 100);
    $.ui.label('#score', 'Очки: ' + score);
    $.ui.label('#coins', 'Монеты: ' + collected + '/' + coins.length);
}
// в $.update: refreshHud();
```

`$.ui.bar(sel, value, max)` и `$.ui.label(sel, text)` массово правят найденные
узлы. Размер шрифта — поле `size` у `ui.label` (не метод `.size()`).

**На экране:** слева сверху полоса здоровья, очки и счётчик монет.

## Шаг 9. Камера

```js
$.camera.follow('#hero', { smooth: 0.2, offset: [0, -60], zoom: 1.5 })
    .limits(-100, -250, W + 200, 800);   // в $.ready, после buildHero()
```

`.limits(...)` не даёт камере уехать за уровень, `smooth` — мягкость слежения,
`offset` — сдвиг кадра, `zoom` — масштаб. Камеру не двигайте руками: тряску
даёт `$.camera.shake(8, 250)`.

**На экране:** кадр едет за маскотом и упирается в края уровня.

## Шаг 10. Смерть, респавн и финиш

Яма — это смерть. Монеты спрятаны, а не удалены, поэтому рестарт уровня — это
вернуть их и обнулить счётчики.

```js
function restartLevel() {
    lives = 3; score = 0; collected = 0; won = false;
    for (const c of coins) c.data('taken', false).show();
}
function fallDown() {
    if (won) return;
    $.sound.play(SFX.hurt, { volume: 0.8 });
    $.camera.shake(8, 250);
    lives--;
    if (lives <= 0) restartLevel();
    $('#hero').respawn(SPAWN.x, SPAWN.y);   // на старт и с полным здоровьем
}
$.update(() => {
    if ($('#hero').pos().y > DEATH_Y) fallDown();
    if (!won && collected === coins.length) {
        won = true;
        score += 100;
        $.store.set('best', Math.max($.store.get('best', 0), score));
        $.store.save();
    }
});
```

`.respawn(x, y)` телепортирует узел и восстанавливает здоровье, `.pos()` —
позиция, `.hp()` — текущее здоровье. О гибели от врагов расскажет событие:
`$('#hero').on('death', () => $.log('маскот погиб'))`.

**На экране:** падение в яму возвращает маскота на старт; когда собраны все
монеты — уровень пройден (в шаге 14 это отдельная сцена).

## Шаг 11. Звук

Расширение можно не писать: движок сам ищет `.wav`, `.ogg`, `.mp3`, `.flac`.

```js
const SFX = {
    jump:   'demos/assets/audio/sfx/jump_01.ogg',
    pickup: 'demos/assets/audio/sfx/pickup_01.ogg',
    hurt:   'demos/assets/audio/sfx/hurt_01.ogg',
};
// в $.ready:
$('#hero').on('jump', () => $.sound.play(SFX.jump, { volume: 0.7 }));
$.sound.volume(0.8);
$.sound.music('demos/assets/audio/music/action.ogg', { loop: true, volume: 0.4 });
```

Событие `jump` движок шлёт сам при прыжке. Для звука от объекта есть
`$.sound.playAt('boom.ogg', '#hero', { max: 700 })` — панорама и затухание
считаются от камеры.

**На экране:** играет музыка, прыжок и подбор монеты звучат.

## Шаг 12. Сохранение прогресса

```js
$.store.file('save.json').load();   // прочитать прошлое сохранение
$.store.set('best', score);         // записать рекорд
$.store.save();                     // сохранить прямо сейчас
$.store.get('best', 0);             // прочитать (0 — если записи нет)
$.store.autoSave(30000);            // писать раз в 30 с, если что-то менялось
```

Путь считается от корня запуска. Для своих файлов рядом есть `$.fs`:
`$.fs.readJSON('data/levels.json', {})`, `$.fs.write('log.txt', 'текст')`.

`autoSave` заводит таймер, а смена сцены их очищает: вызывайте его в `enter`
сцены уровня (шаг 14), а не в `$.ready`. Последний шанс — `$.exit(() => $.store.save())`.

**На экране:** после перезапуска в HUD виден прошлый рекорд.

## Шаг 13. Меню: заголовок и кнопки

**Закон интерфейса — RmlUi** ([UI_RMLUI_LAW.md](UI_RMLUI_LAW.md)): меню, экраны
и диалоги делаются документами `.rml` + `.rcss`. Ниже — оба способа; «Путь А»
на узлах оставлен для существующих игр и быстрых проб, для нового меню берите
путь с RmlUi.

| Путь | Когда выбирать |
|---|---|
| RmlUi-документ `$.ui.doc('...rml')` | **Основной путь**: меню, настройки, инвентарь, диалоги |
| Узлы `<ui.panel>`, `<ui.label>`, `<ui.button>` | Быстрый экран на `$` без файлов: пробы, HUD, существующие игры |

**Путь А — узлы** (для существующих игр и проб). Меню без единого файла разметки:

```js
function buildMenu() {
    const s = $.window.size();
    $('<ui.panel>', { x: s.w / 2, y: s.h / 2, w: s.w, h: s.h, color: '#0b1220ee' })
        .appendTo($.ui);
    $('<ui.label>', { id: 'title', text: 'МАСКОТ И МОНЕТЫ', size: 48,
                      color: '#7fd1ff', align: 'center' })
        .at(s.w / 2, s.h * 0.3).appendTo($.ui);
    $('<ui.button>', { id: 'btn-play', text: 'Играть', x: s.w / 2, y: s.h * 0.5 })
        .appendTo($.ui).on('click', () => $.scene.load('level'));
    $('<ui.button>', { id: 'btn-quit', text: 'Выход', x: s.w / 2, y: s.h * 0.5 + 70 })
        .appendTo($.ui).on('click', () => $.quit());
}
```

**Путь Б — RmlUi.** Создайте `mygame/ui/menu.rml` (стили — прямо в файле):

```xml
<rml>
<head>
    <title>Меню</title>
    <style>
        body { font-family: Noto Sans; font-size: 20px; color: #eef2f8;
               background-color: rgba(11, 18, 32, 238); width: 100%; height: 100%; }
        #menu { display: block; width: 520px; margin-left: auto; margin-right: auto;
                margin-top: 130px; text-align: center; }
        h1 { font-size: 46px; color: #7fd1ff; margin-bottom: 30px; }
        button { display: block; width: 320px; margin-left: auto; margin-right: auto;
                 margin-top: 12px; margin-bottom: 12px; padding: 14px; font-size: 20px;
                 color: #0d1220; background-color: #7fd1ff; border-width: 0px;
                 border-radius: 8px; text-align: center; }
        button:hover { background-color: #a9e0ff; }
    </style>
</head>
<body>
    <div id="menu">
        <h1>МАСКОТ И МОНЕТЫ</h1>
        <button id="btn-play">Играть</button>
        <button id="btn-quit">Выход</button>
    </div>
</body>
</rml>
```

```js
this.doc = $.ui.doc('mygame/ui/menu.rml')      // метод называется doc(), не load()
    .on('btn-play', 'click', () => $.scene.load('level'))
    .on('btn-quit', 'click', () => $.quit())
    .show();
// в exit сцены: if (this.doc) this.doc.hide();
```

Путь к документу — от корня проекта, поэтому `mygame/ui/menu.rml`, а не
`ui/menu.rml`. Слушатели RmlUi не снимаются при смене сцены, поэтому
`$.ui.doc()` кэширует документ и повторную подписку пропускает.

**Кнопки.** `hover`/нажатие у `ui.button` рисует движок; `click` приходит и от
мыши, и с клавиатуры: `Tab`/`Shift+Tab` — фокус, `Enter`/`Space` — нажать.
Программно: `$.ui.focus('#btn-play')` и `$.ui.focusedId()`.

**На экране:** затемнённый экран, заголовок и две кнопки; «Играть» ведёт на
уровень, «Выход» закрывает игру.

## Шаг 14. Сцены: меню → уровень → победа

```js
$.scene.add('level', {
    enter($)  { /* построить мир */ },
    exit()    { /* убрать за собой */ },
    update(dt, $) { /* логика кадра */ },
    render($) { /* необязательно: своя отрисовка */ },
});
$.scene.add('intro', ($) => { /* сцена-функция: это её enter */ });
```

```js
$.scene.load('level');                            // с переходом-fade (300 мс по умолчанию)
$.scene.load('level', { transition: 'none' });    // мгновенно
$.scene.load('level', { transition: 'fade', ms: 500 });
$.scene.transition('fade', 250);                  // сменить переход по умолчанию
$.scene.restart();                                // перезапустить текущую
$.scene.current() / .names() / .busy()            // что сейчас, что есть, идёт ли переход
```

Смена сцены **отложена на начало следующего кадра**, поэтому её можно вызывать
прямо из обработчика клика. При смене мир очищается (узлы, тела, твины,
таймеры), сцена получает `exit()`.

Стек — для паузы и оверлеев:

```js
$.scene.push('pause');   // запомнить текущую и открыть паузу
$.scene.pop();           // вернуться к запомненной
$.scene.stack();         // ['level']
$.scene.add('pause', {
    enter($) { $.time.pause(); /* показать оверлей */ },
    exit()   { $.time.resume(); },
    update(dt, $) { if ($.input.pressed('escape')) $.scene.pop(); },
});
// из уровня: if ($.input.pressed('escape')) $.scene.push('pause');
```

`push`/`pop` — обычные `load`, поэтому мир под паузой тоже очищается, и после
возврата уровень начинается заново. Если мир нужно сохранить — делайте паузу
оверлеем: `$.time.pause()` плюс скрытые узлы `<ui.*>`.

`$.update(fn)` — **глобальный** и работает во всех сценах сразу: логику уровня
перенесите в `update(dt, $)` сцены `level`, иначе она тикает и в меню. Цикл
`menu → level → win → menu` из трёх сцен:

```js
// menu: кнопка/Enter
$.scene.load('level');
// level: собрали все монеты
score += 100;
$.store.set('best', Math.max($.store.get('best', 0), score));
$.store.save();
$.scene.load('win');
// win: кнопка «В меню»/Enter
$.scene.load('menu');
```

**На экране:** «Играть» → fade → уровень; победа → fade → экран победы;
«В меню» → fade → меню.

## Шаг 15. Сборка в один файл

Сборка встроена в движок. Команда выполняется **из корня движка** — там, где
лежит `build/russiano2d`:

```bash
# 1. Собрать. --project — корень проекта (отсюда считаются пути в грузе),
#    --entry — точка входа относительно корня, --out — имя файла.
./build/russiano2d build --project . --entry mygame/main.js --out mascot-game
# 2. macOS: переподписать (см. ниже)
codesign --force --sign - ./mascot-game
# 3. Запустить: папки проекта рядом нет, всё внутри
./mascot-game
```

Наш код ссылается на ассеты демо (`demos/assets/...`). Автоматически в груз
попадают только каталог `assets/` и каталог точки входа (`mygame/`), поэтому
демо-ассеты добавляем явно, иначе после сборки они «не найдутся»:

```bash
./build/russiano2d build --project . --entry mygame/main.js --out mascot-game \
    --add demos/assets
```

`--out` — это имя **файла**, и оно не должно совпадать с именем папки проекта
(`mygame`): иначе сборка скажет `не удалось записать mygame`. Назовите файл
иначе (здесь `mascot-game`) или саму папку проекта — иначе.

Посмотреть, что попадёт в груз, ничего не записывая:

```bash
./build/russiano2d build --project . --entry mygame/main.js --out mascot-game --list
```

**Что внутри.** Файл — движок плюс контейнер `R2DP` и футер `R2DF`: скрипты —
байткод QuickJS по графу `import`, ассеты — как есть, груз зашифрован
ChaCha20-Poly1305 (обфускация, не защита; `--no-encrypt` выключает).
`project.json` попадает в груз всегда — оттуда собранная игра берёт имя окна.

**macOS: переподпишите собранный файл.** Сборка дописывает груз в копию
бинарника, и подпись исходного движка перестаёт совпадать:

```bash
codesign --force --sign - ./mascot-game
```

Без этого система может отказаться запускать файл («повреждён» или `killed: 9`).
Сообщение сборки про неудачную переподпись — ожидаемое: подпись делается вручную.

**Проверка без окна** — тот же агентский протокол, что у обычного запуска:

```bash
./mascot-game --agent --headless --fixed-dt 0.0166666667
```

**Если команда не сработала:**

* `нет файла ...` — `--entry` указан неверно или относительно не того корня.
  Путь всегда от `--project`.
* `нашлось несколько main.js — укажите --entry` — уберите неоднозначность.
* `неизвестная опция` — сверьтесь с `./build/russiano2d build --help`.
* `не удалось записать mygame` — `--out` совпал с папкой проекта; выберите
  другое имя файла.
* Режим `--relink <папка>` генерирует C-файл с грузом, который затем
  вкомпилируется в движок через cmake: нужен компилятор и несколько минут,
  зато получается обычный бинарник для подписи настоящим сертификатом.

**На экране:** при запуске `./mascot-game` (папки проекта рядом нет) игра стартует
с меню и работает так же, как при `--game mygame`.

## Полный листинг `mygame/main.js`

Меню, уровень, монеты, HUD, победа и сохранение — один файл, копируется
целиком. Замените только путь к маскоту, если положите его в свой проект.

```js
// mygame/main.js — игра целиком. Запуск: ./build/russiano2d --game mygame
// Сборка: ./build/russiano2d build --project . --entry mygame/main.js --out mascot-game --add demos/assets
// На macOS: codesign --force --sign - ./mascot-game; запуск сборки: ./mascot-game
const W = 1920, DEATH_Y = 420, SPAWN = { x: 0, y: 150 };
const MUSIC_MENU = 'demos/assets/audio/music/menu.ogg';
const MUSIC_LEVEL = 'demos/assets/audio/music/action.ogg';
const MASCOT = { src: 'demos/assets/art/mascot/russiano_mascot_sheet.png',
                 cols: 8, rows: 4, cw: 176, ch: 176 };
const ANIM = {
    idle: { from: 0,  to: 3,  speed: 5,  loop: true },
    walk: { from: 8,  to: 13, speed: 13, loop: true },
    air:  { from: 21, to: 23, speed: 9,  loop: true },
};
const SFX = {
    jump:   'demos/assets/audio/sfx/jump_01.ogg',
    pickup: 'demos/assets/audio/sfx/pickup_01.ogg',
    hurt:   'demos/assets/audio/sfx/hurt_01.ogg',
};
const PLATFORMS = [
    [360, 200, 720, 40], [1560, 200, 720, 40],
    [420, 100, 180, 24], [960, 100, 220, 24],
    [1320, 100, 180, 24], [1680, 100, 200, 24],
];
const COINS = [[200, 130], [420, 40], [560, 130], [960, 40],
               [1200, 130], [1320, 40], [1680, 40], [1820, 130]];
let coins = [], animState = '';
let score = 0, collected = 0, lives = 3, won = false;
function buildLevel() {
    for (const [x, y, w, h] of PLATFORMS) {
        $('<wall>').at(x, y).size(w, h).color('#2a3240').appendTo($.world);
    }
}
function buildHero() {
    return $('<player>', { id: 'hero' })
        .at(SPAWN.x, SPAWN.y).size(48, 64).collision(28, 56).health(100)
        .controls({ axis: 'both', jump: 'space' })
        .frames(MASCOT).animate(ANIM.idle)
        .on('jump', () => $.sound.play(SFX.jump, { volume: 0.7 }))
        .appendTo($.world);
}
function buildCoins() {
    coins = COINS.map(([x, y]) => $('<sprite>', { class: 'coin' })
        .at(x, y).size(22, 22).color('#ffd54a')
        .on('pickup', e => {
            e.self.data('taken', true).hide();
            collected++;
            score += 10;
            $.sound.play(SFX.pickup, { volume: 0.8 });
        })
        .appendTo($.world));
}
function buildHud() {
    const s = $.window.size();
    $('<ui.bar>', { id: 'hp', value: 100, max: 100 })
        .at(140, 34).size(220, 16).appendTo($.ui);
    $('<ui.label>', { id: 'score', text: 'Очки: 0', size: 20, color: '#ffd54a' })
        .at(24, 72).appendTo($.ui);
    $('<ui.label>', { id: 'coins', text: 'Монеты: 0/8', size: 20 })
        .at(24, 100).appendTo($.ui);
    $('<ui.label>', { id: 'hint', text: 'A/D или ←/→ — идти · Space — прыжок',
                       size: 16, color: '#8fa3bf' })
        .at(24, s.h - 30).appendTo($.ui);
}
function refreshHud() {
    $.ui.bar('#hp', $('#hero').hp(), 100);
    $.ui.label('#score', 'Очки: ' + score);
    $.ui.label('#coins', 'Монеты: ' + collected + '/' + coins.length);
}
function restartLevel() {
    lives = 3; score = 0; collected = 0; won = false;
    for (const c of coins) c.data('taken', false).show();
}
function fallDown() {
    if (won) return;
    $.sound.play(SFX.hurt, { volume: 0.8 });
    $.camera.shake(8, 250);
    lives--;
    if (lives <= 0) restartLevel();
    $('#hero').respawn(SPAWN.x, SPAWN.y);
}
function buildMenu() {
    const s = $.window.size();
    $('<ui.panel>', { x: s.w / 2, y: s.h / 2, w: s.w, h: s.h, color: '#0b1220ee' })
        .appendTo($.ui);
    $('<ui.label>', { id: 'title', text: 'МАСКОТ И МОНЕТЫ', size: 48,
                      color: '#7fd1ff', align: 'center' })
        .at(s.w / 2, s.h * 0.3).appendTo($.ui);
    $('<ui.button>', { id: 'btn-play', text: 'Играть', x: s.w / 2, y: s.h * 0.5 })
        .appendTo($.ui).on('click', () => $.scene.load('level'));
    $('<ui.button>', { id: 'btn-quit', text: 'Выход', x: s.w / 2, y: s.h * 0.5 + 70 })
        .appendTo($.ui).on('click', () => $.quit());
}
$.ready(() => {
    $.sound.volume(0.8);
    $.store.file('save.json').load();
    $.scene.transition('fade', 250);
    $.scene.add('menu', {
        enter($) {
            buildMenu();
            $.sound.music(MUSIC_MENU, { loop: true, volume: 0.4 });
        },
        exit() { $.sound.stopMusic(300); },
        update(dt, $) {
            if ($.input.pressed('enter') || $.input.pressed('space')) $.scene.load('level');
            if ($.input.pressed('escape')) $.quit();
        },
    });
    $.scene.add('level', {
        enter($) {
            score = 0; collected = 0; lives = 3; won = false; animState = '';
            $.store.autoSave(30000);
            $.world.gravity(0, 2000).color('#5fcde4');
            buildLevel();
            buildCoins();
            buildHero();
            buildHud();
            $.camera.follow('#hero', { smooth: 0.2, offset: [0, -60], zoom: 1.5 })
                .limits(-100, -250, W + 200, 800);
            $.sound.music(MUSIC_LEVEL, { loop: true, volume: 0.4 });
        },
        exit() { $.sound.stopMusic(300); },
        update(dt, $) {
            const h = $('#hero'), v = h.velocity();
            const state = !h.onFloor() ? 'air' : (Math.abs(v.x) > 20 ? 'walk' : 'idle');
            if (state !== animState) { animState = state; h.animate(ANIM[state]); }
            h.flip(v.x < -10, false);
            for (const c of coins) {
                if (c.data('taken')) continue;
                if (c.distanceTo('#hero') < 32) c.emit('pickup');
            }
            refreshHud();
            if (h.pos().y > DEATH_Y) fallDown();
            if (!won && collected === coins.length) {
                won = true;
                score += 100;
                $.store.set('best', Math.max($.store.get('best', 0), score));
                $.store.save();
                $.scene.load('win');
            }
        },
    });
    $.scene.add('win', {
        enter($) {
            const s = $.window.size();
            $('<ui.panel>', { x: s.w / 2, y: s.h / 2, w: s.w, h: s.h, color: '#0b1220ee' })
                .appendTo($.ui);
            $('<ui.label>', { id: 'win-title', text: 'Уровень пройден!', size: 44,
                              color: '#ffd54a', align: 'center' })
                .at(s.w / 2, s.h * 0.35).appendTo($.ui);
            $('<ui.label>', { id: 'win-score',
                              text: 'Очки: ' + score + ' · Рекорд: ' + $.store.get('best', 0),
                              size: 22, align: 'center' })
                .at(s.w / 2, s.h * 0.46).appendTo($.ui);
            $('<ui.button>', { id: 'win-menu', text: 'В меню', x: s.w / 2, y: s.h * 0.6 })
                .appendTo($.ui).on('click', () => $.scene.load('menu'));
        },
        update(dt, $) {
            if ($.input.pressed('enter') || $.input.pressed('space') ||
                $.input.pressed('escape')) $.scene.load('menu');
        },
    });
    $.scene.load('menu', { transition: 'none' });
});
$.exit(() => $.store.save());
```

## Частые вопросы

**Пустое окно, ничего не происходит.** Сцена не загружена или загружена не та:
`$.scene.load('menu', { transition: 'none' })` должен идти после всех
`$.scene.add(...)`, а имя — совпадать. Если сцена «неизвестна», в журнале будет
`$: неизвестная сцена "..."`. Ещё вариант: узлы созданы, но не добавлены —
у мировых узлов нужен `.appendTo($.world)`, у интерфейса `.appendTo($.ui)`.

**Ассеты не найдены.** Путь в коде должен совпадать с путём от корня запуска:
`demos/assets/art/mascot/russiano_mascot_sheet.png`, не `art/...` и не
`assets/...`. Проверить можно из игры: `$.fs.exists('demos/assets/...')` и
`$.gfx.textureSize('demos/assets/...')` (вернёт `[w, h]`). После сборки — та же
ошибка: забудьте `--add demos/assets`, и ассетов в грузе не будет.

**Кнопка не реагирует.** Кнопка должна быть добавлена в интерфейс
(`.appendTo($.ui)`), быть видимой и не перекрытой другим `ui.panel` (рисуются в
порядке создания — фон создавайте первым). У RmlUi-меню — `.show()` у документа
и `.on('btn-play', 'click', ...)`. Проверить фокус: `$.ui.focusedId()`, поставить
`$.ui.focus('#btn-play')`; `Tab` и `Enter` работают и без мыши.

**Сцена не переключается.** Переход отложен и идёт ~300 мс: `$.scene.load()`
только ставит запрос, реальная замена — в начале следующего кадра. Смотрите
`$.scene.current()` и `$.scene.busy()`. Имя должно быть зарегистрировано
`$.scene.add()` **до** `load()`.

**После сборки не запускается.** На macOS переподпишите:
`codesign --force --sign - ./mascot-game`; сообщение сборки про переподпись —
ожидаемое. `груз: тег не сошёлся` означает, что файл изменили после сборки —
соберите заново. `не удалось прочитать модуль ...` — модуль не попал в груз:
динамический `import()` из другого каталога добавляют через `--add`.

**Где смотреть ошибки.** Ошибки игрового кода уходят в журнал движка (терминал,
откуда запущена игра) со стеком; своё сообщение пишет `$.log('текст')`.
Оверлей с FPS и статистикой — клавиша `F1`, флаг `--overlay` или
`$.debug.on()`; свои значения выводят `$.debug.watch('hp', () => $('#hero').hp())`.
В консоль движка можно добавить команду: `$.console.register('win', () => ...)`.
В агентском режиме хвост ошибок отдаёт `stderr_tail` (см. [AGENT_API.md](AGENT_API.md)).

## Что дальше

* [HIGH_LEVEL_API.md](HIGH_LEVEL_API.md) — всё, что умеет `$`: селекторы,
  физика, события, твины, сцены, интерфейс, окно и время; [internal/NATIVE.md](internal/NATIVE.md) —
  низкий уровень: батчинг, тела, BSP, свет, RmlUi.
* [tutorial-menus.md](tutorial-menus.md) — меню, пауза и переходы подробнее;
  [tutorial-platformer.md](tutorial-platformer.md) — платформер с врагами и
  проверкой агентом; [BUILD.md](BUILD.md) — сборка, шифрование, `--relink`.
* [AGENT_API.md](AGENT_API.md) — прогон игры программой; [demos.md](demos.md) —
  демо-проект и живые примеры.
* Подсистемы `$` — [docs/highlevel](highlevel/): [anim](highlevel/anim.md), [tilemap](highlevel/tilemap.md),
  [particles](highlevel/particles.md), [nav](highlevel/nav.md), [prefab](highlevel/prefab.md), [audio](highlevel/audiobus.md),
  [layers](highlevel/layers.md), [widgets](highlevel/widgets.md), [tween](highlevel/tween.md), [pool](highlevel/pool.md),
  [triggers](highlevel/triggers.md), [i18n](highlevel/i18n.md).
