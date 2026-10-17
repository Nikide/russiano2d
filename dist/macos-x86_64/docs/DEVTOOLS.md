# R2D DevTools

## Цель

Дать инструменты разработчика, **не нарушая code-first философию** R2D
([PHILOSOPHY.md](PHILOSOPHY.md) §2.2).

DevTools — это **инспектор и отладчик**. Это **не** каноническая среда
авторинга игры: уровень и логика по-прежнему описываются кодом и данными.
DevTools ничего не «сохраняет как проект» и не становится источником истины.

Статус: **панели собраны и покрыты тестами** — 15 вкладок диагностики (F1),
инспектор сущности (F2), picking, детектор hitch и 81 метод `$.devtools`.
Что именно есть, а чего ещё нет — §9. Справка по API —
[highlevel/devtools.md](highlevel/devtools.md).

---

## 1. Технология UI

**Весь UI DevTools делается на RmlUi.** См. [UI_RMLUI_LAW.md](UI_RMLUI_LAW.md):
никаких новых ImGui-окон, никакого второго developer GUI.

Нативные custom-элементы внутри RmlUi **разрешены** — ровно для
специализированного отрисованного содержимого (см. §4). RmlUi владеет
окружающим интерфейсом, вёрсткой и раскладкой.

Разметка собирается **кодом** (`engine.ui.loadMarkup`), `.rml`-файл игры не
нужен: панель обязана работать в любой игре без ассетов.

---

## 2. Панели

Реализованы две панели, обе на RmlUi:

* **F1 — диагностика runtime** (`$.devtools.openRuntime()`, `$.debug.on()`,
  `--overlay`): 15 вкладок — `perf`, `hitch`, `physics`, `render`, `events`,
  `tree`, `diag`, `audio`, `input`, `assets`, `memory`, `console`, `step`,
  `watch`, `vfx`. Переключение — кнопки `rt-tab-<имя>` или
  `$.devtools.tab(name)`. Вкладка `vfx` (§M4) — авторский контур VFX: список
  `$.vfx.list()`, плей в центре камеры, прогресс, перемотка ±0.1 с и экспорт
  спеки в JSON, который сразу читает `$.vfx.load`.
  Экспорт отчёта (§39) — внутри вкладки `diag` (отдельной вкладки REPORT нет).
* **F2 — инспектор сущности** (`$.devtools.open()`, `$.devtools.toggle()`):
  список → выбор → секции `Identity / Transform / Gameplay / Physics /
  Presentation`, поиск, фильтры, picking, копирование селектора/ID/JS.

Панелей WORLD, BSP, NAV как отдельных вкладок нет: их данные доступны
оверлеями подсистем (§4) и в инспекторе.

---

## 3. Инспектор сущности

Секции инспектора — те же понятия, что у `$` и у агентского протокола
(один introspection API, см. §7):

```text
#hero

Identity      id, uid, nid, tag, kind, классы, prefab, источник
Transform     position, rotation, scale, размеры
Gameplay      здоровье, команда, состояние, живость
Physics       тело, тип, скорость, фильтры, контакты
Presentation  видимость, альфа, слой, спрайт, ui/aria
```

Секции переключаются `$.devtools.section(name)`, данные всех секций разом
отдаёт `$.devtools.inspect(sel)`; выборка списка с поиском и фильтрами —
`$.devtools.list()`, состояние панели — `$.devtools.panel()`.

Значения в панели **только читаются**. Правки на лету и «Export override» —
см. §9 («чего ещё нет»).

---

## 4. Визуализация

Реализовано оверлеями поверх кадра (по умолчанию выключены и кадр не меняют):

* формы коллизий — вкладка PHYS, режимы «все / только выбранный / выключить»
  (`$.devtools.physicsOverlay(mode)`, контуры из `engine.devtools.shapes()`);
* сетка тайлмапа, твёрдые клетки, координаты под курсором —
  `$.tilemap.debug(...)`;
* анимация: клип, время, слои, окна удара, точки событий —
  `$.anim.debug(sel, ...)`;
* камера: deadzone, лимиты, зоны, цель follow, зум — `$.camera.debug(...)`;
* свет: радиусы/центры нарисованных источников, деградация теней —
  `$.gfx.light.debug(...)`;
* ручные примитивы для игры и тестов — `$.debug.draw.*`.

Не реализовано как инструмент: визуализация BSP, навигации, пространственных
индексов и зон видимости (доступны только ручные примитивы `$.debug.draw`).

---

## 5. Выбор сущности (picking)

Клик по миру даёт **ту же идентичность**, что понимает `$`:

```text
кликнули сущность → #goblin_12
```

`$.devtools.pickMode(true)` включает режим, `$.devtools.pickAt(x, y)` выбирает
по экранной точке (тем же путём, что клик мышью), `$.devtools.picked()` отдаёт
`{ selector, source, x, y }`, `pickHover()` — uid под курсором. Скопировать
полезный селектор: `copySelector()` / `copyNodeId()` / `copyJs()`,
результат — в `lastCopied()`. Проверка — `tests/agent/devtools_pick_test.py`.

---

## 6. Источник истины

Временное изменение значения через DevTools **не должно** молча становиться
каноническими данными проекта. Там, где это уместно, предоставляются явные
действия:

```text
Copy value
Copy selector
Copy JS
Export override
```

Пример:

