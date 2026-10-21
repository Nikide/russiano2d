# Кирпичики: жанровые проекты, собранные в Editor

Снимки сделаны тестом `tests/agent/snippets_genre_projects_test.py --shots` в
настоящем Editor и runtime. Каждый проект: шаблон `blank` → Editor → панель
«Кирпичики» → «Новый объект» → набор жанра из каталога → «Сгенерировать» →
запуск игры. `main.js` поведения не содержит — только строку подключения
`generated/snippets` (её вставляет генератор). Графика — без спрайтов: набор
задаёт поведение, ресурсы назначаются в Inspector полей.

| Жанр | Набор | Editor | Игра |
|---|---|---|---|
| Платформер | `kit.project-platformer` | ![](images/platformer-editor.png) | ![](images/platformer-game.png) |
| Witch | `kit.project-witch` | ![](images/witch-editor.png) | ![](images/witch-game.png) |
| Top-down | `kit.project-top-down-action` | ![](images/top-down-editor.png) | ![](images/top-down-game.png) |
| Визуальная новелла | `kit.project-vn-romance` | ![](images/vn-editor.png) | ![](images/vn-game.png) |
| JRPG | `kit.project-jrpg` | ![](images/jrpg-editor.png) | ![](images/jrpg-game.png) |
| Roguelike | `kit.roguelike-run` | ![](images/roguelike-editor.png) | ![](images/roguelike-game.png) |
| Кооператив | `kit.project-coop-adventure` | ![](images/co-op-editor.png) | ![](images/co-op-game.png) |

Подробно о пакетах, полях, генерации и кодах SNIP — [../SNIPPETS.md](../SNIPPETS.md).
