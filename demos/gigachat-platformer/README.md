# Прыжок к маяку

Чистая стартовая точка Russiano2D: один `main.js`, `project.json` и публичный `$` API.

## В Editor

1. Откройте `main.js`, добавьте узлы из `$` API и нажмите Run.
2. Ошибки `r2d lint` и `r2d validate` появятся в Problems.
3. Создайте ресурсы через File → New или меню проекта: тайлкарту для Tilemap Studio, `.particles.json` для Particle Studio, `.rml` для RmlUi Studio.
4. Сохраните, закройте и откройте ресурс снова, затем проверьте Run/Stop и Build.

`project.json` (schema 2) хранит настройки запуска и граф проекта: при Save `.js` Editor сам обновляет `editor.graph` (сцены, объекты, `.appendTo`/`.sprite`); граф виден во вкладке «Граф» нижней панели. Подробности — `docs/PROJECT_JSON.md`.

Шаблон намеренно остаётся пустым, чтобы не навязывать жанр или структуру игры.
