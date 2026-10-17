# Re2D bench lab — P4 benchmark scenarios

`./build/russiano2d --game demos --scene re2d_bench_lab` (или через лаунчер).

`re2dBench.apply(name)` переключает сценарий и сбрасывает предыдущую нагрузку:

| Сценарий | Что регистрирует |
|---|---|
| `base` | пустая комната, камера/FPS-вид |
| `actors_100` | 100 нативных atlas world sprites |
| `lights_32` | 32 динамических света (8 shadow) |
| `particles_2000` | 2000 нативных частиц (пул 2048) |
| `portals` | dust2: nav graph + portals |
| `movers` | dust2: 16 lift/platform mover'ов |
| `worstcase` | 100 actors + 32 lights + 3000 particles |

`re2dBench.snapshot()` отдаёт `frameMs/visibilityMs/actorMs/surfaceMs/
compositionMs/navMs`, счётчики и backend; HUD дополнительно показывает живую
строку profiler'а (`hud` в snapshot). Числа — нативные замеры на текущей
машине; тест `tests/agent/re2d_bench_lab_test.py` печатает их для протокола.
