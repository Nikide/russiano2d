# Туториал: первая игра на `$`

От пустого каталога до играбельного платформера. За основу взята рабочая игра
из [`game/`](../game) — здесь мы разберём её по частям и объясним решения.

Справочник по всем вызовам — [HIGH_LEVEL_API.md](HIGH_LEVEL_API.md).

- [Что получится](#что-получится)
- [Шаг 1. Каталог игры](#шаг-1-каталог-игры)
- [Шаг 2. Первый экран](#шаг-2-первый-экран)
- [Шаг 3. Игрок](#шаг-3-игрок)
- [Шаг 4. Уровень из ASCII](#шаг-4-уровень-из-ascii)
- [Шаг 5. Враги и монеты](#шаг-5-враги-и-монеты)
- [Шаг 6. HUD на узлах интерфейса](#шаг-6-hud-на-узлах-интерфейса)
- [Шаг 7. Сцены: меню и уровень](#шаг-7-сцены-меню-и-уровень)
- [Шаг 8. Сохранения](#шаг-8-сохранения)
- [Как это проверять без рук](#как-это-проверять-без-рук)

---

## Что получится

Платформер: персонаж ходит и прыгает, собирает монеты, враги патрулируют и
бьют при касании, есть HUD, пауза, победа и возврат в меню. Всё это — на одном
объекте `$`, без классов и без вызовов `engine.*`.

---

## Шаг 1. Каталог игры

```
mygame/
  main.js          точка входа
  scenes/
    menu.js
    level.js
```

Запуск: `./build/russiano2d --game mygame`, точка входа — `<каталог>/main.js`.
Пути к ассетам считаются от корня запуска (там, где лежат `game/` и `assets/`),
поэтому свой файл пишется как `mygame/assets/hero.png`.

## Шаг 2. Первый экран

```js
// mygame/main.js
$.ready(($) => {
    $.gfx.color('#141824');           // фон кадра
    $.world.gravity(0, 1800);         // «вниз» — положительное Y

    $('<player>', { id: 'hero' })
        .at(200, 300)
        .appendTo($.world);

    $.camera.follow('#hero');
});
```

`$.ready` вызывается один раз, на первом кадре: `$` уже готов, мир пуст.
Больше ничего писать не нужно — движок сам вызывает `onUpdate`/`onRender`, а `$`
внутри них обновляет твины, камеру, анимации и отрисовывает мир.

## Шаг 2.1. Камера платформера и бесшовный фон

Слежение настраивается тремя независимыми вещами: `smooth` (насколько
«прилипает»), `deadzone` (зона свободы — цель внутри неё камеру не двигает) и
`lookahead` (взгляд вперёд по направлению движения).

```js
$.camera.follow('#hero', { smooth: 0.12, deadzone: [40, 24], lookahead: 64 })
         .limits(0, 0, LEVEL_W, LEVEL_H);      // не показывать пустоту за краем

// Фон: слой с образцом + бесшовная полоса без ручных копий.
const sky = $.layers.create({ name: 'sky', order: -30 });
$('<sprite>', { src: 'assets/sky.png', w: 512, h: 256 }).at(0, 200).appendTo(sky);
sky.parallax(0.9);
$.layers.repeat(sky, { period: 512 });
```

Слой едет за камерой с коэффициентом `parallax` (0 — приколот к экрану, 1 —
как мир), а `repeat` размножает картинку по экрану с модульным сдвигом: полоса
остаётся бесшовной при движении и при зуме. Подробности —
[layers.md](highlevel/layers.md), камера — [camera.md](highlevel/camera.md).

## Шаг 3. Игрок

```js
$('<player>', { id: 'hero' })
    .at(200, 300)
    .size(26, 30)              // размер и хитбокс
    .health(100)
    .controls('both')          // WASD и стрелки; прыжок по Space/W/↑
    .collision(26, 30)         // тело пересоздаётся под этот прямоугольник
    .attr({ jumpForce: 700 })
    .sprite({ src: 'assets/atlas.png', cols: 4, rows: 1, cw: 32, ch: 32 })
    .frame(0)
    .appendTo($.world)
    .on('hit', e => $.camera.shake(5, 200))
    .on('death', () => console.log('игрок погиб'));
```

Что здесь важно:

* `.controls('both')` — встроенное управление: движок читает ввод через
  `$.input.vec('both')`, сам ставит скорость телу и прыгает по Space
  (только если `onFloor()` истинно). Сила прыжка берётся из схемы или из
  `.attr({ jumpForce: 700 })`.
* `.sprite({...})` с объектом — это **лист**: задаёт и текущий кадр, и набор
  кадров для `.frame(n)` и `.animate(...)`.
* Каждый вызов возвращает обёртку, поэтому цепочка не прерывается.

Для «ощущаемого» платформера включите окна прыжка — всё это игровое время, не
кадры:

```js
$('#hero').controls({
    axis: 'both',
    coyote: 100,        // прыжок ещё 100 мс после схода с платформы
    jumpBuffer: 120,    // нажатие за 120 мс до земли сработает при касании
    jumpCut: 0.35,      // отпустил кнопку — прыжок ниже
    dropThrough: true,  // S/↓+Space на односторонней платформе — спрыгнуть вниз
});
```

Спрыгнуть можно и явно: `$('#hero').dropThrough(250)` — 250 мс игрового
времени контакт с односторонними платформами выключен, платформа не трогается.

Движущаяся платформа — кинематическое тело, игрок несётся вместе с ней:

```js
$('<wall>', { id: 'lift' }).at(600, 400).size(200, 20)
    .body('kinematic').appendTo($.world);

$.update(dt => $('#lift').velocity(120, 0));   // .controls() несёт стоящего
```

Если нужен свой контроллер — не вызывайте `.controls()` и работайте с
`$.input` напрямую:

```js
$.update(dt => {
    const v = $.input.vec('wasd');
    $('#hero').velocity(v.x * 240, $('#hero').velocity().y);
    if ($.input.pressed('space') && $('#hero').onFloor()) $('#hero').jump(700);
});
```

## Шаг 4. Уровень из ASCII

Уровень удобно держать текстом: одна клетка — тайл 32×32.

```js
const TILE = 32;
const LEVEL = [
    '..........o.....',
    '.......####.....',
    '..P.............',
    '#####.....####..',
];

$.ready(($) => {
    $.world.bounds(-64, -64, LEVEL[0].length * TILE + 128, LEVEL.length * TILE + 128);

    LEVEL.forEach((row, ty) => {
        for (let tx = 0; tx < row.length; tx++) {
            const x = tx * TILE + TILE / 2;
            const y = ty * TILE + TILE / 2;
            const cell = row[tx];

            if (cell === '#') {
                $('<wall>').at(x, y).size(TILE, TILE).appendTo($.world);
            } else if (cell === 'o') {
                $('<sprite>', { class: 'coin' }).at(x, y).size(18, 18).appendTo($.world);
            } else if (cell === 'P') {
                $('<player>', { id: 'hero' }).at(x, y).controls('both').appendTo($.world);
            }
        }
    });
});
```

`$.world.bounds(...)` ставит четыре статические стены по краям — из мира нельзя
выпасть. Служебные стены носят класс `world-bound` и не попадают в
`$.world.count()`.

## Шаг 5. Враги и монеты

Враг — обычный узел с телом. Патруль пишется тремя строками:

```js
$('<enemy>', { class: 'walker' }).at(x, y).health(30)
    .on('death', e => e.self.fadeOut(200).remove())
    .appendTo($.world).attr('dir', 1);

$.update(() => {
    $('.walker').each((i, e) => {
        if (e.onWall()) e.attr('dir', -e.attr('dir'));   // развернуться у стены
        e.velocity(e.attr('dir') * 45, e.velocity().y);
    });
});
```

Монеты подбираются по расстоянию; событие узла избавляет от лишнего кода:

```js
$('.coin').on('pickup', e => { $.sound.play('pickup.ogg'); e.self.remove(); score++; });

$.update(() => {
    $('.coin').each((i, c) => { if (c.distanceTo('#hero') < 30) c.emit('pickup'); });
});
```

## Шаг 6. HUD на узлах интерфейса

Узлы `ui.*` рисуются в координатах окна: камера на них не влияет, в мир они не
попадают и видны агенту в снимке состояния. Это **HUD**; меню и экраны нового
кода делаются документами RmlUi (`$.ui.doc('ui/menu.rml')`) — см.
[UI_RMLUI_LAW.md](UI_RMLUI_LAW.md) и [tutorial-menus.md](tutorial-menus.md).

```js
$('<ui.bar>', { id: 'hp', value: 100, max: 100 }).at(120, 30).appendTo($.ui);
$('<ui.label>', { id: 'score', text: 'Очки: 0', size: 18, color: '#ffd54a' })
    .at(30, 60).appendTo($.ui);

$.update(() => {
    $.ui.bar('#hp', $('#hero').hp(), 100);
    $.ui.label('#score', 'Очки: ' + score);
});
```

Для сложной вёрстки есть документы RmlUi:

```js
const menu = $.ui.doc('ui/menu.rml').show();
menu.text('score', '120').on('btn-play', 'click', () => $.scene.load('level'));
```

## Шаг 7. Сцены: меню и уровень

Сцена — объект с `enter/exit/update/render` или просто функция-построитель.

```js
// mygame/scenes/menu.js
export default function installMenu($) {
    $.scene.add('menu', {
        enter($) {
            this.doc = $.ui.doc('ui/menu.rml').show()
                .on('btn-play', 'click', () => $.scene.load('level'));
        },
        exit() { if (this.doc) this.doc.hide(); },
        update(dt, $) { if ($.input.pressed('escape')) $.quit(); },
    });
}

// mygame/main.js
import installMenu from './scenes/menu.js';
$.ready(($) => {
    installMenu($);
    $.scene.add('level', $ => { /* построить уровень */ });
    $.scene.load('menu', { transition: 'none' });
});
```

Смена сцены **отложена на начало следующего кадра** — её можно вызывать прямо
из обработчика клика. Мир при смене очищается: узлы, тела, твины и таймеры
исчезают, и игра начинается «с нуля».

## Шаг 8. Сохранения

```js
$.store.file('save.json').load();
$.store.set('best', score);
$.store.save();                    // путь считается от корня запуска
$.store.autoSave(30000);           // и раз в 30 секунд, если что-то менялось
```

Кроме этого `$.fs` умеет читать и писать любые файлы:
`$.fs.readJSON('data/levels.json')`, `$.fs.write('log.txt', text)`.

## Как это проверять без рук

Игру можно гонять агентом: движок принимает JSON-команды и отдаёт состояние.

```bash
./build/russiano2d --agent --headless --fixed-dt 0.0166666667 --game mygame
```

```python
import sys; sys.path.insert(0, "tools")
from agent_client import Agent

with Agent(game="mygame", seed=7) as a:
    a.step(30)
    print(a.eval("$('#hero').pos()"))
    a.keys(["D"]); a.step(60); a.keys([])
    a.key("Space", "tap"); a.step(10)
    a.screenshot("build/shot.png")
    print(a.stderr_tail(10))        # ошибки игрового кода видны здесь
```

Игра со своей стороны может рассказывать о себе агенту:

```js
$.agent.expose('score', () => score);        // поле появится в снимке состояния
$.test.check($('.coin').length === 5, 'монет пять');
```

Подробности — [AGENT_API.md](AGENT_API.md).

## Разбор настоящей игры: `game/`

Туториал выше собирает минимальный платформер. Рабочая игра движка устроена
так же, но разложена по трём файлам, и это стоит скопировать в свою:

| Файл | Что в нём | Почему отдельно |
|---|---|---|
| [`game/levels.js`](../game/levels.js) | ASCII-карты трёх уровней и палитры | данные: новый уровень — запись в массиве, а не код |
| [`game/level.js`](../game/level.js) | сборка мира, монеты, шипы, движущиеся и односторонние платформы, чекпойнты, ворота, отклик на удар | механика одна на все уровни |
| [`game/campaign.js`](../game/campaign.js) | меню, сцены уровней, HUD, пауза, победа, прогресс в `save.json` | общее для кампании, не для уровня |

Что там есть из «продакшн-мелочей», которых нет в минимальном примере:

* уровень шире экрана (48x18 тайлов) — камере есть что скроллить, работают
  `follow` с `smooth`, `deadzone` и `lookahead` (docs/highlevel/camera.md);
* отклик удара одной строкой: `$.hits.play(hero, { preset: 'hit' })` — искры,
  вспышка экрана, тряска, hit-stop, squash (docs/highlevel/hits.md);
* чекпойнт считается по расстоянию, поэтому ловится и когда игрок падает
  сквозь флаг на большой скорости;
* прогресс (пройденные уровни, лучшее время) хранится в `save.json` через
  `$.store`, а состояние кампании видно агенту (`$.agent.expose('campaign')`);
* HUD — узлы `<ui.*>` с панелью-подложкой: тёмный текст на светлом небе
  первого уровня без подложки не читается.

Запуск уровней по отдельности — для отладки:

```bash
./build/russiano2d --game game --scene meadow     # уровень 1
./build/russiano2d --game game --scene caverns    # уровень 2
./build/russiano2d --game game --scene spires     # уровень 3
```

Проверка всей кампании без рук — `python3 tests/agent/game_test.py`
(в том числе в сборке платформера: `R2D_BINARY=build-2d/russiano2d ...`).

## Что дальше

* [tutorial-menus.md](tutorial-menus.md) — меню, пауза и переходы между сценами.
* [HIGH_LEVEL_API.md](HIGH_LEVEL_API.md) — всё, что умеет `$`.
* `internal/NATIVE.md` — низкий уровень: батчинг, тела, BSP, свет, RmlUi.
