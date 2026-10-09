# Производительность компонентов `$` API

Отдельный периодический стенд. Он **не входит** в обычный прогон тестов или CI.
Это базовая линия конкретной машины, не обещание FPS на другом оборудовании.

## Машина и сборка

| Условие | Значение |
|---|---|
| Дата UTC | 2026-10-08T20:13:09.286389+00:00 |
| ОС / архитектура | macOS-27.0.1-arm64-arm-64bit-Mach-O / arm64 |
| Компьютер / CPU | Mac mini Mac16,10 / Apple M4 |
| RAM / logical CPU | 17179869184 bytes / 10 |
| GPU | `[{"spdisplays_vendor": "sppci_vendor_Apple", "sppci_model": "Apple M4"}]` |
| GPU backend | metal |
| Питание | Now drawing from 'AC Power' |
| Binary version / SHA256 | 0.1.23 / `4ea6a438ecaa1dd693c9cc77c7bd59aa6687ea2d2032b5dc9d151e94bea219a1` |
| HEAD / dirty | `5710fcfaa81b85516a7c947208a3a5ba61b904a6` / True |
| Build | `{"CMAKE_BUILD_TYPE:STRING": "Release", "CMAKE_C_COMPILER:FILEPATH": "/usr/bin/cc", "CMAKE_C_FLAGS_RELEASE:STRING": "-O3 -DNDEBUG", "R2D_EMBED_DIR:STRING": "game", "R2D_EMBED_SCRIPTS:BOOL": "OFF", "R2D_ENABLE_AUDIO:BOOL": "ON", "R2D_ENABLE_HOTRELOAD:BOOL": "ON", "R2D_ENABLE_HTTP:BOOL": "ON", "R2D_ENABLE_IMGUI:BOOL": "ON", "R2D_ENABLE_LIVE_SHADERS:BOOL": "ON", "R2D_ENABLE_NET:BOOL": "ON", "R2D_ENABLE_RMLUI:BOOL": "ON", "R2D_JS_LEAK_DEBUG:BOOL": "OFF", "R2D_PAYLOAD_FILE:FILEPATH": "", "R2D_SANITIZE:BOOL": "OFF", "R2D_SHADERS_WGSL_ONLY:BOOL": "OFF", "R2D_VISIBILITY_INCLUDE_DIR:INTERNAL": "/Volumes/SSD NVME/nikiniki2d/build-autobuild/macos-arm64/_deps/visibility-src"}` |
| Разрешение / режим | 1280×720, headless, fixed dt 1/60, seed 17 |
| Прогрев / frame window / повторов | 40 / 120 кадров / 7 |
| Таймер micro | $.time.perfNow, monotonic native clock; target 20 ms на batch |

Полные compiler flags, dirty paths, environment, список фоновых процессов и сырые
результаты сохранены в JSON (базовая линия: `docs/benchmarks/api-performance.json`). Тест не останавливает чужие процессы.
На фоне тяжёлой сборки/нагрузки замер следует повторить.

## Охват и методика

Режим: полный sweep
В дереве 78 high-level модулей. Micro workloads: 75; frame workloads: 20.
Таблица указывает конкретную операцию: это представительные нагрузки компонентов,
**не замер каждого метода и каждой комбинации опций**. HTTP/SDK control rows
меряют только overhead capability/path queries, не сеть, импорт или компиляцию.
Micro timer исключает запуск процесса, подготовку и IPC; µs — время одной
описанной операции (часто над N объектами), включая вызов callback и checksum.
P95 в micro — percentile средних по повторным batches, не latency каждой операции.
Frame CPU — native profiler averages по окну; P95 — разброс окон, не отдельных кадров.
Обе метрики зависят от сборки, частоты CPU и фоновой нагрузки.

