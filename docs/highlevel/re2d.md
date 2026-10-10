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
