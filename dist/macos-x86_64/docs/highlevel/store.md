# Файлы и сохранения — `$.fs` и `$.store`

* `$.fs` — чтение и запись файлов рядом с игрой (путь от корня запуска).
* `$.store` — обычный key-value, который сохраняется в JSON на диск.

```js
$.store.set('highscore', 1200);
$.store.set('settings', { volume: 0.7, lang: 'ru' });
$.store.save();                       // в сохранение по умолчанию

$.store.autoSave(true);               // сохранять при изменениях
const hp = $.store.get('hp', 100);    // значение по умолчанию
```

---

## 1. Методы `$.store`

| Вызов | Смысл |
|---|---|
| `set(key, value)` / `setAll(obj)` | записать значение / пачку (возвращают `$.store` — цепочка) |
| `get(key, fallback?)` / `has(key)` | прочитать / проверить |
| `remove(key)` / `clear()` | удалить ключ / всё |
| `keys()` / `all()` | список ключей / весь объект данных |
| `file(path?)` | без аргумента — имя файла по умолчанию (`"save.json"`), с аргументом — выбрать другой и вернуть `$.store` |
| `save(path?)` / `load(path?)` | запись и чтение JSON; без аргумента — файл из `file()`; возвращают `bool` (совместимость) |
| `saveResult(path?)` / `loadResult(path?)` | то же, но структура: `{ ok, stage, code, message, path, backup, temp/recovered, atomic, schema }` |
| `lastFailure()` | структура последнего отказа (или `null`) |
| `schema(cfg?)` | игровая схема файла настроек (§4) |
| `stats()` | `{ file, schema, schema_migrations, loads, saves, backups, recovered, dirty, last_failure }` |
| `autoSave(ms?)` / `stopAutoSave()` | автосохранение по игровому времени (по умолчанию 30000 мс, пишет только при изменениях) |

`get` с вторым аргументом не падает на пропущенном ключе — это основной способ
играть с настройками.

**Чего у `$.store` нет** (частые догадки): `list()`, `count()`, `exists()`,
`basePath()` — их не существует. Список файлов, проверка существования и корень
запуска живут у `$.fs` (`list`, `exists`, `basePath`), а размер данных —
`Object.keys($.store.all()).length`.

## 2. Методы `$.fs`

| Вызов | Смысл |
|---|---|
| `readJSON(path, fallback?)` / `readText(path)` | чтение |
| `writeJSON(path, data)` / `write(path, text)` | запись |
| `writeAtomic(path, text \| object)` | **атомарная замена** файла через `engine.fs.writeAtomic` (temp рядом + `fsync` + `rename`); без биндинга — обычная запись (`$.store`/`$.save` добавляют temp+backup) |
| `exists(path)` | есть ли файл (видит и встроенные данные собранной игры) |
| `list(dir)` | пути в каталоге, отсортированы |
| `remove(path)` | удалить файл (идемпотентно: файла нет — тишина, см. ниже) |
| `basePath()` | корень, от которого считаются относительные пути |
| `$.fs.documentsPath()` | системный каталог «Документы» текущего пользователя на этой ОС |
| `pickFolder(opts?)` | системное окно выбора папки → `Promise<string \| null>` |
| `pickFile(opts?)` | системное окно выбора файла → `Promise<string \| string[] \| null>` |
| `saveFile(opts?)` | системное окно «Сохранить как» → `Promise<string \| null>` (сам файл не пишет) |

Чтение сначала проверяет встроенные данные собранной игры, затем файлы на
диске: каталог выбранного `--game` → корень запуска (`$.fs.basePath()`).
Абсолютные пути принимаются как есть.
Запись и удаление работают на диске; встроенный payload не меняют.

`write`/`writeJSON`/`writeAtomic`/`store.save()` возвращают `false`, если файл записать не
удалось (например, каталог только для чтения). Причина отказа теперь видна:
печатается ровно одна строка с путём и причиной (`Permission denied (errno 13)`,
`Read-only file system (errno 30)`, `No such file or directory (errno 2)`), и в
`$.debug.errors()` кладётся запись `R2D_FS_WRITE_FAILED` (subsystem `fs`,
recoverable `true`) с `assetPath`. Успешная запись журнал не трогает — одна
строка на отказ, ноль на успех. Проверять код возврата всё равно обязательно:
причина объясняет отказ, но не отменяет его.

`remove(path)` **идемпотентен**: если файла нет, это не отказ — возвращается
`false` (на нём держится различение «удалил» и «и так нет», см. `$.save.remove`),
и в журнал не пишется ничего. Настоящий отказ (нет прав на каталог, каталог
непустой) виден так же, как отказ записи, но с кодом `R2D_FS_REMOVE_FAILED`:

```js
$.fs.remove('save.json');   // файла нет → false, тишина (идемпотентная уборка)
$.fs.remove('saves');       // каталог непустой → false и одна строка:
// $: ошибка в $.fs.remove: не удалось удалить "…/saves": Directory not empty
//    (errno 66) (код R2D_FS_REMOVE_FAILED)
```

Успешное удаление тоже молчит. Проверки: `tests/agent/fs_write_failure_test.py`
(запись и удаление, тишина на успехе).

### Системные окна выбора

`pickFolder`/`pickFile`/`saveFile` открывают окно ОС (SDL3
`SDL_ShowFileDialogWithProperties`, `src/dialog.c`) и не блокируют кадр:
ответ приходит в безопасной фазе кадра.

| Опция | Смысл |
|---|---|
| `title` | заголовок окна (на части ОС игнорируется) |
| `path` | где открыть окно (папка или файл) |
| `filters` | `[{ name: 'Картинки', ext: 'png;jpg' }]`; точки, пробелы и запятые в `ext` убираются; у `pickFolder` не действуют |
| `many` | только `pickFile`: можно выбрать несколько, ответ — массив |

Ответ — абсолютный путь (или массив при `many`), `null` — пользователь нажал
«Отмена». Если окно не открылось (нет оконной системы, нет портала на Linux),
Promise отклоняется ошибкой с `code: 'R2D_FS_DIALOG_FAILED'`, и та же запись
попадает в `$.debug.errors()` — тихого `null` вместо ошибки нет.

```js
const dir = await $.fs.pickFolder({ title: 'Папка проекта' });
if (dir) openProject(dir);
const png = await $.fs.pickFile({ filters: [{ name: 'PNG', ext: 'png' }] });
```

Проверки: `tests/js/fs_dialog_test.mjs` (7, контракт обёртки на заглушке).
Сам системный диалог автоматическим тестом не проверяется — он требует
пользователя.

## 3. Атомарная замена, backup и восстановление

```js
$.fs.writeAtomic('save.json', { version: 1, data: { volume: 0.6 } });
```

`writeAtomic` — замена целевого файла **атомарно**: биндинг
`engine.fs.writeAtomic(path, text)` делает временный файл рядом, `fsync` и
`rename`, поэтому сбой посреди записи не оставляет половину JSON. Если сборка
старая и биндинга нет, `$.fs.writeAtomic` честно падает на обычную запись —
атомарности в этом случае нет, и это видно по `saveResult().atomic === false`.

`$.store.save()` и `$.save` заменяют **целевой** файл через
`writeAtomic`, сохраняя прежний протокол:

1. временный `<файл>.tmp` + проверка прочитанным (что реально легло на диск);
2. копия последней **корректной** версии в `<файл>.bak`;
3. `writeAtomic` заменяет основной файл;
4. проверка чтением; при расхождении основной файл восстанавливается из `.bak`.

Отказы:

| Код / стадия | Когда |
|---|---|
| `R2D_STORE_READ_FAILED` (`read`) | файл есть, но не читается как JSON-объект, и `.bak` нет |
| `R2D_STORE_WRITE_FAILED` (`temp`/`replace`) | запись не удалась (причина — из `$.fs`, например read-only) |
| `R2D_STORE_VERIFY_FAILED` (`verify-temp`/`verify`) | записанное не совпало с прочитанным; при `.bak` — откат |
| `R2D_SAVE_SCHEMA_FUTURE` (`schema`) | файл записан схемой новее текущей |

**Повреждённый файл.** `load()` берёт `.bak`, возвращает `true`,
`loadResult()` показывает `recovered: true, backup: true`, `stats().recovered`
растёт. **Тихого сброса нет:** если ни основной файл, ни `.bak` не читаются,
`load()` возвращает `false`, данные в памяти остаются прежними, причина —
в `loadResult()`/`lastFailure()` и одной строкой в журнале (плюс
`$.debug.reportError` с `subsystem: 'store'`).

**Схема из будущего.** Если `schema` в файле больше объявленной игрой, это не
повреждение и не повод сбрасывать настройки: `load()` возвращает `false`,
данные в памяти целы, `save()` отказывается затирать такой файл
(`R2D_SAVE_SCHEMA_FUTURE`). Если `.bak` читается нашей схемой — берётся он
(`recovered`), а файл будущей схемы остаётся на диске как есть.

## 4. Схема настроек: `$.store.schema`

Контракт ровно тот же, что у `$.save.schema` (`save.md` §2.6): версия, шаги
миграций `k → k+1`, defaults и validate. Схема пишется в файл целым полем
`schema`; файл без него — legacy-схема `0`. Миграции получают **документ
файла** (`{ version, saved_frame, data, schema }`), поэтому настройки
адресуются как `doc.data.*`; для «сырого» JSON без `data` — прямо в корне.