| Компонент / нагрузка | N | Median µs/op | P95 µs/op | Δ baseline |
|---|---:|---:|---:|---:|
| core, api — CSS class selection over N nodes | 128 | 8.628 | 8.831 | — |
| sprite — Position/alpha/pivot on one cached node | 128 | 1.664 | 1.682 | — |
| signal — Emit to N listeners | 128 | 39.170 | 39.404 | — |
| mathx — Vector normalize + interpolation | 128 | 0.437 | 0.453 | — |
| random — Seeded noise2D + weighted selection | 128 | 1.142 | 1.152 | — |
| csv — Parse N-row CSV | 128 | 187.705 | 213.919 | — |
| grid — Flood fill 16x16 | 256 | 78.679 | 82.324 | — |
| curve — Evaluate cubic curve and gradient | 128 | 2.126 | 2.156 | — |
| state — FSM send with two real transitions | 128 | 7.892 | 7.967 | — |
| store — Set/read one key in N-entry memory store | 128 | 0.221 | 0.337 | — |
| i18n — Lookup + parameter substitution | 128 | 3.707 | 3.748 | — |
| collision — Named layer mask resolution | 128 | 4.739 | 4.782 | — |
| input — Bound action state and axis query | 128 | 10.937 | 11.043 | — |
| time — Create/cancel timer without frame advance | 128 | 1.197 | 1.213 | — |
| camera — Transform screen/world coordinates | 128 | 0.954 | 0.978 | — |
| viewports — Resolve secondary camera data | 128 | 6.968 | 7.011 | — |
| window — Read window size and pixel size | 128 | 0.807 | 0.834 | — |
| agent — Snapshot of N entities | 128 | 237.458 | 238.562 | — |
| debug — Collect counters over N nodes | 128 | 24.869 | 25.530 | — |
| watch — Create/stop live selection watch | 128 | 21.418 | 22.406 | — |
| prefab — Serialize subtree to inspectable data | 128 | 14.452 | 14.592 | — |
| save — Build store/world snapshot, no disk I/O | 128 | 1771.924 | 1787.871 | — |
| resource — Get resident Curve resource | 128 | 0.832 | 0.857 | — |
| scene — Register/remove scene description | 128 | 0.490 | 0.500 | — |
| script — Read native reload state, no restart | 128 | 0.259 | 0.359 | — |
| font — Measure cached Cyrillic string | 128 | 3.728 | 3.766 | — |
| text — Measure alternating Cyrillic strings | 128 | 0.719 | 0.731 | — |
| ui — RmlUi DOM text write/read | 128 | 0.458 | 0.479 | — |
| devtools — Refresh real RmlUi inspector over N nodes | 128 | 300.474 | 305.732 | — |
| widgets — Legacy virtual list range of N items | 128 | 2.360 | 2.382 | — |
| layers — Resolve layer/parallax | 128 | 0.896 | 0.908 | — |
| anim — Lookup defined sprite animation clip | 128 | 0.222 | 0.255 | — |
| animplayer — Seek actual property-track player | 128 | 5.734 | 5.762 | — |
| tween — Create/kill property Tween | 128 | 3.624 | 3.742 | — |
| flow — Create/cancel delayed flow | 128 | 7.810 | 8.319 | — |
| task — Create/cancel chunked task | 128 | 4.699 | 10.418 | — |
| nav — A* through 32x32 grid | 1024 | 21.191 | 21.532 | — |
| bsp — Native BSP order of N parallel walls | 128 | 118.743 | 119.713 | — |
| world — Native broadphase circle query over N bodies | 128 | 99.653 | 101.418 | — |
| triggers — Test node within real trigger zone | 128 | 0.797 | 0.800 | — |
| pool — Spawn/release reusable object | 16 | 4.233 | 4.261 | — |
| particles — Particle preset normalization | 128 | 6.790 | 6.843 | — |
| tilemap — Coordinate conversion + visible range | 256 | 2.364 | 2.444 | — |
| atlas — Parse N frame Aseprite atlas in memory | 128 | 326.562 | 328.098 | — |
| items — Inventory definition lookup + creation | 128 | 0.285 | 0.322 | — |
| weapons — Weapon stats resolution | 128 | 0.143 | 0.307 | — |
| combat — Damage/zone calculation | 128 | 0.267 | 0.292 | — |
| alive — Update real NPC psyche | 128 | 1.606 | 1.623 | — |
| quest — Quest definition lookup | 128 | 0.130 | 0.317 | — |
| story, story_script — Parse N dialogue steps | 128 | 578.624 | 587.742 | — |
| dialog — Dialogue definition serialization | 128 | 0.330 | 0.373 | — |
| screen — Legacy screen define/remove, no new GUI | 128 | 0.851 | 0.861 | — |
| loading — Loading progress state | 128 | 0.243 | 0.289 | — |
| timeline — Timeline definition registration | 128 | 1.693 | 1.784 | — |
| cutscene — Read input ownership and cutscene state | 128 | 0.187 | 0.284 | — |
| cels — Evaluate real cel graph drivers | 128 | 2.534 | 2.538 | — |
| mesh — Pose two-bone skeleton | 2 | 2.189 | 2.197 | — |
| proc — Render 32x32 pixel character with seed | 1024 | 1718.417 | 1745.742 | — |
| raid — Generate deterministic raid plan | 32768 | 11.984 | 12.710 | — |
| replay — Serialize deterministic recorded input frames | 128 | 27.897 | 28.858 | — |
| acoustics — Resolve current room/zone state | 128 | 6.958 | 7.003 | — |
| audiobus — Resolve gain through bus tree | 128 | 1.364 | 1.389 | — |
| soundbank — Bank variation lookup | 128 | 0.436 | 0.451 | — |
| steps — Resolve footstep material | 128 | 0.467 | 0.472 | — |
| sound — Native sound play/stop | 128 | 39.607 | 40.800 | — |
| net — Pack replicated snapshot without external transport | 128 | 209.461 | 211.242 | — |
| re2d — Native height support over 2 vertical spans | 2 | 1.509 | 1.697 | — |
| rotsprite — Native Re2DSprite synthesize changing pose | 1 | 4040.302 | 4210.907 | — |
| kinds — Change node kind and resolve | 128 | 0.509 | 0.524 | — |
| ru — Russian tag/name alias creation and removal | 128 | 6.108 | 6.336 | — |
| viewport — Native target create/destroy, 32x32 | 1024 | 6.591 | 6.778 | — |
| fx — Build ribbon and clear bounded effect registry | 3 | 7.077 | 7.155 | — |
| depth — Toggle native depth mode; not GPU fill rate | 1 | 0.176 | 0.324 | — |
| http — HTTP capability/pending query only; no network transfer | 1 | 0.218 | 0.327 | — |
| sdk — Native tool paths/availability only; no bake/process throughput | 1 | 10.565 | 10.640 | — |

