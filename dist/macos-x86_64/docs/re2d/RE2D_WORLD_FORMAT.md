# Re2D World: authoring, native JSON и baked output

Редакция 2026-10-10. Формат исходника SDK и формат входа native runtime различаются. Public API — [reference](../highlevel/re2d.md); рабочий игровой пример — [guide](../RE2D_WORLD_GUIDE.md).

## Три представления

| Представление | Назначение | Читатель |
| --- | --- | --- |
| `.re2dmap` / `.re2dmap.json` | inspectable source: ids, rect, stairs/slopes, portals, lights | existing native SDK compiler / RmlUi World Studio |
| native author JSON version 1 | cells x/y/w/h, spans, numeric portal refs; без baked | $.re2dWorld.fromJSON(JSON.stringify(data)) / load; C validates/builds |
| `.re2dworld` с baked | compiled BSP/topology/surfaces/static associations + readable metadata | новый native runtime; authoritative binary tables |

Расширение само по себе не определяет ABI. Version/fields проверяются loader-ом. Native fromJSON принимает строку, а не произвольный JS object. Не передавайте SDK source напрямую native loader-у и не называйте legacy compiled JSON native baked world.

## SDK source

Минимальная двухэтажная комната `maps/room.re2dmap`:

```json
{
  "version":1,
  "name":"Two storeys",
  "cells":[{"id":"room","rect":[0,0,240,240],"spans":[
    {"bottom":0,"top":128,"floorColor":"#888888","ceilingColor":"#777777",
      "lighting":{"level":0.25,"color":"#ffffff","fog":{"density":0,"start":0,"color":"#142a49"}}},
    {"bottom":160,"top":288,"floorColor":"#aa8877","ceilingColor":"#777777"}
  ]}],
  "walls":[
    {"id":"north","from":[0,0],"to":[240,0],"bottom":0,"top":288,"color":"#bba078"},
    {"id":"south","from":[0,240],"to":[240,240],"bottom":0,"top":288,"color":"#bba078"},
    {"id":"west","from":[0,0],"to":[0,240],"bottom":0,"top":288,"color":"#bba078"},
    {"id":"east","from":[240,0],"to":[240,240],"bottom":0,"top":288,"color":"#bba078"}
  ],
  "portals":[],"stairs":[],"slopes":[],
  "lighting":{"mode":"classic","dynamic":true,"shadows":true,"distanceScale":0.001},
  "lights":[{"x":120,"y":120,"h":208,"radius":180,"intensity":1,"color":"#ff3020","shadow":true}]
}
```

```sh
build/r2d-sdk world-compile maps/room.re2dmap --renderer --output maps/room.re2dworld
```

Без `--renderer` сохраняется legacy output для `$.re2d.world` и stepped slopes. Для нового мира флаг обязателен. Compiler report содержит outputFormat/runtimePortals/diagnostics/stats. Atomic writer публикует compiled output заменой временного файла; не передавайте watcher-у частично записанный asset.

SDK `id` — authoring identifier, не native numeric handle. Compiler может объединять exact same-XY authored rectangles в одну cell с несколькими spans. После compilation numeric indices могут отличаться от authoring array positions. Не сохраняйте runtime surface/span indices как стабильные semantic IDs между builds.

## Portals, stairs и slopes в SDK

Рабочие source examples — [acceptance map](../../demos/re2d_world_renderer_lab/acceptance/acceptance.re2dmap) и [Dust2 map](../../demos/re2d_dust2/dust2.re2dmap). Portals задают связь cells на общей XY-границе с высотным открытием; SDK validates references и вырезает проёмы из authored walls.

```json
{
  "stairs":[{"id":"stairs1","rect":[240,0,160,120],"axis":"x","dir":1,
    "steps":4,"base":0,"rise":8,"top":128}],
  "slopes":[{"id":"ramp1","rect":[0,240,240,160],"axis":"y","dir":1,
    "from":0,"to":32,"top":160}]
}
```

Это фрагменты sections, а не полный source. Stairs steps=1..256; первый generated floor = base+rise, далее base+(i+1)*rise для i=0..steps-1. Top — absolute ceiling, не headroom добавка. `axis` x/y, dir ±1. С `--renderer` slope становится одной plane; segments можно опустить. В legacy mode segments обязателен и задаёт stepped approximation. Авторские lighting/fog наследуются generated spans.

Generated stairs/slopes соединяются через общую грань, если свободные высоты совместимы и authored wall перекрывает не всё открытие. Wall lintel выше opening не должен отключать соседние steps. Для обычных explicit cells нужна explicit portal связь. Auto generated connections — не auto navigation для произвольной сцены.

Пример SDK portal section между source cells с id roomA/roomB и общей границей x=240:

```json
{"portals":[{"id":"door","cellA":"roomA","cellB":"roomB",
  "from":[240,80],"to":[240,160],
  "openings":[{"bottom":0,"top":128},{"bottom":160,"top":288}]}]}
```

Здесь ссылки — строки author IDs; в native JSON они numeric indices. Native `closed` bool и runtime portalClosed задают closure state; не предполагайте, что произвольное дополнительное author property автоматически переносится compiler-ом.

## Native author JSON

