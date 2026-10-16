# Russiano2D — Production Polish & Developer Experience Plan

**Статус:** рабочее инженерное ТЗ  
**Базовая версия:** `v0.1.33`  
**Цель следующей контрольной точки:** стабильная production-ready ревизия движка с зелёным CI, замороженными базовыми контрактами и полноценными встроенными средствами разработки.

> Спецификация приложена к репозиторию целиком, как и предыдущие раунды
> (`PRODUCTION_READINESS.md`, `PRODUCTION_PLAN.md`): по ней проверяется
> состояние работ, а не по памяти.

---

## 0. Состояние выполнения

| PASS | Что закрывает | Состояние |
|---|---|---|
| 1 | CI/CD и переносимость (§4) | **Закрыт**: Linux x86_64/aarch64 и Windows x86_64 собираются hosted-раннерами, тесты и контракт упаковки проходят (прогон 38862722918). Windows собирается кросс-сборкой MinGW, потому что MSVC 14.44 падает внутренней ошибкой CL.exe; наблюдение за MSVC осталось необязательной задачей. Владение сборками и релизами закрыто, включая пайплайны Mos.Hub и GitVerse |
| 2 | Базовые контракты (§5–§15) | в работе: ошибки контрактов исправлены, покрытие выросло, список остатка ниже |
| 3 | Фундамент DevTools (§17, §18, §19, §20, §21) | вкладки, сводка PERF, график кадра, hitch-детектор, ENTITY 2.0 и world picking сделаны и покрыты тестами; остались инспекторы из PASS 4 |
| 4 | Специализированные инспекторы (§25–§29, §34–§37) | бэкенд физики/рендера/света готов (`engine.devtools.*`, `renderInfo()`); вкладки PHYSICS/RENDER/AUDIO/INPUT/ASSETS ещё не собраны |
| 5 | Runtime polish (§40–§52) | в работе: время/камера/частицы/render target (runtime-core), аудио/материалы/шейдеры/атласы/reload (runtime-assets); §52 lifetime stress и §23 журнал событий закрыты |
| 6 | Уборка (§59–§62) | не начат |
| 7 | Заморозка и выпуск (§63, §66) | не начат |

**Где живут релизы.** GitHub Actions собирает Windows/Linux и создаёт GitHub
Release; `.gitlab-ci.yml` (Mos.Hub, раннер `appsechub`) и
`.gitverse/workflows/build.yaml` (GitVerse) собирают Linux и Windows (MinGW) и
создают релизы на своих хостингах, а macOS **не собирают** — забирают готовые
архивы нужной версии из витрины `dist/`. Локальный Mac собирает только macOS.

### PASS 1 — что сделано

* **§4.1 `M_PI`.** Каноническая `R2D_PI`/`R2D_TAU` объявлена в `src/r2d.h`;
  `src/nodes.c` и `tests/audio/fx_test.c` больше не зависят от libc-константы.
* **§4.2 `strtok_r`.** Разбор тегов атласа идёт через локальный
  `sdk_next_field` (`sdk/native/sdk_atlas.c`); глобального `strtok` в
  генераторе встраивания тоже нет.
* **§4.3 VLA.** `src/render.c` использует константу времени компиляции;
  все 144 единицы трансляции собираются с `-Wvla -Werror=vla`.
* **Машинный гейт.** `tests/portability_test.py` проверяет все три пункта по
  исходникам (без комментариев и литералов) и входит в static-джобу CI.
* **§4.4 Linux SDK GUI.** Причина красного шага найдена и воспроизведена в
  контейнере с той же версией mesa: (1) mesa 25.2.8 lavapipe падает SIGSEGV
  внутри `vkCreateGraphicsPipelines` при прогретом дисковом кэше шейдеров —
  лечится `MESA_SHADER_CACHE_DISABLE=true` в шаге; (2) `screenshot` отвечал
  `ok:true`, не сохраняя файл (у скрытого окна на Vulkan SDL отдаёт NULL
  swapchain) — теперь причина называется, а запрос снимка в сессии SDK помечен
  `optional` и его отказ не валит сессию, но попадает в диагностику.
* **§4.5–§4.9 Владение сборками.** macOS убран из матрицы GitHub Actions;
  CI собирает Windows/Linux, считает суммы и создаёт единственный Release по
  тегу. Локальные скрипты собирают только macOS и релиз не создают;
  macOS-архивы прикладывает `tools/attach_macos_release.py`, витрину `dist/`
  наполняет `tools/fetch_release_assets.py`; владение проверяет
  `tests/release_ownership_test.py`.
* **Имена артефактов.** `release.archive_name()` — единый источник имени
  `russiano2d-v<версия>-<платформа>.<ext>`; старые имена убираются
  `release.prune_stale_archives()`, контракт проверяется в `ci_package.py`.
* **Воспроизводимость.** Шаг обновления документов пакета пересобирает архив
  тем же кодом, что и релиз (`release.write_archive`), а не `make_archive`.
* **macOS-приёмка.** Чистая сборка (RE2D ON и OFF) + `ci_verify` в обеих
  конфигурациях + web-шаг + пакеты обоих архитектур +
  `tests/macos_package_smoke_test.py` (VERSION, суммы, `--version`,
  `r2d-sdk version`, headless-прогон 30 кадров; x86_64 — через Rosetta).
* **Остаток по Windows.** Сборка MSVC упирается во внутреннюю ошибку CL.exe на
  исходниках RmlUi Debugger (не в наш код, появилась между v0.1.31 и v0.1.32).
  Обход: `/Zf` и `/Od` для целей RmlUi, `--parallel 2` в CI; подтверждается
  прогоном CI.

### PASS 2 — что сделано

* **§5.1 `solidAt` — исправлена реальная ошибка контракта.** Для карты без
  таблицы `tiles` (`solid: true`) `solidAt` отвечал `false` всегда, хотя тела
  физика строила: сетка, навигация и occluder видели проходимую карту там, где
  стояли тела. Теперь legacy-слой отвечает по своему предикату, `solid: false`
  выключает слой целиком. Регрессии — `tests/js/tilemap_test.mjs` (проверено,
  что тест краснеет на старой версии); поведение вне карты задокументировано в
  `docs/highlevel/tilemap.md`.
* **§5.2 round-trip.** Матрица tile↔pixel: тайлы 16/32/128 × origin 0/≠0 ×
  клетки (0,0),(1,1),(2,2),(−1,0),(0,−1),(−5,7) плюс края клетки.
* **§10 presentation RNG.** Снимок для слота больше не содержит
  презентационных потоков; список живёт в `random.js` и читается и реплеем, и
  сейвом. Тест — `tests/agent/highlevel_save_presentation_test.py`.
* **§10 области актёра.** Области (геометрия, роли, фильтры, `enabled`,
  владелец по `nid`) сохраняются вместе с узлом и восстанавливаются после
  загрузки мира; `save → load → save` не «плывёт». Тест —
  `tests/agent/highlevel_save_areas_test.py`.
* **§11 RNG-изоляция.** Косметика (частицы, тряска) не сдвигает ни `$.random`,
  ни поток `generation`, а `presentation` ведёт себя независимо; отдельно
  исправлено: генератор эффектов засеян зерном сессии (раньше — константой),
  `$.camera.shake(0, 0)` теперь публичный «стоп». Тест —
  `tests/agent/highlevel_rng_isolation_test.py` (с экспериментом «намеренно
  сломали — тест покраснел»).
* **§15 подавление повторов.** У записи есть `repeats`, строка журнала несёт
  «repeated xN», сводка отдаёт `repeated` по сообщениям — молчаливого
  исчезновения больше нет.
* **Новое покрытие §6–§10** — список файлов в конце раздела.

### PASS 2 — что осталось

* **§6.3 трение.** Актёр под управлением, стоящий на склоне 30°, с трением по
  умолчанию сползает вниз ровно и бесконечно: 11 px за 120 кадров (5.5 px/s),
  одинаково в каждом следующем окне — тело не засыпает, потому что
  контроллер переписывает скорость каждый кадр. С `friction: 1.0` — 1.01 px.
  Спецификация требует «не сползать бесконечно» — нужна правка интеграции
  контроллера/трения. Поймает проверка: ужесточить порог в
  `highlevel_physics_slopes_test.py` с 20 px до 1 px.
* **§6.1 `segment`/`chain`.** Публичного API таких форм нет (только
  box/circle/capsule/polygon) — пункт неприменим, зафиксировать явно.
