# Пример: Recovery (§31-7)

Готовый вертикальный срез восстановления после сбоев на чистом `$`. Относится к
разделу §31 «Документация и вертикальные примеры» и последовательности §49
[спецификации производственной готовности](https://github.com/Nikide/russiano2d/blob/main/docs/PRODUCTION_READINESS.md).
Пошаговый разбор — [docs/tutorial-recovery.md](../../docs/tutorial-recovery.md).

## Запуск

```bash
./build/russiano2d --game demos/recovery
python3 tests/agent/recovery_test.py                          # 66 проверок
R2D_BINARY=build-2d/russiano2d python3 tests/agent/recovery_test.py
```

Экран восстановления — RmlUi (`rml/recovery.rml`): состояние, подробность и
кнопки «Повторить», «Восстановить из копии», «Сбросить прохождение»,
«Смоделировать сбой записи», «Слот из будущего», «Перезагрузить ассет»,
«Записать прогон», «Проиграть», «Проиграть со сдвигом». Те же операции
доступны агенту как `$.recoveryApp.*` — человек и агент вызывают один код.

## Что показывает

| Сбой | Как воспроизводится | Что проверяет тест (факты) |
|---|---|---|
| **Save failure** | запись в каталог `CMakeLists.txt/saves` — путь «внутри файла» | `save()` → `false`, `stats().last_error` с текстом, стадия `temp`; ошибка уходит в `$.debug.errors()`; экран показывает её человеку; рабочее состояние и посторонний слот целы; кадры идут |
| **Corrupted slot** | основной `slot-run.json` заменяется на `{broken json` | `verify().ok === false` и `backup === true`; `load()` берёт `.bak`, `stats().recovered` = 1, из копии поднимается значение v1; `profile` побайтово не изменён |
| **Safe repair** | `$.save.recover('run')` | основной файл **побайтово равен** `.bak`, `verify().ok === true` снова |
| **Слот из будущего** | в слот пишется `version: 999` | `save()` → `false`, код `R2D_SAVE_FUTURE`, файл не изменён, `stats().rejected_future` = 1 |
| **Corrupted asset** | `assets/panel.json` заменяется на `{ nope` | `$.reload.reload('panel')` → `ok:false`, код `R2D_RELOAD_PARSE`, версия не растёт, игра работает на last-known-good (`panel v1`), кадры идут |
| **Safe reload** | файл починен другим содержимым | reload → `ok:true`, `changed:true`, версия 1 → 2, игра видит `panel v2` без перезапуска |
| **Replay divergence** | запись 24 кадров, затем проигрывание с намеренным сдвигом после кадра 7 | чистый прогон: `divergence() === null`; со сдвигом: `tick = 10`, поле `n6.x`, ID `n6`, версия записи 2 — то есть назван **первый** расходящийся tick, поле и ID |

Ключевые числа: запись 24 кадра, checkpoint state hash каждые 10 simulation
ticks, намеренный сдвиг с кадра 7 → первое расхождение фиксируется на tick 10
(первый checkpoint после сдвига). `tests/agent/recovery_test.py` — 66 проверок.

## Как устроено

* `main.js` — точка входа: `install($)` и `$.scene.load('recovery')`;
* `index.js` — сцена, слоты (`build/recovery-saves`), `$.reload.watch('panel')`
  за живым JSON, пара `sampler`/`apply` для записи и проигрывания,
  `$.recoveryApp` для агента;
* `assets/panel.json` — ассет под наблюдением;
* `rml/recovery.rml` — экран восстановления.

Симуляция прогона детерминирована: позиция узла считается из записанного ввода
и gameplay-потока `$.random`, зерно фиксировано, RNG потребляется одинаково при
записи и проигрывании — поэтому state hash сходится, а внесённый сдвиг виден как
расхождение.

## Ограничения (честно)

* **Ядро не классифицирует отказ записи слота.** Стадии `write`/`temp` и отказ
  «слот из будущего» вызывают `fail()`/`failWith()` без проброса `fatal`, поэтому
  `save({ fatal: true })` не пишет в `$.debug`, а `stats().last_failure` для
  `temp` пуст. **Починено в `save.js` (§14):** `fatal` пробрасывается на все
  стадии записи, отказ стадии `temp` даёт код `R2D_SAVE_TEMP` в
  `stats().last_failure` и запись в `$.debug.errors()`. Обход из примера убран —
  он проверяет поведение ядра, а не подменяет его своим кодом.
* **Атомарной замены нет** как обещания: `rename`/`fsync` в биндингах
  `$.fs` отсутствуют, поэтому слот защищён проверкой записи и копией `.bak`, а
  не атомарным `replace`. См. [save.md](../../docs/highlevel/save.md) §2.3.
* **Реплей воспроизводит только записанный ввод.** Симуляция не должна
  зависеть от настенных часов, сети и `Math.random`; ID сборки в заголовке
  задаёт игра (`$.replay.identity`), у JS-биндингов своей версии нет.
* **Смена размера текстуры — не hot reload**: здесь перезагружается JSON, у
  которого нет ни UV, ни native-хендлов. См.
  [reload.md](../../docs/highlevel/reload.md) «Ограничения».
* Слоты примера лежат в `build/recovery-saves` (writable, вне дерева ассетов);
  тест чистит каталог и восстанавливает `assets/panel.json` в `finally`.

## Ссылки

* [save.md](../../docs/highlevel/save.md) — слоты, разделы, `.bak`, транзакция;
* [replay.md](../../docs/highlevel/replay.md) — запись, checkpoints, divergence;
* [reload.md](../../docs/highlevel/reload.md) — конвейер и коды `R2D_RELOAD_*`;
* [diag.md](../../docs/highlevel/diag.md) — `$.debug.errors()` / `reportError`;
* [tutorial-recovery.md](../../docs/tutorial-recovery.md) — пошаговый разбор.
