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

Совместимость: [legacy API](../highlevel/re2d_legacy.md), [historical CPU performance](RE2D_WORLD_CPU_HISTORY.md). Их прежние limitations не описывают новый renderer.

Implementation/requirements evidence: [source plan](RE2D_WORLD_GZDOOM_RENDERER_PLAN.md), [behavior](RE2D_RENDERER_BEHAVIOR.md), [reference rules](GZDOOM_REFERENCE_RULES.md), [phase evidence](RE2D_RENDERER_IMPLEMENTATION_PLAN.md), [17-point audit](RE2D_DOCUMENT_ACCEPTANCE_AUDIT.md), [benchmark JSON](RE2D_RENDERER_BENCHMARK.json).

Последние local results находятся в [SDK_HANDOFF.md](../../SDK_HANDOFF.md); наличие документа или configured CI не является hosted run/visual observation evidence. Runtime examples: demos/re2d_world_renderer_lab/acceptance и demos/re2d_dust2.
