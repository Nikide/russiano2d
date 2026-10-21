// ===========================================================================
// Манифест проекта: имя окна, размер, версия игры.
//
// Файл `project.json` лежит рядом с точкой входа (с `main.js`) и описывает
// то, что видит игрок при запуске, а не движок:
//
//   {
//     "title":   "Моя игра",
//     "width":   1280,
//     "height":  720,
//     "version": "1.0.0"
//   }
//
// schema_version 2 (docs/PROJECT_JSON.md) — вложенный манифест:
//   "schema_version": 2,
//   "project": { "name": "…", "version": "…" },
//   "runtime": { "entry": "main.js", "start_scene": "menu",
//                "window": { "title": "…", "width": 1280, "height": 720, "fullscreen": false } },
//   "editor":  { "graph": { … } }       — граф проекта для Editor, рантайм его игнорирует
// Манифест без schema_version — минимальный плоский (title/width/height/version).
// Все поля необязательны: чего нет — берётся из значений по умолчанию.
// Файл читается и из папки проекта, и из груза собранной игры, поэтому имя
// окна попадает в собранный бинарник само, без пересборки движка.
//
// Порядок старшинства при запуске: флаги командной строки → манифест →
// значения по умолчанию. Из скриптов имя окна меняется в любой момент:
// `$.app.title('Уровень 2')`.
// ===========================================================================
#pragma once

#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

#define R2D_TITLE_MAX 256

typedef struct R2dProject {
    char title[R2D_TITLE_MAX];
    int  width;
    int  height;
    char version[64];

    bool has_title;
    bool has_size;

    // "toolHost": true — проект сам является инструментом SDK и получает мост
    // `$.sdk` к нативному бэкенду r2d-sdk (src/sdk_host.h). Обычным играм он
    // не нужен и по умолчанию выключен.
    bool tool_host;

    bool fullscreen;        // v2 "runtime.window.fullscreen"
    int  schema_version;    // 1 (нет поля) или 2
    char entry[512];        // v2 "runtime.entry", пусто — main.js
    char start_scene[128];  // v2 "runtime.start_scene", пусто — нет
} R2dProject;

// Значения по умолчанию (пустой манифест).
void r2d_project_defaults(R2dProject *project);

// Читает project.json: сначала из груза, затем из каталога игры на диске.
// Отсутствие файла — не ошибка: остаются значения по умолчанию.
// `game_dir` может быть NULL, `payload_entry` — относительный путь точки
// входа в грузе (нужен, чтобы выбрать правильный project.json, если их
// несколько). Возвращает true, если файл найден.
bool r2d_project_load(R2dProject *project, const char *game_dir, const char *payload_entry);

// Только диск: <dir>/project.json (для `build`, где груза нет).
bool r2d_project_load_dir(R2dProject *project, const char *dir);

#ifdef __cplusplus
}
#endif
