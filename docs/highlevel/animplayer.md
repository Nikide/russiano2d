# `$.anim.player` — анимационный плеер: таймлайны, мультицелевые дорожки, звук и маркеры

Подсистема добавляет к `$` **анимационный плеер** — аналог `AnimationPlayer` в
Godot 4.x, но 2D и в духе `$`. Она живёт в `src/highlevel/animplayer.js`,
дополняет уже существующее пространство `$.anim` (см. [anim.md](anim.md)) и не
заменяет ни один его метод.

Что умеет:

* клипы с дорожками `position`, `scale`, `rotation`, `alpha`, `color`,
  `sprite` (кадры листа), произвольной `value`-дорожкой (число для игры),
  дискретными `visible`/`bool`/`enum`, property-дорожками `emitter`, `shape`,
  `light`, `ui` и cue-дорожками `audio`/`method`/`event`;
* **мультицелевые дорожки** (§41): у дорожки есть `target` относительно корня
  плеера, стабильный id/path, typed binding и режим обновления; binding
  разрешается **до** `play`, а не селектором каждый кадр;
* ключи со временем **в миллисекундах** и плавностью (`ease`) теми же кривыми,
  что у твинов и клипов `anim.js`;
* события-маркеры с ID и policy при seek/loop/skip/restore, gameplay-окна
  (§10) и «предпросмотр без урона»: необратимые damage/spawn маркеры на
  перемотке молчат;
* **audio cues**: resource, bus, gain, offset, length и огибающая, привязанная к
  **своему** handle (чужую громкость дорожка не трогает);
* method-дорожки, вызывающие **зарегистрированные** действия по имени — без
  `eval` строки;
* собственные часы плеера: `play`, `stop`, `interrupt`, `pause/resume`, `seek`,
  `skip`, `restore`, `speed`, `loop`, режимы `once` / `loop` / `pingpong`;
* домен часов (§6): `clock: 'simulation'` (по умолчанию, стоит на паузе и
  hit-stop) или `clock: 'presentation'` (идёт сырым временем кадра);
* микширование двух клипов (`blend(a, b, t)`) и ручной кроссфейд по весам;
* начальная поза (`reset`, `initial`) и загрузка клипов из открытого JSON
  (`$.anim.load`), которая играет без ручного frame-callback на каждую дорожку;
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

Один клип на шесть целей (кадр героя, оружие, sensor атаки, эмиттер, вспышка
света и SFX) — см. пример 3 ниже.

---

## Чем это отличается от `$.anim.define()` (anim.js)

| | `anim.js` (`$.anim.define` / `.playClip`) | `animplayer.js` (`$.anim.clip` / `$.anim.player`) |
|---|---|---|
| Время ключа | доля клипа `0..1` | миллисекунды от начала |
| Дорожка | имя свойства узла (`prop: 'x'`) | тип (`type: 'position'`) + `binding`/`target` |
| Владелец времени | узел (`node.__clip`) | плеер (часы + слоты) |
| Цель дорожки | узел целиком | корень плеера и его дети (`target`) |
| Перемотка | нет | `seek`/`skip`/`restore` |
| Микширование | нет (есть машина состояний) | `blend(a, b, t)` |
| События | `events: [{ at: 0..1 }]` | маркеры в мс с ID и policy |
| Произвольное значение | `fn`-дорожка | `value`-дорожка + `player.value()` |
| Звук в таймлайне | нет | `audio`-дорожка (§41) |
| Реестр клипов | `$.anim.define/get/list` | `$.anim.clip/clipGet/clips` |

Реестры **разные**: `$.anim.has('run')` не увидит клип, объявленный через
`$.anim.clip`. Обе подсистемы можно использовать в одной игре. Дорожка
`sprite` с `clip: true` (binding `sprite.clip`) — это единственная точка
соприкосновения: она выбирает именованный клип `anim.js` через `.playClip()`.
Не стоит анимировать одним и тем же свойством одного узла обеими подсистемами —
выигрывает та, что тикает позже (`tickAnimPlayer` идёт сразу после `tickAnim`).

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
| `clock` | `'simulation' \| 'presentation'` | `'simulation'` | домен часов (§6); клип лишь **просит** домен, явный `player.clock(x)` важнее |
| `reset` | bool | `false` | `true` — `play()` сразу ставит начальную позу |
| `tracks` | массив | `[]` | property- и cue-дорожки (см. ниже) |
| `events` | массив | `[]` | маркеры: `{ at, name, id?, data?, kind?, window?, policy? }` |

### Дорожки: старый формат

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
| `event` | — (ключ с `name`) | колбэк `call`, подписки и узлы-маркеры |

