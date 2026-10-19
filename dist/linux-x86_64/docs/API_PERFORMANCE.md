# Производительность компонентов `$` API

Отдельный периодический стенд. Он **не входит** в обычный прогон тестов или CI.
Это базовая линия конкретной машины, не обещание FPS на другом оборудовании.

## Машина и сборка

| Условие | Значение |
|---|---|
| Дата UTC | 2026-10-12T06:14:43.139473+00:00 |
| ОС / архитектура | macOS-27.0.1-arm64-arm-64bit / arm64 |
| Компьютер / CPU | Mac mini Mac16,10 / Apple M4 |
| RAM / logical CPU | 17179869184 bytes / 10 |
| GPU | `[{"spdisplays_vendor": "sppci_vendor_Apple", "sppci_model": "Apple M4"}]` |
| GPU backend | metal |
| Питание | Now drawing from 'AC Power' |
| Binary version / SHA256 | 0.1.30 / `aee16b21de980d728950bfdd17874b219690c5f79f25092355f43cf4e664a52f` |
| HEAD / dirty | `da2d27390d2dc0e1f38a3a83e8ed6a0c08976f06` / True |
| Build | `{"CMAKE_BUILD_TYPE:STRING": "Release", "CMAKE_C_COMPILER:FILEPATH": "/usr/bin/cc", "CMAKE_C_FLAGS_RELEASE:STRING": "-O3 -DNDEBUG", "R2D_BUNDLED_FREETYPE:BOOL": "OFF", "R2D_EMBED_DIR:STRING": "game", "R2D_EMBED_SCRIPTS:BOOL": "OFF", "R2D_ENABLE_AUDIO:BOOL": "ON", "R2D_ENABLE_HOTRELOAD:BOOL": "ON", "R2D_ENABLE_HTTP:BOOL": "ON", "R2D_ENABLE_LIVE_SHADERS:BOOL": "ON", "R2D_ENABLE_NET:BOOL": "ON", "R2D_ENABLE_RMLUI:BOOL": "ON", "R2D_ENABLE_STEAM_AUDIO:BOOL": "ON", "R2D_HELP_LLAMA:BOOL": "OFF", "R2D_HELP_MODEL:FILEPATH": "", "R2D_JS_LEAK_DEBUG:BOOL": "ON", "R2D_PAYLOAD_FILE:FILEPATH": "", "R2D_SANITIZE:BOOL": "OFF", "R2D_SHADERS_WGSL_ONLY:BOOL": "OFF", "R2D_STEAM_AUDIO_SDK:PATH": "/Volumes/SSD NVME/nikiniki2d/build/_deps/steam-audio-sdk/steamaudio", "R2D_VISIBILITY_INCLUDE_DIR:INTERNAL": "/Volumes/SSD NVME/nikiniki2d/build/_deps/visibility-src"}` |
| Разрешение / режим | 1280×720, headless, fixed dt 1/60, seed 17 |
| Прогрев / frame window / повторов | 40 / 120 кадров / 7 |
| Таймер micro | $.time.perfNow, monotonic native clock; target 20 ms на batch |

Полные compiler flags, dirty paths, environment, список фоновых процессов и сырые
результаты сохранены в JSON (базовая линия: `docs/benchmarks/api-performance.json`). Тест не останавливает чужие процессы.
На фоне тяжёлой сборки/нагрузки замер следует повторить.

## Охват и методика

