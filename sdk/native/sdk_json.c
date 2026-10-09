// ===========================================================================
// Каноническая компактная запись JSON для файлов, которые правят и человек,
// и инструменты: пробел после «:» и «,», вложенное — в одну строку. Порядок
// ключей сохраняется, поэтому git diff показывает только настоящие правки.
// ===========================================================================
#include "sdk.h"

void sdk_json_put_compact(R2dSb *sb, const R2dJson *v)
{
    if (!v) {
        r2d_sb_puts(sb, "null");
        return;
    }
    switch (v->type) {
    case R2D_JSON_NULL: r2d_sb_puts(sb, "null"); break;
    case R2D_JSON_BOOL: r2d_sb_puts(sb, v->boolean ? "true" : "false"); break;
    case R2D_JSON_NUM:  r2d_sb_put_json_number(sb, v->number); break;
    case R2D_JSON_STR:  r2d_sb_put_json_string(sb, v->string); break;
    case R2D_JSON_ARR:
        r2d_sb_putc(sb, '[');
        for (int i = 0; i < v->count; ++i) {
            if (i) r2d_sb_puts(sb, ", ");
            sdk_json_put_compact(sb, v->items[i]);
        }
        r2d_sb_putc(sb, ']');
        break;
    case R2D_JSON_OBJ:
        r2d_sb_putc(sb, '{');
        for (int i = 0; i < v->count; ++i) {
            if (i) r2d_sb_puts(sb, ", ");
            r2d_sb_put_json_string(sb, v->keys[i]);
            r2d_sb_puts(sb, ": ");
            sdk_json_put_compact(sb, v->items[i]);
        }
        r2d_sb_putc(sb, '}');
        break;
    }
}
