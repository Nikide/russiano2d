# Отладка — `$.debug` и `$.console`

```js
$.debug.on();                                     // оверлей движка (то же, что F1)
$.debug.draw.rect(10, 10, 40, 40, 'red');
$.debug.watch('hp', () => $('#hero').hp());       // значение в оверлее
$.debug.profile();                                // зоны кадра: UPDATE/RENDER_JS/PHYSICS/…
$.console.register('spawn', (args) => $('<enemy>').at(args[0], args[1]));
$.console.run('spawn 100 200');
```

---

## 1. Методы `$.debug`

| Вызов | Смысл |
|---|---|
| `on()` / `off()` / `toggle()` / `isOn()` | оверлей |
| `draw.rect/line/circle/ring/text/arrow(...)` | рисование поверх кадра |
| `watch(name, fn)` / `unwatch(name)` / `watches()` | значения в оверлее |
| `profile()` / `profileReset()` / `profiling(on)` | замеры кадра: зоны, GPU, пики (у `profile()` аргументов нет) |
| `queryStats()` | диагностика последнего нативного запроса (`$().within`, `engine.queryCircle`) |
| `stats()` / `counters()` / `limits()` / `textures()` | счётчики, занятость и потолки таблиц |
| `resources(opts?)` | таблица ресурсов из существующих источников: `{ ok, frame, items[], totals, budgets, warnings, text }`; `opts.top` — сколько крупнейших |
| `budget(spec?)` | бюджеты разработчика: без аргумента — чтение, с объектом — выставить; `{ ok, budgets, keys, changed, invalid, unknown, error }` |
| `resourcesResetPeaks()` | сбросить накопленные пики ресурсов (`true`) |
| `render()` | факты рендера кадра: `{ info, depth }` — пост-обработка, bloom, проходы и состояние меша/z-буфера; без движка — `null` |
| `memory()` | факты о JS-куче: `{ bytes, used, objects, arrays, strings, atoms, shapes, native_tweens }` (QuickJS `JS_ComputeMemoryUsage`); без движка — `null`. Растущее `objects` между кадрами — утечка, а не шум |
| `nativePasses(on?)` | нативные проходы кадра (`src/nodes.c`): синк физики, события мира, наведение, сортировка и сборка батча. `false` возвращает прежний JS-путь — для сверки «C против JS»; без аргумента — включены ли сейчас (`true` по умолчанию в движке, `false` без движка) |
| `profiler.on(on?)` / `isOn()` | покадровый профайлер подсистем: включить (без аргумента), выключить `on(false)`, прочитать состояние |
| `profiler.start/end/record/report/reset` | свои замеры; время — `$.time.perfNow()` |

## 2. Методы `$.console`

| Вызов | Смысл |
|---|---|
| `register(name, fn, help?)` | своя команда: получает массив аргументов |
| `unregister(name)` / `list()` / `help(name)` | снять команду, перечислить, показать справку |
| `run(text)` | выполнить строку как команду |

Команды — свой мини-терминал: `$.console.run('spawn 100 200')` разбирает строку
на имя и аргументы.

## 3. Ограничения

* **оверлей — RmlUi DevTools**: F1, `--overlay` и `$.debug.on()` используют одну панель; без RmlUi она недоступна. `isOn()` возвращает фактическую видимость;
* **рисование поверх кадра отключается с пост-обработкой** — отладочные фигуры
  идут в тот же проход, что и сцена;
* **профайлер замеряет участки**, а не отдельные вызовы: вложенные замеры
  складываются в один;
* **консоль без истории и автодополнения**: это вызов команды, а не REPL.

`textures()` возвращает метаданные живых GPU-текстур `{id,name,width,height}`.
Панель показывает профиль, статистику, текстуры, watches и `$.script.error()`,
позволяет применить гравитацию общего мира и запросить reload на границе кадра.

---

## 3. Ресурсы и бюджеты (§29)

`$.debug.resources()` — одна таблица из **существующих** источников. Новых
замеров модуль не делает: текстуры — `engine.textureList()`, звук —
`$.sound.busy()/engine.audio.count()`, шрифты — `engine.fontList()/fontStats()`,
RmlUi — `engine.limits()`, узлы/тела/частицы — `$.debug.counters()`, кэш
ассетов — `$.resource.stats()`, JS-куча — `$.debug.memory()`.

У каждого пункта:

```js
{
  key: 'textures', label: 'текстуры',
  count: 12,
  bytes: 4 * 1024 * 1024,
  basis: 'cpu-side-only',       // exact | estimated | cpu-side-only | unknown
  limit: 256,                   // потолок из engine.limits(), если он есть
  peak: { count, bytes, frame },// максимум по явным замерам
  biggest: { name, bytes, detail, users },
  top: [ /* до 5 крупнейших */ ],
  source: 'engine.textureList()',
  note: 'RGBA w×h×4 — CPU-оценка; память GPU не измеряется',
  extra: { /* факты источника */ }
}
```

**Выдуманных байтов нет.** Где движок память не отдаёт (звук, Box2D, кэш
ассетов, RmlUi-документы), стоит `bytes: null` и `basis: 'unknown'`. У текстур
`basis: 'cpu-side-only'` — это `w×h×4`, а не замер GPU; у шрифтов
`estimated` — площадь атласа ×4. Если **источника нет** (метод движка не
существует, `$.resource` не установлен), `count`/`bytes` равны `null`, а
`basis: 'unknown'`; пустой список при живом источнике — измеренный `0`, а не
«нет данных». `totals.measured_bytes` — сумма только измеримого,
`totals.unknown_bytes` — сколько пунктов без байтов.

### Бюджеты

