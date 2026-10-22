// ===========================================================================
// r2d: нативный бэкенд инструментов Russiano2D SDK.
//
// Один C-код для всех клиентов (docs/SDK.md §2): GUI SDK (приложение R2D, мост
// `$.sdk`), CLI `r2d` и агент вызывают одни и те же функции. Внешних
// runtime (Python, Node.js, shell) здесь нет и быть не должно.
//
// Все команды отвечают одним JSON-объектом на stdout:
//   { "ok": bool, ..., "diagnostics": [ { code, severity, asset, location,
//                                           message, details } ] }
// Диагностика — только факты (docs/AGENT_IMPLEMENTATION_RULES.md, правило 9).
// ===========================================================================
#pragma once

#include "json.h"

#include <stdarg.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

// Версия нативного tooling backend = версия проекта: приходит определением
// R2D_SDK_VERSION из xmake.lua. Запасное значение — только для
// сборки вне CMake (например, ручной компиляции одного файла).
#ifndef R2D_SDK_VERSION
#define R2D_SDK_VERSION "0.0.0-dev"
#endif
#define SDK_VERSION R2D_SDK_VERSION

// ---------------------------------------------------------------------------
// Диагностика
// ---------------------------------------------------------------------------
typedef enum SdkSeverity {
    SDK_INFO = 0,
    SDK_WARNING,
    SDK_ERROR,
    SDK_FATAL,
} SdkSeverity;

const char *sdk_severity_name(SdkSeverity s);

// Набор диагностик одной операции. `items` — JSON-массив объектов, собирается
// по мере добавления; счётчики нужны итоговому `ok`/`warnings`/`errors`.
typedef struct SdkReport {
    R2dSb items;      // «{...},{...}» без внешних скобок
    int   count;
    int   infos;
    int   warnings;
    int   errors;     // включая fatal
} SdkReport;

void sdk_report_init(SdkReport *r);
void sdk_report_free(SdkReport *r);

// `location` и `details` — готовые JSON-литералы (объект/массив/строка) или
// NULL. Сообщение — printf-формат.
void sdk_diag(SdkReport *r, SdkSeverity sev, const char *code, const char *asset,
              const char *location, const char *details, const char *fmt, ...);
void sdk_diagv(SdkReport *r, SdkSeverity sev, const char *code, const char *asset,
               const char *location, const char *details, const char *fmt, va_list ap);

// Дописывает в `out`: "diagnostics":[...] (без ведущей запятой).
void sdk_report_put(const SdkReport *r, R2dSb *out);
// Дописывает счётчики: "errors":N,"warnings":N,"infos":N
void sdk_report_put_counts(const SdkReport *r, R2dSb *out);

// ---------------------------------------------------------------------------
// Файлы и пути
// ---------------------------------------------------------------------------
// Читает файл целиком; результат — malloc'нутая строка с завершающим нулём
// (освобождать free()). NULL, если файла нет.
// Префикс «файла» из встроенного пакета бинарника (tools/embed_bundle.py);
// sdk_read_file читает такие пути из памяти, остальное — с диска.
#define SDK_BUILTIN_PREFIX "r2d-builtin:"
char *sdk_read_file(const char *path, size_t *size);
bool  sdk_write_file(const char *path, const void *data, size_t size);
bool  sdk_file_exists(const char *path);
bool  sdk_is_dir(const char *path);
// Каталог файла: «a/b/c.json» → «a/b». Без каталога — «.».
void  sdk_dirname(const char *path, char *out, size_t cap);
void  sdk_join(const char *a, const char *b, char *out, size_t cap);
// Абсолютный путь (от cwd) для внешнего процесса: движок резолвит --game от
// своего каталога, поэтому относительный путь пользователя надо сделать
// абсолютным. Абсолютный путь возвращается без изменений.
bool  sdk_abs_path(const char *path, char *out, size_t cap);
bool  sdk_ends_with(const char *s, const char *suffix);
// Простой glob: `*` — любая последовательность, `?` — любой символ.
// Регистр не учитывается. Сопоставляется имя файла, а не весь путь.
bool  sdk_glob_match(const char *pattern, const char *name);
// «a/b/c.png» → «c.png»
const char *sdk_basename(const char *path);
// Каталог исполняемого файла (с завершающим «/»).
const char *sdk_exe_dir(void);