```js
$('#guard').at(420, 120);
```

Сейчас реализованы копирования (`Copy selector` / `Copy node ID` / `Copy JS`,
`Copy report`); правок значений и `Export override` нет — панель читает мир,
кроме явных действий (mute/solo шины, стоп канала, пауза и масштаб времени,
шаг кадра, очистка журналов и захватов).

---

## 7. Интеграция с агентом

DevTools и агентский протокол **опираются на один introspection API**:
`$.agent.nodes/node`, `$.debug.*`, `$.trace`, `$.sound/$.audio`, `$.input`,
`$.reload`. Нельзя независимо реализовывать «инспекцию для DevTools» и
«инспекцию для агента» с несовместимой семантикой.

```text
            Debug/Inspection API
               /            \
            RmlUi          Agent
           DevTools        Protocol
```

Каждая вкладка отдаёт **машиночитаемый JSON** теми же методами, что рисуют её
содержимое (`$.devtools.perf()`, `.hitch()`, `.physics()`, `.render()`,
`.events()`, `.audio()`, `.input()`, `.assetsTab()`, `.memory()`, `.timeStep()`,
`.report()`, `.hitch()`, …). Тесты вкладок сравнивают видимое в панели с этими
данными, поэтому панель не может «показать одно, а отдать другое».

---

## 8. Критерии приёмки

DevTools умеет:

* список сущностей и выбор одной — ✅ (`list()`, `select()`, `selectBy()`);
* инспекцию состояния по секциям — ✅ (5 секций, `inspect()`);
* метрики движка и профиль кадра — ✅ (PERF, ПРОФИЛЬ, перцентили, hitch);
* инспекторы подсистем — ✅ (PHYS, RENDER, EVENTS, AUDIO, INPUT, ASSETS, MEM);
* picking из мира с копированием селектора — ✅ (`pickMode`, `pickAt`);
* только RmlUi для обычного интерфейса — ✅ (ImGui не используется);
* работу, не превращаясь в источник истины — ✅ (панель читает; правок нет).

---

## 9. Что уже есть в движке

`$.devtools` — **81 публичное имя** на 0.1.34 (полный список и семантика —
[highlevel/devtools.md](highlevel/devtools.md)), 15 вкладок F1, инспектор F2,
детектор hitch (`engine.hitch.*`, вкладка HITCH), picking, экспорт отчёта (§39)
и консоль команд (§31). Всё видимое в панели доступно как JSON; тесты вкладок
сверяют одно с другим.

| Тест | Что закрывает |
|---|---|
| `tests/agent/devtools_test.py` | инспектор F2: список, выбор, секции, поиск, фильтры, копирование |
| `tests/agent/devtools_perf_test.py` | PERF / ПРОФИЛЬ / ДИАГ / НАБЛЮД: сводка, график, перцентили, дерево зон |
| `tests/agent/devtools_hitch_test.py` | HITCH: искусственный долгий кадр, причина, порог, очистка |
| `tests/agent/devtools_physics_test.py` | PHYS: таблица тел и оверлей форм |
| `tests/agent/devtools_render_test.py` | RENDER / ASSETS |
| `tests/agent/devtools_events_test.py` | EVENTS: журнал `$.trace`, фильтр, пауза, потери |
| `tests/agent/devtools_audio_test.py` | AUDIO / INPUT |
| `tests/agent/devtools_memory_test.py` | MEM: счётчики, пределы, дельты, подозрение на рост |
| `tests/agent/devtools_console_test.py` | КОНСОЛЬ / ШАГ: команды, история, шаг кадра |
| `tests/agent/devtools_report_test.py` | ДИАГ и экспорт отчёта (§39) |
| `tests/agent/devtools_pick_test.py` | picking: клик по миру, подсветка, копирование |
| `tests/agent/devtools_backend_test.py` | данные бэкенда: формы, свет, `renderInfo()` |
| `tests/agent/sdk_runtime_ui_test.py` | панель F1 целиком, гравитация, перезапуск скриптов |
| `tests/js/devtools_test.mjs` | логика панели без GUI (qjs) |
| `tests/agent/tilemap_debug_test.py`, `anim_debug_test.py`, `camera_debug_test.py`, `light_debug_test.py` | оверлеи подсистем (§4) |
| `tests/agent/debug_diagnostics_test.py`, `highlevel_perf_test.py` | профиль, история кадра, перцентили |

**Чего ещё нет** (осознанно, а не «потеряно»):

* правок значений на лету и их экспорта (value / JS / override) — см. §6;
* отдельных панелей WORLD / BSP / NAV и визуализации этих подсистем как
  инструмента;
* редактора сцены и записи проекта — это вне философии R2D (§1).

**ImGui удалён (2026-10-09).** F1, `--overlay` и `$.debug.on()` используют
RmlUi диагностику DevTools, F2 — инспектор узлов.

---

## 10. Связанные документы

[UI_RMLUI_LAW.md](UI_RMLUI_LAW.md) — закон интерфейса,
[highlevel/devtools.md](highlevel/devtools.md) — справочник `$.devtools`,
[AGENT_API.md](AGENT_API.md) и [highlevel/agent.md](highlevel/agent.md) —
агентский протокол и снимок, [highlevel/debug.md](highlevel/debug.md) —
`$.debug`/`$.console`, [ROADMAP.md](ROADMAP.md) — фаза 8.
