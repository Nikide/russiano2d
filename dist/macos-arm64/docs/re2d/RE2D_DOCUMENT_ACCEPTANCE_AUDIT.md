# Проверка по исходному документу — 2026-10-10

Повторно приложенный `RE2D_WORLD_GZDOOM_RENDERER_PLAN.md` побайтово совпадает с сохранённым исходным планом. Его исходные галочки являются требованиями, а не доказательством выполнения. Эта сверка связывает требования с реализацией и проверками; исторические результаты остаются в `SDK_HANDOFF.md`.

## Обязательный scope Renderer 1.0 (§55)

| Требования | Реализация | Проверки / ограничения |
| --- | --- | --- |
| XY BSP, cells, spans, portals, same-XY, room-over-room | `src/re2d_world_topology.c`, `src/re2d_world_visibility.c` | `tests/re2d/world_test.c`, renderer и acceptance agent suites; XY cells прямоугольные |
| walls/floors/ceilings/slopes, depth/composition | `src/re2d_world.c`, `src/re2d_world_gpu.c`, `shaders/world.frag.glsl` | native ray/reference, CPU/GPU parity, continuous SDK slopes; это constrained surfaces, не arbitrary mesh world |
| classic/color/orientation/distance | `src/re2d_world_light.c`, world shader | native кривые и независимые формулы, golden corridor; таблицы Doom не импортированы |
| dynamic/culling/portal propagation/shadows | native light pool, portal associations, GPU local shadow chunks | native radius/height/door/overflow, 128-light stress, upper-floor/opening tests; геометрические тени, без per-texel transmission |
| albedo/emissive/normal/fog | `src/re2d_world_material.c`, shared native/GPU shading | native darkness/normal response, GPU parity, emissive/normal/fog diagnostics |
| Re2DSprite lighting/occlusion | `src/re2d_world_runtime.c`, existing RotSprite synthesis + sample depth | renderer suite, same-XY pigs, AK attachment, flash and depth checks; PNG synthesis сохранён |
| debug/native profiler | 13 native views, culling/draw/stage/payload counters | renderer suite и acceptance; CPU wall/submission/fence timings, не hardware GPU timestamps; memory counters измеряют payload |
| render lab/goldens/stress | parent lab + acceptance child; A/B/C benchmark | 6 golden captures и provenance report; статический warm benchmark не доказывает скорость массовой анимации |
| public `$`, C hot paths, SDL_GPU | wrapper → bindings → native runtime → existing SDL_GPU | public-only demos/Studio; конфигурация и gameplay coarse queries в JS, renderer traversal/light/shadow/pose/queues в C |

## Финальный сценарий (§72): все 17 пунктов

| № | Требование | Конкретное подтверждение |
| --- | --- | --- |
| 1 | Два spans в одинаковом XY | acceptance `spanAt(350,120,40/200/140)` различает нижний/верхний/solid промежуток |
| 2 | Sprite nodes сверху и снизу | native registrations; две свиньи имеют одинаковые XY и разные depth |
| 3 | Красный свет сверху | authored upper lights; movingLamp теперь красный на h=208; отдельный assertion |
| 4 | Solid floor блокирует свет | cross-storey ray + isolated red lamp: нижний receiver не меняется |
| 5 | Opening пропускает | isolated upper lamp увеличивает lightAt в соседнем upper span через открытие |
| 6 | Дверь меняет visibility | закрытие уменьшает visibleCells и меняет фактический кадр |
| 7 | Дверь меняет propagation | уменьшается native lightSpanPairs |
| 8 | Дверь меняет shadow | native door/lift shadow parity; reopening invalidates GPU chunks, stationary cache не перестраивается |
| 9 | Flash освещает нижнюю свинью | фактический pig/AK screen region ярче; отдельно растут native receiver contributions sprite node/wall/floor; lifetime истекает |
| 10 | Normal wall реагирует | native facing-normal response test, material CPU/GPU parity; acceptance normal diagnostics |
| 11 | Emissive panel виден | native emissive survives zero ambient, golden/material tests, emissive diagnostics |
| 12 | Fog corridor | отключение span fog меняет фактические pixels; world/sprite node shared fog |
| 13 | BSP debug | native owner-node view; distinct captured diagnostic |
| 14 | Light debug | dynamic-light-count view и native association counts |
| 15 | Depth debug | depth/owner distinct captures + native sprite node/wall/sample occlusion checks |
| 16 | Profiler показывает culling | bspNodesVisited/cellsRejected/draws/material batches assertions |
| 17 | Gameplay JS не содержит renderer loops | lab callbacks конфигурируют camera/moving light, делают support/blocked queries и вызывают world.render; все renderer loops native |

Повторный прогон после исправления movingLamp: **21/21 acceptance checks passed**, без failures. Новые проверки не заменяют прежнюю native/GPU regression evidence. Parent golden fixture и binary не изменены этой доработкой. Crop pig/AK проверяет их совместную экранную область; это не отдельная сегментация weapon pixels. Native attachment/shared lighting проверяется также renderer suite.

## Прочие gates и границы

Gates 0–4: spec/clean boundary/core/projection/visibility/constrained surfaces; 5–14: lighting/materials/shadows/fog/portals/sprites/depth/SDL_GPU; 15–24: queues/transparency/sky/decals/moving world/static bake/normals/public/native API; 25–29: no ECS/debug/profile/stress/lab. Реализация и evidence перечислены выше и в `RE2D_RENDERER_IMPLEMENTATION_PLAN.md`.

Gates 30–35: plan-derived behavior notes, explicit reference limits, first-class spans, independent shading order. **Визуальное наблюдение запущенного GZDoom не выполнено.** Наличие ссылок/карточек не подтверждает наблюдение; source/shaders/assets не использовались как шаблон.

Gates 36–40: native deterministic flicker/lifetimes/lightAt/coarse queries, compiled BSP/topology/static associations, без WAD/UDMF runtime. Gates 41–42 описывают допустимый postprocess/bloom; отдельный world bloom не входит в mandatory §55 и не заявляется реализованным.

Gates 43–50: local shadow chunks, portal propagation, native tests, six goldens, public API tests, retained arenas/ownership, transactional reload/watch, Re2D diagnostics. Полный список ограничений — `RE2D_WORLD_RUNTIME.md`: binary doors, flat-only lift edits, center-sorted transparency, conservative orthographic/outside visibility, whole shadow atlas repack/upload при изменении локального chunk.

Gate 51 и phases 0–15 имеют **локальную** implementation/test evidence. Linux workflow настроен, hosted CI не запускался. Никакой commit/release/publication этой сверкой не выполнен. Dust2 — работающая оригинальная интерпретация маршрутов с native topology; точная геометрия Valve и законченная Counter-Strike игра не заявляются.
