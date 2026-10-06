# `$.anim.player` — анимационный плеер: таймлайны, события, микширование

Подсистема добавляет к `$` **анимационный плеер** — аналог `AnimationPlayer` в
Godot 4.x, но 2D и в духе `$`. Она живёт в `src/highlevel/animplayer.js`,
дополняет уже существующее пространство `$.anim` (см. [anim.md](anim.md)) и не
заменяет ни один его метод.

Что умеет:

* клипы с дорожками `position`, `scale`, `rotation`, `alpha`, `color`,
  `sprite` (кадры листа) и произвольной `value`-дорожкой (число для игры);
* ключи со временем **в миллисекундах** и плавностью (`ease`) теми же кривыми,
  что у твинов и клипов `anim.js`;
* события-ключи: колбэк (`call`) или подписка (`on`) — аналог Call Method Track;
* собственные часы плеера: `play`, `stop`, `pause/resume`, `seek`, `speed`,
  `loop`, режимы `once` / `loop` / `pingpong`;
* микширование двух клипов (`blend(a, b, t)`) и ручной кроссфейд по весам;
* детерминизм: время идёт только от `dt` игрового кадра, поэтому прогон в
  `--fixed-dt` повторяется кадр в кадр.

```js
$.ready(() => {
    $.anim.clip('run', {
        duration: 600,
        loop: 'loop',
        tracks: [
            { type: 'position', keys: [{ t: 0, v: { x: 0, y: 0 } },
                                       { t: 600, v: { x: 120, y: 0 }, ease: 'quadOut' }] },
            { type: 'sprite', fps: 12, from: 0, to: 5 },
            { type: 'event', keys: [{ t: 300, name: 'step', call: () => $.sound.play('step') }] },
        ],
    });

    $('<sprite>', { id: 'hero' }).frames(HERO).at(0, 0).appendTo($.world);
    $.anim.player('hero').target('#hero').play('run');
    $.anim.player('hero').on('step', () => $.log('шаг'));
});
```

---

## Чем это отличается от `$.anim.define()` (anim.js)

| | `anim.js` (`$.anim.define` / `.playClip`) | `animplayer.js` (`$.anim.clip` / `$.anim.player`) |
|---|---|---|
| Время ключа | доля клипа `0..1` | миллисекунды от начала |
| Дорожка | имя свойства узла (`prop: 'x'`) | тип (`type: 'position'`) |
| Владелец времени | узел (`node.__clip`) | плеер (часы + слоты) |
| Перемотка | нет | `seek(ms)` |
| Микширование | нет (есть машина состояний) | `blend(a, b, t)` |
| События | `events: [{ at: 0..1 }]` | ключи `t` в мс, `call` и подписки |
| Произвольное значение | `fn`-дорожка | `value`-дорожка + `player.value()` |
| Реестр клипов | `$.anim.define/get/list` | `$.anim.clip/clipGet/clips` |

Реестры **разные**: `$.anim.has('run')` не увидит клип, объявленный через
`$.anim.clip`. Обе подсистемы можно использовать в одной игре, но не стоит
анимировать ими одно и то же свойство одного узла — выигрывает та, что
тикает позже (`tickAnimPlayer` идёт сразу после `tickAnim`).

---

## Формат клипа

`$.anim.clip(name, spec)` — объявить (или переобъявить) клип. Возвращает `$`.
Некорректное объявление бросает исключение: лучше упасть при загрузке, чем
молча показывать неживую анимацию.

| Поле | Тип | По умолчанию | Смысл |
|---|---|---|---|
| `duration` | число, мс | — (обязательно, `> 0`) | длина клипа |
| `loop` | `'once' \| 'loop' \| 'pingpong'` | `'once'` | режим воспроизведения |
| `speed` | число `>= 0` | `1` | темп клипа по умолчанию |
| `tracks` | массив | `[]` | дорожки (см. ниже) |
| `events` | массив | `[]` | события: `{ at, name, data, call }` |

Дорожка-событие может быть и отдельным элементом `tracks`
(`{ type: 'event', keys: [{ t, name, data, call }] }`) — такие ключи попадают
в общий список событий клипа.

### Дорожки

| `type` | Значение ключа `v` | Куда пишется |
|---|---|---|
| `position` | `{x, y}`, `[x, y]`, число (по обеим осям) | `node.x`, `node.y` |
| `position` + `axis: 'x' \| 'y'` | число | только `node.x` или `node.y` |
| `scale` | `{x, y}` или число (равномерно) | `node.scale_x`, `node.scale_y` |
| `rotation` (он же `angle`) | число, радианы | `node.angle` |
| `alpha` (он же `opacity`) | число `0..1` | `node.alpha` |
| `color` (он же `tint`) | `'#rgb'`, `'#rrggbb'`, `'#rrggbbaa'`, `'red'`, `[r,g,b,a]` | `node.color` |
| `sprite` | индекс кадра | `node.sprite`, `node.frame_index` |
| `value` | число | в плеер (`player.value(name)`) |
| `event` | — (ключ с `name`) | колбэк `call` и подписки |