* **§5.3 chunk boundaries.** Чанкового тайлпампа в движке нет — пункт
  неприменим, это нужно зафиксировать явно.
* **§8.2** выгрузка проверена по узлам/телам/подпискам/таймерам/реестру
  occluders и 30 кадрам тишины событий, но НЕ по аудио-голосам, источникам
  света, эмиттерам частиц, зарегистрированным колбэкам и мёртвым JS-обёрткам —
  нужен добивочный тест по каждому списку.
* **§12 треки** `scale`, `enum`, `audio.gain` — не покрыты тестами дорожек.
* **§13 hot-plug** геймпада (disconnect → reconnect → перепривязка) не покрыт.
* **§14** отсутствующие модули/циклы импорта и мост «нативный diag → JS» не
  покрыты.
* **§15 `jsonPath`** не покрыт тестом.

### PASS 2 — закрыто после первой ревизии

* **§6.6 `.attr({friction|density|restitution})` после создания тела** — теперь
  это не тишина: запись `R2D_ATTR_AFTER_BODY` в `$.debug.errors()` с атрибутом,
  значением и узлом (значение остаётся в attrs, его прочитает пересоздание
  тела). Тест `tests/agent/attr_after_body_test.py` проверяет оба пути.
* **§6.6 подъём сквозь one-way** — проба пола больше не считает опорой
  одностороннюю платформу, когда тело ниже её поверхности: прыжок в этот
  момент снова считается воздушным. Регрессия в
  `tests/agent/highlevel_physics_oneway_test.py`.
* **§10 состояние анимации** — сохраняется провайдером `anim.player` по
  стабильному nid (клип, время, скорость, loop, окна удара, маркеры), откат
  возвращает прежнюю цель; `data.scene` читается через `$.scene.adopt()` /
  `$.room.adopt()` без второго мира. Тесты `highlevel_save_anim_test.py`,
  `highlevel_save_scene_test.py`; `docs/highlevel/world.md` §6.
* **§7.3 несколько областей одного actor** и область как свойство узла —
  покрыто `highlevel_contact_area_payload_test.py`, `highlevel_area_rebuild_test.py`.
* **§52 lifetime stress** — 100 циклов по широкому списку ресурсов
  (`tests/agent/lifetime_stress_test.py`).
* **§23 журнал событий** — помимо боя и сцен пишутся звук и ввод (включая
  синтетический): `tests/agent/trace_producers_test.py`.

## PASS 2 — что осталось

* **§6.3 трение.** Актёр под управлением, стоящий на склоне 30°, с трением по
  умолчанию сползает вниз ровно и бесконечно: 11 px за 120 кадров (5.5 px/s),
  одинаково в каждом следующем окне — тело не засыпает, потому что
  контроллер переписывает скорость каждый кадр. С `friction: 1.0` — 1.01 px.
  Спецификация требует «не сползать бесконечно» — нужна правка интеграции
  контроллера/трения. Поймает проверка: ужесточить порог в
  `highlevel_physics_slopes_test.py` с 20 px до 1 px.
* **§6.1 `segment`/`chain`.** Публичного API таких форм нет (только
  box/circle/capsule/polygon) — пункт неприменим, зафиксировать явно.
* **§6.6 `.attr({friction|density|restitution})` после создания тела** — молча
  ничего не делает (трение читается один раз при создании, нативного сеттера
  нет). Измерено: тело с `friction: 1.0`, выставленным после создания,
  проезжает 124.4 px — ровно как с `friction: 0.0`. Нужен либо сеттер, либо
  видимая диагностика вместо тишины.
* **§6.6 подъём сквозь one-way.** Во время прохода вверх `onFloor()` истинно
  2 кадра, пока тело ещё внутри платформы: проба пола игнорирует направление
  и состояние пересечения, и нажатый в этот момент прыжок считается «на земле».
* **§5.3 chunk boundaries.** Чанкового тайлпампа в движке нет — пункт
  неприменим, это нужно зафиксировать явно.
* **§8.2** выгрузка проверена по узлам/телам/подпискам/таймерам/реестру
  occluders и 30 кадрам тишины событий, но НЕ по аудио-голосам, источникам
  света, эмиттерам, отложенным колбэкам и мёртвым JS-обёрткам — счётчиков для
  них в фикстуре нет.
* **§10** постоянное состояние анимации не сохраняется вовсе (моста save↔anim
  нет); идентичность сцены при загрузке сейва всё ещё не восстанавливается
  (сцена снимается при выгрузке комнаты, но `data.scene` по-прежнему не
  читается при load).
* **§12** треки `scale`, `enum`, `audio.gain` реализованы, но не прогоняются
  end-to-end; «прерывание атаки закрывает окно удара» проверено только в JS-наборе.
* **§13** hot-plug и disconnect/reconnect не покрыты, и у агентского протокола
  нет способа подключить/отключить виртуальный геймпад; rebinding проверяется
  только как таблица, а не как поведение.
* **§14** отсутствующие модули и циклы модулей не покрыты; ошибки загрузки
  модулей на стороне C не попадают в `$.debug.errors()`.
* **§15** `jsonPath` формируется атласом, но не проверяется тестом.

### PASS 2 — покрытие выросло (все тесты зелёные)

`tests/agent/`: `highlevel_physics_edge_test`, `highlevel_physics_slopes_test`,
`highlevel_physics_moving_test`, `highlevel_physics_oneway_test`,
`highlevel_physics_raycast_test`, `highlevel_contact_area_payload_test`,
`highlevel_area_rebuild_test`, `highlevel_frame_order_test`,
`highlevel_room_unload_test`, `highlevel_scene_transaction_test`,
`highlevel_rng_isolation_test`, `highlevel_save_areas_test`,
`highlevel_save_presentation_test`; `tests/js/tilemap_test.mjs` (round-trip §5.2).

---

## 0. Главная цель

На этом этапе **не переносить игры** и не строить новые game-specific системы.

Задача — довести Russiano2D до состояния, в котором на нём удобно и безопасно делать реальные 2D-игры каждый день:

- движок стабильно собирается на заявленных платформах;
- основные runtime-контракты проверены тестами;
- публичный `$` API не меняется без веской причины;
- DevTools позволяют отлаживать игру без бесконечных `printf`;
- профайлер показывает, куда уходит кадр;
- физику, рендер, аудио, input, ресурсы и события можно инспектировать в рантайме;
- ошибки структурированы и пригодны для CI;
- hot reload не разрушает валидное состояние;
- package/release pipeline воспроизводим;
- SDK остаётся специализированным tooling, а не превращается в новый Godot.

После выполнения этого документа нужно **остановить бесконечную разработку фундамента**, выпустить стабильную ревизию и использовать движок по назначению.

---

# 1. Неподвижные архитектурные правила

Эти решения **не пересматриваются** в рамках дополировки.

## 1.1. Никакого ECS

Архитектура остаётся вокруг существующей модели:

- `$`;
- node/tag/wrapper;
- prefab;
- room;
- scene;
- attrs;
- state;
- native runtime + QuickJS.

Не вводить:

- entity registry как новую параллельную модель;
- components;
- systems;
- archetypes;
- entity queries как отдельную архитектуру.

---

## 1.2. Никакого канонического визуального scene editor

Russiano2D остаётся code-first/data-first движком.

SDK и DevTools могут иметь специализированные инструменты:

- Sprite Studio;
- Animation;
- Tilemap;
- Collision;
- Audio;
- Input;
- RmlUi;
- DevTools;
- Automation;
- validation;
- preview.

Но они **не становятся источником истины проекта**.

---

## 1.3. RmlUi — единственный обычный UI DevTools

Не возвращать ImGui.

Обычные:

- окна;
- панели;
- таблицы;
- деревья;
- графики;
- вкладки;
- controls;

делаются через RmlUi.

Нативные custom elements разрешены для специализированной отрисовки:

- график профайлера;
- physics overlay preview;
- timeline;
- render-target preview;
- waveform;
- memory graph.

---

## 1.4. QuickJS остаётся скриптовым слоем

Не заменять его Lua/Python/другой VM.

Задача дополировки — сделать JS lifecycle, диагностику и hot reload надёжнее.

---

## 1.5. Не писать второй dialogue framework

Существующие:

- `$.timeline`;
- `$.cutscene`;
- `$.dialog`;
- RmlUi;