Старый формат работает без изменений: у дорожки без `target`/`binding` id и
ключ значения остаются прежними (`alpha`, `stamina`, `x`…), пишется она в
узел-корень плеера.

### Дорожки §41: дискретные и property

| `type` | `binding` по умолчанию | Значение ключа | Куда пишется |
|---|---|---|---|
| `visible` | `visible` | `true/false` | `node.visible` |
| `bool` | задаётся полем `binding` | `true/false` | адаптер зарегистрированного binding'а |
| `enum` | задаётся полем `binding` | строка | адаптер; промежуточного значения нет |
| `attr` | `attr` | любой JSON | `node.attrs[name]` (совместимо со старым `prop: 'hp'`) |
| `emitter` | `emitter.emitting` (`prop: 'position'` → `emitter.position`) | `true/false` или `{x,y}` | `.emitting()` эмиттера / позиция узла |
| `shape` | `shape.enabled` | `true/false` | безопасная команда движка (не запись поля) |
| `light` | `light.intensity` (`prop: 'radius'` → `light.radius`) | число | `node.intensity` / `node.radius` |
| `ui` | `ui.style` (`field: 'value'` → `ui.value`) | число/строка | документ RmlUi: `doc.style(el, prop, v)` / `doc.setValue(el, v)` |
| `sprite` + `clip: true` | `sprite.clip` | имя клипа `anim.js` | `node.playClip(name)` |
| `audio` | — | огибающая (см. ниже) | запуск звука и его громкость |
| `method` | — | — | зарегистрированное действие `$.anim.action(name, fn)` |

### Поля дорожки

| Поле | Тип | По умолчанию | Смысл |
|---|---|---|---|
| `type` | строка | — | тип дорожки (или выводится по `prop`, см. сокращения) |
| `binding` | строка | по типу | имя адаптера (§41), перекрывает вывод по типу |
| `target` | строка/узел | корень плеера | цель дорожки: `'#id'`, селектор, `'.'`, путь `'weapon/barrel'` по прямым детям (id или `attrs.name`) |
| `id` | строка | выводится | стабильный ID дорожки (ключ в `player.values()`); по умолчанию `binding[.channel][@target]` |
| `keys` | массив | `[]` | `{ t, v, ease? }`, `t` — **миллисекунды** от начала клипа |
| `mode` | `'apply' \| 'change' \| 'once'` | дискретные — `change`, остальные — `apply` | режим обновления: каждый кадр / по изменению / один раз |
| `initial` (он же `reset`) | любое | первый ключ | начальная поза для `player.reset()` и `play({reset:true})` |
| `axis` | `'x' \| 'y'` | — | писать одну ось (`position`, `emitter.position`) |
| `name` / `key` / `prop` | строка | — | имя значения для `value`/`attr` (`player.value(name)`) |
| `attr` | bool | `false` (но `true` для `prop`-фолбэка) | писать ещё и в `node.attrs[name]` |
| `from`, `to` | число | `0`, `-1` | диапазон кадров листа (`-1` — последний) |
| `fps` | число | `0` | листать кадры со скоростью `fps` |
| `once` | bool | `false` | кадры без зацикливания / маркер один раз за всё время |
| `doc`, `element`, `property` | строка | — | для `ui.style`/`ui.value`: документ `.rml`, элемент, CSS-свойство |
| `shape` | число | `0` | индекс формы для `shape.enabled` (нужен per-shape гейт сборки) |
| `at` | число, мс | `0` | момент cue-дорожки (`audio`, `method`, `event`) |
| `policy` | объект | см. таблицу policy | поведение маркера при `seek`/`skip`/`loop`/`restore` |
| `kind` | строка | `null` | класс маркера; `damage`/`spawn`/`kill` → необратимый |
| `irreversible` | bool | по `kind` | `true` — не повторяется на seek/skip без явного разрешения |
| `window`, `windowPhase` | строка | `null` | gameplay-окно: имя и `'open'`/`'close'` |

Сокращения при объявлении: тип можно не писать, если указан привычный `prop`
(`x`, `y`, `scale`, `angle`, `alpha`, `color`, `sprite`); `prop` с любым другим
именем (`prop: 'hp'`) — это `value`-дорожка с записью в `node.attrs`. Ключ с
`name` вместо `v` считается ключом-событием. Полные имена binding'ов можно
писать прямо в `type`: `shape.enabled`, `emitter.emitting`, `light.intensity`,
`ui.style`, `sprite.frame`.

### Audio-дорожка (`type: 'audio'`)