Поля дорожки:

| Поле | Для чего | Смысл |
|---|---|---|
| `keys` | все | массив `{ t, v, ease }`, `t` — **миллисекунды** |
| `axis` | `position` | `'x'` или `'y'` — писать одну ось |
| `name` / `key` / `prop` | `value` | имя значения в `player.value(name)` |
| `attr` | `value` | `true` — писать ещё и в `node.attrs[name]` |
| `from`, `to` | `sprite` | диапазон кадров листа (`to: -1` — последний) |
| `fps` | `sprite` | кадры листаются по кругу со скоростью `fps` |
| `once` | `sprite` | `true` — без зацикливания, встать на `to` |

Сокращения при объявлении: тип можно не писать, если указан привычный
`prop` (`x`, `y`, `scale`, `angle`, `alpha`, `color`, `sprite`); `prop` с любым
другим именем (`prop: 'hp'`) — это `value`-дорожка с записью в `node.attrs`.
Ключ с `name` вместо `v` считается ключом-событием.

### Плавности (`ease`)

Те же кривые, что у твинов (`tween.js`) и клипов `anim.js`: `linear`, `quadIn`,
`quadOut`, `quadInOut`, `cubicIn/Out/InOut`, `quartIn/Out/InOut`,
`sineIn/Out/InOut`, `backIn/Out/InOut`, `elasticIn/Out`, `bounceIn/Out`, `in`,
`out`, `inOut`, `step` и длинные имена (`easeOutQuad`, …). Своей таблицы кривых
модуль не заводит: короткие имена переводит `chooseEase` из `anim.js`, а сами
кривые — `easeFunction` из `tween.js`.

Плавность берётся у ключа-назначения (правого), а если её там нет — у левого:

```js
[{ t: 0, v: 0 }, { t: 600, v: 100, ease: 'quadOut' }]   // ease «на приезде»
[{ t: 0, v: 0, ease: 'quadIn' }, { t: 600, v: 100 }]    // ease «на выезде»
```

### События

```js
$.anim.clip('attack', {
    duration: 400,
    events: [
        { at: 0,   name: 'swing' },                                   // сработает сразу в play()
        { at: 200, name: 'hit', data: { power: 7 },
          call: (e) => $.log('удар', e.data.power) },                 // прямой вызов
    ],
});
```

* событие срабатывает ровно один раз — когда время плеера пересекает его
  момент в интервале `(прошлое, текущее]`;
* в `loop`/`pingpong` событие повторяется каждый проход (его моменты —
  `at + n * duration`); событие `at: 0` — на каждом стыке циклов;
* у подписчика приходит `{ name, data, at, clip, clipName, player }`;
* сообщение приходит и как общее `'event'`, и под своим именем;
* `seek()` события **не** вызывает: это прыжок. Нужно доиграть — `seek(ms, { fire: true })`;
* `stop()` отменяет всё: после остановки события не приходят.

---

## Плееры

### `$.anim.player(name)`

Плеер по имени (создаётся при первом обращении). Без имени — плеер по
умолчанию (`'main'`), тот же, на который смотрит фасад `$.anim.play/stop/…`.

### Методы плеера

| Метод | Что делает |
|---|---|
| `.target(узел \| '#id' \| селектор \| обёртка)` | привязать цель; без аргумента — геттер |
| `.play(clip, opts)` | играть клип; `opts`: `slot`, `weight`, `loop`, `speed`, `restart`, `time`, `offset`, `onEnd` |
| `.blend(a, b, t, opts)` | кроссфейд: `t = 0` — только `a`, `t = 1` — только `b` |
| `.stop(clipName?)` | без имени — остановить всё и сбросить часы; с именем — один клип |
| `.pause()` / `.resume()` / `.paused()` | пауза часов |
| `.seek(ms, { fire })` | перемотка на `ms` от начала клипа |
| `.speed(x)` / `.speed()` | множитель скорости часов (`x >= 0`) |
| `.loop(true \| false \| 'once' \| 'loop' \| 'pingpong' \| null)` | режим повтора; без аргумента — геттер |
| `.playing()` | играет ли что-нибудь (на паузе — тоже `true`) |
| `.time()` | время внутри клипа, мс `0..duration` |
| `.total()` | часы плеера целиком, мс (со всеми проходами) |
| `.clip()` / `.clipNames()` | имя основного клипа / всех играющих |
| `.value(name, fallback?)` | значение `value`-дорожки (`0`, если её нет) |
| `.values()` | все значения последнего кадра |
| `.weight(slot, x?)` | вес слота: геттер/сеттер для ручного кроссфейда |
| `.on(event, fn)` | подписка; возвращает **функцию отписки** |
| `.off(event, fn?)` | снять обработчик(и) |
| `.destroy()` | плеер больше не тикает, подписки снимаются |

