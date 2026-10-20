// ===========================================================================
// russiano2d-sdk — кликабельный запуск SDK.
//
// Двойной клик по этому бинарнику (Finder/Explorer) запускает то же, что
// `./russiano2d --game sdk`: SDK-приложение на том же runtime, без второго
// приложения и без shell-скрипта. Движок ищется рядом с лаунчером, каталог
// sdk/ — рядом с движком (пакет) или вверх по дереву (build/ в репозитории).
//
// Аргументы пробрасываются как есть: `russiano2d-sdk --headless --frames 60`.
// Если пользователь сам передал --game, он старше нашего значения.
// ===========================================================================
#include <SDL3/SDL.h>

#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef _WIN32
#include <direct.h>
#define r2d_chdir _chdir
#else
#include <unistd.h>
#define r2d_chdir chdir
#endif

static bool is_file(const char *path)
{
    SDL_PathInfo info;
    return path && *path && SDL_GetPathInfo(path, &info) && info.type == SDL_PATHTYPE_FILE;
}

static void dirname_of(const char *path, char *out, size_t cap)
{
    snprintf(out, cap, "%s", path ? path : "");
    char *slash = strrchr(out, '/');
#ifdef _WIN32
    char *bslash = strrchr(out, '\\');
    if (!slash || (bslash && bslash > slash)) slash = bslash;
#endif
    if (slash) *slash = '\0';
    else out[0] = '\0';
}

// Есть ли <dir>/sdk/project.json.
static bool sdk_here(const char *dir, char *out, size_t cap)
{
    char probe[4096];
    snprintf(probe, sizeof probe, "%s/sdk/project.json", dir);
    if (!is_file(probe)) return false;
    snprintf(out, cap, "%s/sdk", dir);
    return true;
}

int main(int argc, char **argv)
{
    char exe_dir[4096] = {0};
    const char *base = SDL_GetBasePath();
    if (base) snprintf(exe_dir, sizeof exe_dir, "%s", base);
    size_t len = strlen(exe_dir);
    while (len > 1 && (exe_dir[len - 1] == '/' || exe_dir[len - 1] == '\\')) exe_dir[--len] = '\0';

    char cwd[4096] = {0};
    char *cwd_raw = SDL_GetCurrentDirectory();
    if (cwd_raw) {
        snprintf(cwd, sizeof cwd, "%s", cwd_raw);
        SDL_free(cwd_raw);
    }

    // 1. sdk/ рядом с лаунчером (пакет), 2. вверх по дереву (build/ репозитория),
    // 3. sdk/ в текущем каталоге / вверх от него.
    char sdk_dir[4096] = {0};
    // Стандартный macOS app bundle: SDK-проект лежит в
    // <app>/Contents/Resources/sdk, а runtime — рядом с launcher в MacOS/.
    char contents_dir[4096];
    dirname_of(exe_dir, contents_dir, sizeof contents_dir);
    char bundled_sdk[4096];
    snprintf(bundled_sdk, sizeof bundled_sdk, "%s/Resources/sdk", contents_dir);
    char bundled_project[4096];
    snprintf(bundled_project, sizeof bundled_project, "%s/project.json", bundled_sdk);
    if (is_file(bundled_project)) {
        snprintf(sdk_dir, sizeof sdk_dir, "%s", bundled_sdk);
    }

    const char *starts[2] = { exe_dir, cwd };
    for (int si = 0; si < 2 && !sdk_dir[0]; ++si) {
        const char *start = starts[si];
        if (!start || !*start) continue;
        char cur[4096];
        snprintf(cur, sizeof cur, "%s", start);
        for (int depth = 0; depth < 6; ++depth) {
            if (sdk_here(cur, sdk_dir, sizeof sdk_dir)) break;
            char up[4096];
            dirname_of(cur, up, sizeof up);
            if (!up[0] || strcmp(up, cur) == 0) break;
            snprintf(cur, sizeof cur, "%s", up);
        }
        if (sdk_dir[0]) break;
    }
    (void)0;

    if (!sdk_dir[0]) {
        SDL_ShowSimpleMessageBox(SDL_MESSAGEBOX_ERROR, "Russiano2D SDK",
            "Не найден каталог sdk/ (sdk/project.json).\n"
            "Положите russiano2d-sdk рядом с каталогом sdk/ или запустите из корня SDK.",
            NULL);
        return 1;
    }

    char engine[4096] = {0};
#ifdef _WIN32
    const char *exe_name = "russiano2d.exe";
#else
    const char *exe_name = "russiano2d";
#endif
    snprintf(engine, sizeof engine, "%s/%s", exe_dir, exe_name);
    if (!is_file(engine)) {
        // SDL_GetBasePath() on macOS app bundles points to Resources rather
        // than MacOS on some launch paths. Resolve the sibling runtime from
        // the standard Contents/MacOS directory in that case.
        snprintf(engine, sizeof engine, "%s/MacOS/%s", contents_dir, exe_name);
    }
    if (!is_file(engine)) {
        char parent[4096];
        dirname_of(exe_dir, parent, sizeof parent);
        snprintf(engine, sizeof engine, "%s/%s", parent, exe_name);
    }
    if (!is_file(engine)) {
        SDL_ShowSimpleMessageBox(SDL_MESSAGEBOX_ERROR, "Russiano2D SDK",
            "Не найден исполняемый файл движка russiano2d рядом с лаунчером.",
            NULL);
        return 1;
    }

    // Рабочий каталог — родитель sdk/: тогда $ API видит sdk_tools.json и docs.
    char sdk_parent[4096];
    dirname_of(sdk_dir, sdk_parent, sizeof sdk_parent);
    if (sdk_parent[0] && r2d_chdir(sdk_parent) != 0) {
        SDL_ShowSimpleMessageBox(SDL_MESSAGEBOX_ERROR, "Russiano2D SDK",
            "Не удалось перейти в каталог SDK.", NULL);
        return 1;
    }

    bool user_game = false;
    for (int i = 1; i < argc; ++i) {
        if (strcmp(argv[i], "--game") == 0) { user_game = true; break; }
    }

    const char **args = (const char **)calloc((size_t)argc + 4, sizeof *args);
    if (!args) return 1;
    int n = 0;
    args[n++] = engine;
    char game_rel[] = "sdk";
    if (!user_game) {
        args[n++] = "--game";
        args[n++] = game_rel;
    }
    for (int i = 1; i < argc; ++i) args[n++] = argv[i];
    args[n] = NULL;

#ifdef __APPLE__
    // In the Finder .app, keep the runtime in this process so macOS assigns
    // its window to the app bundle (instead of a detached child process).
    execv(engine, (char *const *)args);
    {
        char msg[1024];
        snprintf(msg, sizeof msg, "Не удалось запустить движок: %s", strerror(errno));
        SDL_ShowSimpleMessageBox(SDL_MESSAGEBOX_ERROR, "Russiano2D SDK", msg, NULL);
    }
    free(args);
    return 1;
#else
    SDL_Process *process = SDL_CreateProcess(args, false);
    free(args);
    if (!process) {
        char msg[1024];
        snprintf(msg, sizeof msg, "Не удалось запустить движок: %s", SDL_GetError());
        SDL_ShowSimpleMessageBox(SDL_MESSAGEBOX_ERROR, "Russiano2D SDK", msg, NULL);
        return 1;
    }

    int exit_code = 0;
    SDL_WaitProcess(process, true, &exit_code);
    SDL_DestroyProcess(process);
    return exit_code;
#endif
}