| Поле | Единица | По умолчанию | Смысл |
|---|---|---|---|
| `resource` (он же `src`/`sound`/`path`) | путь | — (обязательно) | что играть |
| `at` | мс | `0` | когда запускать |
| `bus` | имя шины | `'sfx'` (`$.audio`) | шина маршрутизации |
| `gain` | множитель | `1` | базовая громкость |
| `offset` | секунды | `0` | с какого места начинать |
| `length` | мс | `0` (без лимита) | через сколько погасить **свой** handle |
| `loop` | bool | `false` | зацикливать |
| `keep` | bool | `false` | не гасить при конце/остановке клипа |
| `stop` | bool | `false` | не играть, а погасить звуки этого слоя в момент `at` |
| `envelope` (он же `keys`) | `{t (мс), v (множитель)}` | `[]` | огибающая громкости **своего** handle по времени клипа |

Envelope умножает `gain` и уходит в `handle.volume(...)` конкретного канала:
громкость чужих звуков и шин не меняется. Если `$.audio` не поставлен, дорожка
падает на `$.sound.play` + `engine.audio.setChannelVolume` и по-прежнему
управляет только своим каналом.

### Method-дорожка (`type: 'method'`)

`{ type: 'method', at: 150, name: 'camera.shake', data: { intensity: 6 } }`
зовёт действие, зарегистрированное через `$.anim.action(name, fn)`; строки не
вычисляются. Встроены `camera.shake`, `camera.zoom`, `camera.pan`,
`sound.stop`. Действие получает payload маркера (`{ name, id, data, at, phase,
clip, clipName, player }`). Незарегистрированное действие не роняет кадр —
один раз пишется в журнал.

### Policy маркеров

`policy` (или те же поля прямо в маркере) со значениями `'fire' | 'skip' |
'state' | 'once'`:

| Фаза | По умолчанию | Смысл |
|---|---|---|
| `normal` | — | обычный ход: маркер срабатывает ровно один раз при пересечении |
| `seek` | `'skip'` | `player.seek(ms)`: прыжок без событий; `seek(ms, {fire:true})` доигрывает маркеры, у которых политика не запрещает |
| `skip` | `'skip'` | `player.skip(ms)`: перемотка вперёд с той же фильтрацией |
| `loop` | `'fire'` | `'once'` — маркер срабатывает один раз за всё время, а не каждый проход |
| `restore` | `'skip'` | `player.restore(ms)`: восстанавливает значение состояния, cue не проигрывает |

Авто-умолчание не ломает прежний контракт `seek(ms, {fire:true})`: обычный
маркер (без явной `policy`) доигрывается. Явная `policy: {seek: 'skip'}`
запрещает. Необратимые маркеры (`kind: 'damage'/'spawn'/'kill'` или
`irreversible: true`) при seek/skip **не выполняются**, пока не передано
`{ irreversible: true }` — предпросмотр перемотки урона не наносит.

Маркер имеет стабильный ID: `id` из объявления или `name@at`. Он попадает в
payload (`payload.id`) и в `$.anim.markers(clip)`.

### Gameplay-окна (§10)

Маркер с `window: 'attack'` и `windowPhase: 'open' | 'close'` открывает и
закрывает окно. Плеер хранит состояние: `player.window('attack')` →
`true/false`, `player.windows()` → `[{ name, open, at, clip }]`. На каждое
изменение приходит подписка `'window'` (payload с `window: { name, open }`).
Прерывание (`interrupt()`), конец клипа и `stop()` закрывают окна слоя с
причиной в payload.

---

## Target, binding и режим обновления

```js
$.anim.clip('attack', {
    duration: 600,
    tracks: [
        { type: 'sprite', keys: [{ t: 0, v: 0 }, { t: 600, v: 3 }] },              // корень плеера
        { type: 'rotation', target: 'weapon', keys: [...] },                        // ребёнок 'weapon'
        { type: 'visible', target: 'weapon', keys: [...] },
        { type: 'shape', binding: 'shape.enabled', target: 'attack-sensor',
          keys: [{ t: 150, v: true }, { t: 400, v: false }] },
        { type: 'light', binding: 'light.intensity', target: 'weapon/flash', keys: [...] },
        { type: 'audio', at: 150, resource: 'shot.ogg', bus: 'sfx', gain: 0.8 },
        { type: 'method', at: 150, name: 'camera.shake', data: { intensity: 6 } },
    ],
});
$.anim.player('hero').target('#hero').play('attack');
```

* `target` — относительно **корня плеера** (`player.target()`): `'.'`/пусто —
  сам корень, `'#id'`/селектор — поиск по сцене, `'a/b'` — путь по прямым
  детям (совпадение по `id` или `attrs.name`).