Повторный `.play()` того же клипа не сбрасывает время (как `.playClip()` в
`anim.js`): игровой код может звать его каждый кадр без «дёрганья». Нужен
сброс — `{ restart: true }`.

### Фасад `$.anim.*` (плеер по умолчанию)

| Метод | Что делает |
|---|---|
| `$.anim.target(x)` | задать цель плеера по умолчанию |
| `$.anim.play(name, opts)` | играть клип |
| `$.anim.blend(a, b, t, opts)` | кроссфейд |
| `$.anim.stop(clipName?)` / `$.anim.stopAll()` | остановить клип / все плееры |
| `$.anim.pause()` / `$.anim.resume()` / `$.anim.paused()` | пауза часов |
| `$.anim.seek(ms, opts)` | перемотка |
| `$.anim.speed(x?)` | скорость: сеттер (цепочка) или геттер |
| `$.anim.loop(v?)` | режим повтора: сеттер или геттер |
| `$.anim.playing()` / `$.anim.time()` / `$.anim.totalTime()` | состояние |
| `$.anim.clipName()` | имя играющего клипа |
| `$.anim.value(name, fallback?)` / `$.anim.values()` | значения дорожек |
| `$.anim.on(event, fn)` / `$.anim.off(event, fn?)` | подписки (возвращают отписку / `$.anim`) |

Методы-сеттеры возвращают `$.anim`, поэтому цепочки работают:

```js
$.anim.target('#hero').play('run').speed(2);
```

### Реестр клипов плеера

| Метод | Что делает |
|---|---|
| `$.anim.clip(name, spec)` | объявить клип, возвращает `$` |
| `$.anim.clipGet(name)` | нормализованный клип или `null` |
| `$.anim.clips()` | имена клипов плеера |
| `$.anim.removeClip(name)` | удалить клип, `true` если он был |
| `$.anim.clearClips()` | очистить реестр, возвращает `$` |
| `$.anim.players()` | имена созданных плееров |
| `$.anim.defaultPlayer()` | плеер по умолчанию |
| `$.anim.clearPlayers()` | остановить и забыть все плееры |

---

## Примеры

### 1. Ходьба с событием шага и сменой кадров

```js
$.ready(() => {
    $.anim.clip('walk', {
        duration: 800,
        loop: 'loop',
        tracks: [
            { type: 'sprite', fps: 10, from: 0, to: 7 },
            { type: 'position', axis: 'x', keys: [{ t: 0, v: 0 }, { t: 800, v: 160 }] },
        ],
        events: [{ at: 400, name: 'step' }],
    });

    $('<sprite>', { id: 'hero' }).frames({ src: 'hero.png', cols: 8, rows: 1, cw: 32, ch: 32 })
        .at(0, 200).appendTo($.world);

    const hero = $.anim.player('hero').target('#hero').play('walk');
    hero.on('step', () => $.sound.play('step'));
});
```

### 2. Одноразовая анимация двери + value-дорожка

```js
$.anim.clip('door', {
    duration: 500,
    tracks: [{ type: 'rotation', keys: [{ t: 0, v: 0 }, { t: 500, v: -1.57, ease: 'quadOut' }] }],
    events: [{ at: 500, name: 'opened' }],
});

$.anim.clip('stamina', {
    duration: 1000,
    loop: 'loop',
    tracks: [{ type: 'value', name: 'energy', attr: true,
               keys: [{ t: 0, v: 100 }, { t: 1000, v: 0 }] }],
});

$.anim.player('door').target('#door').play('door', {
    onEnd: () => $.log('дверь открыта'),
});

const hud = $.anim.player('stamina').target('#hud').play('stamina');
$.update(() => { $('#bar').value(hud.value('energy') / 100); });
```

### 3. Кроссфейд ходьбы и бега

