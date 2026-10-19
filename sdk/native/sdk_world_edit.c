// ===========================================================================
// Re2D World: операции правки *.re2dmap (docs/WORLD_EDITOR.md).
//
// Один backend для GUI, CLI и агента (docs/SDK.md §2):
//
//   r2d-sdk world-edit <file.re2dmap> --op <op> [--args 'JSON object'] [--out <file>]
//
// Источник карты читается как JSON и правится как JSON-дерево, поэтому чужие
// поля и порядок ключей сохраняются: операция меняет только те ключи, которые
// ей принадлежат. Все правила геометрии (выпуклое кольцо, 3..64 вершины,
// top > bottom, дырки внутри кольца, разрезание по оси) берутся из существующего
// native-кода sdk_brush.c — здесь нет второй геометрии.
//
// Правка транзакционная: дерево глубоко клонируется, операция применяется к
// клону, и только успешный результат попадает в файл/data. При отказе исходный
// файл не меняется.
//
// Формат вывода (stdout, один объект):
//   {"ok":bool,"file":...,"op":...,"changed":bool,"result":{...},
//    "data":{...},   // только когда не задан --out
//    "errors":N,"warnings":N,"diagnostics":[...]}
//
// Коды: SDK_WORLD_EDIT_USAGE / _FILE / _OP / _ARGS / _BRUSH / _GEOMETRY /
// _NOT_FOUND. Код выхода: 0 — ok, 1 — операция отклонена (есть ошибки),
// 2 — неверное использование.
// ===========================================================================
#include "sdk.h"
#include "sdk_brush.h"
#include "re2d_world.h"

#include <math.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define EDIT_EPS 0.001f
#define EDIT_LIMIT 1000000.0
#define EDIT_MAX_ID 64

// ---------------------------------------------------------------------------
// Изменяемое JSON-дерево (R2dJson из src/json.h)
//
// src/json.h отдаёт только чтение; операциям нужны вставка/замена/удаление
// ключей с сохранением порядка. Функции ниже живут в этом файле и работают
// ровно с той же структурой, что парсер движка, — второго формата нет.
// ---------------------------------------------------------------------------

static char *edit_dup(const char *s)
{
    const size_t n = s ? strlen(s) : 0;
    char *out = (char *)malloc(n + 1);
    if (!out) return NULL;
    if (n) memcpy(out, s, n);
    out[n] = '\0';
    return out;
}

static R2dJson *j_new(R2dJsonType type)
{
    R2dJson *v = (R2dJson *)calloc(1, sizeof *v);
    if (v) v->type = type;
    return v;
}

static R2dJson *j_num(double value)
{
    R2dJson *v = j_new(R2D_JSON_NUM);
    if (v) v->number = value;
    return v;
}

static R2dJson *j_bool(bool value)
{
    R2dJson *v = j_new(R2D_JSON_BOOL);
    if (v) v->boolean = value;
    return v;
}

static R2dJson *j_str(const char *value)
{
    R2dJson *v = j_new(R2D_JSON_STR);
    if (!v) return NULL;
    v->string = edit_dup(value ? value : "");
    if (!v->string) { free(v); return NULL; }
    return v;
}

static R2dJson *j_arr(void) { return j_new(R2D_JSON_ARR); }
static R2dJson *j_obj(void) { return j_new(R2D_JSON_OBJ); }

static R2dJson *j_clone(const R2dJson *v)
{
    if (!v) return NULL;
    R2dJson *out = j_new(v->type);
    if (!out) return NULL;
    out->boolean = v->boolean;
    out->number = v->number;
    if (v->type == R2D_JSON_STR) {
        out->string = edit_dup(v->string ? v->string : "");
        if (!out->string) { free(out); return NULL; }
        return out;
    }
    if (v->type != R2D_JSON_ARR && v->type != R2D_JSON_OBJ) return out;
    if (v->count <= 0) return out;
    // keys есть только у объектов: r2d_json_free обходит keys[i] по count,
    // поэтому у массива не должно быть укороченного keys-массива.
    if (v->type == R2D_JSON_OBJ) {
        out->keys = (char **)calloc((size_t)v->count, sizeof *out->keys);
        if (!out->keys) { r2d_json_free(out); return NULL; }
    }
    out->items = (R2dJson **)calloc((size_t)v->count, sizeof *out->items);
    if (!out->items) { r2d_json_free(out); return NULL; }
    out->count = v->count;
    for (int i = 0; i < v->count; ++i) {
        if (v->type == R2D_JSON_OBJ && v->keys && v->keys[i]) {
            out->keys[i] = edit_dup(v->keys[i]);
            if (!out->keys[i]) { r2d_json_free(out); return NULL; }
        }
        out->items[i] = j_clone(v->items ? v->items[i] : NULL);
        if (!out->items[i]) { r2d_json_free(out); return NULL; }
    }
    return out;
}

// Заменяет значение существующего ключа на месте или дописывает новый ключ.
// Владение value переходит функции всегда (в том числе при ошибке).
static bool j_obj_set(R2dJson *obj, const char *key, R2dJson *value)
{
    if (!obj || obj->type != R2D_JSON_OBJ || !key || !value) {
        r2d_json_free(value);
        return false;
    }
    for (int i = 0; i < obj->count; ++i) {
        if (obj->keys[i] && strcmp(obj->keys[i], key) == 0) {
            r2d_json_free(obj->items[i]);
            obj->items[i] = value;
            return true;
        }
    }
    char **keys = (char **)realloc(obj->keys, (size_t)(obj->count + 1) * sizeof *keys);
    if (!keys) { r2d_json_free(value); return false; }
    obj->keys = keys;
    R2dJson **items = (R2dJson **)realloc(obj->items, (size_t)(obj->count + 1) * sizeof *items);
    if (!items) { r2d_json_free(value); return false; }
    obj->items = items;
    char *copy = edit_dup(key);
    if (!copy) { r2d_json_free(value); return false; }
    obj->keys[obj->count] = copy;
    obj->items[obj->count] = value;
    obj->count++;
    return true;
}

static bool j_obj_set_num(R2dJson *obj, const char *key, double value)
{
    return j_obj_set(obj, key, j_num(value));
}

static bool j_obj_set_str(R2dJson *obj, const char *key, const char *value)
{
    return j_obj_set(obj, key, j_str(value));
}

static bool j_obj_set_bool(R2dJson *obj, const char *key, bool value)
{
    return j_obj_set(obj, key, j_bool(value));
}

static int j_obj_index(const R2dJson *obj, const char *key)
{
    if (!obj || obj->type != R2D_JSON_OBJ || !key) return -1;
    for (int i = 0; i < obj->count; ++i) {
        if (obj->keys[i] && strcmp(obj->keys[i], key) == 0) return i;
    }
    return -1;
}

static void j_obj_del_at(R2dJson *obj, int index)
{
    if (!obj || index < 0 || index >= obj->count) return;
    free(obj->keys[index]);
    r2d_json_free(obj->items[index]);
    for (int i = index; i + 1 < obj->count; ++i) {
        obj->keys[i] = obj->keys[i + 1];
        obj->items[i] = obj->items[i + 1];
    }
    obj->count--;
}

// Заменяет rect/polygon на месте, сохраняя позицию ключа в объекте.
static bool j_obj_set_footprint(R2dJson *obj, const char *key, R2dJson *value)
{
    int first = -1, extra = -1;
    for (int i = 0; i < obj->count; ++i) {
        const char *k = obj->keys[i];
        if (k && (!strcmp(k, "rect") || !strcmp(k, "polygon"))) {
            if (first < 0) first = i;
            else if (extra < 0) extra = i;
        }
    }
    if (first < 0) return j_obj_set(obj, key, value);
    char *copy = edit_dup(key);
    if (!copy) { r2d_json_free(value); return false; }
    free(obj->keys[first]);
    obj->keys[first] = copy;
    r2d_json_free(obj->items[first]);
    obj->items[first] = value;
    if (extra >= 0) j_obj_del_at(obj, extra);
    return true;
}

static bool j_arr_push(R2dJson *arr, R2dJson *value)
{
    if (!arr || arr->type != R2D_JSON_ARR || !value) {
        r2d_json_free(value);
        return false;
    }
    R2dJson **items = (R2dJson **)realloc(arr->items, (size_t)(arr->count + 1) * sizeof *items);
    if (!items) { r2d_json_free(value); return false; }
    arr->items = items;
    arr->items[arr->count++] = value;
    return true;
}

static bool j_arr_insert(R2dJson *arr, int at, R2dJson *value)
{
    if (!arr || arr->type != R2D_JSON_ARR || at < 0 || at > arr->count || !value) {
        r2d_json_free(value);
        return false;
    }
    R2dJson **items = (R2dJson **)realloc(arr->items, (size_t)(arr->count + 1) * sizeof *items);
    if (!items) { r2d_json_free(value); return false; }
    arr->items = items;
    memmove(arr->items + at + 1, arr->items + at,
            (size_t)(arr->count - at) * sizeof *items);
    arr->items[at] = value;
    arr->count++;
    return true;
}

static void j_arr_remove(R2dJson *arr, int index)
{
    if (!arr || arr->type != R2D_JSON_ARR || index < 0 || index >= arr->count) return;
    r2d_json_free(arr->items[index]);
    memmove(arr->items + index, arr->items + index + 1,
            (size_t)(arr->count - index - 1) * sizeof *arr->items);
    arr->count--;
}

// ---------------------------------------------------------------------------
// Каноническая запись: 2 пробела на уровень, порядок ключей как в дереве.
// ---------------------------------------------------------------------------

static void put_indent(R2dSb *sb, int count)
{
    for (int i = 0; i < count; ++i) r2d_sb_putc(sb, ' ');
}

static void put_pretty(R2dSb *sb, const R2dJson *v, int indent)
{
    if (!v) { r2d_sb_puts(sb, "null"); return; }
    if (v->type == R2D_JSON_ARR) {
        if (v->count == 0) { r2d_sb_puts(sb, "[]"); return; }
        r2d_sb_puts(sb, "[\n");
        for (int i = 0; i < v->count; ++i) {
            put_indent(sb, indent + 2);
            put_pretty(sb, v->items[i], indent + 2);
            if (i + 1 < v->count) r2d_sb_putc(sb, ',');
            r2d_sb_putc(sb, '\n');
        }
        put_indent(sb, indent);
        r2d_sb_putc(sb, ']');
        return;
    }
    if (v->type == R2D_JSON_OBJ) {
        if (v->count == 0) { r2d_sb_puts(sb, "{}"); return; }
        r2d_sb_puts(sb, "{\n");
        for (int i = 0; i < v->count; ++i) {
            put_indent(sb, indent + 2);
            r2d_sb_put_json_string(sb, v->keys[i] ? v->keys[i] : "");
            r2d_sb_puts(sb, ": ");
            put_pretty(sb, v->items[i], indent + 2);
            if (i + 1 < v->count) r2d_sb_putc(sb, ',');
            r2d_sb_putc(sb, '\n');
        }
        put_indent(sb, indent);
        r2d_sb_putc(sb, '}');
        return;
    }
    sdk_json_put_compact(sb, v);
}

// ---------------------------------------------------------------------------
// Диагностика операции
// ---------------------------------------------------------------------------

static void edit_loc(R2dSb *sb, const char *section, int index,
                     const char *id, const char *field)
{
    r2d_sb_puts(sb, "{\"section\":");
    r2d_sb_put_json_string(sb, section ? section : "");
    if (index >= 0) r2d_sb_printf(sb, ",\"index\":%d", index);
    if (id && id[0]) {
        r2d_sb_puts(sb, ",\"id\":");
        r2d_sb_put_json_string(sb, id);
    }
    if (field && field[0]) {
        r2d_sb_puts(sb, ",\"field\":");
        r2d_sb_put_json_string(sb, field);
    }
    r2d_sb_putc(sb, '}');
}

static void edit_diagv(SdkReport *rep, SdkSeverity severity, const char *code,
                       const char *asset, const char *section, int index,
                       const char *id, const char *field, const char *fmt,
                       va_list ap)
{
    R2dSb loc;
    r2d_sb_init(&loc);
    edit_loc(&loc, section, index, id, field);
    sdk_diagv(rep, severity, code, asset, loc.data ? loc.data : "{}", NULL, fmt, ap);
    r2d_sb_free(&loc);
}

static void edit_diag(SdkReport *rep, SdkSeverity severity, const char *code,
                      const char *asset, const char *section, int index,
                      const char *id, const char *field, const char *fmt, ...)
{
    va_list ap;
    va_start(ap, fmt);
    edit_diagv(rep, severity, code, asset, section, index, id, field, fmt, ap);
    va_end(ap);
}

static void set_err(char *error, size_t size, const char *message)
{
    if (error && size) snprintf(error, size, "%s", message);
}

// ---------------------------------------------------------------------------
// Аргументы операции
// ---------------------------------------------------------------------------

typedef enum EditArg {
    EDIT_ARG_MISSING = 0,
    EDIT_ARG_OK,
    EDIT_ARG_BAD
} EditArg;

static EditArg arg_number(const R2dJson *args, const char *key, float *out)
{
    const R2dJson *v = r2d_json_get(args, key);
    if (!v) return EDIT_ARG_MISSING;
    if (v->type != R2D_JSON_NUM || !isfinite(v->number) ||
        fabs(v->number) > EDIT_LIMIT) return EDIT_ARG_BAD;
    *out = (float)v->number;
    return EDIT_ARG_OK;
}