дополняются только интеграционно.

Не создавать отдельный Dialogic-клон.

---

## 1.6. Не переписывать renderer с нуля

Основной renderer остаётся SDL_GPU.

Дорабатывать:

- robustness;
- observability;
- debug views;
- resource lifetime;
- passes;
- profiling;
- post-processing contracts.

---

## 1.7. Не писать свою физику

Box2D остаётся физическим фундаментом.

Исправлять и тестировать integration layer Russiano2D.

---

## 1.8. RE2D не превращать в generic 3D engine

RE2D остаётся отдельной opt-in возможностью.

2D runtime остаётся главным.

Сборка:

`R2D_ENABLE_RE2D=OFF`

должна оставаться полноценным поддерживаемым 2D-профилем.

---

# 2. Что уже есть и что нельзя переписывать заново

Перед реализацией новой системы сначала проверить существующий код и документацию.

На текущей базе уже есть значительный фундамент.

## 2.1. DevTools

В репозитории уже существует первый срез DevTools:

- F1 — диагностика;
- F2 — inspector;
- RmlUi;
- список сущностей;
- выбор сущности;
- базовая инспекция;
- copy selector.

Существующий `docs/DEVTOOLS.md` считать исходной точкой.

---

## 2.2. Профилирование

Уже присутствуют:

- `$.debug.profile()`;
- `$.debug.profiler.*`;
- нативные profiler zones;
- GPU timing там, где реально измеряется;
- stress demos;
- `tools/bench_stress.py`.

Новый profiler UI должен использовать **эти данные**, а не создавать второй независимый profiler backend.

---

## 2.3. Debug API

Уже есть или частично есть:

- `$.debug.stats()`;
- `$.debug.counters()`;
- `$.debug.limits()`;
- `$.debug.draw.*`;
- `$.debug.watch()`;
- `$.debug.errors()`;
- `$.debug.report()`;
- `$.debug.reportError()`;
- `$.debug.expectClean()`;
- `$.trace`;
- `engine.depthInfo()`;
- `engine.fontStats()`;
- `engine.renderInfo()`.

Доработка должна объединить эти данные в удобный интерфейс.

---

## 2.4. Agent/introspection

Уже есть:

- `$.agent.snapshot()`;
- `$.agent.node(sel)`;
- `$.agent.nodes(sel)`;
- `$.agent.expose(name, fn)`;
- headless/agent protocol.

DevTools и Agent должны использовать **один introspection backend**.

Нельзя реализовать две несовместимые модели инспекции.

---

# 3. Критерий окончания этапа

Дополировка считается законченной только когда одновременно выполняются следующие условия.

## 3.1. Build / CI matrix

Политика сборок фиксируется явно:

- Windows x86_64 собирается **только GitHub-hosted runner'ом**;
- Linux x86_64 собирается **только GitHub-hosted runner'ом**;
- Linux ARM64, если он остаётся поддерживаемой целью, собирается **GitHub runner'ом**;
- macOS собирается **локально на рабочем Mac**, а не дублируется GitHub-hosted macOS runner'ом;
- `R2D_ENABLE_RE2D=ON` проверяется в соответствующих поддерживаемых профилях;
- `R2D_ENABLE_RE2D=OFF` проверяется как полноценная 2D-сборка.

Критерий готовности:

- Windows runner — GREEN;
- Linux runner'ы — GREEN;
- локальная macOS clean build — GREEN;
- macOS package smoke — GREEN;
- release pipeline — GREEN.

CI и локальная macOS-сборка не должны дублировать ответственность друг друга.

---

## 3.2. Tests

Проходят:

- native tests;
- JS tests;
- SDK tests;
- GUI regression tests;
- agent/headless tests;
- package tests;
- standalone smoke tests.

---

## 3.3. Runtime

Нет известных P0:

- crash;
- use-after-free;
- dangling JS wrapper;
- scene lifecycle corruption;
- physics corruption;
- resource lifetime leak;
- broken save/restore;
- deterministic RNG regression.

---

## 3.4. Tooling

Работают:

- F1 diagnostics;
- F2 entity inspector;
- profiler;
- physics debug;
- event trace;
- render inspector;
- audio inspector;
- input inspector;
- asset/hot-reload monitor;
- agent integration.

---

# 4. P0 — полностью зелёный CI

Текущая база `v0.1.33` не должна считаться стабильной до устранения известных CI-проблем.

---

## 4.1. Windows: portable PI constant

Не использовать голый `M_PI`, если его наличие зависит от libc/compiler.

Ввести один канонический вариант, например:

`R2D_PI`

или эквивалент в общем math header.

Проверить собственный код и собственные тесты.

### Acceptance

Поиск по проектному коду не показывает platform-dependent использования `M_PI`.

MSVC build проходит.

---

## 4.2. Windows: `strtok_r`

Не использовать POSIX-only API напрямую в portable SDK code.

Текущий известный проблемный участок — atlas parsing.

Предпочтительный вариант:

- небольшой собственный parser;
- либо общий portable helper.

Не использовать глобальный небезопасный `strtok`, если возможны вложенные вызовы.

### Acceptance

Нет unresolved `strtok_r` на MSVC.

---

## 4.3. Windows: VLA

Убрать variable-length arrays из portable C-кода.

Известный проблемный участок находится в renderer.

В зависимости от частоты вызова использовать:

- bounded stack buffer;
- persistent scratch;
- arena;
- heap;
- reusable frame buffer.

Не создавать лишнюю allocation per draw call.

### Acceptance

MSVC не выдаёт ошибок runtime-sized C arrays.

---

## 4.4. Linux SDK GUI regressions

Не скрывать падение через `continue-on-error`.

Изолированно прогнать:

- `sdk_cli_test.py`;
- `sdk_studios_test.py`;
- `sdk_package_test.py`;
- `build_test.py`;
- `ui_virtual_mouse_test.py`.

Найти первый настоящий failure.

Если проблема в Xvfb/CI environment — стабилизировать окружение.

### Acceptance

Linux x86_64 и ARM64 проходят SDK GUI regression suite.

---

## 4.5. macOS — локальная сборка на рабочем Mac

macOS больше не должен дублироваться GitHub-hosted runner'ом только ради того, чтобы повторять ту же работу, которая выполняется локально на целевой машине.

Политика:

- macOS engine build выполняется локально на рабочем Mac;
- macOS SDK build выполняется локально;
- macOS native/JS tests выполняются локально;
- macOS package собирается локально;
- результат должен проходить отдельный documented smoke/acceptance step;
- локальная macOS-сборка остаётся частью release acceptance, даже если GitHub Actions сам macOS не компилирует.

Если поддерживается только Apple Silicon — зафиксировать это явно.

Если требуется Intel macOS — проверять его отдельным реально доступным способом, но не оставлять формальную красную матрицу, которую проект не собирается обслуживать.

---

## 4.6. Build ownership policy

С этого момента ответственность за сборки разделена жёстко.

### GitHub Actions / GitHub runners

GitHub CI/CD отвечает за:

- Windows build;
- Windows tests;
- Windows package;
- Linux build;
- Linux tests;
- Linux package;
- checksums;
- release metadata;
- release artifact preparation;
- автоматическое создание GitHub Release по version tag.

### Локальный Mac

Локальная машина отвечает за:

- macOS build;
- macOS tests;
- macOS package;
- проверку Metal/macOS runtime;
- подготовку macOS release artifact.

Не должно быть сценария, в котором локальный deployment script снова пытается сам собирать Linux "на всякий случай".

---

## 4.7. Очистить `deploy_and_push`

Скрипт `deploy_and_push` необходимо упростить.

Удалить из него полностью:

- локальную Linux-сборку;
- cross-build Linux;
- Linux packaging;
- Linux archive generation;
- Linux checksum generation, если этим уже занимается workflow;
- локальное дублирование Windows/Linux CI;
- локальное создание GitHub Release;
- ручное создание release notes, если это уже делает CI/CD;
- любые шаги, которые повторяют GitHub Actions.

`deploy_and_push` не должен быть вторым CI-сервером.

Его допустимая ответственность:

- clean/check локального дерева;
- обновление/проверка версии;
- локальная macOS build;
- локальные macOS tests/smoke;
- локальная macOS packaging;
- commit/push, если это часть текущего рабочего процесса;
- создание/push version tag, если именно tag является триггером release workflow;
- подготовка macOS artifact к последующей публикации.

