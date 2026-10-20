# P2-полировка — `lib/polish.js`

Сэмплы полировки на существующих подсистемах: decal-пул, привязанные VFX,
позиционный звук, top-down камера, debug-оверлеи и заметки по профилированию.
Никаких новых менеджеров: всё — объекты, которые сцена создаёт и тикает.

```js
import { createPolish, re2dDecalProvider } from './lib/polish.js';

const fx = createPolish($, {
    world,                               // Re2D world (для decals/debug tags)
    roadGraph: graph,
    population: crowd,
    decalProvider: re2dDecalProvider(world),   // или свой для plain 2D
    camera: { follow: '#hero', zoom: 1.2, bounds: { x: 0, y: 0, w: 3000, h: 2000 } },
    h: 0,
});
$.update((dt) => fx.update(dt));         // decals/vfx/audio, debug.draw
fx.debug.toggle('tags');                 // отладочный слой
```

## 1. Decals (следы шин/удары)

`createDecalPool($, {max, life, width, height, fadeIn, fadeOut, provider})`.

`provider` — **интерфейс, который даёт сцена**: функция `(spec) => handle|null`
или объект `{decal(spec)}`. `handle` — что угодно с `.remove()`.

Для Re2D готов адаптер `re2dDecalProvider(world)`: он вызывает
`world.decal({surface, material, u, v, width, height, life, rotation, scale,
fadeIn, fadeOut})` (декаль ставится на **поверхность**; `u`/`v` — координаты в
системе поверхности, а не мировая точка). У `world.decal` есть лимит **128**
decals (`$.capabilities.re2d.maxDecals`) и fade через `fadeIn`/`fadeOut`
(расширенная форма). Для обычного 2D своего decal-API в движке нет: сцена
передаёт свой provider (например, рисует пятна в `$.gfx.draw` или пул
спрайтов) — `polish` не подделывает нативный decal.

| Вызов | Смысл |
|---|---|
| `place(spec)` | произвольная декаль; `spec` пробрасывается провайдеру |
| `tyre(x,y,{width,height,life,rotation,angle})` | след шины |
| `impact(x,y,{…})` | скол/след удара |
| `update(dt)` | возраст; по `life` — `remove()` провайдера |
| `clear()` | снять все |
| `count()/stats()` | активные/лимит/placed/recycled/expired/unsupported |

Пул соблюдает лимит (`max`, по умолчанию 96): при переполнении вытесняется
самая старая декаль (`recycled`). Это **свой** пул поверх провайдера, не замена
нативного лимита 128.

## 2. VFX: привязанные эмиттеры и залпы

`createVfxAttach($, opts)`:

| Вызов | Что делает |
|---|---|
| `exhaust(node, {preset:'smoke', dx, dy, amount, …})` | дочерний `<particles>` в локальном пространстве узла — дым едет с машиной |
| `fire(node, {…})` | то же с пресетом `fire` |
| `attach(node, spec)` | произвольный эмиттер (`preset`/`params`) |
| `burst(name, at, {useVfx, preset, amount})` | разовый залп; `useVfx:true` и имя из `$.vfx.list()` → `$.vfx.play` |
| `impact(x,y)` | искры в точке |
| `update(dt)/count()/clear()/stats()` | уборка осиротевших, счётчики |

Используются существующие `$.particles` (пул, бюджеты, детерминизм seed) и
`$.vfx` (бюджеты/seed/деградация). `autoRemove` (по умолчанию) снимает разовый
эмиттер по событию `particlesEnd`.

## 3. Позиционный звук

`createSpatialAudio($, {listener})` — поверх `$.audio`/`$.sound`:

| Вызов | Что делает |
|---|---|
| `spatial(file, {source, loop, volume, maxDistance})` | канал `$.audio.play` (handle: `volume()`/`pan()` каждый кадр) |
| `engine(node, {file, speed/speedRef, basePitch, maxPitch, idleVolume})` | тон двигателя; громкость/панорама по скорости |
| `horn(file, {source})` | разовый гудок (приоритет выше) |
| `skid(file, {source})` | луп визга, `set(on)` |
| `siren(file, {twoTone, lowPitch, highPitch, period})` | сирена (две высоты) |
| `update(dt)/count()/stopAll()/stats()` | тик/остановка |

Громкость и панорама обновляются через **публичный** handle `$.audio.play`
(`volume()`, `pan()`), позиция — относительно камеры (или `listener`).
**Ограничение:** в публичном API нет `setChannelPitch`/живого изменения тона,
поэтому `engine`/`siren` меняют pitch **перезапуском** канала (`pitchRebuild`,
по умолчанию 0.35 с; сирена — по `period`). Это честный, слышимый сэмпл с
документированным ограничением, а не «идеальный» непрерывный тон. Без
`$.audio` — fallback `$.sound.playAt` (громкость/панорама считаются один раз).

## 4. Top-down камера