```js
$.store.schema({
    version: 2,
    migrate: {
        0: (doc) => { doc.data.volume = 0.7; return doc; },     // legacy-файл
        1: (doc) => { doc.data.muted = false; return doc; },
    },
    defaults: { data: { volume: 0.7, lang: 'ru' } },
    validate: (doc) => !!doc.data,
});
$.store.load();     // старый файл доедет до схемы 2 сам
$.store.save();     // запишет "schema": 2
```

Порядок, коды и стадии отказа — те же: `R2D_SAVE_SCHEMA_FUTURE` (`schema`),
`R2D_SAVE_SCHEMA_MIGRATION` (`migration`), `R2D_SAVE_SCHEMA_DEFAULTS`
(`defaults`), `R2D_SAVE_SCHEMA_INVALID` (`validate`). `$.store.schema()` без
аргумента отдаёт `{ version, migrations, defaults, validate, errors }`;
`$.store.schema(null)` выключает схему.

## 5. Ограничения

| Чего нет | Что делать |
|---|---|
| Песочницы на уровне файловой системы | её нет; абсолютные пути принимаются, поэтому ограничение доступа задаёт окружение запуска |
| Нескольких слотов в одном файле | `save('slot2.json')` — имя файла и есть слот |
| Шифрования и защиты от правки | сохранение — обычный JSON; для честности — хеш на стороне игры |
| Версионирования формата настроек | есть `$.store.schema` (§4): версия, миграции, defaults, validate; отдельного «номера версии» в ключах не нужно |
| Синхронизации с облаком | `$.http` есть, но это HTTP-клиент, а не хранилище |
| Подтверждения записи | `save()`/`write()` возвращают `false` **и** печатают причину (`R2D_FS_WRITE_FAILED`); `remove()` на отсутствующем файле молчит — это идемпотентность, а не подтверждение удаления |
| Атомарности без биндинга | в старой сборке без `engine.fs.writeAtomic` замена не атомарна: `saveResult().atomic === false`, защита — temp+backup+verify (см. §3) |


## Полный перечень имён: чтение и массовые операции

Проверено на живом движке (1.2.0), `tests/fixtures/hello`.

| Имя | Сигнатура | Проверено запуском |
|---|---|---|
| `$.store.keys()` | `→ string[]` | ключи хранилища в порядке появления; на пустом хранилище `setAll({a:1,b:2})` даёт ровно `['a','b']`, при уже занятых ключах новые идут в конец (`['k','a','b']`) |
| `$.store.setAll(object)` | `→ $.store` | записывает все пары объекта; возвращает сам `$.store` (цепочка) |
| `$.store.remove(key)` | `→ $.store` | убирает ключ: после `remove('a')` в `keys()` его нет; возвращает `$.store` |
| `$.store.clear()` | `→ $.store` | чистит хранилище целиком: после `setAll({a:1,b:2})` и `clear()` → `keys()` = `[]` |
| `$.store.autoSave(ms)` | `→ number` | **не геттер**: включает (или перезапускает) автосохранение раз в `ms` игрового времени, по умолчанию `30000` мс, и возвращает **id таймера** для `$.time.cancel`. Проверено: первый вызов вернул `1`, после `stopAutoSave()` следующий — `2` |
| `$.store.stopAutoSave()` | `→ $.store` | останавливает таймер автосохранения и обнуляет его id (для тестов и режимов без записи на диск); возвращает `$.store` |
| `$.store.file()` | `→ string` | путь файла хранилища |
| `$.store.saveResult(path?)` | `→ { ok, stage, code, message, path, backup, temp, atomic, schema }` | структура записи: `atomic` говорит, была ли замена атомарной в этой сборке |
| `$.store.loadResult(path?)` | `→ { ok, stage, code, message, path, backup, recovered, schema, current }` | структура чтения; `recovered` — данные взяты из `.bak` |
| `$.store.lastFailure()` | `→ object \| null` | последний отказ чтения/записи (код, стадия, файл, схема) |
| `$.store.schema(cfg?)` | `→ object \| $.store` | игровая схема файла настроек; без аргумента — что объявлено |
| `$.store.stats()` | `→ object` | `{ file, schema, schema_migrations, loads, saves, backups, recovered, dirty, last_failure }` |
| `$.fs.pickFolder(opts?)` | `→ Promise<string \| null>` | контракт — `tests/js/fs_dialog_test.mjs` |
| `$.fs.pickFile(opts?)` | `→ Promise<string \| string[] \| null>` | контракт — `tests/js/fs_dialog_test.mjs` |
| `$.fs.saveFile(opts?)` | `→ Promise<string \| null>` | контракт — `tests/js/fs_dialog_test.mjs` |
| `$.fs.writeAtomic(path, data)` | `→ bool` | атомарная замена (temp+fsync+rename) при наличии биндинга; иначе обычная запись |