static EditArg arg_int(const R2dJson *args, const char *key, int *out)
{
    const R2dJson *v = r2d_json_get(args, key);
    if (!v) return EDIT_ARG_MISSING;
    if (v->type != R2D_JSON_NUM || !isfinite(v->number) ||
        v->number < 0.0 || v->number > 1000000.0 ||
        floor(v->number) != v->number) return EDIT_ARG_BAD;
    *out = (int)v->number;
    return EDIT_ARG_OK;
}

static EditArg arg_bool(const R2dJson *args, const char *key, bool *out)
{
    const R2dJson *v = r2d_json_get(args, key);
    if (!v) return EDIT_ARG_MISSING;
    if (v->type != R2D_JSON_BOOL) return EDIT_ARG_BAD;
    *out = v->boolean;
    return EDIT_ARG_OK;
}

static EditArg arg_string(const R2dJson *args, const char *key, const char **out)
{
    const R2dJson *v = r2d_json_get(args, key);
    if (!v) return EDIT_ARG_MISSING;
    if (v->type != R2D_JSON_STR || !v->string) return EDIT_ARG_BAD;
    *out = v->string;
    return EDIT_ARG_OK;
}

typedef struct EditIds {
    char **items;
    int count;
} EditIds;

static void ids_free(EditIds *ids)
{
    if (!ids) return;
    for (int i = 0; i < ids->count; ++i) free(ids->items[i]);
    free(ids->items);
    ids->items = NULL;
    ids->count = 0;
}

static bool ids_read(EditIds *ids, SdkReport *rep, const char *file,
                     const R2dJson *args, const char *key, const char *section)
{
    memset(ids, 0, sizeof *ids);
    const R2dJson *v = r2d_json_get(args, key);
    if (!v || v->type != R2D_JSON_ARR || v->count <= 0) {
        edit_diag(rep, SDK_ERROR, "SDK_WORLD_EDIT_ARGS", file, section, -1,
                  NULL, key, "%s: нужен непустой массив строк %s", section, key);
        return false;
    }
    ids->items = (char **)calloc((size_t)v->count, sizeof *ids->items);
    if (!ids->items) {
        edit_diag(rep, SDK_ERROR, "SDK_WORLD_EDIT_FILE", file, section, -1,
                  NULL, key, "%s: нет памяти", section);
        return false;
    }
    for (int i = 0; i < v->count; ++i) {
        const R2dJson *item = v->items[i];
        if (!item || item->type != R2D_JSON_STR || !item->string[0] ||
            strlen(item->string) >= EDIT_MAX_ID) {
            edit_diag(rep, SDK_ERROR, "SDK_WORLD_EDIT_ARGS", file, section, i,
                      NULL, key, "%s: элемент %d должен быть непустым id до %d символов",
                      section, i, EDIT_MAX_ID - 1);
            ids_free(ids);
            return false;
        }
        for (int j = 0; j < i; ++j) {
            if (strcmp(ids->items[j], item->string) == 0) {
                edit_diag(rep, SDK_ERROR, "SDK_WORLD_EDIT_ARGS", file, section, i,
                          item->string, key, "%s: id %s указан дважды", section,
                          item->string);
                ids_free(ids);
                return false;
            }
        }
        ids->items[i] = edit_dup(item->string);
        if (!ids->items[i]) {
            edit_diag(rep, SDK_ERROR, "SDK_WORLD_EDIT_FILE", file, section, i,
                      NULL, key, "%s: нет памяти", section);
            ids_free(ids);
            return false;
        }
        ids->count = i + 1;
    }
    return true;
}

// ids:[] | один id строкой (удобный алиас UI).
static bool ids_read_flexible(EditIds *ids, SdkReport *rep, const char *file,
                              const R2dJson *args, const char *section)
{
    const R2dJson *v = r2d_json_get(args, "ids");
    if (v) return ids_read(ids, rep, file, args, "ids", section);
    const char *single = NULL;
    if (arg_string(args, "id", &single) == EDIT_ARG_OK && single[0]) {
        R2dJson *wrapped = j_obj();
        R2dJson *arr = j_arr();
        if (!wrapped || !arr || !j_arr_push(arr, j_str(single)) ||
            !j_obj_set(wrapped, "ids", arr)) {
            r2d_json_free(wrapped);
            edit_diag(rep, SDK_ERROR, "SDK_WORLD_EDIT_FILE", file, section, -1,
                      NULL, NULL, "%s: нет памяти", section);
            return false;
        }
        const bool ok = ids_read(ids, rep, file, wrapped, "ids", section);
        r2d_json_free(wrapped);
        return ok;
    }
    edit_diag(rep, SDK_ERROR, "SDK_WORLD_EDIT_ARGS", file, section, -1,
              NULL, "ids", "%s: нужен ids:[...] или id", section);
    return false;
}

// ---------------------------------------------------------------------------
// Цвета и теги: те же правила, что у компилятора (sdk_world.c) и рантайма.
// ---------------------------------------------------------------------------