Режим: полный sweep
В дереве 79 high-level модулей. Micro workloads: 76; frame workloads: 20.
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
| core, api — CSS class selection over N nodes | 128 | 7.639 | 7.783 | — |
| sprite — Position/alpha/pivot on one cached node | 128 | 1.328 | 1.364 | — |
| signal — Emit to N listeners | 128 | 31.316 | 31.670 | — |
| mathx — Vector normalize + interpolation | 128 | 0.377 | 0.394 | — |
| random — Seeded noise2D + weighted selection | 128 | 1.090 | 1.112 | — |
| csv — Parse N-row CSV | 128 | 151.738 | 154.118 | — |
| grid — Flood fill 16x16 | 256 | 71.133 | 74.091 | — |
| curve — Evaluate cubic curve and gradient | 128 | 1.904 | 2.313 | — |
| state — FSM send with two real transitions | 128 | 6.356 | 6.568 | — |
| store — Set/read one key in N-entry memory store | 128 | 0.223 | 0.249 | — |
| i18n — Lookup + parameter substitution | 128 | 2.984 | 3.043 | — |
| collision — Named layer mask resolution | 128 | 3.669 | 3.718 | — |
| input — Bound action state and axis query | 128 | 8.811 | 9.370 | — |
| time — Create/cancel timer without frame advance | 128 | 0.919 | 0.946 | — |
| camera — Transform screen/world coordinates | 128 | 0.736 | 0.818 | — |
| viewports — Resolve secondary camera data | 128 | 5.705 | 5.721 | — |
| window — Read window size and pixel size | 128 | 0.636 | 0.680 | — |
| agent — Snapshot of N entities | 128 | 194.255 | 195.625 | — |
| debug — Collect counters over N nodes | 128 | 20.946 | 21.453 | — |
| watch — Create/stop live selection watch | 128 | 19.021 | 20.016 | — |
| prefab — Serialize subtree to inspectable data | 128 | 11.760 | 11.847 | — |
| save — Build store/world snapshot, no disk I/O | 128 | 1432.617 | 1512.480 | — |
| resource — Get resident Curve resource | 128 | 0.712 | 0.723 | — |
| scene — Register/remove scene description | 128 | 0.410 | 0.425 | — |
| script — Read native reload state, no restart | 128 | 0.176 | 0.193 | — |
| font — Measure cached Cyrillic string | 128 | 3.024 | 3.041 | — |
| text — Measure alternating Cyrillic strings | 128 | 0.615 | 0.661 | — |
| ui — RmlUi DOM text write/read | 128 | 0.425 | 0.430 | — |
| devtools — Refresh real RmlUi inspector over N nodes | 128 | 257.169 | 261.168 | — |
| widgets — Legacy virtual list range of N items | 128 | 2.061 | 2.267 | — |
| layers — Resolve layer/parallax | 128 | 0.779 | 0.851 | — |
| anim — Lookup defined sprite animation clip | 128 | 0.092 | 0.103 | — |
| animplayer — Seek actual property-track player | 128 | 4.751 | 4.815 | — |
| tween — Create/kill property Tween | 128 | 3.247 | 3.343 | — |
| flow — Create/cancel delayed flow | 128 | 7.204 | 7.686 | — |
| task — Create/cancel chunked task | 128 | 3.709 | 10.456 | — |
| nav — A* through 32x32 grid | 1024 | 17.751 | 18.495 | — |
| bsp — Native BSP order of N parallel walls | 128 | 93.117 | 93.904 | — |
| world — Native broadphase circle query over N bodies | 128 | 80.787 | 85.909 | — |
| triggers — Test node within real trigger zone | 128 | 0.745 | 0.770 | — |
| pool — Spawn/release reusable object | 16 | 3.349 | 3.543 | — |
| particles — Particle preset normalization | 128 | 5.270 | 5.291 | — |
| tilemap — Coordinate conversion + visible range | 256 | 1.893 | 1.901 | — |
| atlas — Parse N frame Aseprite atlas in memory | 128 | 274.840 | 304.847 | — |
| items — Inventory definition lookup + creation | 128 | 0.138 | 0.144 | — |
| weapons — Weapon stats resolution | 128 | 0.142 | 0.204 | — |
| combat — Damage/zone calculation | 128 | 0.233 | 0.242 | — |
| alive — Update real NPC psyche | 128 | 1.434 | 1.451 | — |
| quest — Quest definition lookup | 128 | 0.119 | 0.119 | — |
| story, story_script — Parse N dialogue steps | 128 | 461.434 | 467.121 | — |
| dialog — Dialogue definition serialization | 128 | 0.268 | 0.270 | — |
| screen — Legacy screen define/remove, no new GUI | 128 | 0.650 | 0.653 | — |
| loading — Loading progress state | 128 | 0.114 | 0.178 | — |
| timeline — Timeline definition registration | 128 | 1.754 | 1.786 | — |
| cutscene — Read input ownership and cutscene state | 128 | 0.121 | 0.167 | — |
| cels — Evaluate real cel graph drivers | 128 | 2.091 | 2.129 | — |
| mesh — Pose two-bone skeleton | 2 | 1.806 | 1.832 | — |
| proc — Render 32x32 pixel character with seed | 1024 | 1470.792 | 1505.129 | — |
| raid — Generate deterministic raid plan | 32768 | 9.664 | 10.900 | — |
| replay — Serialize deterministic recorded input frames | 128 | 21.782 | 23.021 | — |
| acoustics — Resolve current room/zone state | 128 | 5.746 | 5.855 | — |
| audiobus — Resolve gain through bus tree | 128 | 1.076 | 1.079 | — |
| soundbank — Bank variation lookup | 128 | 0.363 | 0.369 | — |
| steps — Resolve footstep material | 128 | 0.387 | 0.394 | — |
| sound — Native sound play/stop | 128 | 35.371 | 38.213 | — |
| net — Pack replicated snapshot without external transport | 128 | 182.380 | 185.499 | — |
| re2d — Native height support over 2 vertical spans | 2 | 1.152 | 1.164 | — |
| real2d — Real2D v4: synthesize head frame at a changing yaw from the .r2d4 container | 1 | 4879.732 | 5100.562 | — |
| rotsprite — Native Re2DSprite synthesize changing pose | 1 | 4665.911 | 4925.951 | — |
| kinds — Change node kind and resolve | 128 | 0.444 | 0.447 | — |
| ru — Russian tag/name alias creation and removal | 128 | 5.162 | 5.204 | — |
| viewport — Native target create/destroy, 32x32 | 1024 | 5.595 | 5.801 | — |
| fx — Build ribbon and clear bounded effect registry | 3 | 5.312 | 5.378 | — |
| depth — Toggle native depth mode; not GPU fill rate | 1 | 0.159 | 0.162 | — |
| http — HTTP capability/pending query only; no network transfer | 1 | 0.193 | 0.195 | — |
| sdk — Native tool paths/availability only; no bake/process throughput | 1 | 8.702 | 8.968 | — |