// ISO 8601 с часовым поясом: 2026-10-08T17:00:00+03:00, ...Z.
bool sdk_iso8601_tz_ok(const char *s);

// Разбор JSON-файла. При ошибке пишет диагностику SDK_JSON_PARSE и
// возвращает NULL.
R2dJson *sdk_load_json(const char *path, SdkReport *rep);

// Дописывает `"key":` и экранированную строку.
void sdk_put_kv_str(R2dSb *sb, const char *key, const char *value);

// ---------------------------------------------------------------------------
// Реестр инструментов (sdk_tools.json)
// ---------------------------------------------------------------------------
typedef struct SdkTool {
    char  id[64];
    char  name[128];
    char  description[512];
    char  last_updated[40];
    char  entry[128];
    char  binary[256];          // относительный путь к нативному бинарнику или ""
    char  category[64];
    char *assets[16];           // glob-шаблоны имён файлов
    int   asset_count;
    bool  valid;
    // Инструмент, пришедший из расширения (docs/SDK_EXTENSIONS.md): JS-модуль
    // лежит вне sdk/tools, поэтому вместо entry-имени хранится абсолютный путь.
    char  module[1200];         // абсолютный путь к JS-модулю, "" для built-in
    char  source[16];           // "builtin" | "user" | "project"
} SdkTool;

typedef struct SdkRegistry {
    int      schema_version;
    SdkTool *tools;
    int      count;
    char     path[1024];
} SdkRegistry;

// Загружает и проверяет реестр. Ошибки схемы попадают в `rep`; найденные
// записи остаются в списке с признаком valid=false (ничего не пропускается
// молча). Возвращает false, если схему прочитать нельзя вовсе.
bool sdk_registry_load(const char *path, SdkRegistry *reg, SdkReport *rep);
void sdk_registry_free(SdkRegistry *reg);
void sdk_registry_put_json(const SdkRegistry *reg, R2dSb *out);

// ---------------------------------------------------------------------------
// Расширения SDK и standalone-инструменты (docs/SDK_EXTENSIONS.md)
// ---------------------------------------------------------------------------
// Контракт расширения имеет собственную целочисленную версию. Это НЕ версия
// движка: расширение с другой версией отключается с диагностикой, остальные
// инструменты SDK продолжают работать.
#define SDK_EXT_API_VERSION 1

typedef struct SdkExtTool {
    char id[128];
    char name[160];
    char description[512];
    char entry[256];            // относительно каталога расширения
    char category[64];
    char assets[8][128];
    int  asset_count;
} SdkExtTool;

typedef struct SdkExtension {
    char id[128];
    char name[160];
    char description[512];
    char version[40];
    char category[64];
    char scope[16];             // builtin | user | project
    char root[1200];            // абсолютный каталог расширения
    char manifest_path[1400];
    char entry[512];            // относительный JS-модуль входа
    int  sdk_api;
    bool valid;                 // манифест корректен и sdk_api совпал
    bool enabled;               // включено в effective registry
    bool standalone;            // tool.json: отдельный инструмент без contributes
    int  contributes_count;     // сколько contribution-точек объявлено
    int  c_tools, c_menus, c_toolbar, c_panels, c_inspectors,
         c_entity_defs, c_world_tools, c_validators, c_build_steps,
         c_agent_commands;
    SdkExtTool tools[16];
    int  tool_count;
    char permissions[8][64];
    int  permission_count;
    char *contributes_json;     // malloc: компактный JSON объявленных contributions
} SdkExtension;

typedef struct SdkExtensions {
    SdkExtension *items;
    int count, cap;
    char builtin_root[1200];
    char user_root[1200];
    char project_root[1200];
} SdkExtensions;