static bool color_valid(const char *s)
{
    if (!s || !s[0]) return false;
    if (s[0] != '#') return true; // именованные ключи принимает $.color
    const size_t n = strlen(s + 1);
    if (n != 3 && n != 4 && n != 6 && n != 8) return false;
    for (size_t i = 1; i <= n; ++i) {
        const char ch = s[i];
        if (!((ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f') ||
              (ch >= 'A' && ch <= 'F'))) return false;
    }
    return true;
}

// Строит канонический JSON-массив тегов (trim + дедупликация), либо NULL.
static R2dJson *tags_array(const R2dJson *v, char *error, size_t error_size)
{
    if (!v || v->type != R2D_JSON_ARR || v->count > R2D_WORLD_TAG_MAX) {
        set_err(error, error_size, "tags: нужен массив не более 32 строк-тегов");
        return NULL;
    }
    R2dJson *out = j_arr();
    if (!out) { set_err(error, error_size, "tags: нет памяти"); return NULL; }
    char seen[R2D_WORLD_TAG_MAX][R2D_WORLD_TAG_LENGTH + 1];
    int seen_count = 0;
    for (int i = 0; i < v->count; ++i) {
        const R2dJson *item = v->items[i];
        if (!item || item->type != R2D_JSON_STR) {
            set_err(error, error_size, "tags: тег должен быть строкой");
            r2d_json_free(out);
            return NULL;
        }
        char name[R2D_WORLD_TAG_LENGTH + 1];
        if (!r2d_world_tag_normalize(item->string, name, NULL)) {
            set_err(error, error_size,
                    "tags: тег — 1..32 печатных байта после trim");
            r2d_json_free(out);
            return NULL;
        }
        bool duplicate = false;
        for (int j = 0; j < seen_count; ++j) {
            if (strcmp(seen[j], name) == 0) { duplicate = true; break; }
        }
        if (duplicate) continue;
        snprintf(seen[seen_count], sizeof seen[seen_count], "%s", name);
        seen_count++;
        if (!j_arr_push(out, j_str(name))) {
            set_err(error, error_size, "tags: нет памяти");
            r2d_json_free(out);
            return NULL;
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// Мост JSON-кисть <-> SdkBrushSpec. Геометрию проверяет sdk_brush.c.
// ---------------------------------------------------------------------------

static bool spec_number(const R2dJson *v, float *out)
{
    if (!v || v->type != R2D_JSON_NUM || !isfinite(v->number) ||
        fabs(v->number) > EDIT_LIMIT) return false;
    *out = (float)v->number;
    return true;
}

static bool spec_load(const R2dJson *obj, SdkBrushSpec *brush,
                      char *error, size_t error_size)
{
    if (error && error_size) error[0] = '\0';
    if (!obj || obj->type != R2D_JSON_OBJ) {
        set_err(error, error_size, "brush должен быть объектом");
        return false;
    }
    memset(brush, 0, sizeof *brush);
    snprintf(brush->id, sizeof brush->id, "%s",
             r2d_json_str(r2d_json_get(obj, "id"), ""));
    if (!spec_number(r2d_json_get(obj, "bottom"), &brush->bottom) ||
        !spec_number(r2d_json_get(obj, "top"), &brush->top)) {
        set_err(error, error_size, "brush: нужны конечные числа bottom/top");
        return false;
    }
    const R2dJson *poly = r2d_json_get(obj, "polygon");
    if (poly) {
        if (poly->type != R2D_JSON_ARR || poly->count < 3 ||
            poly->count > SDK_BRUSH_MAX_POINTS) {
            set_err(error, error_size, "polygon: нужно 3..64 вершин [x, y]");
            return false;
        }
        brush->ring_count = poly->count;
        for (int i = 0; i < poly->count; ++i) {
            const R2dJson *pt = poly->items[i];
            if (!pt || pt->type != R2D_JSON_ARR || pt->count != 2 ||
                !spec_number(pt->items[0], &brush->ring[i].x) ||
                !spec_number(pt->items[1], &brush->ring[i].y)) {
                set_err(error, error_size, "polygon: вершина должна быть [x, y]");
                return false;
            }
        }
    } else {
        const R2dJson *rect = r2d_json_get(obj, "rect");
        if (!rect || rect->type != R2D_JSON_ARR || rect->count != 4) {
            set_err(error, error_size, "brush: нужен rect [x, y, w, h] или polygon");
            return false;
        }
        float r[4];
        for (int i = 0; i < 4; ++i) {
            if (!spec_number(rect->items[i], &r[i])) {
                set_err(error, error_size, "rect: числа [x, y, w, h] должны быть конечными");
                return false;
            }
        }
        if (!(r[2] > 0.0f) || !(r[3] > 0.0f)) {
            set_err(error, error_size, "rect: w и h должны быть > 0");
            return false;
        }
        brush->ring_count = 4;
        brush->ring[0] = (SdkBrushPoint){r[0], r[1]};
        brush->ring[1] = (SdkBrushPoint){r[0] + r[2], r[1]};
        brush->ring[2] = (SdkBrushPoint){r[0] + r[2], r[1] + r[3]};
        brush->ring[3] = (SdkBrushPoint){r[0], r[1] + r[3]};
    }
    const R2dJson *holes = r2d_json_get(obj, "holes");
    if (holes) {
        if (holes->type != R2D_JSON_ARR || holes->count > SDK_BRUSH_MAX_HOLES) {
            set_err(error, error_size, "holes: массив до 8 прямоугольников [x, y, w, h]");
            return false;
        }
        brush->hole_count = holes->count;
        for (int i = 0; i < holes->count; ++i) {
            const R2dJson *item = holes->items[i];
            if (!item) {
                set_err(error, error_size, "holes: пустой элемент");
                return false;
            }
            if (item->type == R2D_JSON_ARR && item->count == 4) {
                if (!spec_number(item->items[0], &brush->holes[i].x) ||
                    !spec_number(item->items[1], &brush->holes[i].y) ||
                    !spec_number(item->items[2], &brush->holes[i].w) ||
                    !spec_number(item->items[3], &brush->holes[i].h)) {
                    set_err(error, error_size, "holes: [x, y, w, h] из конечных чисел");
                    return false;
                }
            } else if (item->type == R2D_JSON_OBJ) {
                if (!spec_number(r2d_json_get(item, "x"), &brush->holes[i].x) ||
                    !spec_number(r2d_json_get(item, "y"), &brush->holes[i].y) ||
                    !spec_number(r2d_json_get(item, "w"), &brush->holes[i].w) ||
                    !spec_number(r2d_json_get(item, "h"), &brush->holes[i].h)) {
                    set_err(error, error_size, "holes: {x, y, w, h} из конечных чисел");
                    return false;
                }
            } else {
                set_err(error, error_size, "holes: [x, y, w, h] или {x, y, w, h}");
                return false;
            }
            if (!(brush->holes[i].w > 0.0f) || !(brush->holes[i].h > 0.0f)) {
                set_err(error, error_size, "holes: w и h должны быть > 0");
                return false;
            }
        }
    }
    // Единственный источник правил геометрии: native-редактор кисти.
    if (!sdk_brush_move_vertex(brush, 0, brush->ring[0].x, brush->ring[0].y,
                               error, error_size))
        return false;
    return true;
}

static bool near_value(float a, float b) { return fabsf(a - b) <= EDIT_EPS; }

// Кольцо — осевой прямоугольник (4 угла bbox, каждый ровно один раз).
static bool ring_is_rect(const SdkBrushPoint *ring, int count, float out[4])
{
    if (count != 4) return false;
    float minx = ring[0].x, miny = ring[0].y, maxx = ring[0].x, maxy = ring[0].y;
    for (int i = 1; i < count; ++i) {
        minx = fminf(minx, ring[i].x);
        miny = fminf(miny, ring[i].y);
        maxx = fmaxf(maxx, ring[i].x);
        maxy = fmaxf(maxy, ring[i].y);
    }
    if (!(maxx > minx) || !(maxy > miny)) return false;
    int used[4] = {0, 0, 0, 0};
    for (int i = 0; i < count; ++i) {
        const float x = ring[i].x, y = ring[i].y;
        int hit = -1;
        if (near_value(x, minx) && near_value(y, miny)) hit = 0;
        else if (near_value(x, maxx) && near_value(y, miny)) hit = 1;
        else if (near_value(x, maxx) && near_value(y, maxy)) hit = 2;
        else if (near_value(x, minx) && near_value(y, maxy)) hit = 3;
        if (hit < 0) return false;
        used[hit]++;
    }
    if (used[0] != 1 || used[1] != 1 || used[2] != 1 || used[3] != 1) return false;
    out[0] = minx;
    out[1] = miny;
    out[2] = maxx - minx;
    out[3] = maxy - miny;
    return true;
}

static bool write_footprint(R2dJson *obj, const SdkBrushSpec *brush, bool prefer_rect)
{
    float rect[4];
    if (prefer_rect && ring_is_rect(brush->ring, brush->ring_count, rect)) {
        R2dJson *arr = j_arr();
        if (!arr) return false;
        for (int i = 0; i < 4; ++i) {
            if (!j_arr_push(arr, j_num(rect[i]))) return false;
        }
        return j_obj_set_footprint(obj, "rect", arr);
    }
    R2dJson *arr = j_arr();
    if (!arr) return false;
    for (int i = 0; i < brush->ring_count; ++i) {
        R2dJson *pt = j_arr();
        if (!pt || !j_arr_push(pt, j_num(brush->ring[i].x)) ||
            !j_arr_push(pt, j_num(brush->ring[i].y)) ||
            !j_arr_push(arr, pt)) {
            r2d_json_free(pt);
            r2d_json_free(arr);
            return false;
        }
    }
    return j_obj_set_footprint(obj, "polygon", arr);
}

static bool write_holes(R2dJson *obj, const SdkBrushSpec *brush)
{
    R2dJson *arr = j_arr();
    if (!arr) return false;
    for (int i = 0; i < brush->hole_count; ++i) {
        R2dJson *hole = j_arr();
        if (!hole || !j_arr_push(hole, j_num(brush->holes[i].x)) ||
            !j_arr_push(hole, j_num(brush->holes[i].y)) ||
            !j_arr_push(hole, j_num(brush->holes[i].w)) ||
            !j_arr_push(hole, j_num(brush->holes[i].h)) ||
            !j_arr_push(arr, hole)) {
            r2d_json_free(hole);
            r2d_json_free(arr);
            return false;
        }
    }
    return j_obj_set(obj, "holes", arr);
}

typedef struct EditCtx {
    R2dJson *root;
    const R2dJson *args;
    SdkReport *rep;
    const char *file;
    const char *op;
    R2dSb *result;
    bool changed;
} EditCtx;

static void result_ids(EditCtx *c, const char *key, char *const *ids, int count)
{
    r2d_sb_putc(c->result, '{');
    r2d_sb_put_json_string(c->result, key);
    r2d_sb_puts(c->result, ":[");
    for (int i = 0; i < count; ++i) {
        if (i) r2d_sb_putc(c->result, ',');
        r2d_sb_put_json_string(c->result, ids[i]);
    }
    r2d_sb_puts(c->result, "]}");
}

static void result_id(EditCtx *c, const char *id)
{
    r2d_sb_putc(c->result, '{');
    sdk_put_kv_str(c->result, "id", id);
    r2d_sb_putc(c->result, '}');
}

static R2dJson *array_get(const R2dJson *root, const char *key)
{
    const R2dJson *v = r2d_json_get(root, key);
    if (!v || v->type != R2D_JSON_ARR) return NULL;
    return (R2dJson *)v;
}

static R2dJson *array_ensure(EditCtx *c, const char *key)
{
    const R2dJson *v = r2d_json_get(c->root, key);
    if (v) {
        if (v->type != R2D_JSON_ARR) {
            edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_OP", c->file, key, -1,
                      NULL, NULL, "корневое поле %s должно быть массивом", key);
            return NULL;
        }
        return (R2dJson *)v;
    }
    R2dJson *arr = j_arr();
    if (!arr || !j_obj_set(c->root, key, arr)) {
        edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_FILE", c->file, key, -1,
                  NULL, NULL, "нет памяти при создании %s", key);
        return NULL;
    }
    return arr;
}

static int find_id_index(const R2dJson *arr, const char *id)
{
    if (!arr || arr->type != R2D_JSON_ARR || !id) return -1;
    for (int i = 0; i < arr->count; ++i) {
        const R2dJson *obj = arr->items[i];
        if (!obj || obj->type != R2D_JSON_OBJ) continue;
        const char *value = r2d_json_str(r2d_json_get(obj, "id"), NULL);
        if (value && strcmp(value, id) == 0) return i;
    }
    return -1;
}

static int require_index(EditCtx *c, const R2dJson *arr, const char *section,
                         const char *id)
{
    const int index = find_id_index(arr, id);
    if (index < 0) {
        edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_NOT_FOUND", c->file,
                  section, -1, id, NULL, "%s: id %s не найден", section, id);
    }
    return index;
}

static void next_free_id(const R2dJson *arr, const char *prefix,
                         char *out, size_t cap)
{
    int highest = 0;
    const size_t plen = strlen(prefix);
    if (arr && arr->type == R2D_JSON_ARR) {
        for (int i = 0; i < arr->count; ++i) {
            const R2dJson *obj = arr->items[i];
            const char *id = obj && obj->type == R2D_JSON_OBJ
                                 ? r2d_json_str(r2d_json_get(obj, "id"), NULL)
                                 : NULL;
            if (!id || strncmp(id, prefix, plen) != 0 || !id[plen]) continue;
            bool digits = true;
            for (const char *p = id + plen; *p; ++p) {
                if (*p < '0' || *p > '9') { digits = false; break; }
            }
            if (!digits) continue;
            const long value = strtol(id + plen, NULL, 10);
            if (value > highest) highest = (int)value;
        }
    }
    snprintf(out, cap, "%s%d", prefix, highest + 1);
}

// ---------------------------------------------------------------------------
// Построение частей аргументов кисти
// ---------------------------------------------------------------------------

static R2dJson *rect_node(const R2dJson *v, char *error, size_t error_size)
{
    if (!v || v->type != R2D_JSON_ARR || v->count != 4) {
        set_err(error, error_size, "rect: нужен массив [x, y, w, h]");
        return NULL;
    }
    float r[4];
    for (int i = 0; i < 4; ++i) {
        if (!spec_number(v->items[i], &r[i])) {
            set_err(error, error_size, "rect: числа [x, y, w, h] должны быть конечными");
            return NULL;
        }
    }
    if (!(r[2] > 0.0f) || !(r[3] > 0.0f)) {
        set_err(error, error_size, "rect: w и h должны быть > 0");
        return NULL;
    }
    R2dJson *arr = j_arr();
    if (!arr) { set_err(error, error_size, "нет памяти"); return NULL; }
    for (int i = 0; i < 4; ++i) {
        if (!j_arr_push(arr, j_num(r[i]))) {
            r2d_json_free(arr);
            set_err(error, error_size, "нет памяти");
            return NULL;
        }
    }
    return arr;
}

static R2dJson *polygon_node(const R2dJson *v, char *error, size_t error_size)
{
    if (!v || v->type != R2D_JSON_ARR || v->count < 3 ||
        v->count > SDK_BRUSH_MAX_POINTS) {
        set_err(error, error_size, "polygon: нужно 3..64 вершин [x, y]");
        return NULL;
    }
    R2dJson *arr = j_arr();
    if (!arr) { set_err(error, error_size, "нет памяти"); return NULL; }
    for (int i = 0; i < v->count; ++i) {
        const R2dJson *pt = v->items[i];
        if (!pt || pt->type != R2D_JSON_ARR || pt->count != 2) {
            r2d_json_free(arr);
            set_err(error, error_size, "polygon: вершина должна быть [x, y]");
            return NULL;
        }
        float x, y;
        if (!spec_number(pt->items[0], &x) || !spec_number(pt->items[1], &y)) {
            r2d_json_free(arr);
            set_err(error, error_size, "polygon: координаты должны быть конечными");
            return NULL;
        }
        R2dJson *pair = j_arr();
        if (!pair || !j_arr_push(pair, j_num(x)) || !j_arr_push(pair, j_num(y)) ||
            !j_arr_push(arr, pair)) {
            r2d_json_free(pair);
            r2d_json_free(arr);
            set_err(error, error_size, "нет памяти");
            return NULL;
        }
    }
    return arr;
}

// Сдвиг готовой кисти: XYZ-перенос, проверка лимитов и native-валидация.
static bool translate_brush(R2dJson *obj, float dx, float dy, float dz,
                            char *error, size_t error_size)
{
    SdkBrushSpec brush;
    if (!spec_load(obj, &brush, error, error_size)) return false;
    for (int i = 0; i < brush.ring_count; ++i) {
        brush.ring[i].x += dx;
        brush.ring[i].y += dy;
        if (fabsf(brush.ring[i].x) > EDIT_LIMIT ||
            fabsf(brush.ring[i].y) > EDIT_LIMIT) {
            set_err(error, error_size, "перенос выводит вершину за ±1000000");
            return false;
        }
    }
    for (int i = 0; i < brush.hole_count; ++i) {
        brush.holes[i].x += dx;
        brush.holes[i].y += dy;
        if (fabsf(brush.holes[i].x) > EDIT_LIMIT ||
            fabsf(brush.holes[i].y) > EDIT_LIMIT) {
            set_err(error, error_size, "перенос выводит дырку за ±1000000");
            return false;
        }
    }
    brush.bottom += dz;
    brush.top += dz;
    if (fabsf(brush.bottom) > EDIT_LIMIT || fabsf(brush.top) > EDIT_LIMIT) {
        set_err(error, error_size, "перенос выводит высоты за ±1000000");
        return false;
    }
    if (!sdk_brush_move_vertex(&brush, 0, brush.ring[0].x, brush.ring[0].y,
                               error, error_size))
        return false;
    const bool prefer_rect = r2d_json_get(obj, "rect") != NULL;
    if (!write_footprint(obj, &brush, prefer_rect)) {
        set_err(error, error_size, "нет памяти");
        return false;
    }
    if (dz != 0.0f) {
        if (!j_obj_set_num(obj, "bottom", brush.bottom) ||
            !j_obj_set_num(obj, "top", brush.top)) {
            set_err(error, error_size, "нет памяти");
            return false;
        }
    }
    if (brush.hole_count > 0 && (dx != 0.0f || dy != 0.0f)) {
        if (!write_holes(obj, &brush)) {
            set_err(error, error_size, "нет памяти");
            return false;
        }
    }
    return true;
}

static bool tool_valid(const char *name, char *error, size_t error_size)
{
    SdkBrushTool tool;
    if (!sdk_brush_tool_parse(name, &tool)) {
        set_err(error, error_size,
                "tool: solid|nodraw|sky|hint|skip|trigger|areaportal|clip|"
                "enemyclip|playerclip|occluder");
        return false;
    }
    return true;
}

// ---------------------------------------------------------------------------
// Общее применение полей кисти (create и set, включая patch-алиас)
// ---------------------------------------------------------------------------

static bool is_color_key(const char *key)
{
    return !strcmp(key, "sideColor") || !strcmp(key, "floorColor") ||
           !strcmp(key, "ceilingColor");
}

static bool is_tag_key(const char *key)
{
    return !strcmp(key, "tags") || !strcmp(key, "ceilingTags");
}

static bool apply_brush_fields(EditCtx *c, R2dJson *obj, const R2dJson *flat,
                               const R2dJson *patch, int index, const char *id)
{
    char err[256] = {0};
    bool seen_rect = false, seen_polygon = false;
    const R2dJson *sources[2] = {flat, patch};
    for (int s = 0; s < 2; ++s) {
        const R2dJson *src = sources[s];
        if (!src || src->type != R2D_JSON_OBJ) continue;
        for (int i = 0; i < src->count; ++i) {
            const char *key = src->keys[i];
            const R2dJson *value = src->items[i];
            if (!key || !value) continue;
            if (!strcmp(key, "id")) continue; // существующие id не переименовываем
            if (s == 0 && (!strcmp(key, "ids") || !strcmp(key, "patch"))) continue;
            if (!strcmp(key, "rect")) {
                R2dJson *node = rect_node(value, err, sizeof err);
                if (!node) {
                    edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_GEOMETRY",
                              c->file, "brushes", index, id, "rect", "%s", err);
                    return false;
                }
                if (!j_obj_set_footprint(obj, "rect", node)) return false;
                seen_rect = true;
            } else if (!strcmp(key, "polygon")) {
                R2dJson *node = polygon_node(value, err, sizeof err);
                if (!node) {
                    edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_GEOMETRY",
                              c->file, "brushes", index, id, "polygon", "%s", err);
                    return false;
                }
                if (!j_obj_set_footprint(obj, "polygon", node)) return false;
                seen_polygon = true;
            } else if (!strcmp(key, "bottom") || !strcmp(key, "top")) {
                float number = 0.0f;
                if (value->type != R2D_JSON_NUM || !isfinite(value->number) ||
                    fabs(value->number) > EDIT_LIMIT) {
                    edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_ARGS",
                              c->file, "brushes", index, id, key,
                              "brush: %s должен быть конечным числом", key);
                    return false;
                }
                number = (float)value->number;
                if (!j_obj_set_num(obj, key, number)) return false;
            } else if (!strcmp(key, "tool")) {
                if (value->type != R2D_JSON_STR || !value->string ||
                    !tool_valid(value->string, err, sizeof err)) {
                    edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_BRUSH",
                              c->file, "brushes", index, id, "tool",
                              "brush: %s",
                              value->type == R2D_JSON_STR ? err
                              : "tool должен быть строкой");
                    return false;
                }
                if (!j_obj_set_str(obj, "tool", value->string)) return false;
            } else if (!strcmp(key, "subtract") || !strcmp(key, "solid") ||
                       !strcmp(key, "carve")) {
                if (value->type != R2D_JSON_BOOL) {
                    edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_ARGS",
                              c->file, "brushes", index, id, key,
                              "brush: %s должен быть bool", key);
                    return false;
                }
                if (!j_obj_set_bool(obj, key, value->boolean)) return false;
            } else if (is_color_key(key)) {
                if (value->type != R2D_JSON_STR || !value->string ||
                    !color_valid(value->string)) {
                    edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_BRUSH",
                              c->file, "brushes", index, id, key,
                              "brush: цвет — строка вида #rrggbb");
                    return false;
                }
                if (!j_obj_set_str(obj, key, value->string)) return false;
            } else if (is_tag_key(key)) {
                R2dJson *tags = tags_array(value, err, sizeof err);
                if (!tags) {
                    edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_ARGS",
                              c->file, "brushes", index, id, key, "brush: %s", err);
                    return false;
                }
                if (!j_obj_set(obj, key, tags)) return false;
            } else if (!strcmp(key, "visgroup")) {
                if (value->type != R2D_JSON_STR || !value->string ||
                    strlen(value->string) >= EDIT_MAX_ID) {
                    edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_ARGS",
                              c->file, "brushes", index, id, "visgroup",
                              "brush: visgroup — строка до %d символов",
                              EDIT_MAX_ID - 1);
                    return false;
                }
                if (!j_obj_set_str(obj, "visgroup", value->string)) return false;
            } else if (!strcmp(key, "holes")) {
                if (value->type != R2D_JSON_ARR ||
                    value->count > SDK_BRUSH_MAX_HOLES) {
                    edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_ARGS",
                              c->file, "brushes", index, id, "holes",
                              "brush: holes — массив до 8 прямоугольников");
                    return false;
                }
                if (!j_obj_set(obj, "holes", j_clone(value))) return false;
            } else {
                // Неизвестное поле кисти сохраняем как авторские данные.
                if (!j_obj_set(obj, key, j_clone(value))) return false;
            }
        }
    }
    if (seen_rect && seen_polygon) {
        edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_ARGS", c->file, "brushes",
                  index, id, "rect",
                  "brush: укажите либо rect, либо polygon");
        return false;
    }
    SdkBrushSpec spec;
    if (!spec_load(obj, &spec, err, sizeof err)) {
        edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_GEOMETRY", c->file,
                  "brushes", index, id, NULL, "brush: %s",
                  err[0] ? err : "недопустимая геометрия");
        return false;
    }
    const bool subtract = r2d_json_bool(r2d_json_get(obj, "subtract"), false);
    const char *tool = r2d_json_str(r2d_json_get(obj, "tool"), "solid");
    if (subtract && strcmp(tool, "solid") != 0) {
        edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_BRUSH", c->file, "brushes",
                  index, id, "subtract",
                  "brush: subtract допустим только у solid-кисти");
        return false;
    }
    return true;
}

