# Re2D World: производительность и измерения

Редакция 2026-10-10. Текущий renderer — native C + SDL_GPU. GPU world raster и CPU Re2DSprite pose synthesis — разные части кадра. Исторический отчёт прежнего CPU World сохранён отдельно; он не описывает новый renderer.

## Финальный static stress

Provenance: Apple M4, macOS27.0.1 arm64, AppleClang Release, SDL_GPU Metal, native400×240, seed7, warmup8/sample20. Sprite nodes static; initial synthesis unlimited, poseStep0. GPU completion fence waited; FINAL output без framebuffer readback. Modified checkout baseline HEAD8011294b01330420ec12c903dfd9041834a6ecfe, binarySHA256 `6ebf56e995b3f68329c35c8993913dfbf0c96968762103ff2451c2524ff7364c`. Full recorded report: [JSON](re2d/RE2D_RENDERER_BENCHMARK.json).

| Сцена | Visible / total cells | Visible surfaces | Relevant / total lights | Видимые / все спрайты | Warm median ms | Cold frame ms |
| --- | --- | --- | --- | --- | --- | --- |
| A | 16 / 100 | 166 | 8 / 8 | 9 / 10 | 1.056667 | 144.995750 |
| B | 30 / 500 | 486 | 12 / 64 | 29 / 30 | 1.733438 | 444.015333 |
| C room-over-room | 16 / 80 | 167 | 16 / 128 | 15 / 50 | 1.659104 | 254.589333 |

Первичный синтез ракурсов спрайтов: A126.580250/B411.129250/C232.270042ms. Warm static cache не включает постоянную animation resynthesis. Это native world frame time с fence, не displayed FPS и не whole application frame budget. Scene C содержит16 shadow candidates. Полные totals/surfaces/stages/parameters сохранены в JSON, не выводятся из таблицы приблизительно.

BSP visits23/34/29; draws302/1044/314; adjacent sampler batches10/30/16. Binding batches не означают столько же draw calls. GPU draws — specialized fullscreen triangles, не generic scene triangles.

GPU texture payloads A21,562,376/B63,505,416/C34,145,288bytes; buffer/download payloads A1,922,048/B1,922,048/C1,947,424bytes. Эти resident payload categories исключают allocator/driver/temporary/shared resources; их нельзя называть total VRAM/process memory.

## Анимированные персонажи

Earlier unbudgeted animated GPU stress в том же ходе работ дал A135.863/B433.309/C227.574ms; CPU pose synthesis занимала примерно131/421/219ms. Эти значения исторические для recorded промежуточного build, не fresh measurement финального binary. Они объясняют, почему нельзя подменять animated throughput static warm цифрами.

Default `world.quality({poseBudget:1,poseStep:3})` ограничивает dirty synthesis и распределяет её round robin. Спрайт, синтез которого отложен, использует готовый ракурс, animation clocks продолжаются. Budget0 unlimited; step0 unquantized. Снижение pose refresh — visual quality tradeoff, не бесплатное ускорение. Attachment candidates тоже потребляют budget.

## Что оптимизировано

Native visibility следует reachable spans/portal windows и active near-first XY BSP branches. Light masks/per-light reached-span lists ремонтируют dirty links, не пересканируют все cells на unchanged frame. Baked topology/static associations избегают authoring build при compiled startup.

Retained scratch: visibility/frame/light/touched/sort buffers, shared anime supersampling arena. GPU-кэш спрайтов использует монотонный ID экземпляра, ревизию и размер; повторное использование адреса памяти не вызывает коллизии кэша. Shadow chunks local per-light invalidation; atlas repacks/uploads whole after relevant change. Adjacent equal material samplers reused without geometry order changes. Эти оптимизации сохраняют constrained authoritative model.

## Воспроизвести

Из checkout после Release build, на свободной машине:

```sh
python3 tools/bench_re2d_world_renderer.py --backend gpu --frames 20 --output build/re2d_world_renderer_gpu_benchmark.json
python3 tools/bench_re2d_world_renderer.py --backend cpu --frames 20 --output build/re2d_world_renderer_cpu_benchmark.json
```

