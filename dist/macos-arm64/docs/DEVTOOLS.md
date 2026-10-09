# R2D DevTools

## Цель

Дать инструменты разработчика, **не нарушая code-first философию** R2D
([PHILOSOPHY.md](PHILOSOPHY.md) §2.2).

DevTools — это **инспектор и отладчик**. Это **не** каноническая среда
авторинга игры: уровень и логика по-прежнему описываются кодом и данными.
DevTools ничего не «сохраняет как проект» и не становится источником истины.

Статус: план ([ROADMAP.md](ROADMAP.md) фаза 8).

---

## 1. Технология UI

**Весь UI DevTools делается на RmlUi.** См. [UI_RMLUI_LAW.md](UI_RMLUI_LAW.md):
никаких новых ImGui-окон, никакого второго developer GUI.

Нативные custom-элементы внутри RmlUi **разрешены** — ровно для
специализированного отрисованного содержимого (см. §4). RmlUi владеет
окружающим интерфейсом, вёрсткой и раскладкой.

---

## 2. Панели (кандидаты)

```text
WORLD
ENTITIES
EVENTS
PHYSICS
BSP
NAV
AUDIO
RENDER
PERF
AGENT
```

---

## 3. Инспектор сущности

Выбор `#hero` может показывать:

```text
#hero

Transform
  position
  rotation
  scale

Physics
  velocity
  body
  contacts

Gameplay
  health
  state

Events
  recent events

Debug
  source
  prefab
  trace
```

Значения, безопасные для изменения, **могут** правиться на лету — но см. §6
(источник истины).

---

## 4. Визуализация

Нативные custom-элементы RmlUi **могут** визуализировать:

* формы коллизий;
* BSP;
* навигацию;
* пространственные индексы;
* зоны видимости;
* графики профайлера.

---

## 5. Выбор сущности (picking)

Клик по сущности в превью мира должен давать **ту же идентичность**, что
понимает `$`:

```text
кликнули сущность → #goblin_12
```

DevTools должен позволять **скопировать полезный селектор**.

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

---

## 7. Интеграция с агентом

DevTools и агентский протокол **должны опираться на один introspection API**.
Нельзя независимо реализовывать «инспекцию для DevTools» и «инспекцию для
агента» с несовместимой семантикой.

```text
            Debug/Inspection API
               /            \
            RmlUi          Agent
           DevTools        Protocol
```

---

## 8. Критерии приёмки

DevTools умеет:

* список сущностей;
* выбор одной;
* инспекцию базового состояния;
* показ метрик движка;
* использование **только RmlUi** для обычного интерфейса;
* работу, не превращаясь в источник истины.

Первый полезный срез (из [ROADMAP.md](ROADMAP.md) фаза 8):

```text
список сущностей → выбрать → инспекция свойств →
transform/physics/state → скопировать селектор
```

---

## 9. Что уже есть в движке

**Первый срез DevTools сделан (2026-10-07): `$.devtools`** — панель
«список сущностей → выбор → свойства → скопировать селектор», целиком на RmlUi
(документ собирается кодом через `engine.ui.loadMarkup`, `.rml` в игре не
нужен). Открывается по **F2**: [highlevel/devtools.md](highlevel/devtools.md).

Что в нём уже есть:

| Требование §8 | Состояние |
|---|---|
| Список сущностей | ✅ до 24 строк из `$.agent.nodes('*')` |
| Выбор одной | ✅ клик по строке или `$.devtools.selectBy('#hero')` |
| Инспекция базового состояния | ✅ transform, тело, здоровье, команда, живость, видимость, `aria` |
| Метрики движка | ⬜ панель PERF пока не подключена (есть `$.debug.profile()`) |
| Только RmlUi для обычного интерфейса | ✅ ImGui не используется |
| Не источник истины | ✅ панель только читает и копирует селектор |

Чего ещё нет: правки значений на лету, визуализации коллизий/BSP/навигации,
таймлайна событий, панелей WORLD/EVENTS/AUDIO/RENDER, «Copy JS / Export
override». Заготовки для них — ниже.

| Заготовка | Что даёт | Где |
|---|---|---|
| `$.agent.snapshot()` | `frame, time, dt, fps, paused, scene, window, camera, world, entities[], ui[], player, tests` + поля `expose` | [agent.js:76-120](../src/highlevel/agent.js#L76-L120) |
| `$.agent.node(sel)` / `nodes(sel)` | краткое описание узла / список описаний | [agent.js:24-46](../src/highlevel/agent.js#L24-L46), [:58-67](../src/highlevel/agent.js#L58-L67) |
| `$.agent.expose(name, fn)` | свои поля в снимке | [agent.js:70-73](../src/highlevel/agent.js#L70-L73) |
| `engine.setSnapshot` | снимок уходит в ответ на команду `state` | [agent.js:123-126](../src/highlevel/agent.js#L123-L126), [agent.c:195-225](../src/agent.c#L195-L225) |
| `$.debug.stats()` / `counters()` / `limits()` | счётчики, занятость и потолки таблиц | [debug.js:33-71](../src/highlevel/debug.js#L33-L71) |
| `$.debug.profile()` | зоны кадра, GPU-время, пики | [script.c:358-391](../src/script.c#L358-L391), зоны [profile.h:41-48](../src/profile.h#L41-L48) |
| `$.debug.profiler.*` | свои замеры | [debug.js:145-221](../src/highlevel/debug.js#L145-L221) |
| `$.debug.draw.*`, `$.debug.watch()` | отладочная отрисовка и наблюдения (принимают селекторы) | [debug.js:72-118](../src/highlevel/debug.js#L72-L118) |
| `engine.depthInfo()`, `engine.fontStats()`, `engine.renderInfo()` | глубина/меш, атлас глифов, проходы рендера | [script.c:4028](../src/script.c#L4028), [:4190](../src/script.c#L4190) |
| Курсор и выбор в мире | `attrs.picked`/`hovered` | [api.js:1851-1890](../src/highlevel/api.js#L1851-L1890) |
| Диагностика F1 (RmlUi) | статистика, профиль, физика, текстуры, скрипты, watches | [devtools.js](../src/highlevel/devtools.js) |

**Чего ещё нет:**

* правок значений на лету и их экспорта (value / JS / override);
* picking из мира в панель: клик/ховер по узлам интерфейса есть
  ([ui.js:160-202](../src/highlevel/ui.js#L160-L202)), но клик по спрайту в
  сцене пока не превращается в селектор панели;
* панелей WORLD / EVENTS / PHYSICS / BSP / NAV / AUDIO / RENDER / PERF —
  уже есть диагностика статистики/профиля, гравитации, скриптов и текстур; специализированные визуализации остаются;
* визуализации коллизий, BSP, навигации и зон видимости как инструмента
  (есть только ручные примитивы `$.debug.draw`);
* таймлайна событий — `$.watch` (реактивные запросы) даёт материал, но
  панели на нём ещё нет.

**ImGui удалён (2026-10-09).** F1, `--overlay` и `$.debug.on()` используют
RmlUi диагностику существующего DevTools, F2 — инспектор узлов.

---

## 10. Связанные документы

[UI_RMLUI_LAW.md](UI_RMLUI_LAW.md) — закон интерфейса,
[AGENT_API.md](AGENT_API.md) и [highlevel/agent.md](highlevel/agent.md) —
агентский протокол и снимок, [highlevel/debug.md](highlevel/debug.md) —
`$.debug`/`$.console`, [ROADMAP.md](ROADMAP.md) — фаза 8.
