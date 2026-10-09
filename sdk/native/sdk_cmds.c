// ===========================================================================
// Команды CLI r2d-sdk: tools, assets, project, projects, validate, run, build.
// Каждая печатает один JSON-объект и возвращает код выхода (0 — ok).
// ===========================================================================
#include "sdk.h"

#include <SDL3/SDL.h>

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static void emit(R2dSb *out)
{
    puts(out->data);
    fflush(stdout);
}

// Ищет реестр: --registry, ./sdk_tools.json, рядом с бинарником и уровнем выше.
static bool find_registry(const SdkArgs *a, char *out, size_t cap)
{
    const char *explicit_path = sdk_arg_value(a, "--registry");
    if (explicit_path) {
        snprintf(out, cap, "%s", explicit_path);
        return true;
    }
    char cand[1536];
    snprintf(cand, sizeof cand, "sdk_tools.json");
    if (sdk_file_exists(cand)) { snprintf(out, cap, "%s", cand); return true; }
    sdk_join(sdk_exe_dir(), "sdk_tools.json", cand, sizeof cand);
    if (sdk_file_exists(cand)) { snprintf(out, cap, "%s", cand); return true; }
    sdk_join(sdk_exe_dir(), "../sdk_tools.json", cand, sizeof cand);
    if (sdk_file_exists(cand)) { snprintf(out, cap, "%s", cand); return true; }
    return false;
}

// ---------------------------------------------------------------------------
// tools
// ---------------------------------------------------------------------------
int sdk_cmd_tools(const SdkArgs *a)
{
    SdkReport rep;
    sdk_report_init(&rep);
    char path[1536];
    if (!find_registry(a, path, sizeof path)) {
        const int rc = sdk_fail(&rep, "SDK_REGISTRY_NOT_FOUND",
                                "sdk_tools.json не найден: укажите --registry <файл>");
        sdk_report_free(&rep);
        return rc;
    }
    SdkRegistry reg;
    const bool loaded = sdk_registry_load(path, &reg, &rep);

    R2dSb out;
    r2d_sb_init(&out);
    r2d_sb_printf(&out, "{\"ok\":%s,", loaded && rep.errors == 0 ? "true" : "false");
    sdk_put_kv_str(&out, "registry", path);
    r2d_sb_putc(&out, ',');
    if (loaded) {
        sdk_registry_put_json(&reg, &out);
        r2d_sb_putc(&out, ',');
    } else {
        r2d_sb_puts(&out, "\"schema_version\":null,\"tools\":[],");
    }
    sdk_report_put_counts(&rep, &out);
    r2d_sb_putc(&out, ',');
    sdk_report_put(&rep, &out);
    r2d_sb_putc(&out, '}');
    emit(&out);

    const int rc = loaded && rep.errors == 0 ? 0 : 1;
    r2d_sb_free(&out);
    if (loaded) sdk_registry_free(&reg);
    sdk_report_free(&rep);
    return rc;
}

// ---------------------------------------------------------------------------
// assets
// ---------------------------------------------------------------------------
int sdk_cmd_assets(const SdkArgs *a)
{
    SdkReport rep;
    sdk_report_init(&rep);
    const char *root = sdk_arg_positional(a, 0);
    if (!root) {
        const int rc = sdk_fail(&rep, "SDK_USAGE", "Использование: r2d-sdk assets <каталог проекта> [--registry sdk_tools.json]");
        sdk_report_free(&rep);
        return rc;
    }

    SdkRegistry reg;
    bool have_reg = false;
    char reg_path[1536];
    if (find_registry(a, reg_path, sizeof reg_path)) {
        SdkReport reg_rep;
        sdk_report_init(&reg_rep);
        have_reg = sdk_registry_load(reg_path, &reg, &reg_rep);
        // Ошибки реестра важны, но не мешают показать файлы проекта.
        if (reg_rep.count > 0) {
            sdk_diag(&rep, SDK_WARNING, "SDK_REGISTRY_INVALID", reg_path, NULL, NULL,
                     "Реестр инструментов прочитан с замечаниями (%d): сопоставление ассетов с инструментами неполное",
                     reg_rep.count);
        }
        sdk_report_free(&reg_rep);
    }

    SdkAssets assets;
    const bool ok = sdk_assets_scan(root, have_reg ? &reg : NULL, &assets, &rep);

    R2dSb out;
    r2d_sb_init(&out);
    r2d_sb_printf(&out, "{\"ok\":%s,", ok ? "true" : "false");
    sdk_put_kv_str(&out, "root", root);
    r2d_sb_puts(&out, ",\"entries\":[");
    if (ok) {
        for (int i = 0; i < assets.count; ++i) {
            const SdkAssetEntry *e = &assets.items[i];
            if (i) r2d_sb_putc(&out, ',');
            r2d_sb_putc(&out, '{');
            sdk_put_kv_str(&out, "path", e->path);
            r2d_sb_putc(&out, ',');
            sdk_put_kv_str(&out, "type", e->type);
            r2d_sb_printf(&out, ",\"size\":%lld,\"mtime\":%lld,", (long long)e->size, (long long)e->mtime);
            sdk_put_kv_str(&out, "tool", e->tool[0] ? e->tool : NULL);
            r2d_sb_putc(&out, '}');
        }
    }
    r2d_sb_printf(&out, "],\"count\":%d,\"truncated\":%s,", ok ? assets.count : 0,
                  ok && assets.truncated ? "true" : "false");
    sdk_report_put_counts(&rep, &out);
    r2d_sb_putc(&out, ',');
    sdk_report_put(&rep, &out);
    r2d_sb_putc(&out, '}');
    emit(&out);

    r2d_sb_free(&out);
    if (ok) sdk_assets_free(&assets);
    if (have_reg) sdk_registry_free(&reg);
    sdk_report_free(&rep);
    return ok ? 0 : 1;
}

