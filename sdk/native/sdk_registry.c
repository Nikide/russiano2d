// ===========================================================================
// Реестр инструментов SDK: sdk_tools.json (docs/SDK.md §3).
//
// Правило из спецификации: неверная версия схемы или некорректная запись
// показывается структурной диагностикой, а не молча пропускается. Поэтому
// запись с ошибкой остаётся в списке с valid=false, а причина — в report.
// ===========================================================================
#include "sdk.h"

#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static bool id_ok(const char *id)
{
    if (!id[0] || !(islower((unsigned char)id[0]) || isdigit((unsigned char)id[0]))) return false;
    for (const char *p = id; *p; ++p) {
        if (!(islower((unsigned char)*p) || isdigit((unsigned char)*p) || *p == '-')) return false;
    }
    return true;
}

static bool rel_path_ok(const char *p)
{
    if (!p[0] || p[0] == '/' || strstr(p, "..") || strchr(p, '\\')) return false;
    if (strlen(p) > 2 && p[1] == ':') return false;    // «C:\…»
    return true;
}

static char *loc_json(int index, const char *id, const char *field)
{
    R2dSb sb;
    r2d_sb_init(&sb);
    r2d_sb_printf(&sb, "{\"index\":%d", index);
    if (id && id[0]) {
        r2d_sb_puts(&sb, ",\"id\":");
        r2d_sb_put_json_string(&sb, id);
    }
    if (field) {
        r2d_sb_puts(&sb, ",\"field\":");
        r2d_sb_put_json_string(&sb, field);
    }
    r2d_sb_putc(&sb, '}');
    return r2d_sb_take(&sb);
}

// Читает обязательное строковое поле. Ошибку регистрирует сам.
static bool need_str(const R2dJson *obj, const char *key, char *out, size_t cap, int index,
                     const char *id, SdkReport *rep, const char *asset)
{
    const R2dJson *v = r2d_json_get(obj, key);
    if (!v || v->type != R2D_JSON_STR || !v->string || !v->string[0]) {
        char *loc = loc_json(index, id, key);
        sdk_diag(rep, SDK_ERROR, "SDK_REGISTRY_FIELD", asset, loc, NULL,
                 "У записи #%d нет обязательного строкового поля «%s»", index, key);
        free(loc);
        out[0] = '\0';
        return false;
    }
    snprintf(out, cap, "%s", v->string);
    return true;
}

