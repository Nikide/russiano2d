# DevTools — `$.devtools`

Отладочные панели движка: **F1** — диагностика runtime (профиль, hitch,
инспекторы подсистем), **F2** — инспектор сущности (список → выбор → свойства →
«скопировать селектор»). Требования и границы — [DEVTOOLS.md](../DEVTOOLS.md).

Обе панели — **RmlUi-документы, собранные кодом** (`engine.ui.loadMarkup`), а не
`.rml`-файл в игре: инструмент обязан работать в любой игре и не требовать
ассетов. ImGui не используется — закон интерфейса
([UI_RMLUI_LAW.md](../UI_RMLUI_LAW.md)).

```js
$.devtools.open();                    // F2: инспектор сущности (без RmlUi вернёт false)
$.devtools.selectBy('#hero');         // выбрать сущность
$.devtools.section('physics');        // Identity | Transform | Gameplay | Physics | Presentation
$.devtools.pickMode(true);            // клик по миру выбирает сущность

$.devtools.openRuntime();             // F1: панель диагностики (= $.debug.on())
$.devtools.tab('hitch');              // переключить вкладку F1
$.devtools.hitch();                   // те же факты, что видно на вкладке, — JSON
```

Публичная поверхность `$.devtools` — **75 имён** на 0.1.34 (снимается с живого
движка: `Object.keys($.devtools).length`). Ниже — по группам; всё, что
возвращают методы, — обычные JSON-объекты: тесты и внешние инструменты видят
ровно то же, что нарисовано в панели.

---

## 1. Вкладки панели F1

14 вкладок; переключение — `$.devtools.tab(name) → bool`, текущая —
`$.devtools.tabName()`. Кнопки в панели (`rt-tab-<имя>`) дёргают то же
переключение, поэтому клик и API не расходятся.

| `tab` | Кнопка | Что показывает | Тест |
|---|---|---|---|
| `perf` | PERF | сводка кадра (FPS, frame time, CPU по зонам, счётчики мира), график истории, перцентили p50/p95/p99 | `devtools_perf_test.py` |
| `hitch` | HITCH | захваты долгих кадров: время, порог, причина (зона), разбивка по зонам, микро-график | `devtools_hitch_test.py` |
| `physics` | PHYS | таблица тел + оверлей форм в мире (выключен / все / только выбранный) | `devtools_physics_test.py` |
| `render` | RENDER | батчи, draw calls, цели рендера, текстуры, viewport | `devtools_render_test.py` |
| `events` | EVENTS | журнал `$.trace`: записи, фильтр по виду, пауза, потери, связь с боевым попаданием | `devtools_events_test.py` |
| `tree` | ПРОФИЛЬ | иерархия зон кадра (движковые + `$.debug.profiler.*`), группировка Simulation/Presentation/Audio | `devtools_perf_test.py` |
| `diag` | ДИАГ | диагностика мира: счётчики, пределы, профиль, текстуры, watches + **экспорт отчёта** (§39) | `devtools_report_test.py` |
| `audio` | AUDIO | голоса, каналы, шины (mute/solo/громкость), стоп канала | `devtools_audio_test.py` |
| `input` | INPUT | действия и привязки, что нажато, конфликты, ожидания захвата, устройства, залипшие клавиши | `devtools_audio_test.py` |
| `assets` | ASSETS | таблица наблюдаемых ассетов `$.reload.list()`: тип, версия, зависимости, время загрузки | `devtools_render_test.py` |
| `memory` | MEM | `$.debug.counters()/limits()` с дельтами к базовой линии и подозрением на рост | `devtools_memory_test.py` |
| `console` | КОНСОЛЬ | ввод строки и история команд (§31) | `devtools_console_test.py` |
| `step` | ШАГ | кадр/пауза/масштаб времени, шаг физики (§33) | `devtools_console_test.py` |
| `watch` | НАБЛЮД | `$.debug.watches()` с previous/delta/min/max/порогом | `devtools_perf_test.py` |