// ---------------------------------------------------------------------------
// project
// ---------------------------------------------------------------------------
int sdk_cmd_project(const SdkArgs *a)
{
    SdkReport rep;
    sdk_report_init(&rep);
    const char *dir = sdk_arg_positional(a, 0);
    if (!dir) {
        const int rc = sdk_fail(&rep, "SDK_USAGE", "Использование: r2d-sdk project <каталог проекта>");
        sdk_report_free(&rep);
        return rc;
    }
    if (!sdk_is_dir(dir)) {
        const int rc = sdk_fail(&rep, "SDK_PROJECT_NOT_FOUND", "Каталог проекта не найден: %s", dir);
        sdk_report_free(&rep);
        return rc;
    }

    char manifest[1536], main_js[1536];
    sdk_join(dir, "project.json", manifest, sizeof manifest);
    sdk_join(dir, "main.js", main_js, sizeof main_js);
    const bool has_manifest = sdk_file_exists(manifest);
    const bool has_main = sdk_file_exists(main_js);

    R2dSb out;
    r2d_sb_init(&out);
    const char *title = NULL, *version = NULL;
    int width = 0, height = 0;
    R2dJson *root = NULL;
    if (has_manifest) {
        sdk_validate_file(manifest, "project", &rep);
        char *text = sdk_read_file(manifest, NULL);
        if (text) {
            char err[128];
            root = r2d_json_parse(text, err, sizeof err);
            free(text);
        }
        if (root && root->type == R2D_JSON_OBJ) {
            title = r2d_json_str(r2d_json_get(root, "title"), NULL);
            version = r2d_json_str(r2d_json_get(root, "version"), NULL);
            width = r2d_json_int(r2d_json_get(root, "width"), 0);
            height = r2d_json_int(r2d_json_get(root, "height"), 0);
        }
    } else if (!has_main) {
        sdk_diag(&rep, SDK_WARNING, "SDK_NOT_A_PROJECT", dir, NULL, NULL,
                 "В каталоге нет ни project.json, ни main.js — это не проект R2D");
    }

    r2d_sb_printf(&out, "{\"ok\":%s,", rep.errors == 0 ? "true" : "false");
    sdk_put_kv_str(&out, "dir", dir);
    r2d_sb_printf(&out, ",\"hasManifest\":%s,\"hasMain\":%s,", has_manifest ? "true" : "false", has_main ? "true" : "false");
    sdk_put_kv_str(&out, "title", title);
    r2d_sb_putc(&out, ',');
    sdk_put_kv_str(&out, "version", version);
    r2d_sb_printf(&out, ",\"width\":%d,\"height\":%d,", width, height);
    sdk_report_put_counts(&rep, &out);
    r2d_sb_putc(&out, ',');
    sdk_report_put(&rep, &out);
    r2d_sb_putc(&out, '}');
    emit(&out);

    r2d_json_free(root);
    r2d_sb_free(&out);
    sdk_report_free(&rep);
    return 0;
}

