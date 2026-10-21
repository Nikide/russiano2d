# dialog_theme — builtin RML/RCSS, темы и валидация

Модуль отвечает за то, **из чего** собран RML-документ диалога, но не за
narrative state. Всё — чистые функции плюс экземпляр `DialogThemes`, которым
владеет установленный `$.dialog`.

## Builtin

* `DEFAULT_RML` — семантическая разметка с ролями root/box/speaker/text/
  portrait/portrait-image/choices/continue-indicator и шестью choice-кнопками.
* `DEFAULT_RCSS` — layout + CSS variables (`--dialog-font`, `--dialog-text-size`,
  `--dialog-name-size`, `--dialog-width`, `--dialog-height`, `--dialog-bg`,
  `--dialog-text`, `--dialog-name`, `--dialog-portrait-size`).
* `fontFaceRule(family, url)` — helper для `@font-face` в custom RCSS.

## Compose / validate

* `collectRoles(markup)` — роли в порядке документа.
* `prepareMarkup(markup)` — проверяет обязательные роли, вставляет внутренние
  id (`r2d-dlg-<role>[-N]`), возвращает `{ok, markup, roles, errors}`.
* `inlineRcss(markup, rcss)` — вставляет `<style>` в `<head>` (custom font
  подключается только так).
* `validateMarkup(markup)` — pure-валидатор для `$.dialog.validateTheme` и
  hot reload.

## Registry / stack

```js
const themes = new DialogThemes();
themes.define('bashnya', { rml:'ui/dialog/bashnya.rml', rcss:'ui/dialog/bashnya.rcss' });
themes.use('bashnya');
const token = themes.push('memory');
token.release();
```

`default` всегда существует; `resolve(name)` подставляет default RML/RCSS для
недостающих частей, поэтому работают все комбинации default/custom RML+RCSS.
Пути читаются через `$.fs.readText`; inline-строки не требуют файловой системы.

## Ограничения

* RCSS не парсится и не валидируется здесь: синтаксис проверяет RmlUi при
  загрузке; native `r2d dialog validate` проверяет роли, теги, linked RCSS
  и файлы шрифтов.
* Hot reload «все или ничего»: при ошибке view не выгружает прошлый документ.

Проверка: `tests/js/vn_narrative_test.mjs`.