Если macOS artifact прикладывается к GitHub Release локально, это допускается только как **attachment к уже созданному CI/CD release**, а не как создание самого Release из локального скрипта.

Предпочтительная модель:

1. локально собирается и проверяется macOS;
2. пушится commit/tag;
3. GitHub Actions собирает Windows/Linux;
4. GitHub Actions создаёт Release;
5. macOS artifact добавляется к этому же release отдельным документированным шагом, если он не может быть получен через GitHub runner;
6. в Release в итоге лежат все поддерживаемые платформы.

---

## 4.8. GitHub CI/CD — единственный владелец Releases

GitHub Release должен создаваться автоматически workflow'ом.

Триггер:

`vX.Y.Z`

или другой единый version-tag contract проекта.

Workflow обязан:

1. проверить, что tag соответствует версии проекта;
2. собрать Windows;
3. прогнать Windows tests;
4. собрать Linux;
5. прогнать Linux tests;
6. собрать platform packages;
7. посчитать checksums;
8. сформировать release artifacts;
9. создать **ровно один** GitHub Release;
10. приложить Windows/Linux archives и checksums;
11. дать понятную ошибку и не публиковать частично валидный release при провале обязательного build/test gate.

Release creation нельзя одновременно держать:

- в `deploy_and_push`;
- в отдельном shell script;
- и в GitHub Actions.

**Единственный source of truth для создания GitHub Releases — GitHub CI/CD.**

---

## 4.9. Release artifact contract

Имена артефактов должны быть стабильными и машинно предсказуемыми.

Например:

- `russiano2d-vX.Y.Z-windows-x86_64.zip`;
- `russiano2d-vX.Y.Z-linux-x86_64.tar.gz`;
- `russiano2d-vX.Y.Z-linux-aarch64.tar.gz`;
- `russiano2d-vX.Y.Z-macos-arm64.tar.gz`;
- `SHA256SUMS`.

Точное именование может отличаться, но оно должно быть единым.

Release не считается полным, если обязательная поддерживаемая платформа отсутствует без явной причины.

---

# 5. P0 — TileMap contracts

Tilemap — фундамент, а не набор обходов.

---

## 5.1. `solidAt`

Определить единый контракт `solidAt(x, y)`.

Он должен корректно работать:

- legacy representation;
- descriptor-based tiles;
- full-cell solid;
- partial shape;
- empty tile;
- shifted origin;
- padding;
- negative logical coordinates;
- outside map.

Вне карты поведение должно быть явно документировано.

### Tests

Добавить отдельные regression fixtures для каждого режима.

---

## 5.2. Tile ↔ Pixel round-trip

Обязательная проверка:

`tile -> pixel -> tile`

возвращает исходную logical cell.

Проверить координаты:

- `(0,0)`;
- `(1,1)`;
- `(2,2)`;
- `(-1,0)`;
- `(0,-1)`;
- `(-5,7)`.

Проверить:

- tile size 16;
- 32;
- 128;
- origin = 0;
- origin != 0;
- pad = 0;
- pad != 0.

Если используется bottom-up convention — зафиксировать это в документации и тестах.

---

## 5.3. Bounds/origin/pad

Проверить, что logical coordinates не ломаются на:

- отрицательных клетках;
- нижней рамке;
- верхней рамке;
- боковых padding cells;
- chunk boundaries.

---

# 6. P0 — Physics regression suite

Не добавлять новую физическую систему.

Нужно сделать Box2D integration предсказуемой и хорошо видимой в DevTools.

---

## 6.1. Static shapes

Проверить:

- box;
- circle;
- polygon;
- segment/chain, если поддерживается публично.

---

## 6.2. Standing on edge

Actor стоит краем collider на платформе.

Не должно быть:

- дрожания;
- чередования floor/no-floor;
- проваливания;
- случайного lateral impulse.

---

## 6.3. Slopes

Проверить:

- подъём;
- спуск;
- переход slope→flat;
- край slope;
- floor normal.

---

## 6.4. One-way platforms

Проверить:

- проход снизу;
- приземление сверху;
- движение по платформе;
- drop-through;
- повторное включение collision.

---

## 6.5. Moving platforms

Проверить:

- horizontal;
- vertical;
- reversing;
- passenger carry;
- no duplicate velocity;
- no sticky contact.

---

## 6.6. Raycast / shape query

Проверить:

- no hit;
- hit;
- start inside;
- edge;
- layer;
- mask;
- disabled shape;
- multiple hits, если API это поддерживает.

---

# 7. P0 — named Areas / hitboxes / hurtboxes

Новая система named areas должна стать production primitive.

Проверить:

- `area(...)`;
- `areaOn(...)`;
- `areas()`;
- `areaOverlap(...)`.

Contact payload стабильно содержит:

- `areaA`;
- `areaB`;
- `roleA`;
- `roleB`;
- `ownerA`;
- `ownerB`.

---

## 7.1. Enable/disable

Последовательность:

`OFF -> ON -> OFF`

не должна:

- менять logical owner;
- ломать stable area identity;
- оставлять ghost contact;
- генерировать события после выключения.

---

## 7.2. Shape rebuild

После изменения geometry:

- старая shape перестаёт участвовать;
- новая вступает в силу в документированной phase;
- ID/index policy не плавает неожиданно.

---

## 7.3. Несколько областей одного actor

Типичный actor может иметь:

- body;
- hurtbox;
- weapon;
- interaction;
- sensor.

Это должно работать без обязательного создания пяти fake child nodes.

---

# 8. P0 — Frame phases

`FRAME_PHASES.md` должен соответствовать реальному runtime.

Порядок фаз должен быть проверен автоматически.

Например:

- input;
- script update;
- animation;
- physics;
- contact dispatch;
- late update;
- presentation;
- cleanup.

Использовать фактический порядок движка.

---

## 8.1. Destroy inside callback

Если node уничтожен во время event callback:

- следующий callback не получает dangling native pointer;
- JS wrapper становится безопасно invalid;
- physics object удаляется в safe phase.

---

## 8.2. Scene unload cleanup

После unload не должно оставаться:

- physics bodies;
- subscriptions;
- timers;
- tweens;
- orphan audio;
- lights;
- emitters;
- callbacks;
- JS wrappers, продолжающих вызывать native object.

---

# 9. P0 — Scene / Room transactional lifecycle

Проверить:

- prepare;
- commit;
- failed prepare;
- unload;
- reload;
- restore.

Если новая room/scene не смогла подготовиться:

**старый world остаётся полностью валидным.**

Сравнить до/после:

- node count;
- body count;
- subscriptions;
- timers;
- audio;
- light count.

---

# 10. P0 — Save / Restore

Чётко определить persistent и transient state.

Сохранять где предусмотрено контрактом:

- scene/room identity;
- stable node IDs;
- attrs;
- gameplay state;
- RNG stream state;
- enabled/disabled areas;
- persistent animation state;
- project-defined exposed state.

Не сохранять автоматически:

- particles;
- camera shake;
- one-shot SFX;
- transient flashes;
- debug UI;
- presentation-only random.

---

# 11. P0 — Deterministic RNG

Gameplay RNG и presentation RNG обязаны быть разделены.

Частицы, camera shake и декоративный шум не должны изменять последовательность procedural/gameplay random.

Зафиксировать golden samples для:

- algorithm;
- version;
- seed;
- coordinates.

Проверить `state()/restore()`.

---

# 12. P0 — Animation system

Multi-target tracks — часть production runtime.

Тестировать:

## Numeric tracks

- position;
- angle;
- scale;
- alpha;
- audio gain.

## Discrete

- visible;
- enum/state;
- sprite frame;
- shape.enabled;
- emitter enabled.

## Event tracks

- marker;
- method;
- audio cue;
- gameplay window.

## Playback

- play;
- pause;
- resume;
- stop;
- seek;
- loop;
- interrupt;
- restore.

Editor/preview seek не должен вызывать gameplay side effects.

Interrupt атаки должен закрывать hit window.

---

# 13. P0 — Input

Action-based input должен быть production-ready.

Проверить:

- keyboard;
- mouse;
- gamepad;
- multiple gamepads;
- hot plug;
- disconnect/reconnect;
- deadzone;
- analog;
- digital;
- rebinding;
- conflicts;
- reset defaults.

Gameplay не должен зависеть от raw SDL scancode напрямую.

---

# 14. P0 — QuickJS lifecycle