## Практические кадровые нагрузки

| Сценарий | N | Логика ms | Батч ms | CPU вместе ms | P95 окон ms | Box2D ms |
|---|---:|---:|---:|---:|---:|---:|
| none | 0 | 0.145 | 0.031 | 0.176 | 0.373 | 0.007 |
| sprite | 100 | 0.190 | 0.075 | 0.264 | 0.366 | 0.007 |
| sprite | 1000 | 0.642 | 0.529 | 1.171 | 1.561 | 0.009 |
| sprite | 2000 | 0.716 | 0.672 | 1.388 | 1.807 | 0.007 |
| body | 100 | 0.287 | 0.087 | 0.374 | 0.559 | 0.031 |
| body | 1000 | 0.935 | 0.319 | 1.240 | 1.631 | 0.128 |
| query | 1000 | 0.973 | 0.352 | 1.331 | 1.609 | 0.007 |
| cached | 1000 | 0.607 | 0.432 | 1.040 | 1.491 | 0.008 |
| id | 1000 | 0.686 | 0.606 | 1.292 | 1.470 | 0.009 |
| tween | 1000 | 1.421 | 0.313 | 1.734 | 2.151 | 0.006 |
| move | 1000 | 0.936 | 0.425 | 1.338 | 1.906 | 0.008 |
| particles | 1000 | 0.551 | 0.202 | 0.753 | 0.982 | 0.008 |
| ui | 100 | 0.333 | 0.146 | 0.479 | 0.711 | 0.009 |
| text | 100 | 0.282 | 0.186 | 0.468 | 0.567 | 0.009 |
| tilemap | 10000 | 0.193 | 0.593 | 0.786 | 1.181 | 0.008 |
| signal | 1000 | 1.558 | 0.312 | 1.890 | 2.137 | 0.007 |
| chain | 1000 | 0.733 | 0.385 | 1.086 | 1.910 | 0.007 |
| fast | 1000 | 1.321 | 0.866 | 2.187 | 2.401 | 0.014 |
| churn | 1000 | 2.327 | 0.409 | 2.662 | 2.906 | 0.007 |
| batch | 1000 | 2.009 | 0.404 | 2.413 | 3.419 | 0.006 |

## Инфраструктура / ограничения охвата

- `bootstrap`: process startup (wall clock, includes IPC).
- `index`: process startup (module installation).
- `native`: shared native bridge; included in native/frame workloads.
- `render`: frame scenarios: batch collection and native renderer.

Неописанные новые модули: нет.
GPU fill-rate, реальная сеть/HTTP, дисковая запись, full SDK bake, audio output latency
и все сцены каждой игры не покрываются micro таблицей. Audio использует SDL dummy.
Re2DSprite row измеряет native synthesize pose на малом animal fixture; Real2D v4 row — синтез кадра головы на реальном контейнере
demos/real2d/assets/head_real2d_v4.r2d4 (полное тело и pitch — отдельные стадии, тут не меряются); full World/VRM требует отдельных
стендов (например `tools/bench_re2d_world.py`), не подменяется этой цифрой.

## Батчинг и тесты

Измеренный batching probe: `{"scene": "sprite:1000", "sprites": 1000, "draw_calls": 1, "calls_per_sprite": 0.001, "resolution": [1280, 720]}`.
В дереве 126 агентских наборов; их наличие не означает, что этот скрипт их запускает.
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