// ---------------------------------------------------------------------------
// Операции: brushes
// ---------------------------------------------------------------------------

static bool op_brush_create(EditCtx *c)
{
    R2dJson *brushes = array_ensure(c, "brushes");
    if (!brushes) return false;
    const char *id_arg = NULL;
    if (arg_string(c->args, "id", &id_arg) == EDIT_ARG_BAD) {
        edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_ARGS", c->file, "brushes",
                  -1, NULL, "id", "brush.create: id должен быть строкой");
        return false;
    }
    char id[EDIT_MAX_ID];
    if (id_arg) {
        if (!id_arg[0] || strlen(id_arg) >= EDIT_MAX_ID) {
            edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_ARGS", c->file,
                      "brushes", -1, id_arg, "id",
                      "brush.create: id — непустая строка до %d символов",
                      EDIT_MAX_ID - 1);
            return false;
        }
        snprintf(id, sizeof id, "%s", id_arg);
    } else {
        next_free_id(brushes, "brush_", id, sizeof id);
    }
    if (find_id_index(brushes, id) >= 0) {
        edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_BRUSH", c->file, "brushes",
                  -1, id, "id", "brush.create: id %s уже занят", id);
        return false;
    }
    if (!r2d_json_get(c->args, "rect") && !r2d_json_get(c->args, "polygon")) {
        edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_ARGS", c->file, "brushes",
                  -1, id, "rect", "brush.create: нужен rect или polygon");
        return false;
    }
    R2dJson *obj = j_obj();
    if (!obj || !j_obj_set_str(obj, "id", id)) {
        r2d_json_free(obj);
        return false;
    }
    if (!apply_brush_fields(c, obj, c->args, NULL, -1, id)) {
        r2d_json_free(obj);
        return false;
    }
    if (!j_arr_push(brushes, obj)) {
        edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_FILE", c->file, "brushes",
                  -1, id, NULL, "нет памяти");
        return false;
    }
    c->changed = true;
    char *id_pointer = id;
    result_ids(c, "ids", &id_pointer, 1);
    return true;
}

static bool op_brush_delete(EditCtx *c)
{
    EditIds ids;
    if (!ids_read_flexible(&ids, c->rep, c->file, c->args, "brushes")) return false;
    R2dJson *brushes = array_get(c->root, "brushes");
    for (int i = 0; i < ids.count; ++i) {
        if (find_id_index(brushes, ids.items[i]) < 0) {
            edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_NOT_FOUND", c->file,
                      "brushes", -1, ids.items[i], "ids",
                      "brush.delete: id %s не найден", ids.items[i]);
            ids_free(&ids);
            return false;
        }
    }
    for (int i = 0; i < ids.count; ++i) {
        j_arr_remove(brushes, find_id_index(brushes, ids.items[i]));
    }
    c->changed = true;
    result_ids(c, "ids", ids.items, ids.count);
    ids_free(&ids);
    return true;
}

static bool op_brush_translate(EditCtx *c, bool duplicate)
{
    EditIds ids;
    if (!ids_read_flexible(&ids, c->rep, c->file, c->args, "brushes")) return false;
    float dx = 0.0f, dy = 0.0f, dz = 0.0f;
    if (arg_number(c->args, "dx", &dx) == EDIT_ARG_BAD ||
        arg_number(c->args, "dy", &dy) == EDIT_ARG_BAD ||
        arg_number(c->args, "dz", &dz) == EDIT_ARG_BAD) {
        edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_ARGS", c->file, "brushes",
                  -1, NULL, "dx",
                  "brush.%s: dx/dy/dz должны быть конечными числами",
                  duplicate ? "duplicate" : "move");
        ids_free(&ids);
        return false;
    }
    R2dJson *brushes = array_get(c->root, "brushes");
    for (int i = 0; i < ids.count; ++i) {
        if (find_id_index(brushes, ids.items[i]) < 0) {
            edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_NOT_FOUND", c->file,
                      "brushes", -1, ids.items[i], "ids",
                      "brush.%s: id %s не найден",
                      duplicate ? "duplicate" : "move", ids.items[i]);
            ids_free(&ids);
            return false;
        }
    }
    EditIds created;
    memset(&created, 0, sizeof created);
    if (duplicate) {
        created.items = (char **)calloc((size_t)ids.count, sizeof *created.items);
        if (!created.items) { ids_free(&ids); return false; }
    }
    for (int i = 0; i < ids.count; ++i) {
        const int index = find_id_index(brushes, ids.items[i]);
        R2dJson *obj = duplicate ? j_clone(brushes->items[index])
                                 : brushes->items[index];
        if (!obj) { ids_free(&ids); ids_free(&created); return false; }
        char err[256] = {0};
        if (!translate_brush(obj, dx, dy, dz, err, sizeof err)) {
            edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_GEOMETRY", c->file,
                      "brushes", index, ids.items[i], NULL, "brush.%s: %s",
                      duplicate ? "duplicate" : "move",
                      err[0] ? err : "недопустимая геометрия");
            if (duplicate) r2d_json_free(obj);
            ids_free(&ids);
            ids_free(&created);
            return false;
        }
        if (duplicate) {
            char base[EDIT_MAX_ID], candidate[EDIT_MAX_ID];
            snprintf(base, sizeof base, "%s-copy", ids.items[i]);
            // Длинный исходный id не должен зациклить поиск свободного суффикса.
            if (strlen(base) >= EDIT_MAX_ID - 4) {
                edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_BRUSH", c->file,
                          "brushes", index, ids.items[i], "id",
                          "brush.duplicate: id копии слишком длинный");
                r2d_json_free(obj);
                ids_free(&ids);
                ids_free(&created);
                return false;
            }
            snprintf(candidate, sizeof candidate, "%s", base);
            for (int suffix = 2;
                 suffix < 100000 && find_id_index(brushes, candidate) >= 0; ++suffix) {
                snprintf(candidate, sizeof candidate, "%s-%d", base, suffix);
            }
            if (find_id_index(brushes, candidate) >= 0 ||
                strlen(candidate) >= EDIT_MAX_ID) {
                edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_BRUSH", c->file,
                          "brushes", index, ids.items[i], "id",
                          "brush.duplicate: id копии слишком длинный");
                r2d_json_free(obj);
                ids_free(&ids);
                ids_free(&created);
                return false;
            }
            if (!j_obj_set_str(obj, "id", candidate) ||
                !j_arr_push(brushes, obj)) {
                r2d_json_free(obj);
                ids_free(&ids);
                ids_free(&created);
                return false;
            }
            created.items[i] = edit_dup(candidate);
            created.count = i + 1;
        }
    }
    c->changed = true;
    if (duplicate) result_ids(c, "ids", created.items, created.count);
    else result_ids(c, "ids", ids.items, ids.count);
    ids_free(&ids);
    ids_free(&created);
    return true;
}

static bool op_brush_move(EditCtx *c) { return op_brush_translate(c, false); }
static bool op_brush_duplicate(EditCtx *c) { return op_brush_translate(c, true); }

static bool op_brush_set(EditCtx *c)
{
    EditIds ids;
    if (!ids_read_flexible(&ids, c->rep, c->file, c->args, "brushes")) return false;
    R2dJson *brushes = array_get(c->root, "brushes");
    for (int i = 0; i < ids.count; ++i) {
        if (find_id_index(brushes, ids.items[i]) < 0) {
            edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_NOT_FOUND", c->file,
                      "brushes", -1, ids.items[i], "ids",
                      "brush.set: id %s не найден", ids.items[i]);
            ids_free(&ids);
            return false;
        }
    }
    const R2dJson *patch = r2d_json_get(c->args, "patch");
    if (patch && patch->type != R2D_JSON_OBJ) {
        edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_ARGS", c->file, "brushes",
                  -1, NULL, "patch", "brush.set: patch должен быть объектом");
        ids_free(&ids);
        return false;
    }
    for (int i = 0; i < ids.count; ++i) {
        const int index = find_id_index(brushes, ids.items[i]);
        if (!apply_brush_fields(c, brushes->items[index], c->args, patch, index,
                                ids.items[i])) {
            ids_free(&ids);
            return false;
        }
    }
    c->changed = true;
    result_ids(c, "ids", ids.items, ids.count);
    ids_free(&ids);
    return true;
}

static bool op_brush_vertex_move(EditCtx *c)
{
    const char *id = NULL;
    if (arg_string(c->args, "id", &id) != EDIT_ARG_OK || !id[0]) {
        edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_ARGS", c->file, "brushes",
                  -1, NULL, "id", "brush.vertex.move: нужен id строкой");
        return false;
    }
    int vertex = 0;
    if (arg_int(c->args, "vertex", &vertex) != EDIT_ARG_OK) {
        edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_ARGS", c->file, "brushes",
                  -1, id, "vertex", "brush.vertex.move: нужен целый vertex");
        return false;
    }
    float x = 0.0f, y = 0.0f;
    if (arg_number(c->args, "x", &x) != EDIT_ARG_OK ||
        arg_number(c->args, "y", &y) != EDIT_ARG_OK) {
        edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_ARGS", c->file, "brushes",
                  -1, id, "x", "brush.vertex.move: нужны конечные x и y");
        return false;
    }
    R2dJson *brushes = array_get(c->root, "brushes");
    const int index = require_index(c, brushes, "brushes", id);
    if (index < 0) return false;
    R2dJson *obj = brushes->items[index];
    SdkBrushSpec brush;
    char err[256] = {0};
    if (!spec_load(obj, &brush, err, sizeof err)) {
        edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_GEOMETRY", c->file,
                  "brushes", index, id, NULL, "brush.vertex.move: %s",
                  err[0] ? err : "недопустимая геометрия");
        return false;
    }
    if (!sdk_brush_move_vertex(&brush, vertex, x, y, err, sizeof err)) {
        edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_GEOMETRY", c->file,
                  "brushes", index, id, "vertex", "brush.vertex.move: %s", err);
        return false;
    }
    const bool prefer_rect = r2d_json_get(obj, "rect") != NULL;
    if (!write_footprint(obj, &brush, prefer_rect)) {
        edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_FILE", c->file, "brushes",
                  index, id, NULL, "нет памяти");
        return false;
    }
    c->changed = true;
    r2d_sb_putc(c->result, '{');
    sdk_put_kv_str(c->result, "id", id);
    r2d_sb_printf(c->result, ",\"vertex\":%d}", vertex);
    return true;
}