```js
$.debug.budget({
  textures: { bytes: 64 * 1024 * 1024, count: 64 },
  audio: 32,                 // число — бюджет байтов
  entities: { count: 500 },
  particles: { count: 2000 },
});
$.debug.budget();            // текущие бюджеты
$.debug.budget({ textures: null });   // снять
$.debug.resourcesResetPeaks();        // забыть пики наблюдаемых замеров
```

Превышение даёт **одно** структурное предупреждение на ключ и вид бюджета
(`count`/`bytes`) через `$.debug.reportError` с кодом
`R2D_RESOURCE_BUDGET`, `subsystem: 'resources'` и `data: { key, kind, limit,
actual, basis }`. Пока значение не вернётся в бюджет, повторного сообщения
нет; после возврата и нового превышения — снова одно. Это не исключение и не
остановка игры.

Стоимость: пока DevTools закрыт, `resources()` не вызывается — таймера и
опроса нет. Таблицу MEM панель снимает при своём обычном обновлении (≈10 Гц
только при открытой F1), явный вызов API — в момент вызова. Пики копятся
только по этим замерам, поэтому «пик» — пик наблюдаемого, а не всей жизни
процесса.


## Полный перечень имён: оверлеи

| Имя | Сигнатура | Проверено запуском |
|---|---|---|
| `$.debug.isOn()` | `→ bool` | включён ли отладочный оверлей; на старте `false` |
| `$.debug.off()` | `→ состояние оверлея` | гасит оверлей и возвращает объект состояния (`{ overlay, draw, profiler }`) — то же, что у `$.debug.toggle()`/`$.console.toggle()`; повторный вызов безопасен |

## Журнал событий — `$.trace`

`$.trace` — кольцо на 256 записей, **opt-in** (`$.trace.on(true)`). Запись
живёт в `src/highlevel/api.js`; отдельной подсистемы чтения нет — `filter`,
`read`, `categories` и `export` читают то же кольцо, что наполняют бой,
контакты, звук, ввод, сцены, сигналы и DevTools (`noteTrace`).

```js
$.trace.on(true);                 // начать запись
$.trace.list();                   // [{ n, kind, frame, source, target, data }]
$.trace.filter({ category: 'combat', limit: 10 });   // последние 10 боевых
$.trace.read({ since: lastN });   // только новое (курсор агента)
$.trace.export({ format: 'text' });                  // строка, файлов не пишет
$.trace.categories();             // ['audio','combat','contact',…] по алфавиту
```

### `filter(opts)` / `read(opts)`

`read` — тот же вызов, что `filter`; имя для агента и DevTools. Оба
возвращают массив записей в порядке **старый → новый**. Опции складываются:

| Опция | Смысл |
|---|---|
| `category` | одна из категорий ниже; неизвестная — пусто + строка в журнал |
| `kind` | точное имя вида: `'attack'`, `'collide'`, `'audio'`, `'signal:door'`… |
| `selector` | селектор `$`; совпадение по `source`/`target` и стабильным id в `data` (`source,target,node,owner,self,other,attacker,victim`) |
| `from`, `to` | диапазон **кадров включительно** |
| `since` | только записи с `n > since` — курсор для опроса без повторов |
| `limit` | **последние N** записей (самые свежие); порядок результата не меняется |

`limit` применяется ПОСЛЕ остальных фильтров; `limit <= 0`/нечисло — пусто.
`from/to/since` принимают числа; нечисло не задаёт границу.

### Категории

| Категория | Виды (`kind`) |
|---|---|
| `combat` | `attack`, `damage`, `death`, `hit`, `combat:filter` |
| `contact` | `collide`, `separate`, `stay`, `sensor`, `sensor:enter`, `sensor:leave` |
| `audio` | `audio` |
| `input` | `input` |
| `scene` | `scene`, `scene:*` |
| `signal` | `signal`, `signal:<имя>` |
| `devtools` | `devtools`, `devtools:*` |
| `other` | всё остальное, включая `$.trace.note('свой-вид')` |

`categories()` возвращает только РЕАЛЬНО присутствующие категории, по
алфавиту; пустой журнал — `[]`. Таблица «вид → категория» одна
(`traceCategoryOf`), её же использует фильтр.

### `export(opts)`

Строка для сохранения/отправки; **файлов не пишет** — вызывающий (игра или
DevTools) сохраняет её через `$.fs.write`/`$.fs.append`. Фильтр — те же
`opts`, что у `filter/read`.

* `format: 'json'` (по умолчанию) — JSON-массив ровно из
  `{ kind, frame, source, target, data }`; порядок тот же, старый → новый.
* `format: 'text'` — по строке на запись:
  `frame <frame> <#id|nid|-> <kind> <payload>`. В позиции участника — `source`,
  а если его нет — `target`; `#id` берётся из живого узла
  по nid; `payload` — короткое `data.name/weapon/action/text`, иначе
  компактный JSON, иначе пусто.

```js
$.trace.export();                       // '[{"kind":"audio",…}]'
$.trace.export({ format: 'text' });     // 'frame 1002 #player audio ak'
$.trace.export({ category: 'combat', limit: 50, format: 'json' });
```

### Пустой/выключенный журнал

Запись opt-in: пока `on(true)` не вызывали (или после `clear()`), `filter`,
`read`, `categories` пусты, `export` даёт `[]`/`''`. `on(false)`
**не стирает** уже записанное — `list/filter/read/export` продолжают читать
кольцо, как и раньше. Никаких выдуманных записей при выключенной трассировке
нет: производители проверяют флаг до создания объекта записи.

Проверка без движка: `tests/js/trace_filter_test.mjs`; на живом движке —
`tests/agent/trace_producers_test.py`.