Экспорт отчёта (§39) — **внутри вкладки ДИАГ** (отдельной вкладки REPORT нет):
кнопки «Копировать текст отчёта» / «Копировать JSON», текст — `rt-report-text`.

## 2. Машиночитаемый доступ к вкладкам

| Вызов | Что отдаёт |
|---|---|
| `perf()` | `{ tab, rows, summary, text:{summary,stats,source}, graph:{source,stats,stats_source,bars,samples,floor_ms} }` |
| `tree()` | дерево зон: движковые ряды + пользовательские зоны |
| `watches()` / `watchThreshold(n)` / `watchReset()` | наблюдения и их порог |
| `hitch()` | `{ available, count, total, threshold, selected, rows[], capture, text }` |
| `hitchSelect(i)` / `hitchThreshold(ms)` / `hitchClear()` | выбор захвата, порог детектора, очистка |
| `physics()` | `{ mode, bodies[], overlay, text }` |
| `physicsOverlay(mode)` | `'off' \| 'all' \| 'selected'` (без аргумента — чтение) |
| `render()` | `{ info, targets[], textures, viewport, lights, lights_dropped, text }` |
| `events()` | `{ on, count, dropped, filter, paused, rows[], hit, text }` |
| `eventsFilter(f)` / `eventsPause(on)` / `eventsClear()` | фильтр, пауза, очистка журнала |
| `audio()` | `{ busy, playing, sfx, music, master, buses, handles[], channels[], text }` |
| `audioStop(channel)` / `audioBus(what, name, value)` | стоп канала; mute/solo/громкость шины |
| `input()` | `{ actions, bindings, conflicts, waiters, stuck, consumed, devices, pads, slots, mouse, text }` |
| `assetsTab()` | `{ available, list[], stats, text }` |
| `memory()` / `memoryBaseline()` | счётчики, пределы, дельты, серии замеров, подозрения на утечку |
| `consoleRun(line)` / `consoleClear()` / `consoleHistory()` / `consoleLog()` / `consoleLast()` | консоль панели |
| `timeStep()` / `step()` / `steps(n)` / `pause(on)` / `timeScale(v)` / `timeControl(what)` | время и шаг кадра |
| `report()` / `copyReport()` | `{ snapshot, text, json }` — отчёт §39 |
| `openRuntime()` / `closeRuntime()` / `runtimeOpen()` / `refreshRuntime()` / `runtimePanel()` | панель F1 целиком |
| `tickOverlay()` / `tickStep()` | кадровый шаг оверлея форм и «шага кадра» (зовёт движок) |

Чего нельзя измерить — панель не выдумывает: неизвестное значение выводится
как `N/A` или `—`, пустой hitch-список — «захватов нет», причины захвата нет —
`reason: null`. Это проверяется тестами вкладок отдельно.

## 3. Инспектор сущности (F2)

| Вызов | Смысл |
|---|---|
| `open()` / `close()` / `toggle()` / `isOpen()` | панель; в сборке без RmlUi `open()` честно вернёт `false` |
| `panel()` | `{ open, doc, rows, entities, selected, selected_nid, selector, refreshed, search, search_kind, filters, offset, section, pick, pick_hover, picked }` |
| `list()` | текущая выборка: `{ uid, nid, selector, tag, kind, class, prefab, state, body, visible, active, room }` |
| `select(uid)` / `selectBy(sel)` / `selector()` | выбор строки / по селектору `$` / селектор выбранного |
| `inspect(sel)` | `{ found, uid, nid, selector, sections }` — данные всех секций |
| `section(name)` / `sectionName()` | `identity`, `transform`, `gameplay`, `physics`, `presentation` |
| `search(text)` / `searchText()` | поиск по selector/ID/tag/kind/prefab/state (пустая строка снимает) |
| `filter(name, value)` / `filters()` | фильтры `visible`, `physics`, `active`, `room` |
| `refresh()` | перерисовать немедленно и вернуть `panel()` |

Клавиша **F2** открывает и закрывает инспектор, **F1** — панель диагностики
(`$.debug.toggle()`, [debug.md](debug.md)).