// ---------------------------------------------------------------------------
// projects: найти проекты (каталоги с project.json) под каталогом
// ---------------------------------------------------------------------------
int sdk_cmd_projects(const SdkArgs *a)
{
    SdkReport rep;
    sdk_report_init(&rep);
    const char *root = sdk_arg_positional(a, 0);
    if (!root) root = ".";

    SdkAssets assets;
    const bool ok = sdk_assets_scan(root, NULL, &assets, &rep);

    R2dSb out;
    r2d_sb_init(&out);
    r2d_sb_printf(&out, "{\"ok\":%s,", ok ? "true" : "false");
    sdk_put_kv_str(&out, "root", root);
    r2d_sb_puts(&out, ",\"projects\":[");
    int n = 0;
    if (ok) {
        for (int i = 0; i < assets.count; ++i) {
            const SdkAssetEntry *e = &assets.items[i];
            if (strcmp(e->type, "project") != 0 || strcmp(sdk_basename(e->path), "project.json") != 0) continue;
            char dir[1024];
            sdk_dirname(e->path, dir, sizeof dir);
            if (n++) r2d_sb_putc(&out, ',');
            r2d_sb_putc(&out, '{');
            sdk_put_kv_str(&out, "path", dir);
            r2d_sb_putc(&out, ',');
            char manifest[2048];
            sdk_join(root, e->path, manifest, sizeof manifest);
            char *text = sdk_read_file(manifest, NULL);
            const char *title = NULL;
            R2dJson *j = NULL;
            if (text) {
                char err[128];
                j = r2d_json_parse(text, err, sizeof err);
                free(text);
                if (j) title = r2d_json_str(r2d_json_get(j, "title"), NULL);
            }
            sdk_put_kv_str(&out, "title", title);
            r2d_sb_putc(&out, '}');
            r2d_json_free(j);
        }
    }
    r2d_sb_printf(&out, "],\"count\":%d,", n);
    sdk_report_put_counts(&rep, &out);
    r2d_sb_putc(&out, ',');
    sdk_report_put(&rep, &out);
    r2d_sb_putc(&out, '}');
    emit(&out);

    r2d_sb_free(&out);
    if (ok) sdk_assets_free(&assets);
    sdk_report_free(&rep);
    return ok ? 0 : 1;
}

// ---------------------------------------------------------------------------
// validate
// ---------------------------------------------------------------------------
int sdk_cmd_validate(const SdkArgs *a)
{
    SdkReport rep;
    sdk_report_init(&rep);
    const char *path = sdk_arg_positional(a, 0);
    if (!path) {
        const int rc = sdk_fail(&rep, "SDK_USAGE", "Использование: r2d-sdk validate <файл> [--type <тип>]");
        sdk_report_free(&rep);
        return rc;
    }
    const char *type = sdk_validate_file(path, sdk_arg_value(a, "--type"), &rep);

    R2dSb out;
    r2d_sb_init(&out);
    r2d_sb_printf(&out, "{\"ok\":%s,", rep.errors == 0 ? "true" : "false");
    sdk_put_kv_str(&out, "asset", path);
    r2d_sb_putc(&out, ',');
    sdk_put_kv_str(&out, "type", type);
    r2d_sb_putc(&out, ',');
    sdk_report_put_counts(&rep, &out);
    r2d_sb_putc(&out, ',');
    sdk_report_put(&rep, &out);
    r2d_sb_putc(&out, '}');
    emit(&out);

    const int rc = rep.errors == 0 ? 0 : 1;
    r2d_sb_free(&out);
    sdk_report_free(&rep);
    return rc;
}

