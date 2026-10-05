// ===========================================================================
// Минимальный JSON: разбор входящих команд агента и сборка ответов.
//
// Своя реализация, потому что движок не тянет внешних зависимостей, а нужен
// ровно один сценарий: разобрать одну строку-объект и собрать одну строку
// ответа. Поддерживается весь JSON (вложенные объекты/массивы, escape-после-
// довательности, числа, true/false/null) — чтобы агент мог писать клиент
// на любом языке, а не подстраиваться под упрощённый формат.
// ===========================================================================
#pragma once

#include <stdbool.h>
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef enum R2dJsonType {
    R2D_JSON_NULL = 0,
    R2D_JSON_BOOL,
    R2D_JSON_NUM,
    R2D_JSON_STR,
    R2D_JSON_ARR,
    R2D_JSON_OBJ,
} R2dJsonType;

typedef struct R2dJson {
    R2dJsonType type;

    bool   boolean;
    double number;
    char  *string;        // владеемая строка, всегда NUL-terminated

    // Массивы и объекты. У объекта keys[i] соответствует values[i].
    char      **keys;
    struct R2dJson **items;
    int         count;
} R2dJson;

// Разбирает текст. При ошибке возвращает NULL и пишет причину в err.
R2dJson *r2d_json_parse(const char *text, char *err, size_t err_size);
void      r2d_json_free(R2dJson *v);

// Доступ. Все функции безопасны с NULL — возвращают значение по умолчанию.
const R2dJson *r2d_json_get(const R2dJson *obj, const char *key);
const R2dJson *r2d_json_at(const R2dJson *arr, int index);
int             r2d_json_size(const R2dJson *v);

const char *r2d_json_str(const R2dJson *v, const char *def);
double      r2d_json_num(const R2dJson *v, double def);
int         r2d_json_int(const R2dJson *v, int def);
bool        r2d_json_bool(const R2dJson *v, bool def);

// ---------------------------------------------------------------------------
// Буфер строки: растёт сам, отдаёт владение через r2d_sb_take().
// ---------------------------------------------------------------------------
typedef struct R2dSb {
    char  *data;
    size_t len;
    size_t cap;
} R2dSb;

void  r2d_sb_init(R2dSb *sb);
void  r2d_sb_free(R2dSb *sb);
void  r2d_sb_clear(R2dSb *sb);
void  r2d_sb_putc(R2dSb *sb, char c);
void  r2d_sb_puts(R2dSb *sb, const char *s);
void  r2d_sb_printf(R2dSb *sb, const char *fmt, ...);
// Дописывает строку как JSON-литерал: кавычки + экранирование.
void  r2d_sb_put_json_string(R2dSb *sb, const char *s);
// Дописывает число так, чтобы это был валидный JSON (без "nan"/"inf").
void  r2d_sb_put_json_number(R2dSb *sb, double v);
// Отдаёт буфер вызывающему (владеет он) и обнуляет структуру.
char *r2d_sb_take(R2dSb *sb);

#ifdef __cplusplus
}
#endif