Проверить:

- exception propagation;
- stack traces;
- missing modules;
- module cycles;
- hot reload;
- invalid wrapper after node destroy;
- callbacks after destroy;
- timers after scene unload;
- async cancellation.

Любая JS-ошибка должна превращаться в структурированную диагностику, а не undefined C crash.

---

# 15. P0 — Structured diagnostics

Все новые subsystem errors должны по возможности идти через единый diagnostic path.

Минимальные поля:

- code;
- subsystem;
- operation;
- message;
- recoverability;
- nodeId;
- assetPath;
- jsonPath;
- source;
- frame.

Duplicate suppression должен быть видимым:

например `repeated x37`, а не молчаливое исчезновение.

---

# 16. Developer Experience — главная новая зона дополировки

## 16.1. Общая цель

При разработке реальной игры программист должен уметь нажать F1/F2 и ответить на вопросы:

- почему кадр тормозит;
- сколько времени заняла физика;
- какой script жрёт CPU;
- сколько активных тел;
- кто с кем столкнулся;
- почему включился hitbox;
- какой render pass дорогой;
- сколько draw calls;
- сколько textures загружено;
- откуда приехала сущность;
- какой prefab её создал;
- какой event привёл к damage;
- какой audio handle остался после unload;
- какой asset не перезагрузился;
- какой input action сейчас активен.

Для этого нужен не один overlay с FPS, а полноценный встроенный developer suite.

---

# 17. DEV-P0 — Performance Profiler

Сделать полноценную вкладку `PERF`.

Использовать существующие `$.debug.profile()` и profiler zones.

---

## 17.1. Summary

Показывать:

- FPS;
- frame time;
- simulation CPU;
- render CPU;
- GPU time — только если реально измеряется;
- physics;
- JS;
- animation;
- UI;
- audio;
- contacts;
- draw calls;
- batches;
- sprites;
- particles;
- lights;
- shadow lights;
- bodies;
- shapes;
- nodes;
- timers;
- tweens;
- audio voices;
- textures;
- render targets.

Неизмеряемое значение показывать как `N/A`.

Никаких придуманных GPU numbers.

---

## 17.2. Frame graph

Хранить ring buffer, например 300 кадров.

Графики:

- frame;
- simulation;
- physics;
- script;
- render CPU;
- GPU;
- UI.

Статистика:

- current;
- min;
- mean;
- p50;
- p95;
- p99;
- max.

---

## 17.3. Hierarchical profiler

Показывать дерево:

- Frame
  - Simulation
    - Script
    - Animation
    - Physics
    - Contacts
    - Scene
  - Presentation
    - Sprite
    - Light
    - Particle
    - UI
  - Audio

Не жёстко прибивать названия, если backend уже выдаёт зоны — строить дерево по данным.

---

## 17.4. User profiler scopes

Custom game scopes из `$.debug.profiler.*` показывать вместе с engine zones.

Примеры возможных зон:

- generation;
- AI;
- boss;
- inventory;
- dialogue;
- pathfinding.

---

# 18. DEV-P0 — Hitch detector

Добавить автоматический detector долгих кадров.

Настройки порога:

- 16.67 ms;
- 25 ms;
- 33 ms;
- 50 ms;
- custom.

При spike сохранять capture:

- N кадров до;
- spike;
- N после;
- profiler zones;
- counters;
- current scene/room;
- node/body/contact counts;
- diagnostics;
- memory/resource snapshot где возможно.

UI:

`Hitch #17 — 48.3 ms`

с возможностью открыть breakdown.

---

# 19. DEV-P0 — Physics Debugger

Вкладка `PHYSICS` + world overlay.

Переключатели:

- bodies;
- shapes;
- sensors;
- areas;
- hitboxes;
- hurtboxes;
- one-way;
- sleeping;
- static;
- dynamic;
- kinematic;
- contact points;
- normals;
- velocity;
- angular velocity;
- center of mass;
- raycasts;
- masks;
- layers.

Для selected actor:

- body type;
- velocity;
- mass;
- shapes;
- areas;
- contacts;
- layer/mask;
- role;
- owner;
- floor state;
- last collision.

---

# 20. DEV-P0 — Entity Inspector 2.0

Расширить существующий F2.

Поиск:

- selector;
- ID;
- tag;
- kind;
- prefab;
- state.

Фильтры:

- visible;
- physics;
- active;
- current room;
- ownership domain.

---

## 20.1. Identity

Показывать:

- selector;
- stable nid;
- kind;
- tags;
- prefab;
- source;
- owner;
- room/scene.

---

## 20.2. Transform

Показывать:

- local position;
- world position;
- local angle;
- world angle;
- scale;
- parent;
- children count.

---

## 20.3. Gameplay

Показывать:

- attrs;
- state;
- exposed values;
- health, если exposed;
- arbitrary project-defined fields.

---

## 20.4. Physics

Показывать:

- body;
- velocity;
- areas;
- contacts;
- floor;
- layer/mask.

---

## 20.5. Presentation

Показывать:

- visible;
- layer;
- depth;
- y-sort;
- sprite/clip;
- animation;
- material;
- light mask.

---

# 21. DEV-P0 — World Picking

Добавить режим `Pick entity`.

Клик по объекту в мире:

1. находит соответствующий `$` node;
2. выбирает его в F2;
3. подсвечивает bounds;
4. показывает selector;
5. показывает source/prefab.

Действия:

- Copy selector;
- Copy node ID;
- Copy JS.

Пример:

`$('#enemy_12')`

---

# 22. DEV-P1 — Live runtime editing

Разрешить безопасно менять некоторые значения во время запуска.

Например:

- position;
- angle;
- visible;
- attrs;
- light radius;
- light intensity;
- camera values;
- animation speed;
- audio gain.

Важно:

**изменение не сохраняется автоматически в проект.**

После изменения:

- Copy value;
- Copy selector;
- Copy JS;
- Export override.

---

# 23. DEV-P1 — Event Timeline / Trace

Вкладка `EVENTS`.

Показывать события по кадрам:

- node spawn;
- destroy;
- scene enter;
- scene leave;
- room load;
- contact begin/end;
- area enter/leave;
- animation marker;
- method track;
- audio cue;
- input action;
- custom gameplay event;
- diagnostic;
- save;
- restore;
- hot reload.

Фильтры:

- selector;
- nid;
- subsystem;
- event type;
- source;
- frame range.

---

## 23.1. Causal chains

Где возможно связывать цепочки.

Например:

`input.attack`
→ `animation:sword`
→ `marker:hit_on`
→ `area weapon enabled`
→ `contact enemy.hurtbox`
→ `damage`

Не требуется универсальный distributed tracing framework.

Достаточно stable event IDs / source-target IDs / frame data там, где они уже естественно существуют.

---

# 24. DEV-P1 — Watches

Развить `$.debug.watch()`.

Pinned values:

- position;
- velocity;
- health;
- state;
- animation;
- floor;
- RNG;
- enemy count;
- arbitrary expression/exposed value.

Для watch:

- current;
- previous;
- delta;
- optional graph;
- min/max;
- threshold warning.

---

# 25. DEV-P1 — Render Inspector

Вкладка `RENDER`.

Показывать:

- passes;
- targets;
- draw calls;
- batches;
- sprites;
- layer/depth;
- y-sort;
- blend;
- textures;
- atlases;
- materials;
- lights;
- shadows;
- occluders;
- post effects;
- viewport;
- integer scale;
- snap.

Debug overlays:

- sprite bounds;
- atlas region;
- origin/pivot;
- light radius;
- occluder geometry;
- layer label;
- depth label.

---

## 25.1. Render modes

Если реализуются без крупной новой архитектуры:

- normal;
- unlit;
- lighting only;
- occluders;
- light layers;
- receiver masks;
- optional overdraw approximation.

Не делать overdraw mode P0-блокером.

---

# 26. DEV-P1 — Audio Inspector

Вкладка `AUDIO`.

Показывать active voices:

- asset;
- bus;
- gain;
- loop;
- playback position;
- spatial position;
- attenuation;
- persistent flag.

Bus view:

- gain;
- mute;
- solo;
- active count.

Dev actions:

- mute;
- solo;
- stop voice;
- play test sound.

Особенно полезно видеть orphan voices после scene unload.

---

# 27. DEV-P1 — Input Inspector

Вкладка `INPUT`.

Показывать:

