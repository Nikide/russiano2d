// ===========================================================================
// Валидация ассетов: единый реестр проверок по типу (docs/SDK.md §6).
//
// Каждая проверка — функция void(path, report). Диагностика структурная:
// code, severity, asset, location, message, details. Модули инструментов
// (Phase 2+) регистрируют сюда свои типы.
// ===========================================================================
#include "sdk.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

// ---------------------------------------------------------------------------
// project.json
// ---------------------------------------------------------------------------
static void validate_project(const char *path, SdkReport *rep)
{
    R2dJson *root = sdk_load_json(path, rep);
    if (!root) return;
    if (root->type != R2D_JSON_OBJ) {
        sdk_diag(rep, SDK_ERROR, "SDK_PROJECT_ROOT", path, NULL, NULL, "project.json должен быть объектом");
        r2d_json_free(root);
        return;
    }
    static const char *const nums[] = { "width", "height" };
    for (int i = 0; i < 2; ++i) {
        const R2dJson *v = r2d_json_get(root, nums[i]);
        if (!v) continue;
        if (v->type != R2D_JSON_NUM || v->number < 1 || v->number > 16384 || v->number != floor(v->number)) {
            char loc[64];
            snprintf(loc, sizeof loc, "{\"field\":\"%s\"}", nums[i]);
            sdk_diag(rep, SDK_ERROR, "SDK_PROJECT_FIELD", path, loc, NULL,
                     "Поле %s должно быть целым 1..16384", nums[i]);
        }
    }
    static const char *const strs[] = { "title", "version" };
    for (int i = 0; i < 2; ++i) {
        const R2dJson *v = r2d_json_get(root, strs[i]);
        if (v && v->type != R2D_JSON_STR) {
            char loc[64];
            snprintf(loc, sizeof loc, "{\"field\":\"%s\"}", strs[i]);
            sdk_diag(rep, SDK_ERROR, "SDK_PROJECT_FIELD", path, loc, NULL,
                     "Поле %s должно быть строкой", strs[i]);
        }
    }
    r2d_json_free(root);

    char dir[1024], main_js[1100];
    sdk_dirname(path, dir, sizeof dir);
    sdk_join(dir, "main.js", main_js, sizeof main_js);
    if (!sdk_file_exists(main_js)) {
        sdk_diag(rep, SDK_WARNING, "SDK_PROJECT_NO_MAIN", path, NULL, NULL,
                 "Рядом с project.json нет main.js — точка входа задаётся флагом --entry при сборке");
    }
}

// ---------------------------------------------------------------------------
// sdk_tools.json
// ---------------------------------------------------------------------------
static void validate_registry(const char *path, SdkReport *rep)
{
    SdkRegistry reg;
    sdk_registry_load(path, &reg, rep);
    sdk_registry_free(&reg);
}

// ---------------------------------------------------------------------------
// Любой JSON
// ---------------------------------------------------------------------------
static void validate_json(const char *path, SdkReport *rep)
{
    R2dJson *root = sdk_load_json(path, rep);
    r2d_json_free(root);
}

typedef struct Validator {
    const char *type;
    SdkValidateFn fn;
} Validator;

static const Validator k_validators[] = {
    { "project",      validate_project },
    { "sdk.registry", validate_registry },
    { "json",         validate_json },
    { "sprite.atlas", sdk_validate_atlas },
};

int sdk_validator_count(void) { return (int)(sizeof k_validators / sizeof k_validators[0]); }
const char *sdk_validator_type(int i) { return k_validators[i].type; }

const char *sdk_validate_file(const char *path, const char *type_override, SdkReport *rep)
{
    const char *type = type_override && type_override[0] ? type_override : sdk_asset_type(path);
    if (!sdk_file_exists(path)) {
        sdk_diag(rep, SDK_ERROR, "SDK_FILE_NOT_FOUND", path, NULL, NULL, "Файл не найден: %s", path);
        return type;
    }
    for (size_t i = 0; i < sizeof k_validators / sizeof k_validators[0]; ++i) {
        if (strcmp(k_validators[i].type, type) == 0) {
            k_validators[i].fn(path, rep);
            return type;
        }
    }
    char details[128];
    snprintf(details, sizeof details, "{\"type\":\"%s\"}", type);
    sdk_diag(rep, SDK_INFO, "SDK_NO_VALIDATOR", path, NULL, details,
             "Для типа «%s» проверки пока нет — файл не проверялся", type);
    return type;
}
