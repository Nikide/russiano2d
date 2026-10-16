# Документация нового Re2D World

Редакция 2026-10-10. Начните с [World guide](../RE2D_WORLD_GUIDE.md): там полный main.js с двумя этажами/персонажами/AK, doors и flash. Пример проверен в native runtime, source JSON скомпилирован и загружен.

| Документ | Для чего |
| --- | --- |
| [Re2D overview](../RE2D.md) | модель и философия |
| [Public API](../highlevel/re2d.md) | точные signatures/defaults |
| [Runtime reference](RE2D_WORLD_RUNTIME.md) | ownership, полный profiler, lifetime, reload и limits |
| [Re2DSprite World](RE2DSPRITE_WORLD.md) | узлы `$` со спрайтами, ракурсы, оружие, общие свет/туман/глубина, производительность |
| [World formats](RE2D_WORLD_FORMAT.md) | SDK source/native author/baked v1-v2, stairs/slopes, compile |
| [Migration](RE2D_MIGRATION.md) | перенос old room/kind/$.re2d.world |
| [Performance](../RE2D_WORLD_PERF.md) | cold/warm/static/animation measurements и provenance |
| [SDK](../SDK.md#9-re2d-world-studio) | existing RmlUi World Studio/native preview |
| [Sprite authoring](../RE2DSPRITE_GUIDE.md) | PNG/JSON/rig/animation creation |
| [Sprite mathematics](../RE2DSPRITE_MATH.md) | source-linked equations, sample-depth reconstruction |

Совместимость: [legacy API](../highlevel/re2d_legacy.md). Прежние limitations старого CPU-compositor не описывают новый renderer.

Implementation/requirements evidence: [behavior](RE2D_RENDERER_BEHAVIOR.md), [benchmark JSON](RE2D_RENDERER_BENCHMARK.json). План реализации, заметки по GZDoom и аудит приёмки документов — внутренние документы движка, в поставку SDK не входят.

Последние локальные прогоны — во внутреннем журнале SDK (в поставку не входит); наличие документа или configured CI не является hosted run/visual observation evidence. Runtime examples: demos/re2d_world_renderer_lab/acceptance и demos/re2d_dust2.