* Разрешение происходит в `play()`/`bindLayer()` один раз. В кадре селекторы не
  ищутся: `player.bindings()` показывает, что и куда привязалось
  (`{ clip, id, binding, target, mode, resolved }`).
* Если узел цели исчез позже, разрешённый handle продолжает писать в найденный
  узел (и ничего не делает, если узел помечен `removed`). Пропавшая на момент
  `play` цель даёт запись в журнал; остальные дорожки клипа работают.
* `mode: 'change'` не пишет одно и то же значение дважды (дискретное состояние),
  `mode: 'once'` — только при старте/сбросе, `mode: 'apply'` — каждый кадр.
  После `seek`/`skip`/`restore`/`reset` дискретное состояние пересчитывается
  принудительно, независимо от режима.

### Минимальный набор binding'ов §41

| binding | kind | Цель | Что делает |
|---|---|---|---|
| `transform` | непрерывный | узел | `position`/`scale`/`rotation`/`alpha`/`color`: поля узла (без переноса тела Box2D) |
| `visible` | дискретный | узел | `node.visible` |
| `sprite.frame` | дискретный | узел | `node.sprite` + `node.frame_index` из `node.frames` |
| `sprite.clip` | дискретный | узел | `node.playClip(name)` (клип `anim.js`) |
| `emitter.emitting` | дискретный | `<particles>` | существующий setter `.emitting()` |
| `emitter.position` | непрерывный | узел | `node.x`/`node.y` (эмиттер читает их каждый кадр) |
| `shape.enabled` | дискретный | узел с телом | команда движка: `engine.setShapeEnabled` (если есть) либо `engine.setBodyEnabled` для одной формы; поле в обход физики не пишется |
| `light.intensity` | непрерывный | `<light>` | `node.intensity` |
| `light.radius` | непрерывный | `<light>` | `node.radius` |
| `ui.style` | непрерывный | RmlUi-документ | `doc.style(element, property, value)` |
| `ui.value` | дискретный | RmlUi-документ | `doc.setValue(element, value)` |
| `audio.gain` | непрерывный | handle звука | громкость handle: ключ — поле дорожки `handle`, иначе `key`/`id`; audio-cue кладёт свой handle под `audio:<id>` |
| `attr` | store | узел | `node.attrs[name]` |
| `value` | store | плеер | только `player.value(name)` |

Свой binding регистрируется игрой:

```js
$.anim.bind('my.glow', {
    kind: 'continuous',                                  // или 'discrete'/'store'/'cue'
    resolve: (root, track) => (root ? { node: root } : null),
    apply: (handle, value, track) => { handle.node.attrs.glow = value; },
});
$.anim.bindings();                                       // имена всех адаптеров
```

Произвольный JSON-path не обходит physics safety: `shape.enabled` идёт командой
движка, а не записью поля (`root.body` не меняется напрямую).

---

## Сброс, воспроизведение и прерывание

| Ситуация | Поведение |
|---|---|
| `play(clip)` (другой клип) | слот `base` заменяет всё: слои снимаются, окна закрываются, звук гаснет, часы в 0 |
| `play(тот же клип)` | **идемпотентно**: часы не сбрасываются, события не повторяются; нужен сброс — `{ restart: true }` |
| `play(clip, { reset: true })` / `clip.reset` | часы в 0, начальная поза применяется сразу |
| `player.reset()` | часы в 0 и начальная поза (`initial`/`reset` или первый ключ) без снятия слоёв |
| `stop()` | снять все слои, часы в 0, окна закрыть, звук погасить (кроме `keep`) |
| `stop(clipName)` / `interrupt(clipName)` | снять один клип: окна и звук этого слоя закрываются |
| конец `once`-клипа | `finished` (ровно один раз) + `onEnd`; окна закрыты, звук погашен; `reason: 'completed'` |
| `seek`/`skip`/`restore` | позиция меняется, дискретное состояние пересчитывается, cue не повторяются (см. policy) |

Событие `finished` приходит один раз на слой: слот удаляется до рассылки, а
`onEnd`, который снова играет клип, не порождает второго `finished` того же
слоя. Цепочка частей (`onEnd` → `play` следующей) продолжает flow ровно один
раз на часть.

---

## Часы (§6): `simulation` и `presentation`

| Домен | Источник времени | Пауза `$.time.pause()` | Hit-stop `$.time.freeze()` |
|---|---|---|---|
| `simulation` (по умолчанию) | `$.time.delta()`, тот же `dt`, что у твинов и физики | стоит | стоит |
| `presentation` | `$.time.rawDelta()` (сырой кадр) | идёт | идёт |