```js
const p = $.anim.player('hero').target('#hero');
p.play('walk', { slot: 'walk' });
p.play('run', { slot: 'run', weight: 0 });

$.update((dt) => {
    const speed = Math.abs($('#hero').velocity().x);
    const t = Math.max(0, Math.min(1, (speed - 60) / 140));
    p.weight('walk', 1 - t);
    p.weight('run', t);
    // или одной строкой, с обнулением часов:
    // p.blend('walk', 'run', t);
});
```

---

## Чистые функции (для тестов и инструментов)

Экспортируются из `src/highlevel/animplayer.js`, движка не требуют:

| Функция | Что делает |
|---|---|
| `normalizeTimeline(name, spec)` | проверка и нормализация объявления клипа |
| `normalizeTimelineTrack(raw, duration, clipName)` | одна дорожка в каноническом виде |
| `normalizeTimelineKeys(keys, duration, type, raw)` | ключи: мс, сортировка, зажим, канонизация |
| `normalizeEvent(raw, duration)` | событие `{ at, name, data, call }` |
| `trackType(raw)` | тип дорожки (с синонимами и выводом по `prop`) |
| `canonicalKeyValue(type, axis, key)` | значение ключа нужного вида |
| `playerEase(ease)` | функция плавности по имени/функции |
| `sampleKeysAt(keys, ms)` | значение дорожки на момент (число, вектор, цвет) |
| `spriteFrameAt(track, ms, frameCount)` | индекс кадра для дорожки `sprite` |
| `timelineValuesAt(clip, ms, frameCount)` | значения всех дорожек клипа |
| `playheadState(ms, duration, loop)` | `{ position, phase, cycle, ended }` |
| `eventsBetweenTimes(events, from, to, duration, loop)` | события интервала `(from, to]` |
| `blendValues(entries, discrete)` | смешивание значений по весам |
| `writeTrackValue(node, track, value)` | запись значения дорожки в узел |
| `lerpValue(a, b, k)` / `cloneValue(v)` | интерполяция и копия значения |
| `unpackRgba(packed)` / `packRgba(rgba)` | цвет ↔ `[r,g,b,a]` |
| `resolveTarget(value)` | узел/обёртка/селектор → узел |
| `getPlayer(name)` / `advancePlayer(player, ms)` | плеер по имени / шаг одного плеера |
| `tickAnimPlayer(dt)` | шаг всех плееров (вызывается из `api.js`) |
| `installAnimPlayer($)` | установка подсистемы |

Проверка без сборки движка (36 проверок):

```bash
build/_deps/quickjs-build/qjs tests/js/animplayer_test.mjs
```

---

## Подключение

Модуль ставится в `api.js` (это делает интегратор, один писатель на файл):

```js
import { installAnimPlayer, tickAnimPlayer } from './animplayer.js';
// …
installAnim($);
installAnimPlayer($);          // сразу после installAnim: дополняет $.anim
// …
tickAnim(dt);
tickAnimPlayer(dt);            // сразу после tickAnim
```

Интеграционная проверка — `tests/agent/highlevel_animplayer_test.py`
(фикстура `tests/fixtures/animplayer`).

---

## Ограничения (честно)

| Чего нет | Почему / что делать |
|---|---|
| Обратного хода часов | `speed(x)` принимает только `x >= 0`: реверс ломает «событие ровно один раз». Для движения туда-обратно — `loop: 'pingpong'` |
| Кроссфейда кадров спрайта | Кадр дискретен: в `blend()` он берётся у клипа с большим весом, промежуточного кадра не бывает |
| Аддитивного/слоёного смешивания | Микширование — взвешенное среднее по весам; режимов `add`/`mix` как в `AnimationTree` нет |
| Вложенных плееров и IK | Не реализованы: один плеер = одна цель-узел |
| Вложенных дорожек (sub-tracks) и кривых Безье | Интерполяция линейная между ключами + `ease`; своих кривых у ключа нет |
| Точности события внутри кадра | Событие срабатывает в кадре, где время его пересекло; внутри одного клипа порядок — по времени события, между клипами кроссфейда — по порядку слотов |
| Автоматического переноса тела Box2D | `position` пишет `node.x/node.y` напрямую, как в `anim.js`: анимация не телепортирует физику |
| Остановки вместе с `$.time.pause()` | Плеер тикает по сырому `dt` кадра (как `anim.js`): пауза времени на него не действует, для паузы есть `player.pause()` |
| Своего отрисовщика/тега | Подсистема не рисует ничего своего: пишет поля узла, которые читает общая отрисовка |
| Отмены отдельных событий клипа | Отписка (`off`/функция от `on`) или `stop()` целиком |
| Спрайтов без листа | Дорожка `sprite` работает с `node.frames` (`.frames(...)`); если кадров нет, индекс считается, но `node.sprite` не меняется |