`createTopDownCamera($, {follow, zoom, smooth, deadzone, lookahead,
lookaheadSmooth, offset, bounds, shake, apply})` поверх `$.camera`:

```js
const cam = fx.camera;
cam.apply();                       // follow + zoom + deadzone + lookahead + limits
cam.shake(6, 220);                 // тряска (ампитуда px, мс)
cam.zoomTo(1.6, 300);
cam.bounds({x:0,y:0,w:3000,h:2000});   // null — снять
cam.save(); cam.restore();         // snapshot/restore камеры
cam.worldView(world, { orthoHeight: 900 });  // Re2D-вид: world.camera({mode:'topdown'})
```

`bounds` — прямоугольник (сложные формы не поддержаны — ограничение
`$.camera.limits`). `worldView` — **вид мира** Re2D, отдельный от игровой
камеры `$.camera`; это два разных слоя, и presets их не смешивают.

## 5. Debug-оверлеи

`createDebugOverlay($, {roadGraph, population, world, h, sampleStep, maxLabels})`
рисует мировые примитивы через `$.debug.draw` (он сам переводит мир→экран,
включая Re2D-камеру; резерв — `$.gfx.draw`):

| Слой | Что видно |
|---|---|
| `lanes` | линии полос и стрелки направления (`roadgraph.debugLines()`) |
| `spawns` | точки спавна, кольца `spawnDistance`/`despawnDistance` вокруг AOI, живые объекты (persistent — другим цветом) |
| `tags` | семплирование `world.groundAt` по видимой области: цвет по `road/sidewalk/grass/water/parking/no_spawn`, подпись тегов |
| `stimuli` | последние `$.emit('stimulus')` с радиусом и затуханием |

```js
fx.debug.toggle('lanes', true);
fx.debug.toggle('tags');           // переключить
fx.debug.isOn('tags');
const report = fx.debug.draw(0.016);  // {drawn, samples, labels, tagError}
fx.debug.dispose();
```

`F1`-оверлей движка (`$.debug.on()`) не заменяется: это отдельный игровой слой.
Без `world.groundAt` слой `tags` сообщает `tagError` и ничего не выдумывает;
в обычной 2D-сцене работают `lanes/spawns/stimuli`.

## 6. Roof fade — аудит и ограничение

`roofFadeAudit($, world)` проверяет реальный публичный API поверхности:

```js
fx.roofFade(world);
// { supported:false, surfaceApi:true, hasSky:true,
//   limitation:'Re2D surface API has no alpha/fade …', workarounds:[…] }
```

**Вывод: поддерживаемого Re2D surface-fade API нет.** У `world.surface(i)` есть
`material/sky/terrain/conveyor`, но нет `alpha/fade/opacity`. `.sky(true)`
скрывает потолок открытого span'а (крыша исчезает), это **не** fade; выдавать
его за затухание нельзя. В обычной 2D крыша-узел (`<ceiling>`/`<sprite>`)
может затухать обычным `.alpha()` — это свойство узла, а не поверхности Re2D.
Полировка не подделывает fade: сцена либо держит крыши обычными узлами, либо
использует `sky(true)` осознанно.

## 7. Профилирование (заметки, без выдуманных чисел)

Цифры «стало быстрее» без замера не приводятся. Что мерить на реальной сцене:

1. `$.debug.profile()` — время зон кадра (JS-логика, сборка батча, физика);
   `$.debug.profiler.start/end('gta.crowd')` — свои зоны.
2. `$.debug.stats()` — узлы/тела/спрайты/звук; `$.vfx.stats()` — эффекты и
   зарезервированные частицы; `fx.profile()` — decal/vfx/audio/debug counts.
3. `--stats` + `--fixed-dt` на репрезентативной сцене (город, N пешеходов/машин,
   разрешение) — до/после правки, с указанием конфигурации.
4. Что оптимизировать в первую очередь по профилю: частоту `population.update`
   (не чаще кадра), `cooldown/maxPerUpdate`, `minSeparation`, число
   `groundAt`-семплов debug-оверлея (`sampleStep`), количество одновременных
   эмиттеров/декалей (`max`), `$.vfx.budget`.
5. `fx.measure(label, fn)` — обёртка: возвращает `{ms, result}` и (если есть)
   пишет зону в `$.debug.profiler`; время — `$.time.perfNow()`.

## 8. Ограничения

- decals: нативный пул Re2D — 128; plain 2D — только через provider сцены;
- нет живого pitch канала (см. §3);
- `camera.bounds` — прямоугольник; `lookahead` — по направлению движения
  (политика `$.camera`);
- debug-слой — для разработчика; в HUD его не выводить (UI — RmlUi);
- **нет** roof fade поверхностей Re2D (§6).

## 9. Проверка

`tests/agent/re2d_gta_traffic_test.py` (polish smoke): лимит/fade decal-пула,
exhaust/burst, top-down camera follow/zoom/bounds, debug overlay без падения,
`roofFadeAudit().supported === false` с причиной.