```js
$.anim.player('fx').clock('presentation');   // VFX/камера: живут на паузе
$.anim.player('hero').clock();               // 'simulation'
```

Домен задаётся у плеера (`player.clock(x)`) или просится клипом
(`clock: 'presentation'` в spec); явный выбор игрока не перетирается. Старые
клипы и код ничего не знают о новой опции и получают прежнее поведение —
`simulation`. `player.pause()` останавливает часы в любом домене.

Практика: урон и gameplay-окна висят на `simulation`-плеерах (hit-stop их
замораживает, повторного урона не возникает), а вспышка/камера/UI-переход — на
`presentation`, чтобы завершающий flash не блокировался заморозкой.

---

## JSON: `$.anim.load(data)`

`$.anim.load` принимает JSON-строку, объект клипа, массив клипов или
`{ clips: { имя: spec } }`. Все дорожки data-only: события и method-дорожки
ссылаются на **имена** зарегистрированных действий, звук запускается
audio-дорожкой, значения — открытые числа/строки/`{x,y}`. Frame-callback на
каждую дорожку не нужен.

```js
$.anim.action('game.camera', (e) => $.camera.shake(e.data.intensity, 120));
$.anim.load('{"clips":{"attack":{"duration":600,"tracks":[' +
    '{"type":"visible","target":"weapon","keys":[{"t":0,"v":true},{"t":400,"v":false}]},' +
    '{"type":"audio","at":150,"resource":"shot.ogg","bus":"sfx"},' +
    '{"type":"method","at":150,"name":"game.camera","data":{"intensity":6}}]}}}');
$.anim.player('hero').target('#hero').play('attack');
```

`$.anim.clipJSON` — синоним. `$.anim.markers(name)` отдаёт нормализованные
маркеры клипа (id, kind, окно, policy) для инструментов и проверок.

---

## Плееры

### `$.anim.player(name)`

Плеер по имени (создаётся при первом обращении). Без имени — плеер по
умолчанию (`'main'`), тот же, на который смотрит фасад `$.anim.play/stop/…`.

### Методы плеера

| Метод | Что делает |
|---|---|
| `.target(узел \| '#id' \| селектор \| обёртка)` | корень плеера (и база для `target` дорожек); без аргумента — геттер |
| `.play(clip, opts)` | играть клип; `opts`: `slot`, `weight`, `loop`, `speed`, `restart`, `time`, `offset`, `onEnd`, `reset`, `clock` |
| `.blend(a, b, t, opts)` | кроссфейд: `t = 0` — только `a`, `t = 1` — только `b` |
| `.stop(clipName?)` | без имени — остановить всё и сбросить часы; с именем — один клип |
| `.interrupt(clipName?)` | то же, но читаемо в обработчике отмены атаки |
| `.pause()` / `.resume()` / `.paused()` | пауза часов |
| `.seek(ms, { fire, irreversible })` | перемотка; `fire: true` доигрывает разрешённые маркеры |
| `.skip(ms, opts)` | пропуск вперёд (policy-фаза `skip`) |
| `.restore(ms, opts)` | восстановление позиции (фаза `restore`): состояние считается, cue нет |
| `.clock(value?)` | домен часов: `'simulation'`/`'presentation'`; геттер без аргумента |
| `.reset()` | начальная поза и часы в 0 |
| `.speed(x)` / `.speed()` | множитель скорости часов (`x >= 0`) |
| `.loop(true \| false \| 'once' \| 'loop' \| 'pingpong' \| null)` | режим повтора; без аргумента — геттер |
| `.playing()` | играет ли что-нибудь (на паузе — тоже `true`) |
| `.time()` | время внутри клипа, мс `0..duration` |
| `.total()` | часы плеера целиком, мс (со всеми проходами) |
| `.clip()` / `.clipNames()` | имя основного клипа / всех играющих |
| `.value(name, fallback?)` | значение `value`/`attr`-дорожки (`0`, если её нет) |
| `.values()` | все значения последнего кадра (ключи — id дорожек) |
| `.weight(slot, x?)` | вес слота: геттер/сеттер для ручного кроссфейда |
| `.window(name)` / `.windows()` / `.openWindows()` | gameplay-окна |
| `.bindings()` | разрешённые binding'и играющих слоёв (цель, режим, статус) |
| `.markerFired(id)` | сработал ли маркер с `policy.loop: 'once'` |
| `.audioHandle(name, handle?)` | внешний handle для binding'а `audio.gain` |
| `.on(event, fn)` | подписка (`'event'`, имя маркера, `'window'`, `'finished'`); возвращает функцию отписки |
| `.off(event, fn?)` | снять обработчик(и) |
| `.destroy()` | плеер больше не тикает, окна/звук/подписки снимаются |