bool sdk_registry_load(const char *path, SdkRegistry *reg, SdkReport *rep)
{
    memset(reg, 0, sizeof *reg);
    snprintf(reg->path, sizeof reg->path, "%s", path);

    R2dJson *root = sdk_load_json(path, rep);
    if (!root) return false;
    if (root->type != R2D_JSON_OBJ) {
        sdk_diag(rep, SDK_ERROR, "SDK_REGISTRY_ROOT", path, NULL, NULL,
                 "Корень реестра должен быть объектом {schema_version, tools}");
        r2d_json_free(root);
        return false;
    }

    const R2dJson *ver = r2d_json_get(root, "schema_version");
    reg->schema_version = ver && ver->type == R2D_JSON_NUM ? (int)ver->number : 0;
    if (reg->schema_version != 1) {
        char details[96];
        snprintf(details, sizeof details, "{\"expected\":1,\"found\":%d}", reg->schema_version);
        sdk_diag(rep, SDK_ERROR, "SDK_REGISTRY_SCHEMA_VERSION", path, NULL, details,
                 "Неподдерживаемая schema_version: ожидалась 1, найдена %d. "
                 "Обновите SDK или мигрируйте sdk_tools.json", reg->schema_version);
        r2d_json_free(root);
        return false;
    }

    const R2dJson *tools = r2d_json_get(root, "tools");
    if (!tools || tools->type != R2D_JSON_ARR) {
        sdk_diag(rep, SDK_ERROR, "SDK_REGISTRY_TOOLS_MISSING", path, NULL, NULL,
                 "В реестре нет массива tools");
        r2d_json_free(root);
        return false;
    }

    char dir[1024];
    sdk_dirname(path, dir, sizeof dir);

    const int n = r2d_json_size(tools);
    reg->tools = (SdkTool *)calloc((size_t)(n > 0 ? n : 1), sizeof(SdkTool));
    if (!reg->tools) {
        r2d_json_free(root);
        return false;
    }

    for (int i = 0; i < n; ++i) {
        const R2dJson *item = r2d_json_at(tools, i);
        SdkTool *t = &reg->tools[reg->count++];
        const int errors_before = rep->errors;
        char id_for_diag[64] = "";

        if (!item || item->type != R2D_JSON_OBJ) {
            char *loc = loc_json(i, NULL, NULL);
            sdk_diag(rep, SDK_ERROR, "SDK_REGISTRY_ENTRY", path, loc, NULL,
                     "Запись #%d должна быть объектом", i);
            free(loc);
            continue;
        }

        need_str(item, "id", t->id, sizeof t->id, i, NULL, rep, path);
        snprintf(id_for_diag, sizeof id_for_diag, "%s", t->id);
        if (t->id[0] && !id_ok(t->id)) {
            char *loc = loc_json(i, t->id, "id");
            sdk_diag(rep, SDK_ERROR, "SDK_REGISTRY_ID", path, loc, NULL,
                     "id «%s» должен состоять из a-z, 0-9 и «-» и начинаться с буквы или цифры", t->id);
            free(loc);
        }
        need_str(item, "name", t->name, sizeof t->name, i, id_for_diag, rep, path);
        need_str(item, "description", t->description, sizeof t->description, i, id_for_diag, rep, path);
        need_str(item, "entry", t->entry, sizeof t->entry, i, id_for_diag, rep, path);
        if (need_str(item, "last_updated", t->last_updated, sizeof t->last_updated, i, id_for_diag, rep, path)
            && !sdk_iso8601_tz_ok(t->last_updated)) {
            char *loc = loc_json(i, id_for_diag, "last_updated");
            sdk_diag(rep, SDK_ERROR, "SDK_REGISTRY_DATE", path, loc, NULL,
                     "last_updated «%s» — не ISO 8601 с часовым поясом (например 2026-10-08T17:00:00+03:00)",
                     t->last_updated);
            free(loc);
        }

        const R2dJson *bin = r2d_json_get(item, "binary");
        if (bin && bin->type == R2D_JSON_STR && bin->string) {
            snprintf(t->binary, sizeof t->binary, "%s", bin->string);
            if (!rel_path_ok(t->binary)) {
                char *loc = loc_json(i, id_for_diag, "binary");
                sdk_diag(rep, SDK_ERROR, "SDK_REGISTRY_BINARY_PATH", path, loc, NULL,
                         "binary «%s» должен быть относительным путём без «..»", t->binary);
                free(loc);
                t->binary[0] = '\0';
            } else {
                char full[1536];
                sdk_join(dir, t->binary, full, sizeof full);
                if (!sdk_file_exists(full)) {
                    char *loc = loc_json(i, id_for_diag, "binary");
                    sdk_diag(rep, SDK_WARNING, "SDK_REGISTRY_BINARY_MISSING", path, loc, NULL,
                             "Бинарник «%s» не найден — соберите его (cmake --build build)", t->binary);
                    free(loc);
                }
            }
        }

        const R2dJson *cat = r2d_json_get(item, "category");
        if (cat && cat->type == R2D_JSON_STR && cat->string) snprintf(t->category, sizeof t->category, "%s", cat->string);

        const R2dJson *assets = r2d_json_get(item, "assets");
        if (assets && assets->type == R2D_JSON_ARR) {
            const int an = r2d_json_size(assets);
            for (int k = 0; k < an && t->asset_count < 16; ++k) {
                const R2dJson *a = r2d_json_at(assets, k);
                if (a && a->type == R2D_JSON_STR && a->string && a->string[0]) {
                    t->assets[t->asset_count++] = strdup(a->string);
                }
            }
        }

        // Уникальность id.
        for (int k = 0; k < reg->count - 1; ++k) {
            if (t->id[0] && strcmp(reg->tools[k].id, t->id) == 0) {
                char *loc = loc_json(i, t->id, "id");
                char details[96];
                snprintf(details, sizeof details, "{\"firstIndex\":%d}", k);
                sdk_diag(rep, SDK_ERROR, "SDK_REGISTRY_DUPLICATE_ID", path, loc, details,
                         "id «%s» повторяется: компонент должен быть перечислен ровно один раз", t->id);
                free(loc);
                break;
            }
        }

        t->valid = rep->errors == errors_before;
    }

    r2d_json_free(root);
    return true;
}

void sdk_registry_free(SdkRegistry *reg)
{
    for (int i = 0; i < reg->count; ++i) {
        for (int k = 0; k < reg->tools[i].asset_count; ++k) free(reg->tools[i].assets[k]);
    }
    free(reg->tools);
    memset(reg, 0, sizeof *reg);
}

void sdk_registry_put_json(const SdkRegistry *reg, R2dSb *out)
{
    r2d_sb_printf(out, "\"schema_version\":%d,\"tools\":[", reg->schema_version);
    for (int i = 0; i < reg->count; ++i) {
        const SdkTool *t = &reg->tools[i];
        if (i) r2d_sb_putc(out, ',');
        r2d_sb_putc(out, '{');
        sdk_put_kv_str(out, "id", t->id);
        r2d_sb_putc(out, ',');
        sdk_put_kv_str(out, "name", t->name);
        r2d_sb_putc(out, ',');
        sdk_put_kv_str(out, "description", t->description);
        r2d_sb_putc(out, ',');
        sdk_put_kv_str(out, "last_updated", t->last_updated);
        r2d_sb_putc(out, ',');
        sdk_put_kv_str(out, "entry", t->entry);
        r2d_sb_putc(out, ',');
        sdk_put_kv_str(out, "binary", t->binary[0] ? t->binary : NULL);
        r2d_sb_putc(out, ',');
        sdk_put_kv_str(out, "category", t->category[0] ? t->category : NULL);
        r2d_sb_puts(out, ",\"assets\":[");
        for (int k = 0; k < t->asset_count; ++k) {
            if (k) r2d_sb_putc(out, ',');
            r2d_sb_put_json_string(out, t->assets[k]);
        }
        r2d_sb_printf(out, "],\"valid\":%s}", t->valid ? "true" : "false");
    }
    r2d_sb_putc(out, ']');
}