- connected devices;
- active device;
- actions;
- pressed;
- released;
- held;
- analog raw;
- processed;
- deadzone;
- bindings.

Rebind diagnostics:

- waiting input;
- captured input;
- conflicts;
- duplicate bindings.

Опционально показывать виртуальную схему gamepad state.

---

# 28. DEV-P1 — Asset & Hot Reload Monitor

Вкладка `ASSETS`.

Показывать:

- loaded resource;
- type;
- source path;
- dependencies;
- load time;
- last reload;
- reload result;
- approximate memory, если честно доступна;
- active users/refcount, если архитектура это знает.

Hot reload chain:

`texture -> atlas -> prefab/users`

должна быть видима.

Если reload провалился, последняя валидная версия ресурса должна сохраняться там, где это допускает текущая архитектура.

---

# 29. DEV-P1 — Resource / Memory Inspector

Не нужно встраивать Valgrind.

Нужна базовая runtime accounting.

Показывать:

- nodes;
- bodies;
- shapes;
- textures;
- render targets;
- buffers;
- audio voices;
- timers;
- tweens;
- subscriptions;
- JS wrappers;
- loaded assets.

Добавить delta:

`+12 nodes since scene load`

или:

`+3 textures after 10 reload cycles`.

---

## 29.1. Leak suspicion

DevTools может помечать:

- monotonically growing resource;
- object surviving scene unload;
- repeated reload without release.

Это диагностическая подсказка, не доказательство leak.

---

# 30. DEV-P1 — Console

Встроенная developer console должна позволять безопасно выполнять debug JS.

Например:

`$('#hero').pos()`

или:

`$.debug.stats()`

Требования:

- history;
- autocomplete по namespaces, если разумно;
- output;
- structured exception;
- copy result.

Не делать console доступной в production package по умолчанию, если это создаёт security/problem surface.

---

# 31. DEV-P1 — Debug commands / cheats

Добавить registry dev-команд.

Примеры generic-команд:

- pause;
- resume;
- step frame;
- timescale;
- reload;
- reload asset;
- scene restart;
- dump snapshot;
- dump diagnostics;
- profiler capture.

Не добавлять game-specific `godmode` в engine core.

Игра может регистрировать свои команды.

---

# 32. DEV-P1 — Frame stepping

В paused mode нужны:

- Step 1 simulation tick;
- Step N ticks;
- Step 1 render frame;
- resume.

Это важно для:

- physics;
- animation;
- contact debugging;
- event trace.

---

# 33. DEV-P1 — Time controls

В DevTools:

- pause;
- 0.1x;
- 0.25x;
- 0.5x;
- 1x;
- 2x, если допустимо;
- custom.

UI/debug presentation не должен исчезать при simulation pause.

---

# 34. DEV-P1 — Camera debug

Показывать:

- target;
- desired position;
- actual position;
- deadzone;
- limits;
- lookahead;
- smoothing;
- shake offset;
- zoom.

Overlay:

- deadzone rectangle;
- camera bounds;
- target marker.

---

# 35. DEV-P1 — TileMap Debugger

Для selected tilemap:

- cell coordinates under cursor;
- tile ID;
- visual region;
- collision shape;
- solidAt result;
- origin;
- pad;
- chunk;
- room;
- occluder.

Overlay modes:

- logical grid;
- collision cells;
- partial shapes;
- occluders;
- chunks.

---

# 36. DEV-P1 — Animation Debugger

Для selected animation player:

- current clip;
- time;
- normalized time;
- speed;
- loop;
- clock;
- active tracks;
- active marker;
- current gameplay windows.

Controls:

- pause;
- step;
- seek;
- restart;
- inspect tracks.

Preview seek не должен вызывать gameplay side effects.

---

# 37. DEV-P1 — Lighting Debugger

Для selected light:

- position;
- radius;
- intensity;
- shadow;
- layer;
- receiver interactions;
- ray/segment budget;
- affected occluders.

Overlay:

- radius;
- occluder segments;
- mask/layer info.

Quality panel:

- maxShadowLights;
- maxRays;
- maxSegments;
- current degradation report.

---

# 38. DEV-P1 — Screenshot / capture tools

DevTools должен уметь:

- screenshot current frame;
- capture clean frame without DevTools;
- capture debug overlay;
- capture profiler/hitch report.

Полезно для regression fixtures.

---

# 39. DEV-P1 — Debug report export

Одна кнопка:

`Export Debug Report`

Собирает:

- engine version;
- platform;
- GPU/backend;
- build flags;
- scene;
- profiler summary;
- counters;
- diagnostics;
- loaded resources summary;
- recent trace;
- optional screenshot.

Формат:

- JSON для machine use;
- human-readable text/markdown опционально.

Не включать пользовательские секреты и произвольные файлы.

---

# 40. P1 — Renderer robustness

Проверить:

- window resize;
- minimize;
- restore;
- fullscreen;
- borderless;
- HiDPI;
- target recreation.

Не должно оставаться stale target handles.

---

## 40.1. Render target lifecycle

Stress:

`create -> use -> release`

сотни циклов.

Resource counters должны возвращаться к baseline.

---

## 40.2. Blend golden scenes

Зафиксировать:

- alpha;
- additive;
- multiply;
- opaque.

---

## 40.3. Sorting contract

Документировать:

- layer;
- depth;
- Y-sort;
- UI ordering.

Presentation order не должен влиять на physics.

---

# 41. P1 — Pixel presentation

Проверить:

- `$.gfx.snap(true)`;
- `$.gfx.integerScale(true)`;
- subpixel camera;
- zoom;
- odd viewport;
- resize.

Квантуется presentation, а не physics world.

---

# 42. P1 — Lighting stability

Проверить:

- multiple lights;
- shadow on/off;
- static occluder;
- dynamic occluder;
- occluder masks;
- receiver masks;
- light layers;
- `.lit(false)`;
- quality fallback.

При превышении budget свет не должен просто исчезать без diagnostics.

---

# 43. P1 — Materials capability honesty

Material contract может содержать normal metadata, но capability должен сообщаться честно.

Если full per-pixel normal path не поддерживается:

- API сообщает `supported:false`;
- используется documented fallback;
- UI показывает fallback;
- docs не обещают то, чего renderer не делает.

---

# 44. P1 — Custom shaders

Документировать ограничения:

- stages;
- sampler count;
- uniforms/parameter block;
- screen sampling;
- target access.

Не делать arbitrary render graph обязательным для этой версии.

---

# 45. P1 — Atlases

Regression:

- single page;
- multipage;
- trim;
- padding;
- extrusion;
- invalid frame;
- missing page;
- duplicate tag;
- wrong import manifest;
- rotated frame.

Rotated frames либо полностью поддерживаются, либо валидатор их честно отвергает.

---

# 46. P1 — Hot reload safety

Проверить reload:

- JS;
- JSON;
- texture;
- atlas;
- RmlUi;
- shader, где поддерживается.

Ошибка reload не должна уничтожать последнюю валидную runtime-версию, если возможно сохранить её безопасно.

---

# 47. P1 — Audio runtime

Проверить:

- play;
- stop;
- pause;
- resume;
- fade;
- loop;
- bus;
- spatial;
- scene cleanup.

Persistent music должна быть явной политикой, а не случайным orphan handle.

---

# 48. P1 — Particles

Проверить:

- start/stop;
- scene cleanup;
- budget;
- offscreen policy;
- deterministic seed, если запрошен;
- presentation RNG separation.

---

# 49. P1 — Camera

Regression:

- follow;
- smooth;
- deadzone;
- lookahead;
- limits;
- shake;
- zoom;
- target destroy;
- target switch;
- scene change.

---

# 50. P1 — Time

Чётко различать:

- simulation time;
- presentation time;
- real time.

`timeScale = 0` останавливает gameplay simulation, но DevTools остаётся интерактивным.

Проверить:

- 0;
- 0.1;
- 0.5;
- 1;
- invalid negative;
- NaN;
- infinity.

---

# 51. P1 — Profiler baselines

Stress scenes:

- physics;
- contacts;
- tilemap;
- particles;
- lighting;
- UI;
- mixed.

Не вводить искусственную цифру `60 FPS на любом железе`.

Ловить явные regression multipliers.

Например:

- 2x CPU regression;
- 5x allocations;
- runaway resource count.

---

# 52. P1 — Lifetime stress

Автоматический тест:

`load/unload scene` минимум 100 циклов.

