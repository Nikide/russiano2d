# Roadmap расширения R2D

Документ задаёт **порядок** работ по развитию движка. Он расширяет
существующий Russiano2D, а не заменяет его: нормальная починка багов и
сопровождение не останавливаются ради галочек роадмапа.

Статус: план. Ограничения, которым он подчинён — [PHILOSOPHY.md](PHILOSOPHY.md),
[UI_RMLUI_LAW.md](UI_RMLUI_LAW.md),
[AGENT_IMPLEMENTATION_RULES.md](AGENT_IMPLEMENTATION_RULES.md).

Другие списки работ, с которыми этот документ не конфликтует, а дополняет:
[TASKS.md](TASKS.md) (аудит пробелов и дефектов, §12 — предлагаемый порядок),
[GAP_ANALYSIS.md](GAP_ANALYSIS.md) (сверка с Godot 4.x).

Правило перехода: **следующая фаза не начинается, пока текущая не зелёная** —
сборка, существующие тесты, новые тесты, headless-прогон, документация.

---

## Фаза 0 — Базовая линия

Перед разработкой возможностей:

* собрать текущий R2D;
* прогнать текущие тесты;
* зафиксировать текущее поведение;
* разобрать внутренности `$`;
* найти пространственные/BSP-средства;
* найти реализацию агентского протокола;
* найти интеграцию RmlUi;
* снять базовые показатели производительности.

**Результат:** изменений в поведении нет.

**Статус: выполнена 2026-10-07.** Сборка `build/russiano2d` на месте; полный
прогон `python3 tools/run_tests.py` — **79/79 ok, 0 fail, 0 skip** (283.8 с);
`tests/js/*_test.mjs` — 79 наборов зелёные; `tests/doc_claims_test.py` и
`tests/doc_coverage_test.py` пройдены; тесты гейта — 16/16. Инвентаризация ниже.

| Пункт | Есть | Где |
|---|---|---|
| Сборка | да | `build/russiano2d` собирается `cmake --build build` |
| Тесты | да | `python3 tools/run_tests.py` (79 агентских), `tests/js/*_test.mjs` (79) |
| Стражи доков | да | `tests/doc_claims_test.py`, `tests/doc_coverage_test.py` |
| Инвентаризация `$` | да | [GAP_ANALYSIS.md](GAP_ANALYSIS.md), [TASKS.md](TASKS.md) |
| Агентский протокол | да | [AGENT_API.md](AGENT_API.md), [src/agent.c](../src/agent.c) |
| RmlUi | да | [src/gui.cpp](../src/gui.cpp), [API.md](API.md) §9 |
| Замеры | частично | `$.debug.profile()`, `tools/bench_highlevel.py`, `--stats` |
| **CI прогоняет сборку/тесты** | **нет** | [.gitlab-ci.yml](../.gitlab-ci.yml) только публикует релиз — сборка и тесты запускаются локально |

---

## Фаза 1 — Основа запросов

Нужен минимальный нативный конвейер запросов. Начать с одного оператора:

```js
$('.enemy').within('#hero', 500);
```

Затем — одна массовая операция поверх него (`remove()` или другая уже
безопасная). Не реализовывать все операторы сразу.

**Состояние: реализовано (2026-10-07).**

* `$('.enemy').within('#hero', 500)` — цель принимает селектор, узел, обёртку
  или точку `{x, y}`; расстояние считается по центру узла
  ([core.js](../src/highlevel/core.js) — метод `Wrapper.within`, чистая
  `withinRadius`);
* узлы **с телом** отбирает нативный `engine.queryCircle(x, y, r, mask)`
  ([physics.c](../src/physics.c) — `r2d_physics_query_circle`, broadphase
  `b2World_OverlapAABB` + отсев по расстоянию, сортировка по расстоянию);
  узлы **без тела** проверяются по координатам — спрайты и зоны не теряются;
* массовая операция поверх выборки — существующие `.remove()`, `.damage()`,
  `.stopAll()`: `$('.goblin').within('#hero', 250).remove()`;