typedef struct SdkExtOptions {
    const char *sdk_root;       // каталог с sdk_tools.json (абсолютный)
    const char *project_dir;    // проект для project-scope расширений, или NULL
    const char *builtin_dir;    // переопределение built-in каталога
    const char *user_dir;       // переопределение user каталога (тесты/CI)
} SdkExtOptions;

// Детерминированный discovery: built-in -> user -> project, каталоги по имени.
// Ошибки одного расширения — структурные диагностики и enabled=false; скан
// остальных продолжается.
bool sdk_extensions_scan(const SdkExtOptions *opt, SdkExtensions *out, SdkReport *rep);
void sdk_extensions_free(SdkExtensions *ext);
// Добавляет contributed/standalone инструменты в effective registry. Дубликат
// id — SDK_EXTENSION_DUPLICATE_ID, запись пропускается (silent override нет).
void sdk_extensions_append_tools(const SdkExtensions *ext, SdkRegistry *reg, SdkReport *rep);
// Снимок для GUI/агента (id, scope, enabled, counts): "extensions":[...].
void sdk_extensions_put_json(const SdkExtensions *ext, R2dSb *out);
// Проверка одного каталога расширения (для команды extension validate PATH).
bool sdk_extension_validate_dir(const char *dir, const char *scope,
                                SdkExtension *out, SdkReport *rep);
// Реализация команд CLI объявлена ниже, после typedef SdkArgs.

// ---------------------------------------------------------------------------
// Ассеты
// ---------------------------------------------------------------------------
// Тип ассета по имени файла. Возвращает стабильный идентификатор типа или
// "file". Сопоставление — по суффиксам из sdk_assets.c.
const char *sdk_asset_type(const char *path);

typedef struct SdkAssetEntry {
    char  *path;     // относительно корня, всегда с «/»
    const char *type;
    int64_t size;
    int64_t mtime;   // секунды Unix
    char   tool[64]; // id инструмента из реестра, который открывает файл, или ""
} SdkAssetEntry;

typedef struct SdkAssets {
    SdkAssetEntry *items;
    int count;
    int cap;
    bool truncated;
} SdkAssets;

bool sdk_assets_scan(const char *root, const SdkRegistry *reg, SdkAssets *out, SdkReport *rep);
void sdk_assets_free(SdkAssets *a);

// ---------------------------------------------------------------------------
// Граф зависимостей ассетов (sdk_deps.c): манифест deps.json и служебный кэш
// .r2d/cache/assets.json. Это не второй build system и не ассет-база: файлы
// игры остаются обычными файлами, а runtime кэш не читает никогда.
// ---------------------------------------------------------------------------
// FNV-1a 64 содержимого (тот же алгоритм, что в src/payload.c и src/audio.c).
uint64_t sdk_deps_hash64(const void *data, size_t size);
// Путь в манифесте обязан быть относительным, без «.», «..», «//», «\» и диска.
bool sdk_deps_path_ok(const char *rel);

// ---------------------------------------------------------------------------
// Процессы (SDL_Process: массив аргументов, без shell)
// ---------------------------------------------------------------------------
typedef struct SdkProcResult {
    bool  started;
    int   exit_code;
    char *out;       // stdout (+stderr), malloc, может быть NULL
    size_t out_size;
} SdkProcResult;

bool sdk_run_process(const char *const *argv, SdkProcResult *res);
void sdk_proc_free(SdkProcResult *res);
// Путь к бинарнику движка: --engine, R2D_ENGINE, рядом с r2d.
bool sdk_find_engine(const char *override_path, char *out, size_t cap);

typedef struct SdkArgs {
    int          argc;
    const char **argv;   // без имени программы и команды
} SdkArgs;

// ---------------------------------------------------------------------------
// JSON и изображения
// ---------------------------------------------------------------------------
// Компактная запись произвольного JSON в каноническом виде SDK: пробел после
// «:» и «,», объекты и массивы в одну строку. Порядок ключей сохраняется.
void sdk_json_put_compact(R2dSb *sb, const R2dJson *v);

