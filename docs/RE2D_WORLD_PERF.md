# Re2D World: производительность и измерения

Редакция 2026-10-10. Текущий renderer — native C + SDL_GPU. GPU world raster и CPU Re2DSprite pose synthesis — разные части кадра. Исторический отчёт прежнего CPU World сохранён [отдельно](re2d/RE2D_WORLD_CPU_HISTORY.md); он не описывает новый renderer.

## Финальный static stress

Provenance: Apple M4, macOS27.0.1 arm64, AppleClang Release, SDL_GPU Metal, native400×240, seed7, warmup8/sample20. Actors static; initial synthesis unlimited, poseStep0. GPU completion fence waited; FINAL output без framebuffer readback. Modified checkout baseline HEAD8011294b01330420ec12c903dfd9041834a6ecfe, binarySHA256 `6ebf56e995b3f68329c35c8993913dfbf0c96968762103ff2451c2524ff7364c`. Full recorded report: [JSON](re2d/RE2D_RENDERER_BENCHMARK.json).

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

Hosted Linux/Vulkan run, fresh Web/WASM build, arbitrary animated50 actor60FPS и другие hardware/resolutions не подтверждены этим benchmark. CPU/GPU parity и local correctness checks не заменяют platform performance measurements. [Runtime profiler reference](re2d/RE2D_WORLD_RUNTIME.md#диагностика-и-полный-profiler-snapshot), [implementation evidence](re2d/RE2D_RENDERER_IMPLEMENTATION_PLAN.md), [audit](re2d/RE2D_DOCUMENT_ACCEPTANCE_AUDIT.md).
