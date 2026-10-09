// ===========================================================================
// r2d-help: CLI-помощник по `$` API (docs/HELP.md).
//
// Ищет по реестру API (src/highlevel/*.js) и разделам docs/ двумя способами
// сразу: лексически (BM25) и по смыслу (эмбеддинги модели GGUF через
// llama.cpp). Без модели работает только BM25 — инструмент остаётся рабочим.
//
// Только CLI: один запуск — один JSON-объект на stdout (как r2d-sdk,
// docs/SDK.md §4). Ни демона, ни сервера. Индекс пересобирается сам, когда
// меняются docs/ или src/highlevel/, а неизменённые фрагменты не
// переэмбеддятся (вектор берётся из прошлого индекса по хэшу текста).
// ===========================================================================
#pragma once

#include "sdk.h"

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define HELP_VERSION       "0.1.0"
#define HELP_INDEX_MAGIC   "R2DHELP1"
#define HELP_INDEX_FORMAT  1u

typedef enum HelpKind {
    HELP_KIND_METHOD = 1,   // метод/геттер обёртки: def()/defGet()
    HELP_KIND_NS     = 2,   // функция пространства имён: $.nav.find
    HELP_KIND_DOC    = 3,   // раздел документации
} HelpKind;

const char *help_kind_name(int kind);

typedef struct HelpEntry {
    int      kind;
    char    *name;       // «.navigateTo», «$.nav.find», «Заголовок раздела»
    char    *module;     // «nav» или путь документа
    char    *signature;  // «navigateTo(target, opts)» или ""
    char    *location;   // «src/highlevel/nav.js:1738», «docs/highlevel/nav.md:42»
    char    *doc;        // страница документации модуля или ""
    char    *text;       // текст для поиска и эмбеддинга
    uint64_t text_hash;  // FNV-1a от text: ключ повторного использования вектора
    int8_t  *vec;        // dim значений или NULL
    float    vec_scale;  // vec[i] * scale ≈ исходное значение
} HelpEntry;

typedef struct HelpIndex {
    HelpEntry *items;
    int        count;
    int        cap;
    int        dim;               // 0 — эмбеддингов нет
    uint64_t   sources_hash;      // размеры и mtime источников на момент сборки
    char       model_id[128];     // отпечаток модели, которой посчитаны векторы
} HelpIndex;

void       help_index_init(HelpIndex *ix);
void       help_index_free(HelpIndex *ix);
HelpEntry *help_index_add(HelpIndex *ix, int kind, const char *name, const char *module,
                          const char *signature, const char *location, const char *doc,
                          const char *text);
bool       help_index_save(const HelpIndex *ix, const char *path);
bool       help_index_load(HelpIndex *ix, const char *path);

uint64_t   help_fnv1a(const void *data, size_t size, uint64_t seed);

// ---------------------------------------------------------------------------
// Корпус: что индексируется
// ---------------------------------------------------------------------------
// Собирает реестр API из <root>/src/highlevel/*.js и разделы <root>/docs/**.md.
// Нечитаемые файлы — диагностика в rep, а не молчаливый пропуск.
bool     help_collect(const char *root, HelpIndex *ix, SdkReport *rep);
// Отпечаток источников: пути, размеры и mtime (дёшево, без чтения файлов).
uint64_t help_sources_hash(const char *root);
// Есть ли под root исходники, из которых строится индекс.
bool     help_root_ok(const char *root);

// ---------------------------------------------------------------------------
// Поиск
// ---------------------------------------------------------------------------
typedef struct HelpHit {
    int    entry;
    double score;      // итоговая оценка (больше — лучше), округлена
    double bm25;
    double cosine;     // -2 — не считался
} HelpHit;

// Токены для BM25: нижний регистр (латиница и кириллица), camelCase режется
// на части, длинные слова дополнительно усечены до основы.
typedef void (*HelpTokenFn)(const char *tok, size_t len, void *user);
void help_tokenize(const char *text, HelpTokenFn fn, void *user);

// qvec — нормированный вектор запроса (dim = ix->dim) или NULL.
int help_search(const HelpIndex *ix, const char *query, const float *qvec,
                HelpHit *out, int max_out);

// ---------------------------------------------------------------------------
// Эмбеддинги (llama.cpp; без R2D_HELP_LLAMA — заглушка, available() == false)
// ---------------------------------------------------------------------------
typedef struct HelpEmbedder HelpEmbedder;

bool          help_embed_available(void);
// NULL при ошибке; причина — в err.
HelpEmbedder *help_embed_open(const char *model_path, int threads, char *err, size_t err_cap);
void          help_embed_close(HelpEmbedder *e);
int           help_embed_dim(const HelpEmbedder *e);
// is_query: e5 различает «query: » и «passage: ». Результат нормирован (L2).
bool          help_embed_text(HelpEmbedder *e, const char *text, bool is_query, float *out);
// Отпечаток файла модели: размер + FNV первых и последних 1 МБ.
bool          help_model_id(const char *model_path, char *out, size_t cap);

// Квантование в int8 с общим масштабом на вектор.
void help_quantize(const float *v, int dim, int8_t *out, float *scale);

#ifdef __cplusplus
}
#endif