## 4. Picking (§21)

| Вызов | Смысл |
|---|---|
| `pickMode(on)` / `pickOn()` | режим «Pick entity»: клик по миру выбирает сущность |
| `pickAt(x, y)` | выбрать по **экранной** точке — тем же путём, что клик мышью (нет узла под точкой → `null`) |
| `picked()` | последний выбор: `{ uid, nid, selector, source, tag, screen:{x,y}, world:{x,y} }` |
| `pickHover()` | uid узла под курсором |
| `copySelector()` / `copyNodeId()` / `copyJs()` / `lastCopied()` | что реально ушло в буфер обмена |

Выбранный узел подсвечивается bounds (`$.debug.draw.rect`), выбранная строка
списка — классом `sel`. Проверка — `devtools_pick_test.py` (сравнивает
координаты и селектор с `$.debug`-данными и пикселями кадра).

## 5. Оверлеи подсистем

Отладочные режимы живут в самих подсистемах, панель их только включает; по
умолчанию всё выключено и кадр не меняется:

| Вызов | Что рисует | Тест |
|---|---|---|
| `$.tilemap.debug(...)` | сетка клеток, твёрдые клетки, координаты под курсором | `tilemap_debug_test.py` |
| `$.anim.debug(sel, ...)` | клип, время, слои, окна удара, точки событий | `anim_debug_test.py` |
| `$.camera.debug(...)` | deadzone, лимиты, зоны, цель follow, зум | `camera_debug_test.py` |
| `$.gfx.light.debug(...)` | радиусы и центры нарисованных источников, деградация теней | `light_debug_test.py` |
| `$.debug.draw.*`, `$.debug.watch()` | ручные примитивы и наблюдения | [debug.md](debug.md) |

## 6. Источник истины

Панели **только читают** мир (исключения — явные действия вроде mute шины, стопа
канала, паузы времени и шага кадра). DevTools не «сохраняет проект» и не
становится каноническими данными: правки делаются кодом, панель — способ
посмотреть и скопировать селектор ([DEVTOOLS.md](../DEVTOOLS.md) §6).

## 7. Цена

* содержимое F2 обновляется раз в 6 кадров (~10 Гц), а не каждый кадр;
* обработчики вешаются **один раз** при открытии; разметка не перерисовывается
  (иначе RmlUi унёс бы слушателей вместе с элементами) — обновляются только
  тексты и классы через `engine.ui.setText/setHtml/setClass`;
* пока панель F2 закрыта, кадровый шаг делает только проверку F1/F2;
* оверлей форм физики и подсветка picking тикают только при открытой панели и
  включённом режиме.

## 8. Проверка

```bash
python3 tests/agent/devtools_test.py            # F2: список, выбор, секции, поиск, фильтры
python3 tests/agent/devtools_perf_test.py       # PERF / ПРОФИЛЬ / ДИАГ / НАБЛЮД
python3 tests/agent/devtools_hitch_test.py      # HITCH
python3 tests/agent/devtools_physics_test.py    # PHYS + оверлей форм
python3 tests/agent/devtools_render_test.py     # RENDER / ASSETS
python3 tests/agent/devtools_events_test.py     # EVENTS
python3 tests/agent/devtools_audio_test.py      # AUDIO / INPUT
python3 tests/agent/devtools_memory_test.py     # MEM
python3 tests/agent/devtools_console_test.py    # КОНСОЛЬ / ШАГ
python3 tests/agent/devtools_report_test.py     # ДИАГ + экспорт отчёта
python3 tests/agent/devtools_pick_test.py       # picking
python3 tests/agent/devtools_backend_test.py    # данные бэкенда (формы, свет, renderInfo)
python3 tests/agent/sdk_runtime_ui_test.py      # панель F1 целиком
build/_deps/quickjs-build/qjs tests/js/devtools_test.mjs   # без GUI
```

Тесты вкладок проверяют не «функция есть», а совпадение видимого в панели с
данными API: строки таблиц, тексты блоков и классы кнопок сравниваются с
`$.devtools.<вкладка>()`.