### Фасад `$.anim.*` (плеер по умолчанию)

| Метод | Что делает |
|---|---|
| `$.anim.target(x)` | задать корень плеера по умолчанию |
| `$.anim.play(name, opts)` | играть клип |
| `$.anim.blend(a, b, t, opts)` | кроссфейд |
| `$.anim.stop(clipName?)` / `$.anim.interrupt(clipName?)` / `$.anim.stopAll()` | остановить клип / с отменой / все плееры |
| `$.anim.pause()` / `$.anim.resume()` / `$.anim.paused()` | пауза часов |
| `$.anim.seek(ms, opts)` / `$.anim.skip(ms, opts)` / `$.anim.restore(ms, opts)` | перемотка/пропуск/восстановление |
| `$.anim.reset()` | начальная поза |
| `$.anim.clock(x?)` | домен часов: сеттер (цепочка) или геттер |
| `$.anim.window(name)` / `$.anim.openWindows()` | gameplay-окна |
| `$.anim.speed(x?)` / `$.anim.loop(v?)` | скорость и режим повтора: сеттер или геттер |
| `$.anim.playing()` / `$.anim.time()` / `$.anim.totalTime()` | состояние |
| `$.anim.clipName()` | имя играющего клипа |
| `$.anim.value(name, fallback?)` / `$.anim.values()` | значения дорожек |
| `$.anim.on(event, fn)` / `$.anim.off(event, fn?)` | подписки (возвращают отписку / `$.anim`) |

### Реестр клипов, binding'ов и действий

| Метод | Что делает |
|---|---|
| `$.anim.clip(name, spec)` | объявить клип, возвращает `$` |
| `$.anim.clipGet(name)` | нормализованный клип или `null` |
| `$.anim.clips()` | имена клипов плеера |
| `$.anim.load(data)` / `$.anim.clipJSON(data)` | загрузить клипы из JSON/объекта |
| `$.anim.markers(name)` | нормализованные маркеры клипа |
| `$.anim.removeClip(name)` | удалить клип, `true` если он был |
| `$.anim.clearClips()` | очистить реестр, возвращает `$` |
| `$.anim.bind(name, adapter)` / `$.anim.bindings()` | зарегистрировать/перечислить адаптеры свойств |
| `$.anim.action(name, fn)` / `$.anim.actions()` / `$.anim.actionRemove(name)` | реестр действий method-дорожек |
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

### 3. Один клип — шесть целей (§41)

```js
$.anim.action('game.camera', (e) => $.camera.shake(e.data.intensity, 120));

$.anim.clip('attack', {
    duration: 600,
    tracks: [
        { type: 'sprite', keys: [{ t: 0, v: 0 }, { t: 600, v: 3 }] },               // кадры героя
        { type: 'rotation', target: 'weapon', keys: [{ t: 0, v: 0 }, { t: 300, v: 1.2 }, { t: 600, v: 0 }] },
        { type: 'position', target: 'weapon', keys: [{ t: 0, v: { x: 0, y: 0 } },
                                                     { t: 300, v: { x: 12, y: -4 } },
                                                     { t: 600, v: { x: 0, y: 0 } }] },
        { type: 'visible', target: 'weapon', keys: [{ t: 0, v: true }, { t: 480, v: false }, { t: 600, v: true }] },
        { type: 'shape', binding: 'shape.enabled', target: 'sensor',
          keys: [{ t: 0, v: false }, { t: 150, v: true }, { t: 400, v: false }] },
        { type: 'emitter', target: 'smoke', keys: [{ t: 0, v: false }, { t: 150, v: true }, { t: 500, v: false }] },
        { type: 'light', binding: 'light.intensity', target: 'weapon/flash',
          keys: [{ t: 0, v: 0 }, { t: 150, v: 3 }, { t: 500, v: 0 }] },
        { type: 'audio', at: 150, resource: 'shot.ogg', bus: 'sfx', gain: 0.7,
          envelope: [{ t: 150, v: 1 }, { t: 500, v: 0 }] },
        { type: 'method', at: 150, name: 'game.camera', data: { intensity: 6 } },
    ],
    events: [
        { at: 150, name: 'attack-open', window: 'attack', windowPhase: 'open' },
        { at: 400, name: 'attack-close', window: 'attack', windowPhase: 'close' },
        { at: 350, name: 'hit', kind: 'damage', data: { power: 5 } },     // не сработает на seek
    ],
});

$('<sprite>', { id: 'hero', frames: HERO }).at(200, 300).appendTo($.world);
$('<rect>', { id: 'weapon' }).appendTo($('#hero'));
$('<rect>', { id: 'sensor' }).size(24, 24).body('static').sensor(true).appendTo($('#hero'));
$('<particles>', { id: 'smoke', rate: 30, lifetime: 400 }).appendTo($('#hero'));
$('<light>', { id: 'flash' }).appendTo($('#weapon'));

const hero = $.anim.player('hero').target('#hero');
hero.on('hit', (e) => damage(e.data.power));
hero.on('window', (e) => $.log('окно', e.window.name, e.window.open));
hero.on('finished', () => startNextPart());          // flow продолжается ровно один раз
hero.play('attack');
```

