# Туториал: восстановление после сбоев (§31-7)

Как добавить в игру слоты, копию последнего корректного сохранения, горячую
перезагрузку ассетов и проверку расхождений прогона. Всё — на существующем `$`;
готовый пример — [`demos/recovery`](../demos/recovery/README.md), автоматическая
приёмка — `tests/agent/recovery_test.py` (66 проверок).

Разделы спецификации: §14 (save/restore), §26 (replay), §27 (hot reload),
§17 (диагностика), §31-7 (этот пример).

---

## 1. Что считается «восстановлением»

Сбой — это не только падение процесса. Игра должна переживать четыре вещи:

| Сбой | Кто замечает | Что обязано остаться целым |
|---|---|---|
| запись не удалась (нет прав, диск, битый путь) | `$.save.save()` → `false`, `stats().last_error` | последний корректный слот и текущее состояние игры |
| файл слота испорчен | `$.save.load()` берёт `.bak`, `stats().recovered` | значение последней корректной версии, посторонние слоты |
| ассет не читается | `$.reload.reload()` → `ok:false` + код | last-known-good: игра продолжает работать |
| прогон разошёлся | `$.replay.divergence()` | отчёт: первый tick, поля, ID, версии |

Общий принцип: **ошибка до commit не уничтожает рабочее состояние**. Слот
собирается во временной области и применяется только после проверок, а
неудачная перезагрузка ассета не подменяет прежнее значение.

## 2. Слоты: запись, копия, восстановление

```js
$.save.dir('build/recovery-saves');   // writable-каталог, вне дерева ассетов
$.save.run().set('score', score);     // раздел прохождения (§14)
$.save.profile().set('lang', 'ru');   // настройки: restartRun() их не сбрасывает

const ok = $.save.save('run');
if (!ok) reportToPlayer($.save.stats().last_error);
```

Протокол записи (`docs/highlevel/save.md` §2.3): временный файл → проверка
чтением → копия предыдущей корректной версии в `slot-run.json.bak` → перезапись
основного файла → проверка чтением; при провале проверки основной файл
восстанавливается из копии. Слот «из будущего» (`version` больше поддерживаемой)
**не перезаписывается** — `save()` вернёт `false`, а счётчик
`stats().rejected_future` вырастет.

Чтение и лечение:

```js
// load() при битом основном файле сам возьмёт .bak и посчитает stats().recovered
if (!$.save.load('run')) show($.save.stats().last_error);

// recover() лечит основной файл из копии: после него файл побайтово равен .bak
$.save.recover('run');

// verify() — не меняя ничего: { ok, backup, error }
const v = $.save.verify('run');
```

`$.save.path(name)` даёт путь файла: по нему видно, куда именно пишет игра
(проверяйте, что это writable-каталог, а не каталог установки).

## 3. Отказ записи: человек и машина

Строка в журнал — для человека; машине нужен структурный факт. `$.debug`
собирает его в одном месте (`docs/highlevel/diag.md`):

```js
const ok = $.save.save('run', { fatal: true });
if (!ok) {
    const st = $.save.stats();
    $.debug.reportError('$.save.write', new Error(st.last_error || 'запись не удалась'),
                        { fatal: true, code: 'R2D_SAVE_WRITE' });
}
// позже: $.debug.errors() → [{ seq, code, subsystem, operation, message, … }]
```

**Ограничение ядра (проверено примером).** `save({ fatal: true })` сейчас не
доходит до `$.debug` для стадий `write`/`temp` и для отказа «слот из будущего»:
`writeSlotText()` вызывает `fail()`/`failWith()` без проброса `fatal`, поэтому
`stats().last_failure` для стадии `temp` пуст. **Починено в ядре:** `fatal`
пробрасывается на все стадии записи, отказ даёт `R2D_SAVE_TEMP` в структуре и в
`$.debug.errors()`, поэтому обход больше не нужен. (Историческая справка: обход
на стороне игры был —
как выше: проверить `false` и сообщить самому. Когда ядро начнёт пробрасывать
`fatal`.)

Экран восстановления показывает игроку состояние и предлагает действия:
«Повторить» (`load`), «Восстановить из копии» (`recover`), «Сбросить
прохождение» (`$.save.restartRun()` — сбрасывает run/room, **сохраняя**
profile/presentation).

