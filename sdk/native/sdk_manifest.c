// ===========================================================================
// Валидация манифеста batch и сессии агента (§29).
//
// Раньше эти файлы проверялись типом «json» — то есть проверкой «это JSON», и
// всё. Из-за этого `r2d-sdk validate ci.batch.json` говорил «ok» на манифесте
// с несуществующей операцией, а панель Automation показывала свои замечания
// вместо структурных кодов. Здесь описаны те же правила, по которым файлы
// реально исполняются (sdk_batch.c и sdk_agent.c), чтобы CLI и панели видели
// одни и те же ошибки ДО запуска.
// ===========================================================================
#include "sdk.h"

#include <math.h>
#include <stdio.h>
#include <string.h>

// ---------------------------------------------------------------------------
// Манифест batch: version, jobs[].op/source
// ---------------------------------------------------------------------------
void sdk_validate_sdk_manifest(const char *path, SdkReport *rep)
{
    R2dJson *root = sdk_load_json(path, rep);
    if (!root) return;
    if (root->type != R2D_JSON_OBJ) {
        sdk_diag(rep, SDK_ERROR, "SDK_BATCH_FORMAT", path, NULL, NULL, "Манифест должен быть объектом");
        r2d_json_free(root);
        return;
    }
    if (r2d_json_num(r2d_json_get(root, "version"), 0) != 1) {
        sdk_diag(rep, SDK_ERROR, "SDK_BATCH_VERSION", path, "{\"field\":\"version\"}", NULL,
                 "Поддерживается version: 1");
    }
    const R2dJson *jobs = r2d_json_get(root, "jobs");
    if (!jobs || jobs->type != R2D_JSON_ARR) {
        sdk_diag(rep, SDK_ERROR, "SDK_BATCH_FORMAT", path, "{\"field\":\"jobs\"}", NULL,
                 "Нужен массив jobs");
        r2d_json_free(root);
        return;
    }
    if (jobs->count > 4096) {
        sdk_diag(rep, SDK_ERROR, "SDK_BATCH_FORMAT", path, "{\"field\":\"jobs\"}", NULL,
                 "jobs: до 4096 заданий");
        r2d_json_free(root);
        return;
    }
    for (int i = 0; i < jobs->count; ++i) {
        const R2dJson *j = jobs->items[i];
        char loc[64];
        snprintf(loc, sizeof loc, "{\"job\":%d}", i);
        if (j->type != R2D_JSON_OBJ) {
            sdk_diag(rep, SDK_ERROR, "SDK_BATCH_JOB", path, loc, NULL,
                     "job %d: должен быть объектом", i);
            continue;
        }
        const R2dJson *src = r2d_json_get(j, "source");
        if (!src || src->type != R2D_JSON_STR || !src->string[0]) {
            sdk_diag(rep, SDK_ERROR, "SDK_BATCH_JOB", path, loc, NULL,
                     "job %d: нужен непустой source", i);
        }
        const R2dJson *op = r2d_json_get(j, "op");
        if (!op || op->type != R2D_JSON_STR || !op->string[0]) {
            sdk_diag(rep, SDK_ERROR, "SDK_BATCH_OPERATION", path, loc, NULL,
                     "job %d: нужен op", i);
        } else if (strcmp(op->string, "validate") != 0) {
            sdk_diag(rep, SDK_ERROR, "SDK_BATCH_OPERATION", path, loc,
                     "{\"op\":\"validate\"}",
                     "job %d: поддержан только op validate, а не «%s»", i, op->string);
        }
        const R2dJson *type = r2d_json_get(j, "type");
        if (type && type->type != R2D_JSON_STR) {
            sdk_diag(rep, SDK_ERROR, "SDK_BATCH_JOB", path, loc, NULL,
                     "job %d: type — строка (или не задан)", i);
        }
    }
    r2d_json_free(root);
}