### 4. Кроссфейд ходьбы и бега

```js
const p = $.anim.player('hero').target('#hero');
p.play('walk', { slot: 'walk' });
p.play('run', { slot: 'run', weight: 0 });

$.update((dt) => {
    const speed = Math.abs($('#hero').velocity().x);
    const t = Math.max(0, Math.min(1, (speed - 60) / 140));
    p.weight('walk', 1 - t);
    p.weight('run', t);
    // или одной строкой с обнулением часов:
    // p.blend('walk', 'run', t);
});
```

### 5. Мультицелевой клип: отряд, камера, UI и музыка

```js
$('<rect>', { id: 'squad' }).appendTo($.world);
$('<rect>', { id: 'unit-a' }).appendTo($('#squad'));
$('<rect>', { id: 'unit-b' }).appendTo($('#squad'));

$.anim.clip('squad', {
    duration: 800,
    tracks: [
        { type: 'position', target: 'unit-a', keys: [{ t: 0, v: { x: 0, y: 0 } }, { t: 800, v: { x: 120, y: 0 } }] },
        { type: 'position', target: 'unit-b', keys: [{ t: 0, v: { x: 0, y: 0 } }, { t: 800, v: { x: -120, y: 0 } }] },
        { type: 'ui', binding: 'ui.style', doc: 'ui/hud.rml', element: 'fade', property: 'opacity',
          keys: [{ t: 0, v: 1 }, { t: 800, v: 0 }] },
        { type: 'ui', binding: 'ui.value', doc: 'ui/hud.rml', element: 'lives',
          keys: [{ t: 0, v: 3 }, { t: 800, v: 1 }] },
        { type: 'method', at: 100, name: 'game.camera', data: { intensity: 3 } },
        { type: 'audio', at: 0, resource: 'theme.ogg', bus: 'music', gain: 0.6, keep: true },
    ],
});

$.anim.player('squad').target('#squad').play('squad');
```

---

## Чистые функции (для тестов и инструментов)

Экспортируются из `src/highlevel/animplayer.js`, движка не требуют:

| Функция | Что делает |
|---|---|
| `normalizeTimeline(name, spec)` | проверка и нормализация объявления клипа |
| `normalizeTimelineTrack(raw, duration, clipName)` | одна дорожка в каноническом виде |
| `normalizeTimelineKeys(keys, duration, type, raw)` | ключи: мс, сортировка, зажим, канонизация |
| `normalizeEvent(raw, duration)` | маркер `{ at, id, name, data, call, policy, window, irreversible }` |
| `normalizePolicy(raw, src)` | policy маркера: фазы + признак `explicit` |
| `normalizeAudioTrack(raw, duration, clip)` | audio cue: resource/bus/gain/offset/length/envelope/policy |
| `normalizeMethodTrack(raw, duration, clip)` | method cue: имя действия и policy |
| `markerAllowed(ev, phase, opts)` | срабатывает ли маркер в фазе seek/skip/restore/normal |
| `markerId(ev)` | стабильный ID маркера (`id` или `name@at`) |
| `trackType(raw)` / `bindingForTrack(type, raw)` | тип дорожки и её binding по умолчанию |
| `canonicalKeyValue(type, axis, key)` / `canonicalValue(kind, key)` | значение ключа нужного вида |
| `resolveTrackTarget(root, spec)` | target `{ node, id, path }` относительно корня |
| `registerBinding(name, adapter)` / `getBinding(name)` / `bindingNames()` | реестр адаптеров |
| `registerAction(name, fn)` / `getAction(name)` / `actionNames()` | реестр действий |
| `playerEase(ease)` | функция плавности по имени/функции |
| `sampleKeysAt(keys, ms)` | значение дорожки на момент (число, вектор, цвет) |
| `spriteFrameAt(track, ms, frameCount)` | индекс кадра для дорожки `sprite` |
| `trackValueAt(track, ms, frameCount)` | значение одной дорожки |
| `timelineValuesAt(clip, ms, frameCount)` | значения дорожек (совместимый формат) |
| `timelineTrackValuesAt(clip, ms, frameCount)` | значения с id дорожек |
| `playheadState(ms, duration, loop)` | `{ position, phase, cycle, ended }` |
| `eventsBetweenTimes(events, from, to, duration, loop)` | события интервала `(from, to]` |
| `blendValues(entries, discrete)` | смешивание значений по весам |
| `blendTrackEntries(entries, discrete)` | смешивание по id мультицелевых дорожек |
| `isDiscreteTrack(track)` | дискретная ли дорожка |
| `initialTrackValue(track)` | начальное значение дорожки для reset |
| `playerStepMs(player, dt)` | шаг часов с учётом домена clock |
| `writeTrackValue(node, track, value)` | запись значения легаси-дорожки в узел |
| `lerpValue(a, b, k)` / `cloneValue(v)` | интерполяция и копия значения |
| `unpackRgba(packed)` / `packRgba(rgba)` | цвет ↔ `[r,g,b,a]` |
| `boolOf(v)` / `sameValue(a, b)` | приведение к bool и сравнение значений |
| `resolveTarget(value)` | узел/обёртка/селектор → узел |
| `getPlayer(name)` / `advancePlayer(player, ms)` | плеер по имени / шаг одного плеера |
| `tickAnimPlayer(dt)` | шаг всех плееров (вызывается из `api.js`) |
| `installAnimPlayer($)` | установка подсистемы |