static bool op_brush_clip(EditCtx *c)
{
    const char *id = NULL;
    if (arg_string(c->args, "id", &id) != EDIT_ARG_OK || !id[0]) {
        edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_ARGS", c->file, "brushes",
                  -1, NULL, "id", "brush.clip: нужен id строкой");
        return false;
    }
    const char *axis_name = NULL;
    if (arg_string(c->args, "axis", &axis_name) != EDIT_ARG_OK ||
        (strcmp(axis_name, "x") != 0 && strcmp(axis_name, "y") != 0)) {
        edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_ARGS", c->file, "brushes",
                  -1, id, "axis", "brush.clip: axis — x или y");
        return false;
    }
    float coordinate = 0.0f;
    EditArg coordinate_state = arg_number(c->args, "coordinate", &coordinate);
    if (coordinate_state == EDIT_ARG_MISSING) {
        coordinate_state = arg_number(c->args, "coord", &coordinate); // алиас UI
    }
    if (coordinate_state != EDIT_ARG_OK) {
        edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_ARGS", c->file, "brushes",
                  -1, id, "coordinate", "brush.clip: нужна конечная coordinate");
        return false;
    }
    const char *keep = NULL;
    if (arg_string(c->args, "keep", &keep) != EDIT_ARG_OK ||
        (strcmp(keep, "front") != 0 && strcmp(keep, "back") != 0 &&
         strcmp(keep, "both") != 0)) {
        edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_ARGS", c->file, "brushes",
                  -1, id, "keep", "brush.clip: keep — front|back|both");
        return false;
    }
    R2dJson *brushes = array_get(c->root, "brushes");
    const int index = require_index(c, brushes, "brushes", id);
    if (index < 0) return false;
    R2dJson *obj = brushes->items[index];
    SdkBrushSpec brush;
    char err[256] = {0};
    if (!spec_load(obj, &brush, err, sizeof err)) {
        edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_GEOMETRY", c->file,
                  "brushes", index, id, NULL, "brush.clip: %s",
                  err[0] ? err : "недопустимая геометрия");
        return false;
    }
    SdkBrushSpec parts[2];
    const int count = sdk_brush_split_axis(&brush, axis_name[0] == 'y' ? 1 : 0,
                                           coordinate, parts, err, sizeof err);
    if (count != 2) {
        edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_GEOMETRY", c->file,
                  "brushes", index, id, NULL, "brush.clip: %s",
                  err[0] ? err : "разрез невозможен");
        return false;
    }
    // back — низкая половина (x/y <= coordinate), front — высокая.
    const SdkBrushSpec *chosen[2];
    int chosen_count = 0;
    if (strcmp(keep, "back") == 0) chosen[chosen_count++] = &parts[0];
    else if (strcmp(keep, "front") == 0) chosen[chosen_count++] = &parts[1];
    else { chosen[chosen_count++] = &parts[0]; chosen[chosen_count++] = &parts[1]; }

    for (int i = 0; i < chosen_count; ++i) {
        if (find_id_index(brushes, chosen[i]->id) >= 0) {
            edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_BRUSH", c->file,
                      "brushes", index, id, "id",
                      "brush.clip: id %s уже занят", chosen[i]->id);
            return false;
        }
    }
    char ids[2][EDIT_MAX_ID];
    for (int i = 0; i < chosen_count; ++i) {
        snprintf(ids[i], sizeof ids[i], "%s", chosen[i]->id);
    }
    R2dJson *copies[2] = {NULL, NULL};
    for (int i = 0; i < chosen_count; ++i) {
        copies[i] = j_clone(obj);
        if (!copies[i]) {
            r2d_json_free(copies[0]);
            edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_FILE", c->file,
                      "brushes", index, id, NULL, "нет памяти");
            return false;
        }
        if (!j_obj_set_str(copies[i], "id", ids[i]) ||
            !write_footprint(copies[i], chosen[i], true)) {
            r2d_json_free(copies[0]);
            r2d_json_free(copies[1]);
            edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_FILE", c->file,
                      "brushes", index, id, NULL, "нет памяти");
            return false;
        }
    }
    // Обе копии готовы до замены: obj/in-place элемент не читается после free.
    r2d_json_free(brushes->items[index]);
    brushes->items[index] = copies[0];
    if (chosen_count == 2 && !j_arr_insert(brushes, index + 1, copies[1])) {
        copies[1] = NULL;
        edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_FILE", c->file,
                  "brushes", index, id, NULL, "нет памяти");
        return false;
    }
    c->changed = true;
    char *id_ptrs[2] = {ids[0], ids[1]};
    result_ids(c, "ids", id_ptrs, chosen_count);
    return true;
}

static bool op_face_set(EditCtx *c)
{
    const char *id = NULL;
    if (arg_string(c->args, "id", &id) == EDIT_ARG_MISSING) {
        if (arg_string(c->args, "brush", &id) != EDIT_ARG_OK) id = NULL;
    }
    if (!id || !id[0]) {
        edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_ARGS", c->file, "brushes",
                  -1, NULL, "id", "face.set: нужен id (или brush) строкой");
        return false;
    }
    const char *face = NULL;
    if (arg_string(c->args, "face", &face) != EDIT_ARG_OK ||
        (strcmp(face, "floor") != 0 && strcmp(face, "ceiling") != 0 &&
         strcmp(face, "side") != 0)) {
        edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_ARGS", c->file, "brushes",
                  -1, id, "face", "face.set: face — floor|ceiling|side");
        return false;
    }
    const char *material = NULL;
    EditArg material_state = arg_string(c->args, "material", &material);
    if (material_state == EDIT_ARG_MISSING) {
        material_state = arg_string(c->args, "color", &material);
    }
    if (material_state == EDIT_ARG_BAD) {
        edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_ARGS", c->file, "brushes",
                  -1, id, "material", "face.set: material/color должен быть строкой");
        return false;
    }
    if (material && !color_valid(material)) {
        edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_BRUSH", c->file, "brushes",
                  -1, id, "material", "face.set: цвет — строка вида #rrggbb");
        return false;
    }
    const bool is_floor = strcmp(face, "floor") == 0;
    const bool is_ceiling = strcmp(face, "ceiling") == 0;
    const R2dJson *tags_value = r2d_json_get(c->args, "tags");
    const R2dJson *ceiling_tags_value = r2d_json_get(c->args, "ceilingTags");
    if (is_ceiling) tags_value = ceiling_tags_value ? ceiling_tags_value : tags_value;
    char err[256] = {0};
    R2dJson *tags = NULL;
    if (tags_value && (is_floor || is_ceiling)) {
        tags = tags_array(tags_value, err, sizeof err);
        if (!tags) {
            edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_ARGS", c->file,
                      "brushes", -1, id, "tags", "face.set: %s", err);
            return false;
        }
    }
    if (!material && !tags) {
        r2d_json_free(tags);
        edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_ARGS", c->file, "brushes",
                  -1, id, NULL, "face.set: нужен material/color или tags");
        return false;
    }
    R2dJson *brushes = array_get(c->root, "brushes");
    const int index = require_index(c, brushes, "brushes", id);
    if (index < 0) { r2d_json_free(tags); return false; }
    R2dJson *obj = brushes->items[index];

    if (strcmp(face, "side") == 0) {
        if (tags || ceiling_tags_value) {
            edit_diag(c->rep, SDK_WARNING, "SDK_WORLD_EDIT_ARGS", c->file,
                      "brushes", index, id, "tags",
                      "face.set: у боковой грани нет хранилища тегов; tags проигнорированы");
        }
        r2d_json_free(tags);
        if (material && !j_obj_set_str(obj, "sideColor", material)) {
            edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_FILE", c->file,
                      "brushes", index, id, NULL, "нет памяти");
            return false;
        }
    } else {
        const char *color_key = is_floor ? "floorColor" : "ceilingColor";
        const char *tag_key = is_floor ? "tags" : "ceilingTags";
        if (material && !j_obj_set_str(obj, color_key, material)) {
            r2d_json_free(tags);
            edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_FILE", c->file,
                      "brushes", index, id, NULL, "нет памяти");
            return false;
        }
        if (tags && !j_obj_set(obj, tag_key, tags)) {
            edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_FILE", c->file,
                      "brushes", index, id, NULL, "нет памяти");
            return false;
        }
        if (ceiling_tags_value && is_floor) {
            edit_diag(c->rep, SDK_WARNING, "SDK_WORLD_EDIT_ARGS", c->file,
                      "brushes", index, id, "ceilingTags",
                      "face.set: ceilingTags применён только к ceiling");
        }
    }
    c->changed = true;
    r2d_sb_putc(c->result, '{');
    sdk_put_kv_str(c->result, "id", id);
    r2d_sb_puts(c->result, ",\"face\":");
    r2d_sb_put_json_string(c->result, face);
    r2d_sb_putc(c->result, '}');
    return true;
}

// ---------------------------------------------------------------------------
// world.set
// ---------------------------------------------------------------------------

static void world_field_add(char fields[][24], int *count, const char *name)
{
    for (int i = 0; i < *count; ++i) {
        if (strcmp(fields[i], name) == 0) return;
    }
    if (*count < 16) snprintf(fields[(*count)++], 24, "%s", name);
}

static bool world_apply_source(EditCtx *c, R2dJson *world, const R2dJson *src,
                               char fields[][24], int *count)
{
    if (!src || src->type != R2D_JSON_OBJ) return true;
    const char *number_keys[6] = {"x", "y", "w", "h", "bottom", "top"};
    for (int i = 0; i < src->count; ++i) {
        const char *key = src->keys[i];
        const R2dJson *value = src->items[i];
        if (!key || !value) continue;
        bool numeric = false;
        for (int k = 0; k < 6; ++k) {
            if (strcmp(key, number_keys[k]) == 0) { numeric = true; break; }
        }
        if (numeric) {
            if (value->type != R2D_JSON_NUM || !isfinite(value->number) ||
                fabs(value->number) > EDIT_LIMIT) {
                edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_ARGS", c->file,
                          "world", 0, NULL, key,
                          "world.set: %s должен быть конечным числом", key);
                return false;
            }
            if (!j_obj_set_num(world, key, value->number)) return false;
            world_field_add(fields, count, key);
        } else if (!strcmp(key, "boundary")) {
            if (value->type != R2D_JSON_STR || !value->string) {
                edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_ARGS", c->file,
                          "world", 0, NULL, "boundary",
                          "world.set: boundary должен быть строкой");
                return false;
            }
            SdkBrushTool tool;
            if (!sdk_brush_tool_parse(value->string, &tool)) {
                edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_BRUSH", c->file,
                          "world", 0, NULL, "boundary",
                          "world.set: boundary — sky|nodraw|clip|solid");
                return false;
            }
            if (!j_obj_set_str(world, "boundary", value->string)) return false;
            world_field_add(fields, count, key);
        } else if (is_color_key(key)) {
            if (value->type != R2D_JSON_STR || !value->string ||
                !color_valid(value->string)) {
                edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_BRUSH", c->file,
                          "world", 0, NULL, key,
                          "world.set: цвет — строка вида #rrggbb");
                return false;
            }
            if (!j_obj_set_str(world, key, value->string)) return false;
            world_field_add(fields, count, key);
        } else if (is_tag_key(key)) {
            char err[256] = {0};
            R2dJson *tags = tags_array(value, err, sizeof err);
            if (!tags) {
                edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_ARGS", c->file,
                          "world", 0, NULL, key, "world.set: %s", err);
                return false;
            }
            if (!j_obj_set(world, key, tags)) return false;
            world_field_add(fields, count, key);
        }
    }
    return true;
}