## 4. Битый ассет и горячая перезагрузка

```js
$.reload.watch('panel', {
    kind: 'json',
    path: 'assets/panel.json',
    validate: (data) => data && data.version === 1 ? true : 'panel.json: version должен быть 1',
    apply: (value) => { $.store.set('panel', value); },
});
$.reload.reload('panel');       // первая загрузка — тоже reload
```

Конвейер `read → validate → prepare → apply`: ошибка любой стадии не публикует
значение и возвращает структуру:

```js
const r = $.reload.reload('panel');
// битый JSON: { ok:false, stage:'validate', code:'R2D_RELOAD_PARSE', error:'…', version:1, changed:false }
// после починки: { ok:true, stage:'applied', code:null, changed:true, version:2 }
```

Игра продолжает работать на прежнем значении (`$.reload.value('panel')`), версия
не растёт, кадры идут. Исправленный файл применяется **без перезапуска**;
`poll()` применяет только изменившееся на диске. Коды — `R2D_RELOAD_*` в
`docs/highlevel/reload.md`.

## 5. Прогон: запись, проигрывание, divergence

Записывайте **ввод**, а не состояние, и применяйте его одной функцией в обе
стороны:

```js
$.replay.actions(['left', 'right', 'jump'], 'actions/v1');
$.replay.checkpoints({ every: 10 });          // state hash каждые 10 ticks

$.replay.record(sampler, apply);              // sampler() → ввод кадра
// … играем …
const text = $.replay.toText();               // одна строка для файла/багрепорта
$.replay.stop();
```

Проигрывание начинается с того же состояния мира (сбросьте позиции и
`$.random.seed(...)`, если генератор влияет на симуляцию):

```js
$.replay.load(text);
$.replay.play(apply);                         // та же apply, что при записи
// …
$.replay.divergence();
// { ok:false, tick:10, expected:'ac2005e6', actual:'c3669809',
//   fields:[{ field:'n6.x', expected:261834, actual:286834 }], ids:['n6'],
//   versions:{ schema:'r2d.replay', replay:2, engine:{…}, rng:{…} }, content:{} }
```

Чистый прогон даёт `divergence() === null`. Отчёт называет **первый** расходящийся
tick, поля (`nid.поле`) и ID узлов: этого достаточно, чтобы понять, что именно
пошло не так. В hash входят RNG (кроме presentation-потоков) и узлы по `nid`
(позиция, угол, скорость, наличие тела); косметика и wall-clock не входят.

`engine.version`/`build` в заголовке JS-биндинги не отдают — их объявляет игра
через `$.replay.identity({ version, build })`, иначе честно `null`.

## 6. Как это проверить

```bash
python3 tools/run_tests.py recovery_test
R2D_BINARY=build-2d/russiano2d python3 tools/run_tests.py recovery_test
```

Тест проверяет байты, коды и номера, а не «метод существует»:

* битый слот → `stats().recovered = 1`, из `.bak` поднято значение v1,
  посторонний слот `profile` побайтово не изменён;
* `recover()` → основной файл побайтово равен `.bak`;
* отказ записи → `false`, код **`R2D_SAVE_TEMP`** и стадия `temp`, запись в `$.debug.errors()`,
  экран показывает отказ, кадры идут;
* слот из будущего → `R2D_SAVE_FUTURE`, файл не изменён;
* битый ассет → `R2D_RELOAD_PARSE`, версия не выросла, last-known-good жив;
* починка → `changed:true`, версия 1 → 2;
* replay: 24 кадра, checkpoint каждые 10, чистый прогон `null`, сдвиг после
  кадра 7 → `tick = 10`, поле `n6.x`, ID `n6`.

## 7. Границы

* Атомарность замены слота не обещается: в `$.fs` нет `rename`/`fsync`,
  защита — проверка записи и `.bak`.
* Реплей воспроизводит только записанный ввод; настенные часы, сеть и
  `Math.random` ломают соответствие, и движок об этом не догадается.
* Смена размера текстуры — не hot reload (UV нормированы по старому размеру).
* Внешний `.rcss` RmlUi кэширует по URL: правка связанного стиля даёт
  `R2D_RELOAD_STYLE_CACHED`; стиль внутри `.rml` применяется сразу.
