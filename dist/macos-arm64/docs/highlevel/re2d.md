# Re2D World — public `$` API

Редакция 2026-10-18. Для нового рендера используйте `$.re2dWorld`. Это native world handle с собственными cells/spans/portals, списком ссылок на существующие узлы со спрайтами и camera configuration. `$.re2d.room`, `.kind(Re2D)` и `$.re2d.world` сохранены в [legacy reference](re2d_legacy.md); это другие entry points, не сокращённые имена нового API.

## Создание и кадр

```js
const world = $.re2dWorld.load('maps/room.re2dworld').backend('gpu');
const sprite = $.re2dSprite.from('art/hero.character.json')
  .at(150,120).depth(0).size(60,80).re2dStyle('anime').hide();
world.add(sprite);
const view = {x:40,y:120,h:48,yaw:0,pitch:0,fov:70,near:1};
$.render(() => world.render(view,400,240));
```

Файлы примера должны существовать в проекте. Полностью запускаемый пример без внешней карты — [World guide](../RE2D_WORLD_GUIDE.md#минимальный-mainjs).

| Вызов | Контракт |
| --- | --- |
| `$.re2dWorld.load(path)` | читает native author/baked JSON из VFS; включает watcher при engine hot reload |
| `$.re2dWorld.fromJSON(text)` | принимает JSON **строку**, не объект; author topology строится в C |
| `world.add(target)` / `.remove(target)` | регистрирует/снимает Re2DSprite roots; add повторно того же узла не дублирует его |
| `world.sprite(target, opts)` | регистрирует обычный узел как flat directional atlas sprite; см. раздел ниже |
| `world.hit(target, opts)` / `world.hitRemove(target)` | регистрирует/снимает actor hit proxy для trace (P0-B) |
| `world.hit(target, {zones})` | multi-zone boss hit proxy: head/body bands и damage multiplier |
| `world.impactInfo(opts)` / `ricochet(dir,normal)` | material/terrain tag и отражение для damage-response |
| compiler `cells[].polygon` | rectilinear polygon → runtime XY tiles (P1 authoring) |
| `span.audioZone(name)` / `audioZoneAt` | reverb preset зоны, наследуется source-каналами |
| `world.audio.budget(n)` | voice virtualization: реальные/virtual голоса по приоритету |
| `world.trace(opts)` / `world.traceAll(opts)` | ближайшее попадание / все попадания мира и actor-прокси |
| `world.findCell/findWall/findSpan/findPortal(name)` | authored semantic ID → runtime handle (или null) |
| `world.portalOpen(index, fraction)` / `portalFraction(index)` | плавное состояние портала 0..1 |
| `world.navBuild/navNearest/navPath` | 2D span/portal nav graph и детерминированный A* |
| `world.navPath(...,{blockedSpans,blockedPortals})` | dynamic nav без rebuild: маски закрытых span/portal |
| `world.polywall({walls,pivot,angle,speed})` | вращение authored wall в рантайме (trace/render видят) |
| `world.automapLines(states?)` / `automapProject(view,x,y)` | 2D automap-линии и view-трансформ |
| `world.metadata()` / `spawns()` / `spawn(id)` | authored map metadata и типизированные spawn points |
| `world.saveState()` / `loadState(save)` / `saveMapHash()` | versioned native snapshot + map identity guard |
| `world.secret(opts)` / `secretsTick(dt,at)` / `onSecret(fn)` | secret volumes + события `secret.found` |
| `world.breakable(opts)` / `onBreakable(fn)` | authored breakables + событие `breakable.broken` |
| `surface.terrain(name)` / `conveyor(opts)`, `world.terrainAt/conveyorAt` | terrain/liquid metadata и 2D conveyors |
| `world.groundAt(x,y,{h})` / `world.surfaceTagsAt(x,y,{h})` | точный пол/поверхность под точкой + user tags; `h` обязателен при нескольких spans на одних XY |
| `surface(i).tags()/hasTag(name)/tag(name,on)` | произвольные пользовательские теги поверхности; runtime-мутация не меняет геометрию |
| `world.conveyorMotion(surface,v,dt)` | conveyor gameplay tick (velocity к скорости конвейера) |
| `world.mist({x,y,rate,width,depth})` | P5 атмосферная дымка на particle pool |
| `world.materialAnim(name,opts)` / `materialIndex(name)` | flipbook/scroll/emissive анимация материала |
| `world.volume(node,opts)` | constrained box/cross/slice-stack из нескольких billboard-частей (не mesh) |
| `$.capabilities.re2d` | честная матрица возможностей сборки/рантайма |
| `world.post` | финальный 2D postprocess stack поверх `$.gfx.post` |
| `world.skyAnim` / `fogZone` / `fogAt` | анимация панорамы и semantic fog zones |
| `world.portalSky(index,on)` | проём портала как окно в панорамное небо (P2 sky portal) |
| `world.portalMirror(index,on)` | scissored reflected-world pass в проёме (P2 mirror portal) |
| `world.debug.overlay(view,opts)` | screen-space данные automap/trigger/secret для debug-оверлея |
| `world.debug.draw(view,opts)` | рисует overlay через `$.gfx.draw` (линии/точки/hit-zones) |
| `world.particles.burst/continuous/info/clear` | нативный fixed-pool частиц |
| `world.fxDefine(name,bundle)` / `fxSpawn(name,at)` | asset-driven VFX bundle (particles/light/decal/sound/shake) |
| `world.findSurface(name)` | имя стены/span → handle поверхности |
| `world.controller(opts)` | нативный helper движения (sweep/slide/step/slope/jump) |
| `world.mover(opts)` | нативный fixed-tick timeline двери/лифта/крашера/платформы |
| `world.trigger(opts)` + `world.triggerTick/Use/Shoot` | семантические триггеры; события идут в `$.on/$.emit` |
| `.camera(view={})` | заменяет конфигурацию камеры; пропущенные поля получают defaults; `mode:'perspective'` (default) или `mode:'topdown'` |
| `.render(view=null,width=320,height=180)` | синтезирует и рисует обычный sprite на всё окно; возвращает sprite ID |
| `.renderToSprite(view=null,width=320,height=180)` | синтезирует без fullscreen draw; возвращает sprite ID для previews |
| `.backend('cpu'\|'gpu')` | выбор native reference или SDL_GPU; wrapper default CPU |
| `.quality({poseBudget,poseStep})` | меняет только политику поз; defaults 1 pose/frame, 3°; 0 budget = unlimited; **визуальный tier не трогает** |
| `.renderQuality('low'\|'medium'\|'high'\|'ultra')` | явно выбирает визуальный tier (preset рендер-фич); без аргумента возвращает текущий (`'low'`…) |
| `.atmosphere({...})` | атмосфера поверх tier: меняет только переданные поля, возвращает применённые значения; без аргумента — текущие |
| `.profile({gpuWait:false})` | completion wait для измерения; true включает ожидание fence |
| `.info()` | native snapshot counts/timings; точные поля в [runtime](../re2d/RE2D_WORLD_RUNTIME.md) |
| `.dispose()` | освобождает мир/его registry/frame/GPU resources; повторный вызов безопасен; не удаляет игровые узлы |

Frame dimensions — целые 1..1024. View: x/y=0, h=48 (eye — alias), yaw/pitch=0, fov=70°, near=4; projection perspective. Для orthographic: `projection:'orthographic',orthoHeight:400`. `render(null)` использует сохранённую camera. Здесь второй аргумент render — width, **не массив спрайтов**.

Top-down (GTA2-стиль): `world.camera({mode:'topdown', x, y, h, yaw, orthoHeight})`.
Режим сам выставляет `projection:'orthographic'`, `pitch:-89.99°`, `near:1`
(любое поле можно переопределить, а `pitch`/`projection` — вернуть к
perspective/наклону). Потолки из этого ракурса рисуются как крыши; если нужны
улицы, пометьте потолки открытых span'ов sky-поверхностями
(`world.surface(i).sky(true)`) — они перестанут закрывать вид. Для обзора сверху
обычно отключают атмосферу: `world.atmosphere({heightDensity:0,hazeStrength:0})`.
Спрайты остаются камера-ориентированными billboard'ами: top-down арт персонажей —
сторона игры, движок не подменяет их проекцию. Отвесный взгляд (±90°) clamp'ится
в ±89.99°, чтобы математика оставалась невырожденной.

## Игровые запросы

| Вызов | Результат |
| --- | --- |
| `.cellAt(x,y)` | cell index или null |
| `.spanAt(x,y,h)` | global span index или null |
| `.support(x,y,feet,bodyHeight,step=0)` | `{span,height,ceiling}` или null; reachable floor с headroom |
| `.blocked(x,y,radius,bottom,top)` | boolean; статический circle XY × height против стен/portal closure |
| `.ray(from,to)` | точки `{x,y,height}`; `{fraction,x,y,height,wall,span,ceiling}` или null |
| `.lightAt(x,y,h)` | `{r,g,b,level}` или null; native gameplay approximation, без чтения pixels |
| `.surface(index)` | `{kind,primitive,cell,span,material(name),sky(enabled=true),tags(),fade(value)}`, `.hasTag(name)`, `.tag(name,on)` или null; `fade()` читает per-surface alpha |
| `.groundAt(x,y,{h})` | `{cell,span,surface,height,tags:[...]}` или null; при нескольких spans на XY без `h` — `RangeError` |
| `.surfaceTagsAt(x,y,{h})` | tags пола под точкой или null (тонкая обёртка над `groundAt`) |

XY — half-open. Свободный span включает пол и исключает потолок. `surface.kind`: 0 wall, 1 floor, 2 ceiling; наклон — коэффициенты соответствующей plane, не четвёртый mesh type. Не выводите surface ID из wall index попадания вслепую после перекомпиляции: IDs принадлежат текущему canonical domain.

`groundAt` — единственный точечный запрос «что за поверхность/пол здесь». `h` выбирает самый высокий floor не выше переданной высоты (мост над дорогой на тех же XY различается по `h`). Без `h` и при одном span на XY берётся он; при нескольких spans это `RangeError` с числом вариантов — молчаливого выбора этажа нет. Вне cells/ниже всех floors — `null`. Теги — authored-данные поверхности; неизвестные/пустые безопасны.

```js
const ground = world.groundAt(player.x, player.y, { h: player.feet });
if (ground?.tags.includes('road')) grip = 1.0;
if (ground?.tags.includes('no_spawn')) skipSpawn = true;
world.surfaceTagsAt(x, y, { h: 0 });   // null | ['sidewalk', 'no_ped']
```

### Surface tags (P0.1)

Span authoring несёт `tags` для пола и опциональные `ceilingTags` для потолка: `"tags":["road","sidewalk","no_spawn"]`. Это произвольные пользовательские строки, не enum движка: значения ограничены только форматом (≤32 тегов на поверхность, 1..32 печатных байта после trim, дубликаты игнорируются, регистр значим). Теги проходят `.re2dmap` → native author JSON → baked `.re2dworld`; runtime API не меняет geometry/topology revision, но и не сохраняется в bake — после reload теги снова берутся из authored data. Поиск тегов — `world.surface(surfaceIndex)` из `groundAt`/`trace`/`findSurface`.

```js
const s = world.groundAt(x, y, { h: 0 }).surface;
world.surface(s).tags();          // ['road', 'no_spawn']
world.surface(s).hasTag('road');  // true (регистр важен)
world.surface(s).tag('no_spawn', true);
world.surface(s).tag('no_spawn', false);
```

Формат и SDK-правила — [RE2D world format](../re2d/RE2D_WORLD_FORMAT.md#surface-tags-p01).

## Flat directional atlas sprites

Отдельный нативный режим для плоского атласа кадров (enemy sheet 5/8/16
направлений). Это не mesh и не entity: `world.sprite` привязывает политику
отрисовки к существующему узлу `$`. Доступный путь для Re2DSprite-персонажей
остаётся `world.add`; атлас не требует rig/character JSON.

```js
const enemy = $('<sprite>', { id: 'imp' })
  .at(800, 900).depth(0).size(150, 150).angle(0).hide()
  .appendTo($.world);
enemy.get(0).sprite_row = 0;          // строка анимации (0..rows-1)
enemy.get(0).sprite_col = 2;          // явная колонка направления (0..columns-1)

world.sprite(enemy, {
  atlas: 'enemies/imp_sheet.png',     // PNG, ≤4096×4096
  columns: 5, rows: 8,                // сетка листа
  directions: 5, mirror: true,        // 5 колонок = 180°, вторая половина зеркалится
  cell: { w: 198, h: 198 },
  pivot: 'feet',                      // center | feet | bottom-center | custom
  width: 150, height: 150,             // мировой размер КЛЕТКИ
  blend: 'masked',                    // masked | opaque | translucent | additive
});
```

Что делает C, а не игра каждый кадр:

* читает `x/y/depth/w/h/angle`, `sprite_row` и (опционально) `sprite_col` узла;
* выбирает колонку направления из `angle` (facing, радианы, 0 = +X) и позиции
  камеры; `mirror: true` рисует вторую половину отражённой. Если на узле задан
  **`sprite_col`**, C использует его вместо angle-выбора: колонка зажимается
  в `0..columns-1`, зеркалирование и LOD-прореживание направлений к ней не
  применяются. `sprite_col` и `sprite_row` независимы; оба читаются каждый
  кадр, перерегистрация не нужна;
* ставит нормированную точку `pivot` в `depth` узла: `feet` — точка опоры, а не
  центр кадра; `center` держит в `depth` середину; `custom` берёт `pivotX`,
  `pivotY`;
* тестирует глубину, свет и туман тем же нативным композитором, что и
  поверхности мира, поэтому стена перекрывает спрайт попиксельно;
* обрезает нужную клетку в квадратный буфер один раз на смену
  колонки/строки/зеркала и переиспользует его в CPU и SDL_GPU путях.

`directions`: 1, 4, 5+mirror, 8, 16 (1..16). `columns`/`rows` — до 64.

### Atlas set (tiled sheet >4096)

Один PNG ограничен 4096×4096. Лист большего размера задаётся набором тайлов
(row-major); строка `atlas: '<path>'` остаётся неизменной, а объектная форма
включает tiled-режим:

```js
world.sprite(node, {
  atlas: {
    files: ['city_0.png', 'city_1.png', 'city_2.png'], // row-major, ровно columns*rows
    tile: { width: 2048, height: 2048, columns: 3, rows: 1 },
  },
  columns: 48, rows: 1, directions: 1,  // логический лист 6144×2048
  cell: { w: 128, h: 128 },             // сетка относится к ЛОГИЧЕСКОМУ листу
  pivot: 'feet', width: 112, height: 112, blend: 'masked',
});
```

* `files.length` обязан быть равен `tile.columns*tile.rows`; каждый файл —
  PNG ровно `tile.width×tile.height` (оба ≤4096). Ragged/несовпадающие размеры —
  `RangeError`, молчаливого fallback нет.
* Логический размер = `tile.columns*tile.width × tile.rows*tile.height` (до
  65536 на сторону); `columns*cell.w` / `rows*cell.h` обязаны в него влезать.
* Клетка может пересекать границу тайлов: C собирает её из нескольких тайлов
  попиксельно, flip/pivot/blend/масштаб ведут себя так же, как у одиночного
  листа. GPU получает уже готовый cropped frame — шейдер не меняется.
* Пути тайлов дедуплицируются по отдельности; `atlasPin(path)` совпадает, если
  path равен любому тайлу набора. `streamInfo().atlases[].path` для набора —
  склеенный список `'a.png+b.png+...'`, полный список — в `tiles`.

### Packed layered character (`sprite_col`)

Слои (ноги → хвост → торс → голова) можно «запечь» офлайн в один
направленный атлас и управлять им из игры одной колонкой и строкой:

```js
// atlas: 16 columns (directions) x 9 rows (idle + 8 walk), cell 192x192
const hero = $('<sprite>', { id: 'neko' }).at(x, y).depth(0).size(112, 112)
  .hide().appendTo($.world);
world.sprite(hero, {
  atlas: 'chars/neko_sheet.png',
  columns: 16, rows: 9, directions: 16, mirror: false,
  cell: { w: 192, h: 192 }, pivot: 'feet', width: 112, height: 112,
});
const node = hero.get(0);
// каждый кадр, без re-registration и без пересборки атласа:
node.sprite_col = dir;    // 0..15, от мыши/геймпада
node.sprite_row = frame;  // 0 = idle, 1..8 = walk
```

* `sprite_col` приоритетнее `angle`: deterministic-колонка не зависит от
  ракурса камеры и от вырожденного случая «камера ровно над спрайтом» (в
  angle-режиме относительный yaw там равен 0, поэтому 0 и π дают одинаковый
  кадр — это ограничение angle-выбора, не `sprite_col`).
* Смена колонки/строки пересобирает только одну клетку в crop-буфере; полной
  перезагрузки атласа нет, flicker нет.
* Глубина/окклюзия, свет, туман и выбор `blend` — те же, что у обычного
  атласного спрайта.
* `sprite_col` можно не задавать — тогда работает прежний angle-режим
  (`delete node.sprite_col` возвращает его на лету).
`mirror` включается только при `directions > 1`; при `directions: 1` колонка
всегда 0. Ошибки конфигурации — исключения (`TypeError`/`RangeError`): нет
пути, клетка вне листа, `width/height ≤ 0`, неизвестный `pivot`/`blend`.
Повторная регистрация того же узла — ошибка; используйте `world.remove(node)`
перед повторным `world.sprite`. `world.remove` снимает и атлас, и Re2DSprite
регистрацию.

Ограничения P0-A: направление и кадр задаёт атлас, отдельной tint/animation
policy у этого режима нет — строку анимации ставит игра через `sprite_row`;
сортировка прозрачных атласных спрайтов идёт общим путём. Профилирование:
`info().atlasSprites` (зарегистрировано) и `info().visibleAtlasSprites`
(видимых в последнем кадре), `actorMs`.

Проверки: `tests/re2d/atlas_test.c` (Unity: направление, явная колонка, pivot,
клетка, кроп), `tests/agent/re2d_boomer_lab_test.py` (кадр, смена направления,
попиксельная окклюзия стеной), `tests/agent/re2d_sprite_col_test.py` (упакованный
слоистый персонаж: col 0≠2, row 0≠1, live-смена 10 кадров без re-registration,
клэмп колонки), `demos/re2d_boomer_lab`.

## Atlas residency, бюджеты и диагностика (1.2.12)

Плоские атласные спрайты живут в том же budgeted residency cache, что и
регионы/материалы (`src/re2d_world_stream.c`). Видимый атлас не должен
исчезать молча: у каждого зарегистрированного `world.sprite` стабильный
stream id, предыдущий кадр сообщает, какие атласы видимы, и они
**demand-pin**'ятся — продвигаются в RESIDENT вне обычного promote-бюджета и
никогда не вытесняются LRU, даже если суммарный размер видимых атласов больше
budget (soft cap, over-budget виден в диагностике).

```js
world.streamConfig({ residentBytes: 6 * 1024 * 1024, residentItems: 4,
                     uploadBytes: 0, uploadItems: 0, promoteItems: 4 });
world.atlasPin('assets/peds/ped_0.png', true);   // явный pin по пути (или по id)
world.atlasPin(0, false);

const s = world.streamInfo();
// {residentBytes, residentItems, budgetBytes, budgetItems, uploadBudgetBytes,
//  uploadBudgetItems, promoteItems, pending, evictedThisFrame,
//  promotedThisFrame, promoteDeferred, pinnedBytes, pinnedItems,
//  overBudget, overBudgetBytes, overBudgetItems, atlasesPinned, atlasesDemand,
//  pinsPending, pinLimit, pinPaths, decodedUniqueBytes, decodedSavedBytes,
//  dedupHits, warnings,
//  atlases: [{id, streamId, path, nodeId, bytes, streamBytes, state, stateName,
//  pinned, demandPinned, refs, visibleRefs, sharedRefs, lastEvictFrame, reason,
//  lastEvictReason, cellW, cellH, columns, rows, imageW, imageH, tileCount,
//  tileColumns, tileRows, tileWidth, tileHeight, tiles, visible, blocked, warned}]}
world.streamWarnings();       // peek bounded ring (oldest first)
world.takeStreamWarnings();   // copy and clear the ring
```

* `streamConfig`: `0` = unlimited/no cap для всех полей. Это контракт именно
  этого метода; legacy `regionConfig(size, activeRing, preloadRing,
  uploadBytes, uploadItems)` сохраняет старую семантику `0 uploads = no uploads
  this frame`, а `regionBudget(bytes, items)` — прежний сеттер residency.
  Опущенные поля не меняются. `pinLimit` задаёт лимит sticky path-пинов
  (по умолчанию 64, `0` = без лимита до 4096); понижение ниже текущего
  `pinsPending` отклоняется (`RangeError`), а не сбрасывает пины.
* `streamConfig.promoteItems` ограничивает только обычные (невидимые) preload
  продвижения; видимые demand-атласы продвигаются всегда.
* `atlasPin(pathOrId, on)`: путь сравнивается с authored PNG path (для tiled-
  набора — с любым путём тайла); целое число — `id` из
  `streamInfo().atlases` (индекс регистрации). Возвращает число затронутых
  атласов (0 — не найдено). Pin защищает от LRU, но байты продолжают
  учитываться в `pinnedBytes/residentBytes`.
  **Path-pin «липкий»**: его можно вызвать до регистрации атласа (стриминговая
  популяция); путь хранится в bounded pending-наборе (64 пути), и registration
  применяет его сразу, поэтому первый видимый кадр уже resident и не пишет
  `R2D_ATLAS_NOT_RESIDENT`. `on=false` удаляет pending-путь и снимает pin с
  совпавших атласов; ошибка — только переполнение лимита (>64) или path
  длиннее 511 символов (`RangeError`). Numeric-id pin — только немедленный, не
  запоминается. `streamInfo().pinsPending` / `pinPaths` показывают pending-набор.
* `streamWarnings()`/`takeStreamWarnings()`: bounded ring (64) записей о
  видимом, но не резидентном атласе. `world.render`/`renderToSprite`
  автоматически пересылает новую запись в
  `$.debug.reportError('re2d.stream', …, {code:'R2D_ATLAS_NOT_RESIDENT'})`, один
  раз на атлас до восстановления residency. Сообщение содержит path, bytes,
  cell/grid, node id, state и reason; `$.debug.errors()` поэтому называет
  конкретный атлас и узел.
* Пока атлас не резидентен, его изображение не рисуется (GPU residency gate),
  и его contact/ground shadow тоже подавляется — тени без спрайта нет.
  Счётчики: `visibleAtlasBlocked`, `groundShadowsSuppressed`, а также
  `streamPinnedBytes/Items`, `streamOverBudget*`, `streamWarnings` в
  `world.info()`.
* Стабильные stream id означают, что `world.remove(node)`/повторная регистрация
  не оставляют stale residency state, который блокировал бы другой атлас.
* **Decoded-pixel dedup**: RGBA-буфер декодированного PNG один на уникальный
  canonical path (app/VFS-resolved) и на generation кэша; регистрации одного
  файла делят его (`streamInfo().atlases[].sharedRefs`), разные grid/cell
  остаются у каждой регистрации. Память освобождается, когда уходит последняя
  ссылка (`world.remove`, dispose, scene reload); hot reload/reloadJSON
  увеличивает generation, новые регистрации перечитывают файл. Счётчики:
  `streamInfo().decodedUniqueBytes` (живые RGBA-байты), `decodedSavedBytes`
  (сэкономлено шарингом), `dedupHits`; `residentBytes` не считает общие пиксели
  дважды (`streamBytes` регистрации = 0 у алиасов).

Ограничения: residency — детерминированный incremental, не async disk I/O;
декодированные пиксели каждого `world.sprite` хранятся на регистрацию (дедуп
по одному PNG между узлами пока не сделан); бюджет `residentBytes` по умолчанию
8 MiB, поэтому сцена с большими атласами намеренно живёт на soft cap —
смотрите `streamInfo().overBudget`; одиночный PNG ≤4096×4096, больший
логический лист задаётся atlas-set формой выше (до 65536 на сторону).

Проверки: `tests/re2d/stream_residency_test.c` (pin/LRU, soft cap, reasons,
budget 0, deterministic promotion), `tests/agent/re2d_atlas_residency_test.py`
(50 сгенерированных атласов 1024², малые бюджеты, диагностика, pin, 300
кадров движения: ни один видимый спрайт не теряется без предупреждения).

## Async PNG prefetch для атласов (детерминированный контракт, 1.2.13)

Регистрация атласов читает PNG синхронно. Необязательный prefetch читает **байты
файла** заранее в одном рабочем потоке, чтобы регистрация могла пропустить
синхронное чтение, если байты уже готовы. По умолчанию **выключен** — поведение и
кадры по умолчанию не меняются.

```js
world.atlasAsync(true);                       // включить (getter без аргумента)
world.atlasPrefetch('chars/neko_sheet.png');  // token > 0; 0 = уже есть/лимит
world.atlasPrefetch('chars/imp.png');

const info = world.atlasPrefetchInfo();
// { enabled, workers, pending, ready, consumed, failed, entries,
//   bytesPending, bytesReady, limitBytes, requested, consumedTotal,
//   failedTotal, bytesRead, readMs, error,
//   paths: [{ path, token, state: 'pending'|'ready'|'failed'|'consumed',
//             bytes, error }] }

world.atlasPrefetchClear();                   // отменить pending, сбросить ready
world.atlasAsync(false);                      // выключить, остановить поток
```

**Детерминированный контракт.** Prefetch никогда не меняет пиксели кадра,
содержимое кадра, порядок или предупреждения:

* async-часть — только файловый ввод-вывод (stdio) в рабочем потоке. Декодирование
  PNG остаётся на главном потоке через SDL_image; из рабочего потока не делается
  ни одного вызова SDL/QuickJS/GPU (это тот же класс, что падение GPU-профайлера).
* `world.sprite`/`atlas-set` проверяют кэш по точному canonical пути перед
  синхронным чтением: `ready` → декодируются те же байты и запись помечается
  `consumed`; `pending`/`failed`/нет записи → обычное синхронное чтение
  (идентичные байты и результат); затем работает существующий dedup.
* если файл изменился после prefetch (size/mtime), запись отвергается и
  используется синхронное чтение — старые байты никогда не подменяют кадр;
* отсутствующий/битый файл: prefetch-запись получает `state:'failed'` с текстом
  ошибки, регистрация падает/ругается ровно как без prefetch (никаких новых
  предупреждений и никакой «тихой» подмены картинки);
* момент завершения async-чтения не может повлиять на кадр: непрочитанное
  просто означает синхронный путь.

**Границы.** До 64 записей, до 256 MiB суммарно pending+ready, до 64 MiB на
файл. `atlasPrefetch` возвращает
`0`, если prefetch выключен, путь уже pending/ready, или исчерпан бюджет
записей/байт; о лимите сообщает `info.error`. `atlasPrefetch` для не-строки или
пустого пути — `TypeError`. Пакованный груз (VFS) уже в памяти: prefetch копирует
его байты сразу (`ready`) без потока.

**Жизненный цикл.** Рабочий поток создаётся лениво на первом `atlasPrefetch`,
останавливается `atlasAsync(false)`/`atlasPrefetchClear`-совместимо и
джойнится в `world.dispose`/`re2d` shutdown. `atlasPrefetchInfo()` работает после
clear/disable и после dispose мира в пределах живого handle (все записи пусты).
Hot reload/scene reload безопасны: prefetch не владеет узлами, а stale байты
отсекаются проверкой size/mtime. `world.streamInfo()`/dedup/кеш поколений не
меняются.

Тесты: `tests/re2d/atlas_prefetch_test.c` (очередь, границы, dedup, ready/take/
consumed, missing/stale, cancel, disable/shutdown, payload-байты) и
`tests/agent/re2d_atlas_prefetch_test.py` (сгенерированная игра: prefetch off vs
on+wait — байт-идентичные скриншоты, fallback без готовности, 120 кадров
движения, диагностика missing/corrupt).

## Trace: мир + actor-прокси

`world.trace` — единый луч по статическому миру и зарегистрированным
actor-прокси. Это не физика и не 3D-запрос: world-геометрия идёт через
существующий `r2d_world_ray`, актёр — вертикальный цилиндр (XY-круг + интервал
высот). Регистрация следует жизненному циклу узла: registry хранит ссылку, не
владеет узлом.

```js
const enemy = $('<sprite>', { id: 'imp' }).at(800, 900).depth(0).size(48, 150);
world.hit(enemy, { radius: 24, height: 150, category: 'enemy' });

const hit = world.trace({
  from: { x: camera.x, y: camera.y, h: camera.h },
  to:   { x: 800, y: 900, h: 75 },
  mask: ['world', 'enemy'],       // или целые биты: 1|2|4
  ignore: null,                   // узел, чьи прокси игнорировать
});
// hit: {type, fraction, x, y, h, surface, span, node, proxy, normalX, normalY}
// type: 1 = surface мира, 2 = actor proxy; у sprite node — сам узел `$`
```

`world.traceAll(options)` возвращает все попадания от ближнего к дальнему
(стабильный порядок, при равной доле мир идёт раньше спрайта). Маски: `world`
(1), `enemy` (2), `breakable` (4); массив имён либо уже собранные биты. Отсутствие
попадания — `null` (у `traceAll` пустой массив), а не исключение.

`world.hit` параметры: `radius` (по умолчанию 24), `height` (по умолчанию высота
узла), `bottom` (по умолчанию 0), `top` (по умолчанию `bottom+height`),
`category` — `enemy` или `breakable`. `bottom/top` — смещения от `depth` узла,
поэтому движение актёра не требует per-frame обновления registry: координаты
читаются в момент запроса. Предел — 2048 прокси; повторная регистрация того же
узла, нечисловые размеры, `top <= bottom` и неизвестная категория отклоняются
исключениями. `world.remove(node)` снимает и hit proxy, и атласный спрайт, и
Re2DSprite-регистрацию.

Проверки: `tests/re2d/trace_test.c` (Unity: nearest, masks, ignore, multi-hit,
determinism), `tests/agent/re2d_boomer_lab_test.py` (high-level API в живом
кадре: маски, сортировка, стена перед дальним прокси), JS-контракт —
`tests/js/re2d_world_api_test.mjs`.

## Portals 2.0: smooth open fraction

```js
world.portalOpen(0, 0.4);        // 0 = закрыт, 1 = открыт
world.portalFraction(0);         // 0.4
world.portalClosed(0, true);     // бинарный вид, синхронно ставит fraction=0
```

Дробь режет авторский opening сверху: эффективный интервал
`bottom + fraction*(top-bottom)` используется **одним кодом** для прохода
контроллера/коллизии (`r2d_world_portal_passes`), окон видимости
(`r2d_world_opening_between`/`portal_window`) и света. Поэтому дверь на
промежуточной дроби реально перекрывает проход и видимость, а не только
рисуется. `closed` остаётся бинарным представлением (`fraction <= 0`);
`geometry_revision` растёт только при изменении значения. Двери/moverы
с `portal`-целью теперь гоняют дробь плавно каждый fixed tick.

Ограничения: дробь режет opening сверху (вертикальная дверь); вращающиеся/
polyobject-двери — P1/P3; ответвления порталов и рекурсия не меняются.

## Player controller (P0-C)

```js
const ctrl = world.controller({ radius: 14, height: 56, eye: 48, step: 9, slopeLimit: 50 });
ctrl.place(800, 1080, 0);                       // x, y, feet
const st = ctrl.move({ dx: 0, dy: -1, dt: 1 / 60, jump: false });
// st: {x,y,feet,vx,vy,vz,span,ceiling,grounded}
```

Нативный C решает движение: accel/friction на земле, air control в воздухе,
gravity, jump только с земли, потолок, step-up/down, ходьба по склону
(`slopeLimit`), wall slide (полный шаг → X → Y), substeps не больше
`radius*0.5` (до 64). Портал/мульти-span переразрешается через
`r2d_world_support` в новой XY. Это helper, а не entity: состояние игрока
принадлежит игре, controller владеет только математикой. `dt` вне `(0,0.5]`
оставляет состояние без изменений. Стоящий на движущемся span body едет вместе
с полом через `support` (passenger carry ≤ `step` за тик); опускающийся
потолок не оставляет тело внутри ceiling (defensive clamp). Нет mover carry/crush и нет sweep-запроса
по произвольному радиусу (только собственный radius) — ограничения честные.

`ctrl.shape()` возвращает авторскую форму без состояния тика:
`{radius,height,eye,step,slopeLimit}`. Она нужна диагностике — F6-маркер,
нарисованный приблизительным спрайтом, не является коллайдером.

**Контракт визуализации.** Flat-atlas billboard рисуется screen-bottom-anchored:
C проецирует точку `(x,y,bottom)` и блитит `top = p[1] - sh`, `left = p[0] - sw/2`
(`src/re2d_world.c`, `stamp_targets_impl`). Поэтому pivot-centre спрайт размера
`W` визуально центрируется в `node.x + W/2`. Чтобы тело стояло на контроллере,
игра ставит `node.at(ctrl.x - W/2, ctrl.y).depth(ctrl.feet + W/2 + 3)`; это не
«устаревший сдвиг», а компенсация нижней привязки билборда. Точный коллайдер
рисует `world.debug.draw(view, {controllers:[ctrl]})` (см. Debug overlay).

## Movers (P0-E)

```js
const lift = world.mover({ type: 'lift', span: 0, from: 0, to: 96,
                           speed: 240, wait: 0.5, autoReturn: true });
lift.open();
lift.info();     // {position,fraction,phase,direction,timer,events}
```

`span` или `portal` (ровно один). Timeline детерминирован и шагается вместе с
`engine.re2d.worldStep`; `span` mover пишет `bottom=position`, сохраняя
авторский `top`; `portal` mover плавно гоняет `open_fraction` (Portal 2.0),
поэтому промежуточные состояния реально перекрывают проход/видимость.
`.blocking(true)` ставит флаг контакта пассажира: движение замирает, crusher
реверсит и отдаёт событие BLOCKED; снятие флага продолжает ход. Типы: `door` (toggle), `lift`/`platform` (auto-return после wait),
`crusher` (реверс на концах). Бюджет 128 mover'ов. Ограничение: portal
сейчас бинарный (без smooth open fraction) и нет passenger carry — это
следующий шаг P0-E/P1.

## Triggers (P0-F)

```js
world.onTrigger('gate.open', ev => door.open());
world.trigger({ type: 'use', id: 'gate.open', target: 'gate.main',
                x: 800, y: 600, radius: 64, bottom: 0, top: 96, once: true });
world.triggerTick(1 / 60, { x: player.x, y: player.y, feet: player.feet });
world.triggerUse({ x: player.x, y: player.y, h: player.h });
```

Enter — edge-triggered (outside→inside, без повтора внутри объёма), use/shoot —
proximity-запросы. `once`/`cooldown`/`enabled` живут в C; fired-события
возвращаются списком semantic id и реэмитятся в существующий `$.on/$.emit`
(`world.onTrigger` отдаёт `{id,target}`, вторым аргументом — событие `$`).
Бюджет 256 триггеров. Engine не исполняет gameplay: обработчик — игра.

## Semantic IDs (P0-D)

```js
const wall = world.findWall('gate.left');       // индекс стены или null
const floor = world.findSurface('hall.lower');  // handle поверхности
world.findSpan('hall.upper'); world.findPortal('door.exit'); world.findCell('room');
```

`id` берётся из `.re2dmap` (стены, cells/spans, portals) и пишется в
`.re2dworld`; загрузчик валидирует дубликаты/длину транзакционно, старые карты
без таблицы грузятся с пустыми ID. Числовые индексы после reload не
семантика — переразрешайте их через `find_*`. Компилятор:
`build/r2d-sdk world-compile ... --renderer`.

## Map metadata и spawn points (P1)

```js
const meta = world.metadata();       // {id,title,author,version,music,sky,nextMap,
                                     //  secretExit,environment,defaultFog,spawnCount}
const spawns = world.spawns();       // [{id,type,typeName,tag,x,y,h,facing}]
const start = world.spawn('player.start');
```

Авторские `meta`/`metadata` и `spawns` из `.re2dmap` переживают
`world-compile --renderer` (SDK копирует их как данные, не как схему) и
загружаются нативным парсером (`src/re2d_world_metadata.c`): bounded-строки
≤127, дубликаты id и NaN отклоняются, отсутствующие поля — значения по
умолчанию. Типы: player/enemy/item/boss/effect/camera (+cutscene→camera).
Ограничения: metadata не сериализуется в `baked`-payload и не участвует в
save/load этого прохода; spans/openings пока без authored id (см. P0-D).

## Nav graph (P1)

```js
const build = world.navBuild({ radius: 14, height: 56, step: 18 }); // {nodes,edges}
const node = world.navNearest(800, 1080);
const path = world.navPath(node, node);  // массив span-индексов или null
```

Один узел на span, ребро — проходимый portal (open fraction > 0, headroom ≥
height, перепад ≤ step, ширина ≥ 2*radius). A* детерминирован (tie-break по
индексу); scratch и CSR-массивы нативные, без аллокаций на запрос. Граф
перестраивается после topology/height изменений; `navPath` возвращает `null`
для недостижимой цели. Нет 3D-navmesh/сглаживания waypoints.

## Automap (P1)

```js
const lines = world.automapLines(states);   // [{x1,y1,x2,y2,state,kind,index}]
world.automapProject({cx,cy,scale,rotation}, x, y);  // {x,y}
```

Линии стен и порталов в детерминированном порядке; сгенерированные portal closure
walls (opening closures и solid-band closures) не дублируются (грань портала —
одна PORTAL-линия). `states` — плоская таблица по
primitive (стены, затем порталы); отрисовка остаётся за игрой. Только XY,
никакого 3D-minimap.

## Particles (P1)

```js
world.particles.burst({ x: 800, y: 900, h: 80, count: 80, life: 3, size: 50,
  color: '#ff2040', alpha: .8, blend: 'translucent', mode: 'billboard', seed: 7 });
world.particles.continuous({ x: 800, y: 900, h: 40, rate: 40, life: 1, size: 6 }, 1/60);
world.particles.info();   // {alive,capacity,overflow,drawn}
world.particles.clear();
```

Фиксированный пул 2048 на world, детерминированный LCG (`seed`), шаг в
`engine.re2d.worldStep`, curves size/alpha, gravity только по высоте, drag.
Режимы screen/billboard/axis/floor, blends masked/translucent/additive.
Рисование: CPU reference — quads с world depth/light/fog; SDL_GPU — тот же
actor-billboard pipeline с 1×1 white texture и tint'ом (бюджет 512 частиц на
GPU). Нет коллизий, trails и VFX bundles в этом проходе.

## Renderer visual features (R-01/R-02)

```js
world.renderQuality('high'); // visual tier: low | medium | high | ultra
// low = legacy + P0 contact grounding; medium = grounding + variation,
//       height fog/haze, sky layers, liquid; high = + edge/bevel/corner AO.

// Pose policy is independent from the visual tier (BASHNYA 1.2.6): a bigger
// pose budget used to force HIGH and change the whole frame.
world.quality({ poseBudget: 4, poseStep: 3 }); // pose only, tier stays as-is

// Atmosphere is additive: only the provided fields change, applied values are
// returned. hazeColor:null restores the automatic tint from the authored sky.
world.atmosphere({ heightDensity: 0.02, baseHeight: 100, falloff: 2,
                   hazeStrength: 0.12, hazeColor: '#102030',
                   skyLayers: false, sunDisc: false });

// qualityPreset stays the full preset path: pose budget + visual tier + particles.
world.qualityPreset('high');

const v = world.info().visual;
// {quality, contactShadows, footAo, floorTint, edgeActors,
//  variedSurfaces, bevelSurfaces, cornerAoSurfaces, fogSurfaces,
//  hazeSurfaces, liquidSurfaces, skyLayers, celestialDiscs, ...}
```

`world.renderQuality` runs `r2d_world_render_quality(world,
R2D_RENDER_QUALITY_*)`, so it is a preset: it resets atmosphere overrides to
the tier defaults — apply `world.atmosphere` after choosing a tier. Default
worlds are created with the LOW tier, so the legacy low frame is unchanged.

**Migration note (1.2.7).** `world.quality({poseBudget, poseStep})` no longer
changes the visual tier (it used to be `poseBudget>=4` → HIGH, `2..3` → MEDIUM,
otherwise LOW). Use `world.renderQuality(name)` for the tier and
`world.qualityPreset(name)` for the full preset. Defaults still create the LOW
frame. A game that used to get MEDIUM from `quality({poseBudget:2})` must now
call `renderQuality('medium')` (or `qualityPreset('medium')`), otherwise this
is a silent visual change.


`world.atmosphere` applies only the provided fields through
`r2d_world_render_set_features` and never changes the tier. Fields:
`heightDensity` 0..1, `baseHeight` -100000..100000, `falloff` 0..100,
`hazeStrength` 0..1, `hazeColor` (`'#rrggbb'` or packed RGBA number, `null` =
auto), `skyLayers`/`sunDisc` booleans. Wrong type throws `TypeError`,
out-of-range throws `RangeError`; unknown options are rejected, not ignored.

Native GPU pass: contact shadow/foot AO/local floor tint under Re2D actors,
sprite alpha feather/outline/grime, deterministic surface variation, fake bevel
and corner AO-lite, height fog + atmospheric haze, panorama + up to four
parallax sky cards + sun/moon disc, liquid floor shading. The CPU reference
draws the same contact card; the other effects are GPU-reference. See
[RE2D_RENDER_FEATURES.md](../RE2D_RENDER_FEATURES.md) for formulas, counters and
limits. Existing `gpuDrawsBase/Span/Actor/Other` stay exact; grounding adds
`gpuDrawsGround`, VFX adds `gpuDrawsVfx`.

## Surface fade (roof fade)

Any derived surface (a wall or one floor/ceiling plane) has a per-surface fade
alpha independent from its material. It is a render-pass property: it changes
only the colour alpha used by the transparent pass, never the material,
geometry, lighting, collision, navigation or topology revision.

```js
const roof = world.surface(i);   // e.g. the ceiling above the player's room
roof.sky(false);                 // only needed if the surface was a sky surface
roof.fade(0.25);                 // 0 = invisible, 1 = fully opaque (default)
roof.fade();                     // read the current value (number)
```

Typical top-down/roof-fade use case: a house roof is a ceiling surface above an
interior room. While the player is inside, the game computes that test each
frame and sets `fade` to e.g. `0.25` (or `0` to see the interior unobstructed);
outside it sets `1`. The engine only stores the alpha; the per-frame distance /
inside logic belongs to the game. `sky(false)` is only required when the
surface was authored as a sky surface (`surface.sky(true)`), because sky
surfaces bypass the regular surface draw.

Contract details:

* accepts `0..1` only: a non-number throws `TypeError`, a value outside `0..1`
  (or non-finite) throws `RangeError`;
* alpha `< 1` moves an opaque/masked surface into the transparent pass and
  transparent sorting; an additive material stays additive and scales its
  contribution by the alpha;
* alpha `1` is the default and byte-identical to a world that never called
  `fade`; alpha `0` draws nothing;
* the value is runtime state (like user tags): it is not authored into
  `.re2dmap`/`.re2dworld` and is lost after reload/rebuild;
* native API: `r2d_world_surface_fade_set(world, surface, alpha)` and
  `r2d_world_surface_alpha(world, surface)`; the JS bridge is
  `surfaceFade(index[, value])`.

## VFX bundles (P1)

```js
world.fxDefine('ks23.fire', {
  particles: [{ count: 60, life: .4, size: 18, color: '#ffd080',
                blend: 'additive', speed: 220, spread: 90, dirH: .2 }],
  light: { radius: 240, intensity: 3, color: '#ffb060', life: .08, shadow: false },
  decal: { material: 0, width: 10, height: 10, life: 12 },
  sound: 'sfx/ks23_fire.ogg', shake: .35, flash: { color: '#ffd0a0', ms: 60 },
});
world.fxSpawn('ks23.fire', { x, y, h, dx, dy, dz });
// → {particles, light, decal, sound, shake}
```

Bundle — данные, а не gameplay: частицы идут в нативный пул, свет — в
`world.light` с `life`, decal ставится по первому world-попаданию луча из
точки удара, звук — опционально через `$.sound`, shake/flash — через `$.vfx`
(если подсистема установлена; значения возвращаются в результате в любом
случае). Неизвестный bundle — `RangeError`. Никакой JS-покадровой работы:
bundle исполняется один раз в момент спавна.

## Native VFX library (R-03)

```js
const text = $.fs.readText('assets/vfx/combat/muzzle_flash.json');
world.vfx.define('muzzle_flash', text);
world.vfx.spawn('muzzle_flash', { x, y, h, dx: 0, dy: 1, dz: -0.2, seed: 7 });
// -> {particles, cards, trails, lights, decals, distortion, shake, flashMs, flashColor, sound}
world.vfx.info();
world.vfx.debug();          // + particle budget and registered bundle names
world.vfx.lightBudget(8);   // temp-light budget 0..16
world.vfx.clear();
```

`world.vfx` is the native R-03 path: FX bundles are parsed into fixed C pools
(particles go into the existing native pool; cards/trails/lights/decals are
bounded native data), no JS node is created per spark. Same JSON shape as
`fxDefine` plus `cards`, `trail`, collision fields and distortion hints. See
[RE2D_VFX.md](../RE2D_VFX.md) for the complete bundle format, all 53 authored
pack effects in `assets/vfx/`, particle collision modes
(`none/floor/wall/bounce/despawn`) and budget counters. `world.fxDefine/fxSpawn`
stay as the older JS-defined bundle helper; use `world.vfx` for the native pack.
The native renderer now draws live cards, card trails and distortion cards in a
dedicated GPU pass (`gpuDrawsVfx`, `info.visual.vfx*`); distortion cards are
wavy world cards and screen refraction remains in `$.gfx.post`.

## Save / load state (P1)

```js
const save = world.saveState();
// {format:'re2d-world-save', version:1,
//  map:{id,version,hash}, state:{format:'re2d-save',...}}
world.loadState(save);          // true или исключение
world.saveMapHash();            // hex-строка authored identity + topology
```

Ошибка сериализации теперь структурированная: `RangeError` с фактическим
полем/лимитом (`state not serializable: save: spans[i]...`), а не общий
`state serialization failed`. Сцена, где `enter` бросил исключение, получает
`$.debug.errors()` запись `R2D_SCENE_ENTER` и `$.scene.status()` →
`{ok:false,error:{scene,operation:'enter',stage,stack}}`; агентский snapshot
содержит `scene_status`. Это позволяет отличить успешный вход от частичного.

Native snapshot (версия 1) хранит spans (`id,bottom,top`), portals
(`id,open_fraction,closed`), movers (timeline state) и triggers
(`id,type,fire_count,enabled,once,armed,timer`). `loadState` проверяет map hash
и точное число spans/portals/mover'ов/триггеров; несовпадение — `RangeError`,
состояние не меняется. Bounds: 65536 spans/portals (тот же предел, что у runtime topology), 256 movers, 512 triggers;
строки ≤63 байт; NaN/malformed отклоняются. Ограничения: movers/triggers
восстанавливаются позиционно (по id для триггеров), secrets/breakables и
частицы пока в snapshot не входят — следующий шаг.

## Secrets и breakables (P1)

```js
const secret = world.secret({ id: 'secret.tower', x, y, radius: 64, bottom: 0, top: 96, once: true });
world.onSecret(ev => hud.secretFound(ev.secret));
world.secretsTick(1 / 60, { x: player.x, y: player.y, feet: player.feet });

const crate = world.breakable({ id: 'crate.a', hp: 100, variant: 1, portal: 3, x, y, radius: 24, top: 64 });
world.onBreakable(ev => world.portalOpen(ev.portal, 1));
crate.hit(100);   // true один раз; событие breakable.broken
```

Secret — edge-triggered цилиндр (outside→inside), `once`/`found_count`;
событие `secret.found` идёт через `$.on/$.emit`. Breakable — authored hp/
variant/portal; `broken` переключается ровно один раз. Никаких entity/ECS:
события и варианты — данные игры. Лимит 256+256; pointer-based.

## Terrain, liquids и conveyors (P1)

```js
world.surface(floorSurface).terrain('water').conveyor({ vx: 40, vy: 0, accel: 600 });
world.terrainAt(x, y, h);    // {kind,name,moveScale,frictionScale,damagePerSecond}
world.conveyorAt(x, y, h);   // {vx,vy,accel,affectsProjectiles}
```

Пресеты: none/stone/metal/flesh/wood/crystal/magic/water/blood/acid/lava/mist
с move/friction/damage/splash/tint/fog/decal hints. Conveyor — authored XY
скорость поверхности, `accel` — скорость приближения к ней; игра применяет
`r2d_world_conveyor_apply` к телу (никакой fluid simulation/3D rigid body).

## Animated materials (P2)

```js
const anim = world.materialAnim('brick', { frames: 4, fps: 8, pingPong: true,
  scrollU: 0.25, scrollV: 0.1, pulseHz: 2, pulseAmount: 0.4, seed: 3 });
anim.info();    // {frame, emissive, uOffset, vOffset}
anim.remove();
world.materialIndex('brick');   // индекс материала или null
```

Таймлайн детерминирован (seed), шагается вместе с `engine.re2d.worldStep`.
Scroll U/V добавляется к UV constrained surfaces, emissive pulse множит
emissive-канал; CPU reference и SDL_GPU используют одни и те же поля материала
(`anim_u/anim_v/anim_emissive`, GPU — uniform `anim`). Ограничения: flipbook
кадр возвращается в `info()`, но выбор кадра из atlas-полосы — ответственность
материала/игры; decals не анимируются; нет shader graph.

## Volumetric sprites (P2)

```js
const crate = world.volume(node, {
  mode: 'box', width: 120, depth: 80, height: 150,
  cell: { w: 198, h: 198 }, pivot: 'feet',
  faces: { front: 'crate_f.png', back: 'crate_b.png', left: 'crate_l.png', right: 'crate_r.png' },
});
// mode:'cross' или mode:'slice-stack' (atlas + slices 1..32)
crate.parts;   // [{node,atlas,offsetX,offsetY,offsetH,width,height}]
crate.remove();
```

Объём — это несколько специализированных billboard-частей с authored
offset'ами в локальном XY/height актёра, а не mesh: `atlasAdd` принимает
`offsetX/offsetY/offsetH`, нативный композитор сам поворачивает offset по
`angle` узла и сортирует по глубине. Box = 4/6 граней, cross = две карточки,
slice-stack = N полос одного атласа. Позиции/повороты частей не выходят в
generic vertices/indices API. Ограничение: части камера-ориентированные
(billboard), поэтому box/cross — визуально ограниченный impostor, а не
настоящая геометрия; `r2d_world_volume` core (10 тестов) остаётся источником
канонической граневой логики для будущего ужесточения.

## Capabilities и profiler (P4)

```js
$.capabilities.re2d;
// {worldGpu, worldCpu, hrtf, mirrorPortal, skyPortal, volumetricSprite,
//  particles, nav, automap, saveState, maxLights, maxDecals,
//  maxWorldSprites, maxPortalRecursion, maxParticles}
world.info();   // + traceMs/traceCalls, controllerMs/controllerCalls,
                //   navMs/navQueries, audioVoicesActive/audioVoicesVirtual,
                //   gpuDrawsBase/gpuDrawsSpan/gpuDrawsActor/gpuDrawsOther/gpuDrawsGround/
//   gpuDrawsVfx, visual/…, particles/…, movers/…
```

Capabilities — это факты текущей сборки, а не обещание: `mirrorPortal`/
`skyPortal` пока `false` (математическое ядро готово, рендер-проход следующий),
`hrtf` отражает реальный backend `$.audio.hrtf()`. Профайлерные поля
накапливают наносекунды по последним вызовам (trace/controller/nav) и
counters голосов/частиц; overflow частиц виден в `world.particles.info()`.

## Postprocess (P2)

```js
world.post.profile('damage');       // neutral/underwater/poison/frost/boss/damage
world.post.set('vignette', { strength: .5 }).enable('flash', true);
const u = world.post.update(1 / 60); // native step + mapping в $.gfx.post
world.post.reset();
```

Стек — финальный 2D frame: grade/vignette/flash/tint/pixelate/chroma/bloom.
Нативные дескрипторы детерминированно шагаются (`postStep` в worldStep), а
`update()` переводит `R2DPostUniforms` в существующий проход `$.gfx.post`
(vignette/chromatic/glow/tint/saturation/brightness/blood), поэтому 3D G-buffer
не нужен. Ограничения: grade — 3-канальный gain (не LUT-матрица), pixelate —
hint, реальные пиксельные операции остаются в post-шейдере; bloom/chroma —
скалярные подсказки.

## Sky 2.0 и fog zones (P2)

```js
world.skyAnim({ yawSpeed: 0.2, pulseHz: 1.5, pulseAmount: 0.3, color: '#ff8040' });
world.fogZone({ span: 2, density: 0.01, start: 40, color: '#204060' });
world.fogAt(x, y, h);   // {span, density, start, color:[r,g,b]}
```

Скай — та же 2D-панорама: `skyAnim` крутит yaw и детерминированно пульсирует
tint (lightning/exposure-lite) в worldStep; `skyAnimInfo` отдаёт yaw/phase.
`fogZone` — semantic helper над существующим per-span fog: цвет/плотность/
start; переходы между зонами (камера в разных span) дают authored blend без
нового renderer-прохода. На high quality GPU-проход рисует panorama + до
четырёх parallax cards и sun/moon disc (общий panorama texture, не отдельные
слои-ассеты); sky portal/sky surface работают как раньше. Ограничения:
отдельные текстуры/профили слоёв, weather layers и volumetric fog не
поддержаны; fog — не raymarching.

## Multi-zone boss hit proxies (P3)

```js
world.hit(bossNode, { radius: 60, height: 180, category: 'enemy', zones: [
  { from: 0,   to: .45, multiplier: 1 },   // legs
  { from: .45, to: .8,  multiplier: 2 },   // body
  { from: .8,  to: 1,   multiplier: 4 },   // head
]});
const hit = world.trace({ from, to, mask: ['enemy'] });
hit.zone;            // 0..2 или -1
hit.zoneMultiplier;  // 4 для головы
```

Зоны — нормализованные height-полосы внутри того же цилиндра, не отдельные
хитбоксы: trace режет по authored `from/to`, возвращает зону и множитель.
Максимум 4 зоны, `from<to` в 0..1, multiplier ≥ 0; невалидные полосы
отклоняются без изменения registry. Ограничения: зоны вертикальные
(горизонтальные/руки-сегменты — P3+); множитель применяет игра, не engine.

## Material response и ricochet (P2)

```js
const hit = world.impactInfo({ from: {x,y,h}, to: {x,y,h} });
hit.surface; hit.material;          // authored surface material name или null
hit.terrain;                        // {kind,name,moveScale,frictionScale,damagePerSecond}
hit.thickness;                      // приблизительная толщина вдоль луча
world.ricochet(dir, hitNormal);     // отражённый вектор по нормали попадания
```

`impactInfo` — gameplay-запрос: trace по миру + authored terrain/materal tag,
опционально продолжение луча за стену для приблизительной толщины. Игра
выбирает звук/decal/частицы/пробитие. Ограничения: толщина — эвристика по
следующему world-хиту, не CSG-толщина; material tag только у surface material.

## Polygon cells (P1 authoring)

`.re2dmap` принимает `cells[].polygon: [[x,y],...]` вместо `rect`. Компилятор
(`r2d-sdk world-compile --renderer`) валидирует простой полигон, тайлит его в
**axis-aligned runtime cells** (runtime-модель остаётся rect XY) и генерирует:
внутренние порталы по общим рёбрам тайлов и граничные стены по внешнему
контуру. Идентификаторы тайлов — `id#N`.

```json
{ "id": "lroom",
  "polygon": [[0,0],[200,0],[200,100],[100,100],[100,200],[0,200]],
  "spans": [{ "bottom": 0, "top": 120 }] }
```

Ограничения P1: только **rectilinear** полигоны; наклонное ребро — ошибка
`SDK_WORLD_POLYGON` с диагностикой (никакого AABB fallback); отверстия не
поддерживаются; вырез полигона — void без floor/support. Авторские порталы к
исходному `id` полигона не адресуются (используйте сгенерированные/стены).
Capability: `$.capabilities.re2d.polygonCells === true`.

## Audio voice virtualization (P1)

```js
world.audio.budget(24);                 // реальных голосов не больше 24
world.audio.state();                    // {ready,active,virtual,budget}
const src = world.audio.source(path, { priority: 30, x, y, h });
```

Каждый кадр рантайм строит `R2DAudioVoices` pool из активных источников: выше
`priority` — важнее, дальние/тихие уходят в virtual (gain 0, канал
останавливается), при освобождении слота virtual повышается автоматически.
Профайлер: `world.info().audioVoicesActive/audioVoicesVirtual`. Ядро политики —
`r2d_audio_voices` (11 Unity-тестов); его лимит 1..32, runtime default 24.
Ограничения: шина/ducking из core пока не прокинуты в микшер; HRTF-ветка
остаётся у существующего `$.audio`.

## Audio zones (P1)

```js
world.span(0).audioZone('hall');    // room|hall|cave|outside|metal|magic
world.span(0).audioZoneInfo();      // {preset,name} или null
world.audioZoneAt(x, y, h);         // {preset,name,span} — authored или room-size heuristic
```

Preset хранится per-span; `r2d_world_audio_step` на каждом source-канале берёт
зону по позиции источника и применяет `r2d_audio_set_channel_reverb` (wet/decay/
damping), сбрасывая хвост при выходе из зоны. Без authored зоны пресет
выбирается детерминированно из размеров комнаты (`r2d_audio_zone_from_room`) —
та же эвристика, что в core-тестах. Portal-aware attenuation core готов
(`r2d_audio_zone_attenuation`), но в канал пока не подключён: это следующий шаг
вместе с voice virtualization runtime.

## Mirror portal (P2)

```js
world.portalMirror(0, true);    // проём = зеркало
world.portalMirrorGet(0);       // true
```

Mirror — это scissored проход отражённого мира: камера отражается across
плоскость портала (позиция и yaw), для отражённого вида считается отдельная
visibility, и сцена рисуется в экранный прямоугольник портала с выключенным
depth; затем обычные actor/decal проходы продолжают кадр. Для прохода флаг
mirror временно снимается, чтобы отражённая камера видела комнату за
плоскостью. Отдельный offscreen RT не нужен; цвет/освещение считаются тем же
шейдером. Ограничения: окно — AABB прямоугольник (не трапеция), отражение не
включает decals/translucent-слой и не рекурсивно для mirror-в-mirror; это
задокументированная аппроксимация 2.5D, а не G-buffer.
`$.capabilities.re2d.mirrorPortal === true`; флаг входит в save/load.

## Sky portal (P2)

```js
world.portalSky(0, true);      // проём = окно в панораму
world.portalSkyGet(0);         // true
```

Sky portal — это тег на authored portal: visibility **не уходит** в дальнюю cell,
поэтому открытый проём показывает sky background (`world.sky`/`skyAnim`) вместо
соседней комнаты; закрытый портал по-прежнему перекрыт створкой. Работает на
той же 2D topology, без mesh и без отдельного G-buffer. Флаг входит в
`saveState/loadState`; baked-формат его пока не переносит (авор задаёт
`world.portalSky` после загрузки). `$.capabilities.re2d.skyPortal === true`;
полноценный mirror-портал (отражённый проход) остаётся `false`.

## Debug overlay (P4)

```js
world.debug.overlay(view, { width: 1280, height: 720 }); // чистые данные
world.debug.draw(view, { width: 1280, height: 720, hitZones: true }); // поверх кадра
// Точный футпринт нативного контроллера (игрок), без приблизительных спрайтов:
world.debug.draw(view, { width: 1280, height: 720, controllers: [ctrl] });
```

`overlay` проецирует automap-линии и semantic точки (trigger/secret) в экран;
`draw` дополнительно рисует nav-узлы (когда граф построен) и hit-зоны;
`draw` дополнительно рисует их через движковый `$.gfx.draw` (без 3D-gizmo API)
и маркирует boss hit-зоны. Демо `demos/re2d_debug_lab` показывает это на
testroom; F1 переключает слой. Данные детерминированы; `draw.clear()`
вызывается самим helper'ом, так что слой не накапливается между кадрами.

`options.controllers` — массив handle'ов `world.controller(...)` или обычных
`{x,y,feet,radius,height}`. Для каждого контроллера `overlay` возвращает
`controllers[i] = {center, top, ground[32], cross[2], radius, height, feet,
grounded, x, y}`: `ground` — точная окружность радиуса на высоте `feet`
(каждая вершина через тот же `projectPoint`, что automap), `top` — верх
цилиндра `feet+height`, `cross` — крест центра. `draw` рисует зелёную окружность,
белый крест, жёлтую вертикаль высоты и точку центра. Это ровно та же
проекция/математика, что у кадра, поэтому оверлей совпадает с коллайдером до
субпикселя и не зависит от `depth`/pivot спрайтов. Geo: тест
`tests/agent/collision_align_test.py` (фикстура
`tests/fixtures/collision_align`).

## Dynamic nav (P3)

```js
world.navPath(from, to, 256, 0, { blockedSpans: [3, 4], blockedPortals: [1] });
```

Ядро A* принимает маски заблокированных узлов и порталов, поэтому закрытая
дверь/поднятый лифт исключаются из пути **без пересборки навграфа**. Runtime
конвертирует списки в маски; путь — массив node id или `null`. Agent:
`navPath(0,0)` → `[0]`, `blockedSpans:[0]` → `null`. Ограничения: маски
передаёт игра на каждый запрос; сам граф строится из authored topology.

## Rotating polywalls (P3)

```js
const group = world.polywall({ walls: [4], pivot: { x: 200, y: 200 }, angle: 0, speed: 1 });
group.info();          // {angle, speed, walls}
group.speed(0);        // пауза
group.remove();        // вернуть authored endpoints
```

Группа хранит authored endpoints и каждый `worldStep` поворачивает их вокруг
XY-пивота **в `world.walls`**, поэтому collide/trace/render идут по одному и
тому же сегменту без mesh API и без пересборки topology. BSP cell refs не
перестраиваются: группа рассчитана на стену, остающуюся внутри footprint своего
span. Демо `demos/re2d_polywall_lab`; agent: угол 0.05→1.05, trace из попадания
уходит в промах, кадр меняется (~132k px). Capability
`$.capabilities.re2d.rotatingPolywalls === true`.

## P5 mist bands

```js
world.mist({ x: 800, y: 1000, width: 400, depth: 200, rate: 60, color: '#dfe6f0', alpha: 0.12 });
```

Дымка — это предопределённый particle-прототип: долгоживущие медленные
translucent billboard'ы с большим size/endSize, нулевой гравитацией и drag.
Это не volumetric raymarching: слой живёт в пуле частиц (бюджет общий) и
работает вместе с fog zones. `rate` — частиц/сек, возвращает emitted count.

## Свет, материал, изменение мира

```js
world.lighting({mode:'classic',dynamic:true,shadows:true,
  distanceScale:.001,orientationContrast:true,orientationStrength:.06});
world.span(0).lighting({level:.35,color:'#ffffff'})
  .fog({density:.002,start:100,color:'#263044'});
world.material('brick',{albedo:'art/brick.png',normal:'art/brick_n.png',blend:'opaque'});
world.surface(0).material('brick');
const lamp = world.light({x:100,y:120,h:70,radius:180,intensity:1,color:'#ff7040',shadow:true});
lamp.flicker({min:.8,max:1,rate:9,seed:42});
world.portalClosed(0,true);
```

`lighting` задаёт полную global конфигурацию: отсутствующие dynamic/shadows false, distanceScale 0, orientationContrast/enabled true, orientationStrength .06. `span.lighting` и `span.fog` частично обновляют состояние. `span.info()` возвращает level/r/g/b/fogDensity/fogStart/fogR/fogG/fogB. `.span(id).heights(bottom,top)` transactionally меняет допустимый height interval; это не controller, спрайты нужно перемещать игре.

Light: `.at(x,y)`, `.height(h)`, `.radius(r)`, `.intensity(v)`, `.color(c)`, `.shadow(bool)`, `.life(seconds)`, `.flicker(options)`, `.info()`, `.remove()`. Life 0 — постоянный свет; после expiry/removal handle устарел. Limits: 128 total lights, 16 selected/span, 16 shadow lights.

Material: albedo, normal?, emissive?, emissiveStrength=1, uScale/vScale=1/64, blend=`masked` по умолчанию, opacity=1. Blend: opaque/masked/translucent/additive. Masked alpha threshold 128. 64 material slots, texture axes ≤2048. В world shading optional normal относится к constrained surface, не к imported mesh tangent.

Sky: `.sky({texture?,color?,yaw?,exposure?})` — `texture` PNG или `.exr` (панорама; EXR декодируется при загрузке в обычный 8-бит RGBA нативным адаптером tinyexr, одна часть, до 4096×2048, ≤64 МиБ; `exposure` −16..16 EV; для PNG экспозиция применяется в линейном пространстве). Небо — выборка 2D-панорамы без параллакса, не 3D-купол. Поверхность помечается `.surface(ceilingId).sky(true)`. Decal: `.decal({surface,material,u=0,v=0,width=16,height=16,life=0})` → handle с remove(); максимум 128. Transparent/sky base rejects decals.

## Reload и debug

| Вызов | Назначение |
| --- | --- |
| `.reload(path)` / `.reloadJSON(text)` | transactionally заменяет валидную геометрию и authored static lighting |
| `.watch(path)` / `.watch('')` | native watcher каждые .35s / отключение |
| `.debug.view(name)` | переключить native diagnostic, возвращает world |
| `.debug.visibility()` | `{spans:[indices],surfaces:[indices]}` из последнего visibility pass |
| `.debug.renderStats()` | тот же native snapshot, что info() |

Views: final, cell-id, span-id, bsp, portals, depth, owner, light-level, dynamic-light-count, shadow-mask, normal, emissive, overdraw. Snapshot — диагностическая копия; не используйте массивы для JS renderer loops. Index handles проверяются заново после topology reload. Динамический свет, ссылки на узлы со спрайтами и material/sky banks сохраняются при допустимом reload; подробнее [runtime](../re2d/RE2D_WORLD_RUNTIME.md#перезагрузка-и-жизненный-цикл).

## Примеры, ограничения, проверки

[World guide](../RE2D_WORLD_GUIDE.md), [sprite integration](../re2d/RE2DSPRITE_WORLD.md), [formats](../re2d/RE2D_WORLD_FORMAT.md), [migration](../re2d/RE2D_MIGRATION.md). Sources: [wrapper](../../src/highlevel/re2d.js), [bindings](../../src/re2d.c), [нативная композиция спрайтов](../../src/re2d_world_runtime.c).

Public runtime checks: `tests/agent/re2d_world_renderer_test.py`, `re2d_world_acceptance_test.py`, `re2d_dust2_test.py`. Native correctness: `tests/re2d/world_test.c` и `tests/rotsprite/rotsprite_test.c`. Limits и measurement provenance находятся в [performance](../RE2D_WORLD_PERF.md); наличие тестов не заменяет фактический отчёт прогона.

World positional audio: [`world.audio` / `$.re2dWorldAudio(world)`](../re2d/WORLD_AUDIO.md). Sources share the native Re2D geometry and existing mixer; Steam Audio supplies HRTF PCM only.

## Brush compiler, regions and sky boundary

`.re2dworld` остаётся обычным runtime-миром: `$.re2dWorld.load(path)` не меняется.
Новые authored-источники (`brushes`, `world`-конверт, `entities`, `regionSize`)
обрабатываются **SDK-компилятором** `r2d-sdk world compile`; публичного polygon
mesh API в runtime нет. В `.re2dworld` добавляется необязательный блок
`compiler` (brush stats, `regionGrid`, `regionCells`, entities, stage timings),
который runtime игнорирует.

* Tool materials -> `R2DWorldWall.flags`: query through native
  `r2d_world_wall_policy()`; `$`-метод для policy пока не добавлен (binding
  `src/re2d.c` принадлежит другому проходу).
* `sky` boundary: no wall surface, collision/ray stay, shadow/acoustic off.
  Translucent `opacity:0` не является заменой.
* Region partition/streaming/LOD: native `src/re2d_world_region.c`; high-level
  `world.info()` region metrics ещё не подключены.

Docs: [brush authoring](../RE2D_BRUSH_AUTHORING.md),
[huge world](../RE2D_HUGE_WORLD.md), [sky boundary](../RE2D_SKY_BOUNDARY.md).

Demo: `demos/re2d_openworld_lab` (`r2d-sdk world compile` -> `.re2dworld`).

## P4/P5 слой (sky/weather/shafts/post)

`world.qualityPreset('high'|'ultra')` включает P4-карточки без нового API:
distant sky cards, weather layers (rain/snow/ash/clouds) и light shaft cards
рисуются существующим card-конвейером; sky-профили `clear/dusk/night/storm`
и policy порталов/tool_sky описаны в `src/re2d_world_sky.h`.
`world.info().visual` дополнен счётчиками `shafts, weatherCards,
distantCards, ambientSamples, detailSamples, decals2, batchDraws,
batchBatches, batchSaved, residentTextures, uploadBytes`.

Честные ограничения: bloom-lite/reflection-lite/depth-aware heat distortion
имеют проверенную native-математику и CPU-reference, но их финальный
screen-pass не подключён к world forward pass (нужен scene-colour target);
ambient/AO field и detail layers пока не загружаются в shader uniforms;
decals 2.0 model ещё не связан с 128-слотовым пулом. Подробности и метрики —
[RE2D_RENDER_FEATURES.md](../RE2D_RENDER_FEATURES.md).

Финальный composite (task-11): `world.post` bloom теперь влияет на кадр через
offscreen post-проход; `world.qualityPreset('high'|'ultra')` включает bloom +
reflection-lite + depth-aware heat distortion. `world.decal({...})` принимает
необязательные `rotation`, `scale`, `fadeIn`, `fadeOut` (старые 7 аргументов
совместимы). Метрики — `info.visual.postPasses/postBloom/postReflection/
postHeat/decals2`. Ограничения (batching без SSBO, независимые sky-текстуры)
описаны в [RE2D_RENDER_FEATURES.md](../RE2D_RENDER_FEATURES.md).

Per-layer sky textures: `world.skyLayer(i,{id,texture,tint,parallax,scroll,alpha,offset,scale})`
(0..3), `world.skyLayers()` и `world.skyManifest('assets/sky/layers.json')`.
`world.info().sky` отдаёт `{count,error,layers[],sun,moon,weather}`; загрузка
транзакционная — missing asset сохраняет прежний слой и пишет `error`.
GPU-биндинг делает отдельный проход (task-13): `r2d_world_runtime_sky_config()`
+ `r2d_world_runtime_sky_layer_pixels()`.

Debug/profiler (task-22): `world.debug.view('region'|'active-region'|'pvs'|
'vis-cluster'|'areaportal'|'occluder'|'distant-lod'|'sprite-lod'|
'material-variation'|'ao-lite'|'vfx-budget')` включает native 2D overlay;
`world.debug.material(name|index)` / `world.debug.materials()` дают material
inspector, `world.info().regionStreamMs/regionStreamIoMs/regionLoadMs/
regionVisibilityMs` — реальные CPU timings. `info.materials` остаётся числом
(совместимость), список — `info.materialList`.