// ---------------------------------------------------------------------------
// Сессия агента: version, game, requests[], timeoutMs, seed, scene
// ---------------------------------------------------------------------------
void sdk_validate_agent_session(const char *path, SdkReport *rep)
{
    R2dJson *root = sdk_load_json(path, rep);
    if (!root) return;
    if (root->type != R2D_JSON_OBJ) {
        sdk_diag(rep, SDK_ERROR, "SDK_AGENT_SESSION", path, NULL, NULL, "Сессия должна быть объектом");
        r2d_json_free(root);
        return;
    }
    const char *game = r2d_json_str(r2d_json_get(root, "game"), NULL);
    if (!game || !game[0]) {
        sdk_diag(rep, SDK_ERROR, "SDK_AGENT_SESSION", path, "{\"field\":\"game\"}", NULL,
                 "Нужен непустой game (каталог проекта относительно сессии)");
    }
    if (r2d_json_num(r2d_json_get(root, "version"), 0) != 1) {
        sdk_diag(rep, SDK_ERROR, "SDK_AGENT_SESSION", path, "{\"field\":\"version\"}", NULL,
                 "Поддерживается version: 1");
    }
    const R2dJson *timeout = r2d_json_get(root, "timeoutMs");
    if (timeout) {
        const double v = r2d_json_num(timeout, -1);
        if (timeout->type != R2D_JSON_NUM || !isfinite(v) || floor(v) != v || v < 1 || v > 600000) {
            sdk_diag(rep, SDK_ERROR, "SDK_AGENT_SESSION", path, "{\"field\":\"timeoutMs\"}", NULL,
                     "timeoutMs — целое 1..600000");
        }
    }
    const R2dJson *seed = r2d_json_get(root, "seed");
    if (seed) {
        const double v = r2d_json_num(seed, -1);
        if (seed->type != R2D_JSON_NUM || !isfinite(v) || floor(v) != v || v < 0 || v > 4294967295.0) {
            sdk_diag(rep, SDK_ERROR, "SDK_AGENT_SESSION", path, "{\"field\":\"seed\"}", NULL,
                     "seed — целое 0..2^32-1");
        }
    }
    const R2dJson *scene = r2d_json_get(root, "scene");
    if (scene && scene->type != R2D_JSON_STR) {
        sdk_diag(rep, SDK_ERROR, "SDK_AGENT_SESSION", path, "{\"field\":\"scene\"}", NULL,
                 "scene — строка (или не задан)");
    }
    const R2dJson *requests = r2d_json_get(root, "requests");
    if (!requests || requests->type != R2D_JSON_ARR) {
        sdk_diag(rep, SDK_ERROR, "SDK_AGENT_SESSION", path, "{\"field\":\"requests\"}", NULL,
                 "Нужен массив requests");
        r2d_json_free(root);
        return;
    }
    if (requests->count > 4096) {
        sdk_diag(rep, SDK_ERROR, "SDK_AGENT_SESSION", path, "{\"field\":\"requests\"}", NULL,
                 "requests: до 4096 запросов");
        r2d_json_free(root);
        return;
    }
    for (int i = 0; i < requests->count; ++i) {
        const R2dJson *req = requests->items[i];
        char loc[64];
        snprintf(loc, sizeof loc, "{\"request\":%d}", i);
        const char *cmd = req->type == R2D_JSON_OBJ ? r2d_json_str(r2d_json_get(req, "cmd"), NULL) : NULL;
        if (req->type != R2D_JSON_OBJ || !cmd || !cmd[0]) {
            sdk_diag(rep, SDK_ERROR, "SDK_AGENT_REQUEST", path, loc, NULL,
                     "request %d: нужен непустой cmd", i);
            continue;
        }
        if (strcmp(cmd, "quit") == 0 && i != requests->count - 1) {
            // quit завершает сессию: стоящий в середине он молча съел бы
            // остальные запросы, поэтому это ошибка, а не замечание.
            sdk_diag(rep, SDK_ERROR, "SDK_AGENT_REQUEST", path, loc, NULL,
                     "request %d: quit допустим только последним", i);
        }
    }
    r2d_json_free(root);
}