static bool op_world_set(EditCtx *c)
{
    const R2dJson *patch = r2d_json_get(c->args, "patch");
    if (patch && patch->type != R2D_JSON_OBJ) {
        edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_ARGS", c->file, "world", 0,
                  NULL, "patch", "world.set: patch должен быть объектом");
        return false;
    }
    const R2dJson *existing = r2d_json_get(c->root, "world");
    R2dJson *world = NULL;
    if (existing) {
        if (existing->type != R2D_JSON_OBJ) {
            edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_OP", c->file, "world",
                      0, NULL, NULL, "world.set: поле world должно быть объектом");
            return false;
        }
        world = (R2dJson *)existing;
    } else {
        world = j_obj();
        if (!world || !j_obj_set(c->root, "world", world)) {
            edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_FILE", c->file, "world",
                      0, NULL, NULL, "нет памяти");
            return false;
        }
    }
    char fields[16][24];
    int field_count = 0;
    if (!world_apply_source(c, world, patch, fields, &field_count)) return false;
    if (!world_apply_source(c, world, c->args, fields, &field_count)) return false;
    // regionSize — корневое поле карты, а не поле world-конверта (формат
    // .re2dmap: "regionSize": 256 на верхнем уровне). Редактор и агент правят
    // его той же операцией world.set.
    const R2dJson *region = r2d_json_get(c->args, "regionSize");
    if (!region && patch) region = r2d_json_get(patch, "regionSize");
    if (region) {
        if (region->type != R2D_JSON_NUM || !isfinite(region->number) ||
            region->number <= 0.0 || region->number > EDIT_LIMIT ||
            floor(region->number) != region->number) {
            edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_ARGS", c->file, "world",
                      0, NULL, "regionSize", "world.set: regionSize — целое > 0");
            return false;
        }
        if (!j_obj_set_num(c->root, "regionSize", region->number)) return false;
        world_field_add(fields, &field_count, "regionSize");
    }
    if (field_count == 0) {
        edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_ARGS", c->file, "world", 0,
                  NULL, NULL, "world.set: не задано ни одного поля");
        return false;
    }
    float w = 0.0f, h = 0.0f, bottom = 0.0f, top = 0.0f;
    const bool has_w = spec_number(r2d_json_get(world, "w"), &w);
    const bool has_h = spec_number(r2d_json_get(world, "h"), &h);
    const bool has_bottom = spec_number(r2d_json_get(world, "bottom"), &bottom);
    const bool has_top = spec_number(r2d_json_get(world, "top"), &top);
    if (has_w && !(w > 0.0f)) {
        edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_GEOMETRY", c->file, "world",
                  0, NULL, "w", "world.set: w должна быть > 0");
        return false;
    }
    if (has_h && !(h > 0.0f)) {
        edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_GEOMETRY", c->file, "world",
                  0, NULL, "h", "world.set: h должна быть > 0");
        return false;
    }
    if (has_bottom && has_top && !(top > bottom)) {
        edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_GEOMETRY", c->file, "world",
                  0, NULL, "top", "world.set: top должен быть больше bottom");
        return false;
    }
    c->changed = true;
    r2d_sb_puts(c->result, "{\"fields\":[");
    for (int i = 0; i < field_count; ++i) {
        if (i) r2d_sb_putc(c->result, ',');
        r2d_sb_put_json_string(c->result, fields[i]);
    }
    r2d_sb_puts(c->result, "]}");
    return true;
}

// ---------------------------------------------------------------------------
// Сущности
// ---------------------------------------------------------------------------

static bool brush_exists(EditCtx *c, const char *id)
{
    return find_id_index(array_get(c->root, "brushes"), id) >= 0;
}

static bool op_entity_create(EditCtx *c)
{
    const char *kind = NULL;
    if (arg_string(c->args, "kind", &kind) != EDIT_ARG_OK || !kind[0]) {
        edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_ARGS", c->file, "entities",
                  -1, NULL, "kind", "entity.create: нужен непустой kind");
        return false;
    }
    R2dJson *entities = array_ensure(c, "entities");
    if (!entities) return false;
    const char *id_arg = NULL;
    if (arg_string(c->args, "id", &id_arg) == EDIT_ARG_BAD) {
        edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_ARGS", c->file, "entities",
                  -1, NULL, "id", "entity.create: id должен быть строкой");
        return false;
    }
    char id[EDIT_MAX_ID];
    if (id_arg) {
        if (!id_arg[0] || strlen(id_arg) >= EDIT_MAX_ID) {
            edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_ARGS", c->file,
                      "entities", -1, id_arg, "id",
                      "entity.create: id — непустая строка до %d символов",
                      EDIT_MAX_ID - 1);
            return false;
        }
        snprintf(id, sizeof id, "%s", id_arg);
    } else {
        next_free_id(entities, "entity_", id, sizeof id);
    }
    if (find_id_index(entities, id) >= 0) {
        edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_BRUSH", c->file, "entities",
                  -1, id, "id", "entity.create: id %s уже занят", id);
        return false;
    }
    const char *brush = NULL;
    if (arg_string(c->args, "brush", &brush) == EDIT_ARG_BAD) {
        edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_ARGS", c->file, "entities",
                  -1, id, "brush", "entity.create: brush должен быть строкой");
        return false;
    }
    if (brush && brush[0] && !brush_exists(c, brush)) {
        edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_NOT_FOUND", c->file,
                  "entities", -1, id, "brush",
                  "entity.create: brush %s не найден", brush);
        return false;
    }
    const char *target = NULL;
    if (arg_string(c->args, "target", &target) == EDIT_ARG_BAD) {
        edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_ARGS", c->file, "entities",
                  -1, id, "target", "entity.create: target должен быть строкой");
        return false;
    }
    R2dJson *obj = j_obj();
    if (!obj || !j_obj_set_str(obj, "id", id) ||
        !j_obj_set_str(obj, "kind", kind)) {
        r2d_json_free(obj);
        return false;
    }
    const char *number_keys[3] = {"x", "y", "h"};
    for (int i = 0; i < 3; ++i) {
        float value = 0.0f;
        const EditArg state = arg_number(c->args, number_keys[i], &value);
        if (state == EDIT_ARG_BAD) {
            edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_ARGS", c->file,
                      "entities", -1, id, number_keys[i],
                      "entity.create: %s должен быть числом", number_keys[i]);
            r2d_json_free(obj);
            return false;
        }
        if (state == EDIT_ARG_OK && !j_obj_set_num(obj, number_keys[i], value)) {
            r2d_json_free(obj);
            return false;
        }
    }
    if (brush && brush[0] && !j_obj_set_str(obj, "brush", brush)) {
        r2d_json_free(obj);
        return false;
    }
    if (target && !j_obj_set_str(obj, "target", target)) {
        r2d_json_free(obj);
        return false;
    }
    // Произвольные авторские свойства копируются как есть.
    static const char *const reserved[] = {
        "id", "kind", "x", "y", "h", "brush", "target"
    };
    for (int i = 0; i < c->args->count; ++i) {
        const char *key = c->args->keys[i];
        if (!key) continue;
        bool skip = false;
        for (size_t r = 0; r < sizeof reserved / sizeof reserved[0]; ++r) {
            if (strcmp(key, reserved[r]) == 0) { skip = true; break; }
        }
        if (skip) continue;
        if (!j_obj_set(obj, key, j_clone(c->args->items[i]))) {
            r2d_json_free(obj);
            return false;
        }
    }
    if (!j_arr_push(entities, obj)) {
        edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_FILE", c->file, "entities",
                  -1, id, NULL, "нет памяти");
        return false;
    }
    c->changed = true;
    result_id(c, id);
    return true;
}

static bool entity_apply_fields(EditCtx *c, R2dJson *obj, const R2dJson *fields,
                                int index, const char *id)
{
    if (!fields || fields->type != R2D_JSON_OBJ) return true;
    const int id_position = j_obj_index(fields, "id");
    if (id_position >= 0) {
        const char *new_id = r2d_json_str(fields->items[id_position], NULL);
        if (!new_id || strcmp(new_id, id) != 0) {
            edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_ARGS", c->file,
                      "entities", index, id, "id",
                      "entity.set: id нельзя менять через fields");
            return false;
        }
    }
    for (int i = 0; i < fields->count; ++i) {
        const char *key = fields->keys[i];
        if (!key) continue;
        if (strcmp(key, "brush") == 0) {
            const char *brush = r2d_json_str(fields->items[i], NULL);
            if (brush && brush[0] && !brush_exists(c, brush)) {
                edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_NOT_FOUND", c->file,
                          "entities", index, id, "brush",
                          "entity.set: brush %s не найден", brush);
                return false;
            }
        }
        if (!j_obj_set(obj, key, j_clone(fields->items[i]))) {
            edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_FILE", c->file,
                      "entities", index, id, NULL, "нет памяти");
            return false;
        }
    }
    return true;
}

static bool op_entity_set(EditCtx *c)
{
    const char *id = NULL;
    if (arg_string(c->args, "id", &id) != EDIT_ARG_OK || !id[0]) {
        edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_ARGS", c->file, "entities",
                  -1, NULL, "id", "entity.set: нужен id строкой");
        return false;
    }
    const R2dJson *fields = r2d_json_get(c->args, "fields");
    if (!fields) {
        fields = r2d_json_get(c->args, "patch");
    }
    if (!fields || fields->type != R2D_JSON_OBJ) {
        edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_ARGS", c->file, "entities",
                  -1, id, "fields", "entity.set: fields (или patch) должен быть объектом");
        return false;
    }
    R2dJson *entities = array_get(c->root, "entities");
    const int index = require_index(c, entities, "entities", id);
    if (index < 0) return false;
    if (!entity_apply_fields(c, entities->items[index], fields, index, id)) {
        return false;
    }
    c->changed = true;
    result_id(c, id);
    return true;
}

static bool op_entity_delete(EditCtx *c)
{
    EditIds ids;
    if (!ids_read_flexible(&ids, c->rep, c->file, c->args, "entities")) return false;
    R2dJson *entities = array_get(c->root, "entities");
    for (int i = 0; i < ids.count; ++i) {
        if (find_id_index(entities, ids.items[i]) < 0) {
            edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_NOT_FOUND", c->file,
                      "entities", -1, ids.items[i], "ids",
                      "entity.delete: id %s не найден", ids.items[i]);
            ids_free(&ids);
            return false;
        }
    }
    for (int i = 0; i < ids.count; ++i) {
        j_arr_remove(entities, find_id_index(entities, ids.items[i]));
    }
    c->changed = true;
    result_ids(c, "ids", ids.items, ids.count);
    ids_free(&ids);
    return true;
}

// ---------------------------------------------------------------------------
// Пути (generic authoring data под корневым "paths")
// ---------------------------------------------------------------------------

static R2dJson *path_node_build(const R2dJson *node, char *error, size_t error_size)
{
    if (!node || node->type != R2D_JSON_OBJ) {
        set_err(error, error_size, "node должен быть объектом");
        return NULL;
    }
    float x = 0.0f, y = 0.0f, h = 0.0f;
    if (!spec_number(r2d_json_get(node, "x"), &x) ||
        !spec_number(r2d_json_get(node, "y"), &y)) {
        set_err(error, error_size, "node: нужны конечные x и y");
        return NULL;
    }
    const R2dJson *hv = r2d_json_get(node, "h");
    if (hv && !spec_number(hv, &h)) {
        set_err(error, error_size, "node: h должен быть конечным числом");
        return NULL;
    }
    R2dJson *out = j_obj();
    if (!out || !j_obj_set_num(out, "x", x) || !j_obj_set_num(out, "y", y) ||
        !j_obj_set_num(out, "h", h)) {
        r2d_json_free(out);
        set_err(error, error_size, "нет памяти");
        return NULL;
    }
    for (int i = 0; i < node->count; ++i) {
        const char *key = node->keys[i];
        if (!key || strcmp(key, "x") == 0 || strcmp(key, "y") == 0 ||
            strcmp(key, "h") == 0) continue;
        if (!j_obj_set(out, key, j_clone(node->items[i]))) {
            r2d_json_free(out);
            set_err(error, error_size, "нет памяти");
            return NULL;
        }
    }
    return out;
}

static R2dJson *path_nodes_array(const R2dJson *nodes, char *error, size_t error_size)
{
    if (!nodes || nodes->type != R2D_JSON_ARR || nodes->count < 1) {
        set_err(error, error_size, "nodes: нужен непустой массив объектов");
        return NULL;
    }
    R2dJson *out = j_arr();
    if (!out) { set_err(error, error_size, "нет памяти"); return NULL; }
    for (int i = 0; i < nodes->count; ++i) {
        R2dJson *node = path_node_build(nodes->items[i], error, error_size);
        if (!node) { r2d_json_free(out); return NULL; }
        if (!j_arr_push(out, node)) {
            r2d_json_free(out);
            set_err(error, error_size, "нет памяти");
            return NULL;
        }
    }
    return out;
}

static bool path_copy_extra_metadata(R2dJson *target, const R2dJson *src,
                                     const char *const *reserved, size_t count)
{
    if (!src || src->type != R2D_JSON_OBJ) return true;
    for (int i = 0; i < src->count; ++i) {
        const char *key = src->keys[i];
        if (!key) continue;
        bool skip = false;
        for (size_t r = 0; r < count; ++r) {
            if (strcmp(key, reserved[r]) == 0) { skip = true; break; }
        }
        if (skip) continue;
        if (!j_obj_set(target, key, j_clone(src->items[i]))) return false;
    }
    return true;
}

