# Built-in SDK extensions

Сюда кладутся расширения, которые принадлежат движку (scope = `builtin`).
Подкаталог с манифестом `extension.json` / `tool.json` / `manifest.json`
автоматически попадает в effective registry (docs/SDK_EXTENSIONS.md).

Пользовательские расширения живут в платформенном конфиг-пути
(`.../russiano2d/sdk/extensions`), проектные — в `<project>/sdk_extensions/`.
Они не копируются сюда и не требуют правки исходников SDK.

Встроенные инструменты SDK по-прежнему перечисляются в `sdk_tools.json`;
этот каталог — только для расширений, которые добавляют contribution-точки.