## Практические кадровые нагрузки

| Сценарий | N | Логика ms | Батч ms | CPU вместе ms | P95 окон ms | Box2D ms |
|---|---:|---:|---:|---:|---:|---:|
| none | 0 | 0.247 | 0.061 | 0.312 | 0.331 | 0.012 |
| sprite | 100 | 0.291 | 0.133 | 0.423 | 0.444 | 0.012 |
| sprite | 1000 | 0.744 | 0.777 | 1.513 | 1.552 | 0.012 |
| sprite | 2000 | 1.181 | 1.394 | 2.575 | 2.797 | 0.011 |
| body | 100 | 0.422 | 0.134 | 0.555 | 0.574 | 0.047 |
| body | 1000 | 1.831 | 0.520 | 2.350 | 2.632 | 0.221 |
| query | 1000 | 2.041 | 0.548 | 2.574 | 2.955 | 0.009 |
| cached | 1000 | 0.920 | 0.806 | 1.711 | 1.854 | 0.013 |
| id | 1000 | 0.761 | 0.739 | 1.519 | 1.602 | 0.012 |
| tween | 1000 | 2.184 | 0.359 | 2.547 | 2.712 | 0.007 |
| move | 1000 | 1.239 | 0.703 | 1.940 | 2.053 | 0.011 |
| particles | 1000 | 0.902 | 0.326 | 1.235 | 1.391 | 0.012 |
| ui | 100 | 0.499 | 0.295 | 0.806 | 0.846 | 0.013 |
| text | 100 | 0.298 | 0.299 | 0.598 | 0.619 | 0.013 |
| tilemap | 10000 | 0.256 | 1.130 | 1.385 | 1.480 | 0.012 |
| signal | 1000 | 2.251 | 0.320 | 2.582 | 2.644 | 0.006 |
| chain | 1000 | 1.172 | 0.702 | 1.874 | 2.056 | 0.011 |
| fast | 1000 | 1.111 | 0.789 | 1.901 | 2.022 | 0.012 |
| churn | 1000 | 2.319 | 0.322 | 2.645 | 2.753 | 0.006 |
| batch | 1000 | 2.324 | 0.320 | 2.643 | 2.743 | 0.006 |

## Инфраструктура / ограничения охвата

- `bootstrap`: process startup (wall clock, includes IPC).
- `index`: process startup (module installation).
- `native`: shared native bridge; included in native/frame workloads.
- `render`: frame scenarios: batch collection and native renderer.

Неописанные новые модули: нет.
GPU fill-rate, реальная сеть/HTTP, дисковая запись, full SDK bake, audio output latency
и все сцены каждой игры не покрываются micro таблицей. Audio использует SDL dummy.
Re2DSprite row измеряет native synthesize pose на малом animal fixture; full World/VRM требует отдельных
стендов (например `tools/bench_re2d_world.py`), не подменяется этой цифрой.

## Батчинг и тесты

Измеренный batching probe: `{"scene": "sprite:1000", "sprites": 1000, "draw_calls": 1, "calls_per_sprite": 0.001, "resolution": [1280, 720]}`.
В дереве 106 агентских наборов; их наличие не означает, что этот скрипт их запускает.
draw calls / sprite зависит от текстур, порядка, blend и clipping. Probe — одна
текстура, без смены blend/clip. Это не постоянная стоимость произвольной сцены.

## Повторный запуск и сравнение

```bash
python3 tools/bench_api.py
python3 tools/bench_api.py --baseline docs/benchmarks/api-performance.json --json build/bench_api_next.json --md docs/API_PERFORMANCE.md
```

Сравнение: `{"status": "no baseline", "regressions": []}`.
Одинаковыми должны быть hardware/OS/build flags/backend/workload/parameters.
Binary SHA и commit записываются, но могут отличаться: именно новые сборки сравниваются.
По умолчанию подозрение на деградацию: >20% и >0.5 µs/op (micro) / >0.1 ms (frame).
Exit 0 — измерения успешны, 1 — ошибка/неописанный модуль, 2 — неверные параметры,
3 — найдены регрессии, 4 — baseline несопоставим. Один шумный результат требует повторения.
JSON сохранить вне build, если он должен пережить очистку сборочных артефактов.