static bool op_path_create(EditCtx *c)
{
    R2dJson *paths = array_ensure(c, "paths");
    if (!paths) return false;
    char err[256] = {0};
    R2dJson *nodes = path_nodes_array(r2d_json_get(c->args, "nodes"), err, sizeof err);
    if (!nodes) {
        edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_ARGS", c->file, "paths",
                  -1, NULL, "nodes", "path.create: %s", err);
        return false;
    }
    const char *id_arg = NULL;
    if (arg_string(c->args, "id", &id_arg) == EDIT_ARG_BAD) {
        r2d_json_free(nodes);
        edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_ARGS", c->file, "paths",
                  -1, NULL, "id", "path.create: id должен быть строкой");
        return false;
    }
    char id[EDIT_MAX_ID];
    if (id_arg) {
        if (!id_arg[0] || strlen(id_arg) >= EDIT_MAX_ID) {
            r2d_json_free(nodes);
            edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_ARGS", c->file, "paths",
                      -1, id_arg, "id", "path.create: неверный id");
            return false;
        }
        snprintf(id, sizeof id, "%s", id_arg);
    } else {
        next_free_id(paths, "path_", id, sizeof id);
    }
    if (find_id_index(paths, id) >= 0) {
        r2d_json_free(nodes);
        edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_BRUSH", c->file, "paths",
                  -1, id, "id", "path.create: id %s уже занят", id);
        return false;
    }
    const char *type = NULL;
    if (arg_string(c->args, "type", &type) == EDIT_ARG_BAD) {
        r2d_json_free(nodes);
        edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_ARGS", c->file, "paths",
                  -1, id, "type", "path.create: type должен быть строкой");
        return false;
    }
    bool loop = false, one_way = false;
    if (arg_bool(c->args, "loop", &loop) == EDIT_ARG_BAD ||
        arg_bool(c->args, "oneWay", &one_way) == EDIT_ARG_BAD) {
        r2d_json_free(nodes);
        edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_ARGS", c->file, "paths",
                  -1, id, "loop", "path.create: loop/oneWay — bool");
        return false;
    }
    R2dJson *obj = j_obj();
    if (!obj || !j_obj_set_str(obj, "id", id) ||
        !j_obj_set_str(obj, "type", type ? type : "path") ||
        !j_obj_set(obj, "nodes", nodes) || !j_obj_set_bool(obj, "loop", loop) ||
        !j_obj_set_bool(obj, "oneWay", one_way)) {
        r2d_json_free(obj);
        edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_FILE", c->file, "paths",
                  -1, id, NULL, "нет памяти");
        return false;
    }
    static const char *const reserved[] = {"id", "type", "nodes", "loop", "oneWay"};
    if (!path_copy_extra_metadata(obj, c->args, reserved,
                                  sizeof reserved / sizeof reserved[0])) {
        r2d_json_free(obj);
        edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_FILE", c->file, "paths",
                  -1, id, NULL, "нет памяти");
        return false;
    }
    if (!j_arr_push(paths, obj)) {
        edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_FILE", c->file, "paths",
                  -1, id, NULL, "нет памяти");
        return false;
    }
    c->changed = true;
    result_id(c, id);
    return true;
}

static R2dJson *path_require(EditCtx *c, const char *id, int *index)
{
    R2dJson *paths = array_get(c->root, "paths");
    const int found = require_index(c, paths, "paths", id);
    if (found < 0) return NULL;
    if (index) *index = found;
    return paths->items[found];
}

static bool path_node_arg(EditCtx *c, const R2dJson *args, const char *path_id,
                          int path_index, R2dJson **out)
{
    char err[256] = {0};
    const R2dJson *node = r2d_json_get(args, "node");
    R2dJson *flat = NULL;
    if (!node) {
        flat = j_obj();
        if (!flat) { set_err(err, sizeof err, "нет памяти"); goto fail; }
        const char *keys[3] = {"x", "y", "h"};
        bool any = false;
        for (int i = 0; i < 3; ++i) {
            float value = 0.0f;
            const EditArg state = arg_number(args, keys[i], &value);
            if (state == EDIT_ARG_BAD) {
                set_err(err, sizeof err, "x/y/h должны быть числами");
                goto fail;
            }
            if (state != EDIT_ARG_OK) continue;
            if (!j_obj_set_num(flat, keys[i], value)) goto fail;
            any = true;
        }
        if (!any) {
            set_err(err, sizeof err, "нужен node:{x,y,h} или x,y");
            goto fail;
        }
        node = flat;
    }
    *out = path_node_build(node, err, sizeof err);
    r2d_json_free(flat);
    if (!*out) {
        edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_ARGS", c->file, "paths",
                  path_index, path_id, "node", "path.node: %s", err);
        return false;
    }
    return true;
fail:
    r2d_json_free(flat);
    edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_FILE", c->file, "paths",
              path_index, path_id, "node", "path.node: %s", err);
    return false;
}

static bool op_path_node_add(EditCtx *c)
{
    const char *id = NULL;
    if (arg_string(c->args, "id", &id) != EDIT_ARG_OK || !id[0]) {
        edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_ARGS", c->file, "paths",
                  -1, NULL, "id", "path.node.add: нужен id строкой");
        return false;
    }
    int index = 0;
    R2dJson *path = path_require(c, id, &index);
    if (!path) return false;
    R2dJson *nodes = (R2dJson *)r2d_json_get(path, "nodes");
    if (!nodes || nodes->type != R2D_JSON_ARR) {
        edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_OP", c->file, "paths",
                  index, id, "nodes", "path.node.add: у пути нет массива nodes");
        return false;
    }
    R2dJson *node = NULL;
    if (!path_node_arg(c, c->args, id, index, &node)) return false;
    int at = nodes->count;
    const EditArg state = arg_int(c->args, "index", &at);
    if (state == EDIT_ARG_BAD || at < 0 || at > nodes->count) {
        r2d_json_free(node);
        edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_ARGS", c->file, "paths",
                  index, id, "index", "path.node.add: index вне диапазона");
        return false;
    }
    if (!j_arr_insert(nodes, at, node)) {
        edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_FILE", c->file, "paths",
                  index, id, NULL, "нет памяти");
        return false;
    }
    c->changed = true;
    r2d_sb_putc(c->result, '{');
    sdk_put_kv_str(c->result, "id", id);
    r2d_sb_printf(c->result, ",\"index\":%d}", at);
    return true;
}

static bool op_path_node_move(EditCtx *c)
{
    const char *id = NULL;
    if (arg_string(c->args, "id", &id) != EDIT_ARG_OK || !id[0]) {
        edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_ARGS", c->file, "paths",
                  -1, NULL, "id", "path.node.move: нужен id строкой");
        return false;
    }
    int path_index = 0;
    R2dJson *path = path_require(c, id, &path_index);
    if (!path) return false;
    R2dJson *nodes = (R2dJson *)r2d_json_get(path, "nodes");
    int node_index = 0;
    if (!nodes || nodes->type != R2D_JSON_ARR ||
        arg_int(c->args, "index", &node_index) != EDIT_ARG_OK ||
        node_index < 0 || node_index >= nodes->count) {
        edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_ARGS", c->file, "paths",
                  path_index, id, "index", "path.node.move: неверный index");
        return false;
    }
    R2dJson *node = nodes->items[node_index];
    const char *keys[3] = {"x", "y", "h"};
    bool any = false;
    for (int i = 0; i < 3; ++i) {
        float value = 0.0f;
        const EditArg state = arg_number(c->args, keys[i], &value);
        if (state == EDIT_ARG_BAD) {
            edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_ARGS", c->file, "paths",
                      path_index, id, keys[i],
                      "path.node.move: %s должен быть числом", keys[i]);
            return false;
        }
        if (state == EDIT_ARG_MISSING) continue;
        if (!j_obj_set_num(node, keys[i], value)) {
            edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_FILE", c->file, "paths",
                      path_index, id, NULL, "нет памяти");
            return false;
        }
        any = true;
    }
    if (!any) {
        edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_ARGS", c->file, "paths",
                  path_index, id, NULL, "path.node.move: нужен x, y или h");
        return false;
    }
    c->changed = true;
    r2d_sb_putc(c->result, '{');
    sdk_put_kv_str(c->result, "id", id);
    r2d_sb_printf(c->result, ",\"index\":%d}", node_index);
    return true;
}

static bool op_path_node_delete(EditCtx *c)
{
    const char *id = NULL;
    if (arg_string(c->args, "id", &id) != EDIT_ARG_OK || !id[0]) {
        edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_ARGS", c->file, "paths",
                  -1, NULL, "id", "path.node.delete: нужен id строкой");
        return false;
    }
    int path_index = 0;
    R2dJson *path = path_require(c, id, &path_index);
    if (!path) return false;
    R2dJson *nodes = (R2dJson *)r2d_json_get(path, "nodes");
    int node_index = 0;
    if (!nodes || nodes->type != R2D_JSON_ARR ||
        arg_int(c->args, "index", &node_index) != EDIT_ARG_OK ||
        node_index < 0 || node_index >= nodes->count) {
        edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_ARGS", c->file, "paths",
                  path_index, id, "index", "path.node.delete: неверный index");
        return false;
    }
    j_arr_remove(nodes, node_index);
    c->changed = true;
    r2d_sb_putc(c->result, '{');
    sdk_put_kv_str(c->result, "id", id);
    r2d_sb_printf(c->result, ",\"index\":%d}", node_index);
    return true;
}

static bool op_path_set(EditCtx *c)
{
    const char *id = NULL;
    if (arg_string(c->args, "id", &id) != EDIT_ARG_OK || !id[0]) {
        edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_ARGS", c->file, "paths",
                  -1, NULL, "id", "path.set: нужен id строкой");
        return false;
    }
    int path_index = 0;
    R2dJson *path = path_require(c, id, &path_index);
    if (!path) return false;
    const R2dJson *patch = r2d_json_get(c->args, "patch");
    const R2dJson *fields = r2d_json_get(c->args, "fields");
    if ((patch && patch->type != R2D_JSON_OBJ) ||
        (fields && fields->type != R2D_JSON_OBJ)) {
        edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_ARGS", c->file, "paths",
                  path_index, id, "fields",
                  "path.set: fields/patch должен быть объектом");
        return false;
    }
    const R2dJson *sources[3] = {c->args, fields, patch};
    bool applied = false;
    for (int s = 0; s < 3; ++s) {
        const R2dJson *src = sources[s];
        if (!src) continue;
        for (int i = 0; i < src->count; ++i) {
            const char *key = src->keys[i];
            const R2dJson *value = src->items[i];
            if (!key || !value) continue;
            if (!strcmp(key, "id")) continue;
            if (s == 0 && (!strcmp(key, "fields") || !strcmp(key, "patch"))) continue;
            if (!strcmp(key, "nodes")) {
                char err[256] = {0};
                R2dJson *nodes = path_nodes_array(value, err, sizeof err);
                if (!nodes) {
                    edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_ARGS", c->file,
                              "paths", path_index, id, "nodes", "path.set: %s", err);
                    return false;
                }
                if (!j_obj_set(path, "nodes", nodes)) return false;
            } else if (!strcmp(key, "loop") || !strcmp(key, "oneWay")) {
                if (value->type != R2D_JSON_BOOL) {
                    edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_ARGS", c->file,
                              "paths", path_index, id, key,
                              "path.set: %s должен быть bool", key);
                    return false;
                }
                if (!j_obj_set_bool(path, key, value->boolean)) return false;
            } else {
                if (!j_obj_set(path, key, j_clone(value))) return false;
            }
            applied = true;
        }
    }
    if (!applied) {
        edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_ARGS", c->file, "paths",
                  path_index, id, NULL, "path.set: не задано ни одно поле");
        return false;
    }
    c->changed = true;
    result_id(c, id);
    return true;
}

static bool op_path_delete(EditCtx *c)
{
    EditIds ids;
    if (!ids_read_flexible(&ids, c->rep, c->file, c->args, "paths")) return false;
    R2dJson *paths = array_get(c->root, "paths");
    for (int i = 0; i < ids.count; ++i) {
        if (find_id_index(paths, ids.items[i]) < 0) {
            edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_NOT_FOUND", c->file,
                      "paths", -1, ids.items[i], "ids",
                      "path.delete: id %s не найден", ids.items[i]);
            ids_free(&ids);
            return false;
        }
    }
    for (int i = 0; i < ids.count; ++i) {
        j_arr_remove(paths, find_id_index(paths, ids.items[i]));
    }
    c->changed = true;
    result_ids(c, "ids", ids.items, ids.count);
    ids_free(&ids);
    return true;
}

// ---------------------------------------------------------------------------
// Visgroups
// ---------------------------------------------------------------------------

static R2dJson *visgroup_find(R2dJson *visgroups, const char *name, const char *id)
{
    if (!visgroups || visgroups->type != R2D_JSON_ARR) return NULL;
    for (int i = 0; i < visgroups->count; ++i) {
        R2dJson *obj = visgroups->items[i];
        if (!obj || obj->type != R2D_JSON_OBJ) continue;
        if (id) {
            const char *value = r2d_json_str(r2d_json_get(obj, "id"), NULL);
            if (value && strcmp(value, id) == 0) return obj;
        }
        if (name) {
            const char *value = r2d_json_str(r2d_json_get(obj, "name"), NULL);
            if (value && strcmp(value, name) == 0) return obj;
        }
    }
    return NULL;
}