* прежнее `$('.enemy')` не изменилось: это фильтрация по индексу реестра в JS
  ([core.js:1297](../src/highlevel/core.js#L1297),
  [core.js:1442](../src/highlevel/core.js#L1442));
* лимит ответа запроса — 256 ([physics.h:249](../src/physics.h#L249)).

Проверка: `tests/agent/highlevel_within_test.py` (28 проверок, фикстура
`tests/fixtures/within`) и `tests/js/within_test.mjs` (6 проверок чистой
фильтрации без движка).

Осталось из «операторов»: `nearest`, `inside`, `visibleFrom`, `limit` — это
фаза 2.

---

## Фаза 2 — Диагностика запросов

Добавить: время запроса, число кандидатов и результатов, диагностику для
разработки; затем — отдельные операторы (`nearest`, `inside`, `visibleFrom`,
`limit`) там, где существующие средства движка делают их осмысленными.

**Состояние: диагностика реализована (2026-10-07), операторы — нет.**

* `engine.queryStats()` → `{ calls, candidates, results, ms, cap, truncated }` —
  только факты о последнем `engine.queryCircle`
  ([script.c](../src/script.c), [API.md](API.md) §16);
* `$.debug.queryStats()` — то же из игры
  ([debug.js](../src/highlevel/debug.js));
* профилировщик по-прежнему знает только зоны кадра — `UPDATE`, `RENDER_JS`,
  `PHYSICS`, `ACQUIRE`, `UPLOAD`, `DRAW`, `UI`, `OTHER`
  ([profile.h:41-48](../src/profile.h#L41-L48), [script.c:358-391](../src/script.c#L358-L391));
* `$.debug.limits()` отдаёт лимиты и занятость таблиц
  ([debug.js:67-71](../src/highlevel/debug.js#L67-L71));
* операторов `nearest` / `inside` / `visibleFrom` / `limit` пока нет.

---

## Фаза 3 — Семантическая инспекция

Расширить агентский протокол командами `query` и `inspect`. Начинать не с
«почему», а с надёжной базовой инспекции.

**Состояние: `query` и `inspect` реализованы (2026-10-07), `why` — нет.**

* **`query`** — `{"cmd":"query","sel":".enemy","limit":10}` → `{ok, sel, nodes}`;
  список сущностей по селектору `$` с необязательным пределом;
* **`inspect`** — `{"cmd":"inspect","sel":"#hero"}` → `{ok, sel, node}`, где
  `node` — краткое описание узла или `null`, если селектор ничего не нашёл;
* разбор селектора остался в JS (`$.agent.node/nodes`), C только перевозит
  строку: у DevTools, агента и игры **одна** реализация поиска
  ([agent.c](../src/agent.c) — `cmd_query`/`cmd_inspect`,
  [script.c](../src/script.c) — `r2d_script_agent_query`,
  [agent.js](../src/highlevel/agent.js) — `install()` и `nodes(sel, limit)`);
  игра на «голом» `engine.*` получает понятную ошибку, а не пустоту;
* структурный снимок мира по-прежнему есть: `$.agent.snapshot()`
  ([agent.js:76-120](../src/highlevel/agent.js#L76-L120)) и команда `state`
  протокола ([agent.c:195-225](../src/agent.c#L195));
* игровые поля (текст, состояние FSM, инвентарь) в снимок не попадают —
  добавляются игрой через `$.agent.expose`;
* команды `why` нет: движок не сочиняет объяснений
  ([AGENT_IMPLEMENTATION_RULES.md](AGENT_IMPLEMENTATION_RULES.md) правило 9).

Проверка: `tests/agent/agent_query_test.py` (15 проверок, фикстура
`tests/fixtures/within`).

---

## Фаза 4 — Trace / profile

Добавить опциональную инструментацию для разработки: `trace`, `profile`.
Инструментация обязана быть отключаемой.

**Состояние: команда `profile` реализована (2026-10-07), `trace` — нет.**

* **`profile`** — `{"cmd":"profile","sel":".enemy","x":100,"y":100,"radius":500}`
  → `{sel, count, bodies, query:{native, candidates, results, ms, cap, truncated},
  frame:{frame_ms, zones[]}, allocations:null}`
  ([agent.c](../src/agent.c) — `cmd_profile`, [AGENT_API.md](AGENT_API.md) §3.3.3);
  число сущностей по селектору считает игровой JS (тот же код, что `query`),
  нативный поиск меряется через `r2d_physics_query_circle`, зоны кадра — через
  `r2d_prof_*`. `allocations` — `null`: движок их не измеряет и не притворяется;
* есть `$.debug.profile()` (зоны кадра, GPU-время), `$.debug.profiler.*`,
  `$.debug.watch()`, `$.debug.draw.*` ([debug.js:72-221](../src/highlevel/debug.js#L72-L221));
* есть `engine.profile()`, `engine.limits()`, `engine.depthInfo()`,
  `engine.fontStats()`, `engine.renderInfo()`
  ([script.c:3959](../src/script.c#L3959), [:4039](../src/script.c#L4039));
* команды `trace` нет; единой трассировки событий (кто кого ударил, кто умер)
  тоже нет — это следующий шаг фазы.

---

## Фаза 5 — Детерминированный record/replay

Строить запись/воспроизведение на существующих опорах: `--fixed-dt`, `--seed`,
агентский ввод. Использовать в автотестах.

**Состояние: CLI и формат реализованы (2026-10-07); чекпоинтов нет.**

* **`--record <файл>` / `--replay <файл>`** — запись ввода кадра и
  воспроизведение через виртуальный ввод ([main.c](../src/main.c),
  [replay.c](../src/replay.c)); формат — JSON-строки с версионированным
  заголовком (`r2d_replay`, версия движка, игра, шаг, зерно), чужая версия
  отвергается с объяснением;
* есть JS-подсистема `$.replay` (запись ввода по кадрам, JSON, лимит
  36 000 кадров, `verify`, `compareReplays`) —
  [replay.js](../src/highlevel/replay.js), [highlevel/replay.md](highlevel/replay.md);
* **нет** чекпоинтов (утверждений о состоянии на кадре) и хеша мира, нет
  команд реплея в агентском протоколе: сценарий разыгрывается командами
  `key`/`step`, а состояние сверяет игра.

---

## Фаза 6 — World testing API

Экспортировать высокоуровневые утверждения: `exists`, `count`, `state`,
`position`, `property`. Падающий тест должен оставлять полезные артефакты.

**Состояние:** частично.

* есть `$.test.check/equal/near/truthy/falsy/reset/results/report`
  ([agent.js:137-182](../src/highlevel/agent.js#L137-L182),
  [HIGH_LEVEL_API.md](HIGH_LEVEL_API.md) §25);
* утверждений вида `t.expect('#door').state('open')` и `positionNear` нет;
* сравнение состояния до/после — только вручную через `eval`/`$.test`;
* расхождение доков и кода, найденное аудитом 2026-10-07 (agent.md приписывал
  проверки `$.agent`, а не `$.test`), **закрыто** — документация приведена к
  коду, а `$.agent.install()` теперь регистрирует и инспекцию для команд
  `query`/`inspect`/`profile` (фазы 3–4).

---

## Фаза 7 — Реактивные запросы

Реализовать минимум: `onEnter` / `onLeave`. Оптимизировать только после
профилирования.

**Состояние:** частично.

* зоны `<trigger>` с событиями `enter`/`leave` и подсистема `$.triggers` уже
  есть ([triggers.js](../src/highlevel/triggers.js),
  [highlevel/triggers.md](highlevel/triggers.md));
* реакций на результат произвольного селекторного запроса нет.

---

## Фаза 8 — DevTools на RmlUi

Строить инспектор поверх уже существующего introspection API. **Не
реализовывать инспекцию дважды.** Первый полезный срез:

```
список сущностей → выбор одной → инспекция свойств →
transform/physics/state → копирование селектора
```

**Состояние:** нет. Подробности, панели и критерии — [DEVTOOLS.md](DEVTOOLS.md).
Мешает два обстоятельства: существующая инспекция разрознена, а «второй
developer GUI» уже есть в виде ImGui-оверлея, включённого по умолчанию
([CMakeLists.txt:46](../CMakeLists.txt#L46), [debug_ui.cpp](../src/debug_ui.cpp)).

---

## Фаза 9 — Продвинутые инструменты

Возможные будущие работы: визуализация BSP, визуализация навигации, таймлайн
событий, визуализатор запросов, таймлайн реплея, flame/timeline
производительности. Делать только когда это действительно полезно.

---

## Явные non-goals

Роадмап **не** требует:

* переписывания на ECS;
* перехода на C++;
* нового UI-фреймворка;
* визуального редактора сцен вместо кода;
* переписывания рендера;
* нового физического движка;
* отказа от `$`;
* замены QuickJS-ng;
* монорепозитория R2D/R3D и общего фреймворка
  ([R2D_R3D_CONVENTIONS.md](R2D_R3D_CONVENTIONS.md)).