// Размер изображения (PNG/JPG/BMP…) без полной декодировки.
bool sdk_image_info(const char *path, int *w, int *h);
// RGBA8 целиком; освобождать sdk_image_free(). NULL при ошибке.
uint8_t *sdk_image_load_rgba(const char *path, int *w, int *h);
uint8_t *sdk_image_load_rgba_mem(const uint8_t *data, size_t size, int *w, int *h);
void sdk_image_free(uint8_t *pixels);
// Запись RGBA8 в PNG.
bool sdk_image_write_png(const char *path, const uint8_t *rgba, int w, int h);

// ---------------------------------------------------------------------------
// Атласы спрайтов (формат Aseprite-совместимый, читается $.atlas — docs/SDK.md §7)
// ---------------------------------------------------------------------------
void sdk_validate_atlas(const char *path, SdkReport *rep);
// Манифест batch и сессия агента (sdk_manifest.c): те же правила, по которым
// эти файлы исполняются, поэтому панели Automation/DevTools и CLI не расходятся.
void sdk_validate_sdk_manifest(const char *path, SdkReport *rep);
void sdk_validate_agent_session(const char *path, SdkReport *rep);
// Приводит JSON атласа к каноническому виду (одна строка на кадр, тег, слайс).
// Возвращает malloc'нутый текст или NULL (ошибка — в rep).
char *sdk_atlas_canonical(const R2dJson *root, SdkReport *rep, const char *asset);
int sdk_cmd_atlas_grid(const SdkArgs *a);
int sdk_cmd_atlas_format(const SdkArgs *a);
int sdk_cmd_atlas_info(const SdkArgs *a);
int sdk_cmd_sprite_mesh_bake(const SdkArgs *a);

// ---------------------------------------------------------------------------
// Re2D World: `*.re2dmap` → `.re2dworld` (тот же native bake, что читает
// $.re2dWorld; --renderer включает continuous slopes/portals/BSP-таблицы).
// ---------------------------------------------------------------------------
void sdk_validate_re2dmap(const char *path, SdkReport *rep);
int sdk_cmd_world_compile(const SdkArgs *a);
int sdk_cmd_world_info(const SdkArgs *a);
int sdk_cmd_world(const SdkArgs *a);
// Правки карты как операции backend (docs/WORLD_EDITOR.md): те же native
// правила геометрии, что у компилятора. GUI и агент вызывают одну команду.
int sdk_cmd_world_edit(const SdkArgs *a);

// Расширения SDK: discovery, манифесты, объединённый реестр (docs/SDK_EXTENSIONS.md).
int sdk_cmd_extension(const SdkArgs *a);
int sdk_cmd_tool(const SdkArgs *a);

// ---------------------------------------------------------------------------
// Студии данных: tilemap, particles, collision, layers, fonts, audio, input, rml, rcss
// (sdk_data.c; правила совпадают с sdk/lib/kinds/*.js и sdk/lib/rml_model.js)
// ---------------------------------------------------------------------------
void sdk_validate_tilemap(const char *path, SdkReport *rep);
void sdk_validate_particles(const char *path, SdkReport *rep);
void sdk_validate_collision(const char *path, SdkReport *rep);
void sdk_validate_layers(const char *path, SdkReport *rep);
void sdk_validate_fonts(const char *path, SdkReport *rep);
void sdk_validate_audio(const char *path, SdkReport *rep);
void sdk_validate_input(const char *path, SdkReport *rep);
void sdk_validate_rml(const char *path, SdkReport *rep);
void sdk_validate_rcss(const char *path, SdkReport *rep);

// ---------------------------------------------------------------------------
// Валидация ассетов (docs/SDK.md §6): один реестр проверяющих функций.
// ---------------------------------------------------------------------------
typedef void (*SdkValidateFn)(const char *path, SdkReport *rep);

// Находит проверку по типу ассета (sdk_asset_type) и выполняет её.
// Возвращает использованный тип. Для неизвестного типа — «file» и info.
const char *sdk_validate_file(const char *path, const char *type_override, SdkReport *rep);
// Типы, для которых есть проверка (для документации и тестов).
int sdk_validator_count(void);
const char *sdk_validator_type(int i);