static bool op_visgroup_ensure(EditCtx *c)
{
    const char *name = NULL;
    if (arg_string(c->args, "name", &name) != EDIT_ARG_OK || !name[0]) {
        edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_ARGS", c->file, "visgroups",
                  -1, NULL, "name", "visgroup.ensure: нужен непустой name");
        return false;
    }
    const char *id_arg = NULL;
    if (arg_string(c->args, "id", &id_arg) == EDIT_ARG_BAD) {
        edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_ARGS", c->file, "visgroups",
                  -1, name, "id", "visgroup.ensure: id должен быть строкой");
        return false;
    }
    bool visible = true, locked = false;
    const EditArg visible_state = arg_bool(c->args, "visible", &visible);
    const EditArg locked_state = arg_bool(c->args, "locked", &locked);
    if (visible_state == EDIT_ARG_BAD || locked_state == EDIT_ARG_BAD) {
        edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_ARGS", c->file, "visgroups",
                  -1, name, "visible", "visgroup.ensure: visible/locked — bool");
        return false;
    }
    R2dJson *visgroups = array_ensure(c, "visgroups");
    if (!visgroups) return false;
    R2dJson *existing = visgroup_find(visgroups, name, id_arg);
    if (existing) {
        if (visible_state == EDIT_ARG_OK &&
            !j_obj_set_bool(existing, "visible", visible)) {
            edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_FILE", c->file,
                      "visgroups", -1, name, NULL, "нет памяти");
            return false;
        }
        if (locked_state == EDIT_ARG_OK &&
            !j_obj_set_bool(existing, "locked", locked)) {
            edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_FILE", c->file,
                      "visgroups", -1, name, NULL, "нет памяти");
            return false;
        }
        c->changed = visible_state == EDIT_ARG_OK || locked_state == EDIT_ARG_OK;
        r2d_sb_putc(c->result, '{');
        sdk_put_kv_str(c->result, "id",
                       r2d_json_str(r2d_json_get(existing, "id"), name));
        r2d_sb_puts(c->result, ",\"created\":false}");
        return true;
    }
    char id[EDIT_MAX_ID];
    const char *wanted = (id_arg && id_arg[0]) ? id_arg : name;
    if (strlen(wanted) >= EDIT_MAX_ID) {
        edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_ARGS", c->file, "visgroups",
                  -1, name, "id", "visgroup.ensure: id/name слишком длинный");
        return false;
    }
    snprintf(id, sizeof id, "%s", wanted);
    if (find_id_index(visgroups, id) >= 0) {
        edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_BRUSH", c->file, "visgroups",
                  -1, id, "id", "visgroup.ensure: id %s уже занят", id);
        return false;
    }
    R2dJson *obj = j_obj();
    if (!obj || !j_obj_set_str(obj, "id", id) ||
        !j_obj_set_str(obj, "name", name) ||
        !j_obj_set_bool(obj, "visible", visible) ||
        !j_obj_set_bool(obj, "locked", locked)) {
        r2d_json_free(obj);
        edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_FILE", c->file, "visgroups",
                  -1, name, NULL, "нет памяти");
        return false;
    }
    if (!j_arr_push(visgroups, obj)) {
        edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_FILE", c->file, "visgroups",
                  -1, name, NULL, "нет памяти");
        return false;
    }
    c->changed = true;
    r2d_sb_putc(c->result, '{');
    sdk_put_kv_str(c->result, "id", id);
    r2d_sb_puts(c->result, ",\"created\":true}");
    return true;
}

static bool op_visgroup_state(EditCtx *c)
{
    const char *id = NULL, *name = NULL;
    if (arg_string(c->args, "id", &id) == EDIT_ARG_BAD ||
        arg_string(c->args, "name", &name) == EDIT_ARG_BAD) {
        edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_ARGS", c->file, "visgroups",
                  -1, NULL, "id", "visgroup.state: id/name должны быть строками");
        return false;
    }
    if ((!id || !id[0]) && (!name || !name[0])) {
        edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_ARGS", c->file, "visgroups",
                  -1, NULL, "id", "visgroup.state: нужен id (или name)");
        return false;
    }
    bool visible = true, locked = false, hidden = false;
    EditArg visible_state = arg_bool(c->args, "visible", &visible);
    const EditArg locked_state = arg_bool(c->args, "locked", &locked);
    const EditArg hidden_state = arg_bool(c->args, "hidden", &hidden);
    if (visible_state == EDIT_ARG_BAD || locked_state == EDIT_ARG_BAD ||
        hidden_state == EDIT_ARG_BAD) {
        edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_ARGS", c->file, "visgroups",
                  -1, id, "visible",
                  "visgroup.state: visible/locked/hidden — bool");
        return false;
    }
    if (hidden_state == EDIT_ARG_OK) {
        visible = !hidden;
        visible_state = EDIT_ARG_OK;
    }
    if (visible_state == EDIT_ARG_MISSING && locked_state == EDIT_ARG_MISSING) {
        edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_ARGS", c->file, "visgroups",
                  -1, id, "visible", "visgroup.state: нужен visible/locked/hidden");
        return false;
    }
    R2dJson *visgroups = array_get(c->root, "visgroups");
    R2dJson *obj = visgroup_find(visgroups, name, id);
    if (!obj) {
        edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_NOT_FOUND", c->file,
                  "visgroups", -1, id ? id : name, NULL,
                  "visgroup.state: visgroup не найден");
        return false;
    }
    if (visible_state == EDIT_ARG_OK &&
        !j_obj_set_bool(obj, "visible", visible)) {
        edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_FILE", c->file, "visgroups",
                  -1, id, NULL, "нет памяти");
        return false;
    }
    if (locked_state == EDIT_ARG_OK && !j_obj_set_bool(obj, "locked", locked)) {
        edit_diag(c->rep, SDK_ERROR, "SDK_WORLD_EDIT_FILE", c->file, "visgroups",
                  -1, id, NULL, "нет памяти");
        return false;
    }
    c->changed = true;
    r2d_sb_putc(c->result, '{');
    sdk_put_kv_str(c->result, "id",
                   r2d_json_str(r2d_json_get(obj, "id"), id ? id : name));
    r2d_sb_putc(c->result, '}');
    return true;
}

// ---------------------------------------------------------------------------
// Диспетчер операций
// ---------------------------------------------------------------------------

typedef bool (*EditOpFn)(EditCtx *);

static bool op_noop(EditCtx *c)
{
    (void)c;
    r2d_sb_puts(c->result, "{}");
    return true;
}

static const struct {
    const char *name;
    EditOpFn fn;
} k_edit_ops[] = {
    {"brush.create", op_brush_create},
    {"brush.delete", op_brush_delete},
    {"brush.duplicate", op_brush_duplicate},
    {"brush.move", op_brush_move},
    {"brush.set", op_brush_set},
    {"brush.vertex.move", op_brush_vertex_move},
    {"brush.clip", op_brush_clip},
    {"face.set", op_face_set},
    {"world.set", op_world_set},
    {"entity.create", op_entity_create},
    {"entity.set", op_entity_set},
    {"entity.delete", op_entity_delete},
    {"path.create", op_path_create},
    {"path.node.add", op_path_node_add},
    {"path.node.move", op_path_node_move},
    {"path.node.delete", op_path_node_delete},
    {"path.set", op_path_set},
    {"path.delete", op_path_delete},
    {"visgroup.ensure", op_visgroup_ensure},
    {"visgroup.state", op_visgroup_state},
    {"noop", op_noop},
};

static EditOpFn find_op(const char *name)
{
    if (!name) return NULL;
    for (size_t i = 0; i < sizeof k_edit_ops / sizeof k_edit_ops[0]; ++i) {
        if (strcmp(name, k_edit_ops[i].name) == 0) return k_edit_ops[i].fn;
    }
    return NULL;
}

// ---------------------------------------------------------------------------
// Вывод и CLI
// ---------------------------------------------------------------------------

static void put_nullable_string(R2dSb *sb, const char *key, const char *value)
{
    r2d_sb_put_json_string(sb, key);
    r2d_sb_putc(sb, ':');
    if (value) r2d_sb_put_json_string(sb, value);
    else r2d_sb_puts(sb, "null");
}

static int edit_emit(const char *file, const char *op, bool ok, bool changed,
                     const R2dSb *result, const R2dJson *data,
                     const SdkReport *rep, int rc)
{
    R2dSb out;
    r2d_sb_init(&out);
    r2d_sb_printf(&out, "{\"ok\":%s,", ok ? "true" : "false");
    put_nullable_string(&out, "file", file);
    r2d_sb_putc(&out, ',');
    put_nullable_string(&out, "op", op);
    r2d_sb_printf(&out, ",\"changed\":%s,\"result\":", changed ? "true" : "false");
    if (result && result->data && result->len) r2d_sb_puts(&out, result->data);
    else r2d_sb_puts(&out, "{}");
    if (data) {
        r2d_sb_puts(&out, ",\"data\":");
        sdk_json_put_compact(&out, data);
    }
    r2d_sb_putc(&out, ',');
    sdk_report_put_counts(rep, &out);
    r2d_sb_putc(&out, ',');
    sdk_report_put(rep, &out);
    r2d_sb_puts(&out, "}\n");
    fputs(out.data, stdout);
    fflush(stdout);
    r2d_sb_free(&out);
    return rc;
}

int sdk_cmd_world_edit(const SdkArgs *a)
{
    SdkReport rep;
    sdk_report_init(&rep);
    R2dSb result;
    r2d_sb_init(&result);    // ops сами пишут объект; пусто -> "result":{} в edit_emit

    const char *file = sdk_arg_positional(a, 0);
    const char *op = sdk_arg_value(a, "--op");
    const char *out_path = sdk_arg_value(a, "--out");
    const char *args_text = sdk_arg_value(a, "--args");

    R2dJson *root = NULL;
    R2dJson *args = NULL;
    R2dJson *data = NULL;
    bool changed = false;
    int rc = 2;
    bool ok = false;

    if (!file || !op) {
        edit_diag(&rep, SDK_ERROR, "SDK_WORLD_EDIT_USAGE", NULL, NULL, -1, NULL,
                  "--op",
                  "Использование: r2d-sdk world-edit <file.re2dmap> --op <op> "
                  "[--args JSON] [--out <file>]");
        goto done;
    }
    if (!sdk_file_exists(file)) {
        edit_diag(&rep, SDK_ERROR, "SDK_WORLD_EDIT_FILE", file, NULL, -1, NULL,
                  NULL, "Файл не найден: %s", file);
        rc = 1;
        goto done;
    }
    {
        size_t size = 0;
        char *text = sdk_read_file(file, &size);
        if (!text) {
            edit_diag(&rep, SDK_ERROR, "SDK_WORLD_EDIT_FILE", file, NULL, -1,
                      NULL, NULL, "Файл не читается: %s", file);
            rc = 1;
            goto done;
        }
        char parse_error[256];
        root = r2d_json_parse(text, parse_error, sizeof parse_error);
        free(text);
        if (!root) {
            R2dSb details;
            r2d_sb_init(&details);
            r2d_sb_puts(&details, "{\"parser\":");
            r2d_sb_put_json_string(&details, parse_error);
            r2d_sb_putc(&details, '}');
            sdk_diag(&rep, SDK_ERROR, "SDK_WORLD_EDIT_FILE", file, NULL,
                     details.data, "Некорректный JSON карты: %s", parse_error);
            r2d_sb_free(&details);
            rc = 1;
            goto done;
        }
        if (root->type != R2D_JSON_OBJ) {
            edit_diag(&rep, SDK_ERROR, "SDK_WORLD_EDIT_FILE", file, NULL, -1,
                      NULL, NULL, "Корень карты должен быть JSON-объектом");
            rc = 1;
            goto done;
        }
    }
    if (args_text) {
        char parse_error[256];
        args = r2d_json_parse(args_text, parse_error, sizeof parse_error);
        if (!args || args->type != R2D_JSON_OBJ) {
            edit_diag(&rep, SDK_ERROR, "SDK_WORLD_EDIT_ARGS", file, NULL, -1,
                      NULL, NULL, "--args должен быть JSON-объектом: %s",
                      args ? "корень не объект" : parse_error);
            r2d_json_free(args);
            args = NULL;
            rc = 2;
            goto done;
        }
    } else {
        args = j_obj();
        if (!args) {
            edit_diag(&rep, SDK_ERROR, "SDK_WORLD_EDIT_FILE", file, NULL, -1,
                      NULL, NULL, "Нет памяти");
            rc = 1;
            goto done;
        }
    }
    EditOpFn fn = find_op(op);
    if (!fn) {
        edit_diag(&rep, SDK_ERROR, "SDK_WORLD_EDIT_OP", file, NULL, -1, NULL,
                  "--op", "Неизвестная операция %s", op);
        rc = 2;
        goto done;
    }
    {
        R2dJson *work = j_clone(root);
        if (!work) {
            edit_diag(&rep, SDK_ERROR, "SDK_WORLD_EDIT_FILE", file, NULL, -1,
                      NULL, NULL, "Нет памяти");
            rc = 1;
            goto done;
        }
        EditCtx ctx;
        ctx.root = work;
        ctx.args = args;
        ctx.rep = &rep;
        ctx.file = file;
        ctx.op = op;
        ctx.result = &result;
        ctx.changed = false;
        const bool applied = fn(&ctx);
        changed = ctx.changed;
        if (!applied || rep.errors > 0) {
            r2d_json_free(work);
            rc = 1;
            goto done;
        }
        ok = true;
        rc = 0;
        if (out_path) {
            R2dSb text;
            r2d_sb_init(&text);
            put_pretty(&text, work, 0);
            r2d_sb_putc(&text, '\n');
            if (!sdk_write_file(out_path, text.data, text.len)) {
                sdk_diag(&rep, SDK_ERROR, "SDK_WORLD_EDIT_FILE", out_path, NULL,
                         NULL, "Не удалось записать %s", out_path);
                ok = false;
                rc = 1;
            }
            r2d_sb_free(&text);
            r2d_json_free(work);
        } else {
            data = work;
        }
    }
done:
    rc = edit_emit(file, op, ok, changed, &result, data, &rep, rc);
    r2d_json_free(root);
    r2d_json_free(args);
    r2d_json_free(data);
    r2d_sb_free(&result);
    sdk_report_free(&rep);
    return rc;
}
