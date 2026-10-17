# dialog_view — RML presentation для `$.dialog`

`$.dialog` владеет narrative state, а `dialog_view.js` только рисует его в
RmlUi-документе. Логика не знает DOM id: автор помечает элементы
`data-dialog-role`, view сам вставляет внутренние id и биндит элементы.

## Роли

* обязательные: `root`, `text`, `choices`;
* опциональные: `box`, `speaker`, `portrait`, `portrait-image`,
  `continue-indicator`, `choice`, `choice-text`.

Повторяющиеся роли (`choice`, `choice-text`) получают суффиксы `-1`, `-2`, …
Авторские `id` разрешены: view использует их, если они уже есть.

## API

`createDialogView({backend, themes, readText, onAction})`:

| метод | действие |
|---|---|
| `load(name)` / `reload()` | загрузить тему / перечитать текущую (последний валидный вид сохраняется при ошибке) |
| `show()` / `hide()` / `destroy()` | видимость и освобождение документа |
| `render(model)` | полный view model: speaker/text/portrait/choices/root-classes |
| `setSpeaker`, `setText`, `setPortrait`, `setChoices`, `setContinue` | точечные обновления |
| `roles`, `document`, `errors`, `actions` | диагностика для тестов/агента |

`makeUiBackend(engine.ui)` адаптирует нативные `loadMarkup/unload/show/setText/
setClass/setAttr/setProperty/on`. Backend заменяем, поэтому qjs-тест проверяет
семантику без окна.

## Root-классы

View выставляет `.typing/.ready`, `.has-speaker`, `.has-portrait`,
`.has-choices`, `.auto`, `.skip`, `.backlog-open`, а на портрете —
`.active-speaker/.inactive-speaker` и `slot-*`. RCSS решает, как это выглядит.

Проверка: `tests/js/vn_narrative_test.mjs` (рендер, слоты, выборы, hot reload).