```json
{
  "version":1,
  "cells":[{"x":0,"y":0,"w":240,"h":240,"spans":[
    {"bottom":0,"top":128},
    {"bottom":160,"top":288,"floorSlope":{"a":0.05,"b":0}}
  ]}],
  "walls":[],"portals":[]
}
```

Этот пример показывает format, а не закрытую perimeter комнату: walls пусты. В runtime JSON cells **не создают автоматически наружные walls**. Добавьте ограничивающие отрезки самостоятельно. Для portal native author walls оставляют открытый segment явно; authored solid wall на том же месте не исчезает только от добавления portal. SDK cutter относится к authoring compiler.

| Поле | Правило |
| --- | --- |
| version | integer 1; baked.version — отдельное version поле |
| cells | обязательный массив; x/y/w/h finite; positive dimensions, disjoint XY interiors |
| spans | каждый cell имеет ≥1 free interval; bottom/top finite, non-overlap; geometry в пределах ±1e6 |
| floorSlope/ceilingSlope | optional `{a,b}`; оба coefficients требуются при наличии объекта |
| walls | обязательный массив; from/to 2D endpoints, bottom/top; nondegenerate length/height |
| portals | обязательный массив; numeric cellA/cellB, from/to on exact shared edge, nonempty openings, closed? bool |
| openings | bottom/top fit adjacent free spans, disjoint height interiors |
| colors | optional `#rrggbb`; native author color parser не принимает произвольную CSS запись |

Пол/потолок: `height = base + a*(x-cell.x) + b*(y-cell.y)`. Base = bottom для floor, top для ceiling. Все четыре угла проверяются на positive headroom и inter-span overlap. Cell/span boundaries half-open; touching spans/XY edges не создают overlapping interiors. Несколько openings одного portal допускают room-over-room; solid промежутки остаются закрытыми.

Root lighting: mode classic, enabled/dynamic/shadows/orientationContrast bool, distanceScale≥0, orientationStrength 0..1. Author defaults при присутствии lighting/lights: enabled/dynamic true, shadows false, orientationContrast true, distanceScale .001, orientationStrength .06. Span lighting: level 0..1, color, fog density/start≥0, fog color. Root static lamps: x/y/h/radius обязательны; intensity=1, color white, shadow false по умолчанию. Max lights 128.

## Canonical surfaces

Native canonical sequence: сначала wall surfaces (включая derived portal closure walls), затем по две surfaces каждого global span — floor и ceiling. `surface.kind` 0/1/2; slope не меняет type. Wall surfaces могут иметь cell/span=-1, plane surfaces имеют owner. API surface(index) — snapshot metadata плюс material/sky setters.

`info().walls + 2*spanId` — floor ID текущего build, следующий — ceiling. Это полезно для setup после load; не считается стабильным ID между compiler outputs. Materials/sky/decal assignments задаются через public world API. Строковый material bank не дублирует геометрию. World Studio previewMaterial — authoring preview configuration, не universal baked material serialization.

## Baked output и совместимость

Compiled JSON содержит readable geometry и `baked` field с little-endian hex payload/checksum. Wire v1 содержит geometry/BSP/CSR/canonical surfaces; v2 дополняет global/span/static lighting, generations, full candidate masks и per-light reached-span links. Ordinary JSON version остаётся 1.

Loader проверяет counts/offsets/references, topology/geometry, BSP cycles, checksum, light generations/masks/link ownership. Старый валидный geometry wire v1 читается; fractional/unknown versions и corrupt payload отклоняются. Checksum обнаруживает повреждение, не является authentication.

При наличии baked runtime читает его tables. Правка readable cells/lights рядом с baked не является authoring edit: заново compile source. Startup не пересобирает BSP и не делает static portal BFS; bakedLighting/lightUpdates позволяют это проверить. Imported baked ray queries используют complete primitive fallback, а не недоказанную accelerated cell-ray coverage.

## Editor и ошибки

World Studio редактирует source files через existing RmlUi: XY plan/height section, JSON properties, move/grid, split/join, undo/redo, validation, static lights, debug views, native preview и PNG albedo/normal/emissive previewMaterial. Preview вызывает тот же native compiled world через renderToSprite. Смотрите [SDK §9](../SDK.md#9-re2d-world-studio).

Invalid source/bake/reload выдаёт ошибки на языке cells/spans/portals; previous runtime world сохраняется transactionally. Меняйте source, устраняйте diagnostic с object location, compile и проверяйте новую карту. Не исправляйте checksum вручную как authoring workflow.

Sources: [native loader](../../src/re2d_world_topology.c), [baker](../../src/re2d_world_bake.c), [SDK compiler](../../sdk/native/sdk_world.c). Проверки: `tests/re2d/world_test.c`, `tests/agent/sdk_world_test.py`, `sdk_world_studio_test.py`, `re2d_world_renderer_test.py`.

### Видимость сбоку уклона

В режиме `--renderer` пол уклона остаётся непрерывной плоскостью. Если высота пола меняется вдоль общего ребра, SDK делит автоматически создаваемый проход на прямоугольные части: длина части до одной единицы, максимум 256 частей на ребро. Нижняя граница каждой части учитывает оба конца этого участка. Один проход с нижней границей по самому высокому концу всего уклона ошибочно скрывал нижнюю часть соседнего региона. Явно заданные portals и их индексы остаются прежними; число автоматически созданных portals после повторной компиляции может увеличиться.