Отслеживать:

- nodes;
- bodies;
- shapes;
- textures;
- targets;
- voices;
- timers;
- subscriptions;
- JS wrappers.

Значения не должны монотонно расти без причины.

---

# 53. P1 — SDK

Специализированные студии должны:

- открываться;
- валидировать;
- не падать на пустом документе;
- использовать тот же backend, что CLI;
- сохранять undo/redo;
- не мутировать данные при Validate;
- Preview должен показывать именно validated source.

---

# 54. P1 — CLI / GUI parity

Если операция есть в CLI и GUI:

- Validate;
- Build;
- Package;
- Inspect;

она должна использовать общий backend.

Никаких двух реализаций одной логики.

---

# 55. P1 — Headless / Agent

Стабилизировать:

- `--agent`;
- `--headless`;
- `--fixed-dt`;
- `--seed`;
- `--game`.

Agent должен уметь:

- step;
- input;
- eval;
- snapshot;
- inspect;
- screenshot;
- assert;
- stderr diagnostics.

---

# 56. P1 — Replay hooks

Минимальный deterministic replay contract:

- seed;
- input actions per tick;
- external deterministic events.

Цель — reproduction CI bugs, а не multiplayer rollback.

---

# 57. P1 — Packaging, CI/CD и Releases

Standalone package не должен тащить:

- source tree;
- caches;
- temporary saves;
- SDK dev state;
- unused demos;
- CI junk.

Version, dependencies и licenses должны быть внутри package согласно release contract.

## 57.1. Кто что собирает

**GitHub Actions:**

- Windows;
- Linux;
- тесты этих платформ;
- package/archive;
- checksums;
- автоматический GitHub Release.

**Локальный рабочий Mac:**

- macOS;
- macOS tests;
- macOS archive.

Локальный Mac не используется как самодельный Linux build server.

## 57.2. `deploy_and_push`

После очистки этот скрипт:

- не собирает Linux;
- не собирает Windows;
- не дублирует GitHub CI;
- не создаёт GitHub Release;
- не формирует отдельный параллельный release pipeline.

Он может:

- проверить git status;
- проверить/обновить version;
- собрать macOS;
- прогнать macOS smoke/tests;
- собрать macOS archive;
- push commit/tag;
- при необходимости добавить macOS archive к уже созданному GitHub Release.

## 57.3. Автоматические Releases

Version tag запускает GitHub Actions release workflow.

Workflow:

- валидирует tag/version;
- собирает Windows/Linux;
- тестирует;
- пакует;
- считает SHA256;
- создаёт один Release;
- загружает артефакты.

Не публиковать release, если обязательный CI gate не прошёл.

---

# 58. P1 — Single source of version

Одна версия должна использоваться:

- CMake;
- binary;
- SDK;
- package;
- VERSION;
- Git tag;
- GitHub Release;
- release artifact filenames;
- tag validation.

GitHub CI автоматически ловит mismatch.

Пример обязательного равенства:

`project version == vX.Y.Z tag == binary version == package version == GitHub Release version`

Локальный `deploy_and_push` не должен иметь свою отдельную захардкоженную версию.

---

# 59. P2 — Documentation cleanup

После стабилизации сверить:

- `PHILOSOPHY.md`;
- `BUILD.md`;
- `FRAME_PHASES.md`;
- `DEVTOOLS.md`;
- `PRODUCTION_READINESS.md`;
- `PRODUCTION_PLAN.md`;
- high-level API docs;
- SDK docs.

Deprecated инструкции:

- удалить;
- либо явно пометить historical.

---

# 60. P2 — Small focused examples

Поддерживать маленькие примеры:

- hello;
- platform foundations;
- physics areas;
- animation;
- tilemap;
- rooms;
- lighting;
- audio;
- RmlUi;
- timeline;
- save/restore;
- agent;
- DevTools.

Каждый example демонстрирует один контракт.

---

# 61. P2 — Warnings

Исправить warnings собственного кода:

- pointer/int mismatch;
- narrowing;
- unused parameters;
- platform assumptions;
- unsafe casts.

Third-party warnings не чинить форками без необходимости.

---

# 62. P2 — Dependency audit

Зафиксировать версии:

- SDL3;
- SDL3_image;
- SDL3_mixer;
- SDL3_net;
- QuickJS-ng;
- Box2D;
- RmlUi;
- FreeType;
- glslang;
- SPIRV-Cross.

Проверить licenses.

Не делать массовый dependency upgrade в рамках стабилизации без причины.

---

# 63. API Freeze

После выполнения P0 и обязательных P1 ввести временный freeze public high-level API.

Нельзя без отдельного обоснования:

- переименовывать namespaces;
- менять signatures;
- ломать semantics;
- менять JSON schema;
- менять prefab schema;
- менять room schema;
- менять atlas schema;
- менять save contract.

Новая функция допустима только если:

1. существует реальный missing primitive;
2. существующий API не решает проблему корректно;
3. функция универсальна;
4. есть tests;
5. есть docs.

---

# 64. Anti-goals

На этом этапе НЕ добавлять ради красоты:

- ECS;
- component architecture;
- full visual scene editor;
- visual scripting;
- skeletal animation framework;
- behavior tree framework;
- navmesh framework;
- rollback networking;
- MMO networking;
- terrain editor;
- generic 3D scene graph;
- second scripting VM;
- second dialogue engine;
- second profiler backend;
- second DevTools UI framework.

---

# 65. Порядок работ

## PASS 1 — CI/CD & portability

Закрыть:

- Windows GitHub runner;
- Linux GitHub runners;
- Linux GUI regressions;
- локальную macOS clean build/test/package;
- version/build consistency;
- очистку `deploy_and_push`;
- автоматический GitHub Release workflow;
- стабильное именование release artifacts;
- checksums.

**Gate:** Windows/Linux CI green + локальный macOS acceptance green + release dry-run/validation green.

---

## PASS 2 — Core contracts

Закрыть:

- tilemap;
- coordinates;
- physics;
- named areas;
- frame phases;
- scene lifecycle;
- save/restore;
- RNG;
- animation;
- input;
- QuickJS lifecycle.

**Gate:** regression suite green.

---

## PASS 3 — DevTools foundation

Довести:

- PERF;
- Entity Inspector;
- World Picking;
- Physics Debugger;
- hitch detector;
- event timeline;
- watches.

**Gate:** реальную runtime-проблему можно расследовать без добавления временного debug-кода в игру.

---

## PASS 4 — Specialized inspectors

Добавить:

- Render;
- Audio;
- Input;
- Assets;
- Memory/resources;
- TileMap;
- Animation;
- Lighting;
- Camera.

---

## PASS 5 — Runtime polish

Закрыть:

- renderer lifecycle;
- hot reload;
- audio;
- particles;
- camera;
- time;
- packaging;
- agent;
- replay hooks.

---

## PASS 6 — Cleanup

Закрыть:

- docs;
- warnings;
- focused examples;
- dependencies.

---

## PASS 7 — Freeze & release

- version bump;
- локальная clean macOS build;
- full Windows/Linux GitHub CI;
- standalone packages;
- reproducibility;
- API freeze;
- push version tag;
- automatic GitHub Release creation;
- upload Windows/Linux artifacts from CI;
- attach local macOS artifact к тому же Release;
- SHA256SUMS;
- release notes.

Никакого второго локального механизма создания Releases.

---

# 66. Финальный acceptance checklist

Форму чеклиста проверяет `tests/production_polish_checklist_test.py`: у каждой
закрытой галочки обязано быть названо доказательство (существующий файл теста или
job CI), у каждого незакрытого пункта — причина. Молчаливый незакрытый пункт
гейт не пропускает: «ещё не сделано» и «забыли» должны выглядеть по-разному.
Гейт стоит в общем шаге CI (`static`): закрытая галочка без доказательства или
незакрытый пункт без причины валят сборку.

## Build

- [x] Windows x86_64 собирается GitHub runner'ом — `.github/workflows/build.yml` — кросс-сборка MinGW на hosted-раннере
- [x] Linux x86_64 собирается GitHub runner'ом — `.github/workflows/build.yml`
- [x] Linux ARM64 собирается GitHub runner'ом или явно documented unsupported — `.github/workflows/build.yml`
- [x] macOS собирается локально на рабочем Mac — `tools/autobuild.py` + `tests/macos_package_smoke_test.py`
- [x] macOS clean build проходит — `tests/macos_package_smoke_test.py` (чистая сборка в build-macos-clean)
- [x] macOS package smoke проходит — `tests/macos_package_smoke_test.py`
- [x] RE2D ON — `tools/ci_verify.py`
- [x] RE2D OFF — `tools/ci_verify.py`
- [x] `deploy_and_push` не содержит Linux build/package — `tests/release_ownership_test.py`

