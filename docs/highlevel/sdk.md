# Мост инструментов — `$.sdk`

`$.sdk` доступен проектам инструментов, например встроенному Editor. Он
запускает CLI-операции `r2d` и игры как дочерние процессы без shell. Публичный
игровой API по-прежнему `$`; обычные игры не должны включать мост.

Мост включается только явным `"toolHost": true` в `project.json`:

```json
{ "title": "Russiano2D Editor", "toolHost": true }
```

```js
const res = await $.sdk.tool(['validate', projectPath]);
res.ok;          // exitCode === 0 и json.ok !== false
res.json;        // структурированный ответ команды r2d

const game = $.sdk.launch(['--game', projectPath, '--headless', '--frames', '60']);
game.done.then((result) => $.log('игра завершилась: ' + result.exitCode));
game.peek();     // { running, output, … } без ожидания конца
game.kill();
```

## Методы

| Вызов | Смысл |
|---|---|
| `$.sdk.available()` | Мост включён проектом и native процессный host доступен |
| `$.sdk.paths()` | `{ tool, toolFound, engine, exeDir }`; `tool` и `engine` указывают на единый `r2d` |
| `$.sdk.tool(args, { timeout }?)` | Выполнить `r2d <команда> …` и вернуть Promise результата |
| `$.sdk.launch(args, { timeout }?)` | Запустить `r2d` с аргументами игры; вернуть `{ id, done, kill(), peek() }` |
| `$.sdk.moduleRoot(id, root)` | Зарегистрировать каталог для `import('sdk-ext/<id>/…')` расширения |
| `$.sdk.active()` | Число отслеживаемых процессов |

Результат `tool()` имеет форму `{ ok, exitCode, json, output, truncated, killed,
error }`. CLI команды печатают один JSON-объект; если его нет, `ok` будет `false`
и `error` объяснит причину. Первый аргумент `tool()` — имя команды без дефиса,
например `['world', 'compile', mapPath]`.

Для `r2d run` и `r2d build` `json.outputTail` содержит хвост вывода runtime;
у сборки там перечислены упакованные скрипты и ассеты, затем их размеры и
состояние сжатия/шифрования. Поле вмещает до 64 КиБ; при превышении вывода оно
начинается явной строкой об усечении.

## Гарантии и ограничения

- Вызов не блокирует кадр: вывод читается отдельно, Promise разрешается в
  `tickSdk()`. Одновременно допускается до 16 процессов.
- `tool()` ждёт до 120 секунд по умолчанию, после чего процесс завершается с
  диагностикой таймаута. `launch()` не имеет таймаута по умолчанию.
- Буфер вывода ограничен 1 MiB; при обрезке `truncated` равен `true`.
- При завершении приложения оставшиеся процессы останавливаются.
- В web-сборке процессы недоступны и `available()` возвращает `false`.
- Произвольного запуска shell-команд нет. Для инструментов вызывайте native
  команду `r2d`, для игры — `launch()`.

## Проверка

`tests/js/sdk_test.mjs` покрывает очередь, таймауты и ошибки на подменённом
бэкенде. `tests/agent/editor_extensions_test.py` проверяет регистрацию корней
`moduleRoot()` и загрузку project extensions в Editor; `tests/agent/sdk_extensions_test.py`
проверяет native discovery и legacy compatibility shell.