Проверка без сборки движка (36 + 49 + 29 проверок):

```bash
build/_deps/quickjs-build/qjs tests/js/animplayer_test.mjs
build/_deps/quickjs-build/qjs tests/js/anim_tracks_test.mjs
build/_deps/quickjs-build/qjs tests/js/anim_test.mjs
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
tickAnimPlayer(dt);            // сразу после tickAnim; dt — игровое время
```

`tickAnimPlayer` получает игровое время (`$.time.delta()`): пауза и hit-stop
останавливают `simulation`-плееры. Плееры с `clock: 'presentation'` берут сырое
время кадра сами и потому тикают даже при нулевом `dt`.

Интеграционные проверки — `tests/agent/highlevel_animplayer_test.py`
(фикстура `tests/fixtures/animplayer`) и
`tests/agent/highlevel_animtracks_test.py` (фикстура `tests/fixtures/animtracks`,
сценарий приёмки §41).

---

## Ограничения (честно)

| Чего нет | Почему / что делать |
|---|---|
| Обратного хода часов | `speed(x)` принимает только `x >= 0`: реверс ломает «событие ровно один раз». Для движения туда-обратно — `loop: 'pingpong'` |
| Кроссфейда кадров спрайта | Кадр дискретен: в `blend()` он берётся у клипа с большим весом, промежуточного кадра не бывает |
| Аддитивного/слоёного смешивания | Микширование — взвешенное среднее по весам; режимов `add`/`mix` как в `AnimationTree` нет |
| Вложенных плееров и IK | Не реализованы: один плеер = один корень, цели дорожек — его поддерево |
| Вложенных дорожек (sub-tracks) и кривых Безье | Интерполяция линейная между ключами + `ease`; своих кривых у ключа нет |
| Порядка маркеров внутри кадра между слоями | Внутри клипа — по времени, между клипами кроссфейда — по порядку слотов |
| Автоматического переноса тела Box2D | `transform`/`emitter.position` пишут поля узла: анимация не телепортирует физику. Physics-affecting движение — через controller/physics-команды игры |
| Per-shape enable в старой сборке | `shape.enabled` использует `engine.setShapeEnabled`, когда он есть; иначе — `engine.setBodyEnabled` для цели с одной формой (с индексом формы дорожка молчит и пишет в журнал) |
| Своего отрисовщика/тега | Подсистема не рисует ничего своего: пишет поля узла и вызывает подсистемы |
| Гарантии громкости шин | `audio.gain` и envelope меняют только свой handle; итоговую громкость шины считает `$.audio` |
| Отмены отдельных событий клипа | Отписка (`off`/функция от `on`), `policy` маркера или `stop()` целиком |
| Спрайтов без листа | Дорожка `sprite` работает с `node.frames` (`.frames(...)`); если кадров нет, индекс считается, но `node.sprite` не меняется |
| RmlUi-стиля без документа | `ui.style`/`ui.value` требуют загруженного `.rml`; без `$.ui.doc` дорожка пропускается с записью в журнал |