// ---------------------------------------------------------------------------
// Команды CLI (каждая печатает JSON и возвращает код выхода)
// ---------------------------------------------------------------------------
const char *sdk_arg_value(const SdkArgs *a, const char *flag);   // --flag value
bool        sdk_arg_flag(const SdkArgs *a, const char *flag);    // --flag
// n-й позиционный аргумент (не флаг и не значение флага).
const char *sdk_arg_positional(const SdkArgs *a, int n);

int sdk_cmd_templates(const SdkArgs *a);
int sdk_cmd_new(const SdkArgs *a);
int sdk_cmd_engines(const SdkArgs *a);

int sdk_cmd_deps(const SdkArgs *a);
int sdk_cmd_batch(const SdkArgs *a);
int sdk_cmd_story(const SdkArgs *a);
int sdk_cmd_dialog(const SdkArgs *a);
int sdk_cmd_agent(const SdkArgs *a);

int sdk_cmd_tools(const SdkArgs *a);
int sdk_cmd_assets(const SdkArgs *a);
int sdk_cmd_project(const SdkArgs *a);
int sdk_cmd_projects(const SdkArgs *a);
int sdk_cmd_validate(const SdkArgs *a);
int sdk_cmd_migrate_project(const SdkArgs *a);
// Индексатор editor.graph в project.json (sdk_project_graph.c, docs/PROJECT_JSON.md).
int sdk_cmd_project_index(const SdkArgs *a);
int sdk_cmd_project_set(const SdkArgs *a);   // project-set: запись настроек schema v2 без переформатирования графа
bool sdk_project_index_write(const char *dir, SdkReport *rep);
// Атомарная запись project.json schema 2 (проверка, project.json.bak, rename).
bool sdk_project_manifest_write(const char *dir, const R2dJson *root, SdkReport *rep);
// Система сниппетов (sdk_snippets.c, docs/SNIPPETS.md): каталог пакетов,
// editor.snippets, детерминированная генерация generated/snippets/.
int  sdk_cmd_snippet(const SdkArgs *a);
// Проверка editor.snippets внутри validate project.json (коды SNIP*).
void sdk_snippets_validate_section(const R2dJson *root, const char *manifest_path,
                                   const char *dir, SdkReport *rep);   // r2d new: индекс после копирования шаблона
// Имена сцен из $.scene.add('…') во всех .js проекта (с повторами, в порядке обхода).
int sdk_project_scenes(const char *dir, char (*names)[128], int cap);
int sdk_cmd_api(const SdkArgs *a);
int sdk_cmd_lint(const SdkArgs *a);
int sdk_cmd_doctor(const SdkArgs *a);
int sdk_lint_run(const char *schema_path,const char *target,SdkReport *rep,int *files);
// Находит api.schema.json для validate/lint/doctor: явный --schema (без
// молчаливой подмены), затем каталог проекта, cwd, каталог r2d и два
// уровня выше него. Так установленный пакет проверяет проект из любого cwd.
bool sdk_schema_resolve(const char *explicit_path, const char *preferred_dir,
                        char *out, size_t cap);
int cmd_docs_generate(const SdkArgs *a);
int sdk_cmd_image_stats(const SdkArgs *a);   // image-stats <png>: пустой ли кадр (sdk_image.c)
int sdk_cmd_docs(const SdkArgs *a);   // docs list|show|search|generate (sdk_docs.c)
// project_validate берёт schema_path из --schema (NULL — искать самим).
void sdk_project_validate(const char *dir,const char *schema_path,SdkReport *rep);
int sdk_cmd_run(const SdkArgs *a);
int sdk_cmd_build(const SdkArgs *a);

// Разбор `<команда> [аргументы]` и вызов команды; argv[0] — имя вызова.
// Общая точка входа `r2d` (sdk_cli.c) и `russiano2d sdk` (src/main.c).
int r2d_sdk_main(int argc, char **argv);

// Печатает {"ok":false,"error":...} + диагностику и возвращает 2.
int sdk_fail(SdkReport *rep, const char *code, const char *fmt, ...);

#ifdef __cplusplus
}
#endif
