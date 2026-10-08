// ===========================================================================
// r2d-sdk: нативный бэкенд инструментов Russiano2D SDK.
//
// Один C-код для всех клиентов (docs/SDK.md §2): GUI SDK (приложение R2D, мост
// `$.sdk`), CLI `r2d-sdk` и агент вызывают одни и те же функции. Внешних
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

#define SDK_VERSION "0.1.0"

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
char *sdk_read_file(const char *path, size_t *size);
bool  sdk_write_file(const char *path, const void *data, size_t size);
bool  sdk_file_exists(const char *path);
bool  sdk_is_dir(const char *path);
// Каталог файла: «a/b/c.json» → «a/b». Без каталога — «.».
void  sdk_dirname(const char *path, char *out, size_t cap);
void  sdk_join(const char *a, const char *b, char *out, size_t cap);
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
// Путь к бинарнику движка: --engine, R2D_ENGINE, рядом с r2d-sdk.
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
// Приводит JSON атласа к каноническому виду (одна строка на кадр, тег, слайс).
// Возвращает malloc'нутый текст или NULL (ошибка — в rep).
char *sdk_atlas_canonical(const R2dJson *root, SdkReport *rep, const char *asset);
int sdk_cmd_atlas_grid(const SdkArgs *a);
int sdk_cmd_atlas_format(const SdkArgs *a);
int sdk_cmd_atlas_info(const SdkArgs *a);

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

int sdk_cmd_tools(const SdkArgs *a);
int sdk_cmd_assets(const SdkArgs *a);
int sdk_cmd_project(const SdkArgs *a);
int sdk_cmd_projects(const SdkArgs *a);
int sdk_cmd_validate(const SdkArgs *a);
int sdk_cmd_run(const SdkArgs *a);
int sdk_cmd_build(const SdkArgs *a);

// Печатает {"ok":false,"error":...} + диагностику и возвращает 2.
int sdk_fail(SdkReport *rep, const char *code, const char *fmt, ...);

#ifdef __cplusplus
}
#endif
