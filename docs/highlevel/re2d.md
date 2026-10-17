# Re2D World — public `$` API

Редакция 2026-10-10. Для нового рендера используйте `$.re2dWorld`. Это native world handle с собственными cells/spans/portals, списком ссылок на существующие узлы со спрайтами и camera configuration. `$.re2d.room`, `.kind(Re2D)` и `$.re2d.world` сохранены в [legacy reference](re2d_legacy.md); это другие entry points, не сокращённые имена нового API.

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
| `world.automapLines(states?)` / `automapProject(view,x,y)` | 2D automap-линии и view-трансформ |
| `world.metadata()` / `spawns()` / `spawn(id)` | authored map metadata и типизированные spawn points |
| `world.saveState()` / `loadState(save)` / `saveMapHash()` | versioned native snapshot + map identity guard |
| `world.secret(opts)` / `secretsTick(dt,at)` / `onSecret(fn)` | secret volumes + события `secret.found` |
| `world.breakable(opts)` / `onBreakable(fn)` | authored breakables + событие `breakable.broken` |
| `surface.terrain(name)` / `conveyor(opts)`, `world.terrainAt/conveyorAt` | terrain/liquid metadata и 2D conveyors |
| `world.materialAnim(name,opts)` / `materialIndex(name)` | flipbook/scroll/emissive анимация материала |
| `world.volume(node,opts)` | constrained box/cross/slice-stack из нескольких billboard-частей (не mesh) |
| `$.capabilities.re2d` | честная матрица возможностей сборки/рантайма |
| `world.post` | финальный 2D postprocess stack поверх `$.gfx.post` |
| `world.skyAnim` / `fogZone` / `fogAt` | анимация панорамы и semantic fog zones |
| `world.portalSky(index,on)` | проём портала как окно в панорамное небо (P2 sky portal) |
| `world.debug.overlay(view,opts)` | screen-space данные automap/trigger/secret для debug-оверлея |
| `world.particles.burst/continuous/info/clear` | нативный fixed-pool частиц |
| `world.fxDefine(name,bundle)` / `fxSpawn(name,at)` | asset-driven VFX bundle (particles/light/decal/sound/shake) |
| `world.findSurface(name)` | имя стены/span → handle поверхности |
| `world.controller(opts)` | нативный helper движения (sweep/slide/step/slope/jump) |
| `world.mover(opts)` | нативный fixed-tick timeline двери/лифта/крашера/платформы |
| `world.trigger(opts)` + `world.triggerTick/Use/Shoot` | семантические триггеры; события идут в `$.on/$.emit` |
| `.camera(view={})` | заменяет конфигурацию камеры; пропущенные поля получают defaults |
| `.render(view=null,width=320,height=180)` | синтезирует и рисует обычный sprite на всё окно; возвращает sprite ID |
| `.renderToSprite(view=null,width=320,height=180)` | синтезирует без fullscreen draw; возвращает sprite ID для previews |
| `.backend('cpu'\|'gpu')` | выбор native reference или SDL_GPU; wrapper default CPU |
| `.quality({poseBudget,poseStep})` | частично обновляет policy; defaults 1 pose/frame, 3°; 0 budget = unlimited |
| `.profile({gpuWait:false})` | completion wait для измерения; true включает ожидание fence |
| `.info()` | native snapshot counts/timings; точные поля в [runtime](../re2d/RE2D_WORLD_RUNTIME.md) |
| `.dispose()` | освобождает мир/его registry/frame/GPU resources; повторный вызов безопасен; не удаляет игровые узлы |

Frame dimensions — целые 1..1024. View: x/y=0, h=48 (eye — alias), yaw/pitch=0, fov=70°, near=4; projection perspective. Для orthographic: `projection:'orthographic',orthoHeight:400`. `render(null)` использует сохранённую camera. Здесь второй аргумент render — width, **не массив спрайтов**.

## Игровые запросы

| Вызов | Результат |
| --- | --- |
| `.cellAt(x,y)` | cell index или null |
| `.spanAt(x,y,h)` | global span index или null |
| `.support(x,y,feet,bodyHeight,step=0)` | `{span,height,ceiling}` или null; reachable floor с headroom |
| `.blocked(x,y,radius,bottom,top)` | boolean; статический circle XY × height против стен/portal closure |
| `.ray(from,to)` | точки `{x,y,height}`; `{fraction,x,y,height,wall,span,ceiling}` или null |
| `.lightAt(x,y,h)` | `{r,g,b,level}` или null; native gameplay approximation, без чтения pixels |
| `.surface(index)` | `{kind,primitive,cell,span,material(name),sky(enabled=true)}` или null |

XY — half-open. Свободный span включает пол и исключает потолок. `surface.kind`: 0 wall, 1 floor, 2 ceiling; наклон — коэффициенты соответствующей plane, не четвёртый mesh type. Не выводите surface ID из wall index попадания вслепую после перекомпиляции: IDs принадлежат текущему canonical domain.

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

* читает `x/y/depth/w/h/angle` и `sprite_row` узла;
* выбирает колонку направления из `angle` (facing, радианы, 0 = +X) и позиции
  камеры; `mirror: true` рисует вторую половину отражённой;
* ставит нормированную точку `pivot` в `depth` узла: `feet` — точка опоры, а не
  центр кадра; `center` держит в `depth` середину; `custom` берёт `pivotX`,
  `pivotY`;
* тестирует глубину, свет и туман тем же нативным композитором, что и
  поверхности мира, поэтому стена перекрывает спрайт попиксельно;
* обрезает нужную клетку в квадратный буфер один раз на смену
  колонки/строки/зеркала и переиспользует его в CPU и SDL_GPU путях.

`directions`: 1, 4, 5+mirror, 8, 16 (1..16). `columns`/`rows` — до 64.
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

Проверки: `tests/re2d/atlas_test.c` (Unity: направление, pivot, клетка,
кроп), `tests/agent/re2d_boomer_lab_test.py` (кадр, смена направления,
попиксельная окклюзия стеной), `demos/re2d_boomer_lab`.

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

Линии стен и порталов в детерминированном порядке; derived door-closure walls
не дублируются (дверь — одна PORTAL-линия). `states` — плоская таблица по
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

## Save / load state (P1)

```js
const save = world.saveState();
// {format:'re2d-world-save', version:1,
//  map:{id,version,hash}, state:{format:'re2d-save',...}}
world.loadState(save);          // true или исключение
world.saveMapHash();            // hex-строка authored identity + topology
```

Native snapshot (версия 1) хранит spans (`id,bottom,top`), portals
(`id,open_fraction,closed`), movers (timeline state) и triggers
(`id,type,fire_count,enabled,once,armed,timer`). `loadState` проверяет map hash
и точное число spans/portals/mover'ов/триггеров; несовпадение — `RangeError`,
состояние не меняется. Bounds: 4096 spans/portals, 256 movers, 512 triggers;
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
                //   particles/particlesDrawn, movers, triggers, hitProxies
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
нового renderer-прохода. Ограничения: multi-layer sky и sky portal как
отдельный render pass — следующий шаг; fog не volumetric raymarching.

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