## Core

- [x] tilemap — `tests/js/tilemap_test.mjs` + `tests/js/tilemap_ysort_test.mjs`
- [x] tile/pixel round-trip — `tests/js/tilemap_test.mjs`
- [x] physics — `tests/agent/highlevel_physics_edge_test.py`
- [x] one-way — `tests/agent/highlevel_physics_oneway_test.py`
- [x] moving platforms — `tests/agent/highlevel_physics_moving_test.py`
- [x] raycasts — `tests/agent/highlevel_physics_raycast_test.py`
- [x] named areas — `tests/agent/highlevel_contact_area_payload_test.py`
- [x] scene ownership — `tests/agent/lifecycle_numbers_test.py`
- [x] save/restore — `tests/agent/save_restore_test.py`
- [x] deterministic RNG — `tests/agent/highlevel_rng_isolation_test.py`
- [x] animation — `tests/agent/highlevel_animplayer_test.py`
- [x] input — `tests/agent/highlevel_input_contexts_test.py`
- [x] QuickJS lifecycle — `tests/agent/lifecycle_numbers_test.py`

## Presentation

- [x] renderer resize — `tests/agent/renderer_resize_test.py` (несколько смен размера кадра: viewport, непустой кадр, отсутствие роста целей/текстур, совпадение worldToScreen с фактической отрисовкой)
- [x] render targets — `tests/agent/render_target_lifecycle_test.py`
- [x] blend — `tests/agent/blend_golden_test.py` + эталоны `tests/fixtures/blend_golden/golden/`
- [x] sorting — `tests/agent/sort_contract_test.py`
- [x] pixel snap — `tests/agent/highlevel_presentation_test.py`
- [x] integer scale — `tests/agent/highlevel_presentation_test.py`
- [x] lights — `tests/agent/light_receiver_mask_test.py` + `tests/agent/light_area_layer_test.py`
- [x] materials fallback — `tests/agent/materials_capability_test.py`
- [x] atlases — `tests/agent/atlas_runtime_test.py`
- [x] particles — `tests/agent/particles_runtime_test.py`
- [x] camera — `tests/agent/camera_runtime_test.py`
- [x] audio — `tests/agent/audio_runtime_test.py`

## DevTools

- [x] profiler summary — `tests/agent/devtools_perf_test.py`
- [x] frame graph — `tests/agent/devtools_perf_test.py`
- [x] hierarchical profiler — `tests/agent/devtools_perf_test.py`
- [x] user scopes — `tests/agent/devtools_perf_test.py`
- [x] hitch captures — `tests/agent/devtools_hitch_test.py`
- [x] entity inspector — `tests/agent/devtools_test.py`
- [x] world picking — `tests/agent/devtools_pick_test.py`
- [x] physics overlay — вкладка PHYSICS в `src/highlevel/devtools.js`, проверки в `tests/agent/devtools_physics_test.py` (контуры из `engine.devtools.shapes()` + трансформ узла, режимы all/selected/off, подсветка выбранного тела пиксельно)
- [x] event timeline — вкладка EVENTS в `src/highlevel/devtools.js`, проверки в `tests/agent/devtools_events_test.py` (журнал `$.trace`, фильтр по виду события, очистка, честный счёт вытесненных записей)
- [x] watches — `tests/agent/devtools_test.py`
- [x] render inspector — вкладка RENDER в `src/highlevel/devtools.js`, проверки в `tests/agent/devtools_render_test.py` (счётчики `engine.renderInfo()`, цели, текстуры, батчи/вызовы, состояние viewport)
- [x] audio inspector — вкладка AUDIO в `src/highlevel/devtools.js`, проверки в `tests/agent/devtools_audio_test.py` (активные голоса, шины, стоп выбранного канала; остановка свободного канала честно отвечает отказом, а не успехом)
- [ ] input inspector — причина: вкладка INPUT не собрана (данные `$.input.*` есть)
- [ ] asset monitor — причина: вкладка ASSETS показывает реестр загрузок, отдельного монитора цен/времени загрузки нет
- [x] resource/memory stats — вкладка RESOURCE/MEMORY в `src/highlevel/devtools.js`, проверки в `tests/agent/devtools_memory_test.py` (счётчики и пределы с дельтами, детектор монотонного роста с обеих сторон: подозрение на росте, тишина на стабильных числах)
- [x] tilemap debugger — `$.tilemap.debug()` в `src/highlevel/tilemap.js`, проверки в `tests/agent/tilemap_debug_test.py` (сетка и солиды сверяются с `solidAt`, включение/выключение видно пиксельно)
- [ ] animation debugger — причина: вкладка отладки анимации (клипы/окна/дорожки) не собрана
- [x] camera debugger — `$.camera.debug()` в `src/highlevel/camera.js`, проверки в `tests/agent/camera_debug_test.py` (лимиты, deadzone и зоны сверяются с `$.camera.limits()/deadzone()` и зонами камеры, выключение убирает оверлей)
- [ ] lighting debugger — причина: список источников есть (`engine.devtools.lights()`), оверлей не собран
- [x] console — вкладка CONSOLE в `src/highlevel/devtools.js`, проверки в `tests/agent/devtools_console_test.py` (команды поверх существующих API, история, честный отказ на неизвестную команду)
- [ ] frame stepping — причина: управление шагами кадра из панели не собрано
- [x] debug report export — вкладка REPORT в `src/highlevel/devtools.js`, проверки в `tests/agent/devtools_report_test.py` (снимок счётчиков/пределов/диагностики/профиля и версия, копирование)

## Tooling

- [x] SDK CLI — `tests/agent/sdk_cli_test.py`
- [x] SDK GUI — `tests/agent/sdk_studios_test.py`
- [x] validate parity — `tests/agent/sdk_data_parity_test.py`
- [x] package — `tests/agent/sdk_package_test.py`
- [x] headless — `tests/agent/build_test.py`
- [x] agent — `tests/agent/sdk_automation_test.py`
- [x] profiler stress — `tests/agent/profiler_baseline_test.py`
- [x] lifetime stress — `tests/agent/lifetime_stress_test.py`
- [x] replay fixture — `tests/agent/replay_cli_test.py`
- [x] standalone smoke — `tests/agent/build_test.py`

## Release

- [x] one source of version — `tests/package_docs_refresh_test.py`
- [x] tag `vX.Y.Z` соответствует версии проекта — `.github/workflows/build.yml` — шаг сверки тега с версией
- [x] GitHub Actions автоматически создаёт Release — `.github/workflows/build.yml`
- [x] Release создаётся ровно один раз — `tests/release_ownership_test.py`
- [x] Windows artifact приходит из GitHub runner — `.github/workflows/build.yml`
- [x] Linux artifact приходит из GitHub runner — `.github/workflows/build.yml`
- [x] macOS artifact приходит из локальной Mac-сборки — `tools/attach_macos_release.py`
- [x] локальный script не создаёт GitHub Release — `tests/release_ownership_test.py`
- [x] `SHA256SUMS` опубликован — `tools/release.py`
- [x] reproducible package — `tools/agents_doc.py` — детерминированная перепаковка через `release.write_archive`
- [x] licenses — `tools/release.py` — лицензии входят в пакет, проверяет `tests/agent/sdk_package_test.py`
- [x] docs match runtime — `tests/doc_claims_test.py`
- [ ] no P0 defects — причина: §6.3 (сползание на склоне, 11 px за 120 кадров) остаётся — правка интеграции контроллера/трения не сделана
- [x] Windows/Linux CI green — `.github/workflows/build.yml`, прогон 38862722918: static, linux-x86_64, linux-aarch64 и windows-x86_64 (кросс-сборка MinGW) зелёные, артефакты `release-linux-x86_64`, `release-linux-aarch64`, `release-windows-x86_64` собраны
- [x] локальный macOS acceptance green — `tests/macos_package_smoke_test.py` + полный локальный набор `tools/run_tests.py`
- [ ] API freeze declared — причина: заморозка API объявляется на выпуске (PASS 7) после закрытия инспекторов

---