Script drives agent protocol; measured workload reports native counters, not Python loop execution. Output captures machine/commit/working-tree/binary digest/resolution/quality/cold frame/warm stages. Benchmark tool currently hashes build/russiano2d; для сопоставимого прогона используйте этот binary и не задавайте другой agent binary через environment. LoadWallMs и ColdAgentStepWallMs включают transport; они отличны от frameMs.

```js
world.profile({gpuWait:true});
world.quality({poseBudget:0,poseStep:0});
const sample=world.info(); // читать после фактического render/frame
```

GPU timing fields — CPU wall/cache construction/submission/fence wait, не hardware timestamp. FrameMs без gpuWait не ждёт GPU. Debug capture/readback дороже FINAL; измеряйте выбранный mode явно. Не меняйте golden baseline ради performance результата.

## Что пока не подтверждено

Hosted Linux/Vulkan run, fresh Web/WASM build, arbitrary animated50 actor60FPS и другие hardware/resolutions не подтверждены этим benchmark. CPU/GPU parity и local correctness checks не заменяют platform performance measurements. Диагностика и полный profiler snapshot — в [runtime reference](re2d/RE2D_WORLD_RUNTIME.md#диагностика-и-полный-profiler-snapshot). Отчёты о реализации и аудите приёмки — внутренние документы движка, в поставку SDK не входят.

## P4 benchmark lab: native numbers (2026-10-17)

Сцена: `demos/re2d_bench_lab`, сценарий `re2dBench.apply(...)`,
`world.profile({gpuWait:true})` (frameMs включает ожидание GPU fence),
RelWithDebInfo, macOS arm64, Metal, window 1280×720, world frame 640×360.
Числа — один прогон `tests/agent/re2d_bench_lab_test.py`; это baseline, не
обещание: перед изменением renderer'а гоняйте тот же сценарий.

| Сценарий | actors | lights | particles | draws | frameMs | visibilityMs | surfaceMs |
|---|---:|---:|---:|---:|---:|---:|---:|
| base | 0 | 4 | 0 | 24 | 0.88 | 0.0005 | 0.88 |
| actors_100 | 100 | 4 | 0 | 186 | 1.32 | 0.001 | 1.30 |
| lights_32 | 0 | 36 | 0 | 24 | 0.84 | 0.0009 | 0.84 |
| particles_2000 | 0 | 4 | 2000 | 1048 | 2.97 | 0.001 | 2.96 |
| portals (dust2) | 0 | 35 | 0 | 88 | 0.59 | 0.0075 | 0.58 |
| movers (dust2) | 0 | 35 | 0 | 171 | 0.92 | 0.019 | 0.90 |
| worstcase | 100 | 36 | 2048 | 1210 | 3.86 | 0.001 | 3.83 |

Читать так: particle/actor draw submission доминирует в worstcase; visibility
и actor synthesis — доли миллисекунды. GPU-числа здесь — время ожидания
fence на этой машине, а не гарантированный бюджет BASHNYA (§76 roadmap).

## BASHNYA issue #2: wall->span incidence cache (2026-10-17)

`surface_draw` раньше для каждой видимой стены перебирала **все** видимые
spans (`O(walls × spans)`), и это был единственный суперлинейный этап кадра.
Теперь `WorldGPU` один раз на `topology_revision` строит обратный индекс
`wall -> incident spans` (из `span_wall_refs`) и проверяет `span_seen`.

Замер на `BASHNYA level1` (960×540, headless, 120 кадров, `bashnya.benchmark`):

| | до | после |
|---|---:|---:|
| gpuDraws | 10 531 | 10 531 |
| frameMs p50 | 12.37 | **2.53** |
| frameMs p95 | 13.04 | **3.02** |
| surfaceMs | 11.15 | **1.94** |
| visibleSurfaces / spans | 2192 / 653 | 2192 / 653 |

Кадр до/после побайтово совпал (0 отличий), т.е. это CPU-оптимизация, не
изменение видимой геометрии. `world.info()` теперь отдаёт разбивку
`gpuDrawsBase/gpuDrawsSpan/gpuDrawsActor/gpuDrawsOther` (на старте BASHNYA:
1527 base / 8471 span / 532 actor / 1 other = 10531).

Дополнительно `set_scissor` возвращает false при пустом пересечении с active
clip rect: surface/actor/decal draws с нулевым scissor больше не отправляются
(важно для mirror-прохода). Причина высокого `frameMs` в отчёте BASHNYA
подтверждена как CPU incidence scan, а не число draw call'ов.

## R-01/R-02 visual pass (2026-10-17)

Workload: `demos/re2d_world_renderer_lab`, GPU reference, 1280×720 output
(400×240 world frame), 30 warm frames, `world.profile({gpuWait:true})`.
Current working tree, macOS arm64 / Metal, RelWithDebInfo. Numbers are a single
run and vary with machine load; they prove the pass does not add geometry.

| Tier | draws | frameMs median | frameMs p95 | changed pixels vs low |
|---|---:|---:|---:|---:|
| low (legacy + grounding) | 26 | 12.33 | 12.63 | — |
| high (all R-01/R-02) | 26 | 12.33 | 12.59 | 32.33% |

Visual features are shader uniforms/instructions only: no extra draw calls, and
the frame is dominated by the existing actor readback/composition on this lab.
Per-feature counters are in `world.info().visual` (contactShadows, footAo,
edgeActors, variedSurfaces, bevelSurfaces, fogSurfaces, hazeSurfaces,
liquidSurfaces, skyLayers, celestialDiscs, ...).

VFX pass (`tests/agent/re2d_render_vfx_pass_test.py`, same lab): one live card
adds `gpuDrawsVfx=1`; a live boss aura trail adds 3 trail segment draws
(`vfxTrailDraws=3`). Attribution stayed exact:
`Base+Span+Actor+Other+Ground+Vfx == gpuDraws` (50 == 50 in the trail run).
VFX draw submission is therefore bounded by live cards/trail segments, not by
registered bundle count.

`demos/re2d_bench_lab` current run (same build, GPU wait):

| Scenario | draws | frameMs |
|---|---:|---:|
| base | 24 | 0.88 |
| actors_100 | 263 | 1.64 |
| lights_32 | 24 | 1.31 |
| particles_2000 | 1048 | 3.57 |
| portals (dust2) | 88 | 0.62 |
| movers (dust2) | 143 | 0.77 |
| worstcase | 1287 | 4.91 |

BASHNYA level1 before/after could not be measured in this working tree: the
current in-flight world/region task makes the native map loader reject the
BASHNYA `.re2dworld` with `invalid wall/span geometry (-1)`, and the scripted
intro chain does not reach `level1` through the agent. Re-run the numbers above
plus the BASHNYA script after that integration lands; do not read the lab table
as a BASHNYA budget.

## P4/P5 renderer counters (task-7)

`info.visual` adds: `shafts` (additive light-shaft cards drawn), `weatherCards`,
`distantCards`, `ambientSamples`, `detailSamples`, `decals2`, `batchDraws`,
`batchBatches`, `batchSaved`, `residentTextures`, `uploadBytes`.

Native budgets are explicit and deterministic:

* light shafts: 0-8 cards/frame (`shaft_budget`, quality low 0 / medium 4 /
  high 6 / ultra 8);
* weather: <=96 cards per weather layer, <=8 stacked layers (hard cap), so the
  worst case is bounded at 768 procedural quads; high density defaults to 0.30
  and ultra to 0.55, which yields 28/52 cards for the shipped profiles;
* distant cards: 0-4 per frame;
* decals 2.0: constant 256-slot model (existing world decal pool stays 128);
* batching: consecutive material/blend/light/atlas keys coalesce, `batchSaved`
  counts avoided draw calls;
* residency: byte budget + per-frame upload byte budget; admission is
  deterministic (fits or queued as pending).

The CPU post references are O(w*h) plus a separable box blur and are used only
by the native regression harness, not in the frame loop.