// ---------------------------------------------------------------------------
// run / build: запускают бинарник движка (массив аргументов, без shell)
// ---------------------------------------------------------------------------
static int run_engine(const SdkArgs *a, const char **eargv, int ecount, const char *what)
{
    SdkReport rep;
    sdk_report_init(&rep);
    char engine[1536];
    if (!sdk_find_engine(sdk_arg_value(a, "--engine"), engine, sizeof engine)) {
        const int rc = sdk_fail(&rep, "SDK_ENGINE_NOT_FOUND",
                                "Бинарник движка не найден: соберите проект (cmake --build build) или укажите --engine <путь>");
        sdk_report_free(&rep);
        return rc;
    }
    const char **argv = (const char **)calloc((size_t)ecount + 2, sizeof *argv);
    argv[0] = engine;
    for (int i = 0; i < ecount; ++i) argv[i + 1] = eargv[i];

    SdkProcResult res;
    const bool started = sdk_run_process(argv, &res);
    free(argv);
    if (!started) {
        const int rc = sdk_fail(&rep, "SDK_ENGINE_START", "Не удалось запустить движок: %s", engine);
        sdk_report_free(&rep);
        return rc;
    }
    if (res.exit_code != 0) {
        char details[64];
        snprintf(details, sizeof details, "{\"exitCode\":%d}", res.exit_code);
        sdk_diag(&rep, SDK_ERROR, "SDK_ENGINE_EXIT", NULL, NULL, details,
                 "%s завершился с кодом %d", what, res.exit_code);
    }

    // Хвост вывода: полный журнал сборки может быть большим.
    const size_t keep = 8192;
    const char *tail = res.out ? res.out : "";
    if (res.out_size > keep) tail = res.out + (res.out_size - keep);

    R2dSb out;
    r2d_sb_init(&out);
    r2d_sb_printf(&out, "{\"ok\":%s,\"exitCode\":%d,", res.exit_code == 0 ? "true" : "false", res.exit_code);
    sdk_put_kv_str(&out, "engine", engine);
    r2d_sb_putc(&out, ',');
    sdk_put_kv_str(&out, "outputTail", tail);
    r2d_sb_putc(&out, ',');
    sdk_report_put_counts(&rep, &out);
    r2d_sb_putc(&out, ',');
    sdk_report_put(&rep, &out);
    r2d_sb_putc(&out, '}');
    emit(&out);

    const int rc = res.exit_code == 0 ? 0 : 1;
    r2d_sb_free(&out);
    sdk_proc_free(&res);
    sdk_report_free(&rep);
    return rc;
}

int sdk_cmd_run(const SdkArgs *a)
{
    const char *dir = sdk_arg_positional(a, 0);
    if (!dir) {
        SdkReport rep;
        sdk_report_init(&rep);
        const int rc = sdk_fail(&rep, "SDK_USAGE",
            "Использование: r2d-sdk run <каталог игры> [--scene имя] [--frames N] [--headless] [--agent] [--engine путь]");
        sdk_report_free(&rep);
        return rc;
    }
    const char *eargv[24];
    int n = 0;
    eargv[n++] = "--game";
    eargv[n++] = dir;
    const char *scene = sdk_arg_value(a, "--scene");
    if (scene) { eargv[n++] = "--scene"; eargv[n++] = scene; }
    const char *frames = sdk_arg_value(a, "--frames");
    if (frames) { eargv[n++] = "--frames"; eargv[n++] = frames; }
    const char *fixed = sdk_arg_value(a, "--fixed-dt");
    if (fixed) { eargv[n++] = "--fixed-dt"; eargv[n++] = fixed; }
    const char *seed = sdk_arg_value(a, "--seed");
    if (seed) { eargv[n++] = "--seed"; eargv[n++] = seed; }
    if (sdk_arg_flag(a, "--headless")) eargv[n++] = "--headless";
    return run_engine(a, eargv, n, "Игра");
}

int sdk_cmd_build(const SdkArgs *a)
{
    const char *dir = sdk_arg_positional(a, 0);
    const char *out_path = sdk_arg_value(a, "--out");
    if (!dir || !out_path) {
        SdkReport rep;
        sdk_report_init(&rep);
        const int rc = sdk_fail(&rep, "SDK_USAGE",
            "Использование: r2d-sdk build <каталог проекта> --out <файл> [--entry main.js] [--encrypt|--no-encrypt] [--engine путь]");
        sdk_report_free(&rep);
        return rc;
    }
    // Каталог результата создаётся здесь: пакет не должен падать из-за отсутствующего build/…/
    char out_dir[1536];
    sdk_dirname(out_path, out_dir, sizeof out_dir);
    if (out_dir[0] && !sdk_is_dir(out_dir)) SDL_CreateDirectory(out_dir);
    const char *eargv[16];
    int n = 0;
    eargv[n++] = "build";
    eargv[n++] = "--project";
    eargv[n++] = dir;
    eargv[n++] = "--entry";
    const char *entry = sdk_arg_value(a, "--entry");
    eargv[n++] = entry ? entry : "main.js";
    eargv[n++] = "--out";
    eargv[n++] = out_path;
    if (sdk_arg_flag(a, "--encrypt")) eargv[n++] = "--encrypt";
    if (sdk_arg_flag(a, "--no-encrypt")) eargv[n++] = "--no-encrypt";
    return run_engine(a, eargv, n, "Сборка");
}
