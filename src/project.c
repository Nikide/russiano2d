// ===========================================================================
// Разбор манифеста проекта. Формат и старшинство — в src/project.h.
// ===========================================================================
#include "project.h"

#include "json.h"
#include "payload.h"
#include "r2d.h"

#include <SDL3/SDL.h>

#include <stdlib.h>
#include <string.h>

void r2d_project_defaults(R2dProject *project)
{
    if (!project) return;
    SDL_zero(*project);
    project->width = 1280;
    project->height = 720;
    project->schema_version = 1;
}

// Ищет project.json в грузе: сначала рядом с точкой входа, потом любой.
static const char *find_manifest_in_payload(const char *payload_entry)
{
    const int count = r2d_vfs_count();
    if (count <= 0) return NULL;

    // Каталог точки входа груза: «game/main.js» → «game/».
    char dir[512] = { 0 };
    if (payload_entry && payload_entry[0]) {
        const char *slash = SDL_strrchr(payload_entry, '/');
        if (slash) {
            const size_t len = (size_t)(slash - payload_entry);
            if (len < sizeof dir - 1) {
                memcpy(dir, payload_entry, len);
                dir[len] = '/';
                dir[len + 1] = '\0';
            }
        }
    }

    // Первый проход: манифест именно этой игры.
    for (int i = 0; i < count; ++i) {
        const char *path = r2d_vfs_path_at(i);
        if (!path) continue;
        const size_t len = SDL_strlen(path);
        if (len < 12) continue;                                  // короче "project.json"
        if (SDL_strcasecmp(path + len - 12, "project.json") != 0) continue;
        if (dir[0] && SDL_strncmp(path, dir, SDL_strlen(dir)) == 0) return path;
    }

    // Второй проход: любой манифест (в грузе может лежать только один).
    for (int i = 0; i < count; ++i) {
        const char *path = r2d_vfs_path_at(i);
        if (!path) continue;
        const size_t len = SDL_strlen(path);
        if (len >= 12 && SDL_strcasecmp(path + len - 12, "project.json") == 0) return path;
    }
    return NULL;
}

static void read_string(const R2dJson *root, const char *key, char *out, size_t out_size)
{
    const R2dJson *value = r2d_json_get(root, key);
    if (!value || value->type != R2D_JSON_STR || !value->string) return;
    SDL_snprintf(out, out_size, "%s", value->string);
}

static int read_int(const R2dJson *root, const char *key, int fallback)
{
    const R2dJson *value = r2d_json_get(root, key);
    if (!value || value->type != R2D_JSON_NUM) return fallback;
    // Округление с проверкой диапазона: в манифесте может оказаться inf или
    // 1e400, а приведение такого double к int — undefined behavior.
    const double n = value->number;
    if (!(n == n) || n >= 2000000000.0) return fallback;
    const int number = (int)(n + 0.5);
    return number > 0 ? number : fallback;
}

static void apply_json(R2dProject *project, R2dJson *root, const char *source)
{
    if (!root || root->type != R2D_JSON_OBJ) {
        R2D_WARN("манифест %s: ожидался объект JSON — беру значения по умолчанию", source);
        return;
    }

    const R2dJson *tool_host = r2d_json_get(root, "toolHost");
    if (tool_host && tool_host->type == R2D_JSON_BOOL) project->tool_host = tool_host->boolean;

    const R2dJson *schema = r2d_json_get(root, "schema_version");
    if (schema && schema->type == R2D_JSON_NUM && schema->number == 2.0) {
        // schema_version 2: настройки запуска лежат в project.* и runtime.*;
        // editor.* рантайм не читает.
        project->schema_version = 2;
        const R2dJson *meta = r2d_json_get(root, "project");
        const R2dJson *runtime = r2d_json_get(root, "runtime");
        const R2dJson *window = r2d_json_get(runtime, "window");
        if (meta && meta->type == R2D_JSON_OBJ) {
            read_string(meta, "version", project->version, sizeof project->version);
            read_string(meta, "name", project->title, sizeof project->title);
        }
        if (runtime && runtime->type == R2D_JSON_OBJ) {
            read_string(runtime, "entry", project->entry, sizeof project->entry);
            read_string(runtime, "start_scene", project->start_scene, sizeof project->start_scene);
        }
        if (window && window->type == R2D_JSON_OBJ) {
            read_string(window, "title", project->title, sizeof project->title);
            const R2dJson *fs = r2d_json_get(window, "fullscreen");
            if (fs && fs->type == R2D_JSON_BOOL) project->fullscreen = fs->boolean;
            const int width = read_int(window, "width", 0);
            const int height = read_int(window, "height", 0);
            if (width > 0) project->width = width;
            if (height > 0) project->height = height;
            if (width > 0 || height > 0) project->has_size = true;
        }
        if (project->title[0]) project->has_title = true;
    } else {
        char title[R2D_TITLE_MAX] = { 0 };
        read_string(root, "title", title, sizeof title);
        if (title[0]) {
            SDL_snprintf(project->title, sizeof project->title, "%s", title);
            project->has_title = true;
        }
        read_string(root, "version", project->version, sizeof project->version);
        const int width  = read_int(root, "width", 0);
        const int height = read_int(root, "height", 0);
        if (width > 0) project->width = width;
        if (height > 0) project->height = height;
        if (width > 0 || height > 0) project->has_size = true;
    }

    R2D_LOG("манифест проекта %s: имя окна «%s», размер %dx%d",
            source, project->has_title ? project->title : "(по умолчанию)",
            project->width, project->height);
}

bool r2d_project_load(R2dProject *project, const char *game_dir, const char *payload_entry)
{
    if (!project) return false;
    r2d_project_defaults(project);

    // 1. Груз собранной игры: манифест уже внутри бинарника.
    const char *packed = find_manifest_in_payload(payload_entry);
    if (packed) {
        size_t size = 0;
        uint8_t *data = r2d_vfs_read(packed, &size);
        if (data && size > 0) {
            // Данные груза идут в общем буфере без завершающего нуля, а
            // разборщику JSON нужна строка: копируем с запасом, иначе он
            // читает дальше манифеста и ругается на «лишние данные».
            char *text = (char *)SDL_malloc(size + 1);
            if (!text) {
                r2d_vfs_free(data);
                return false;
            }
            memcpy(text, data, size);
            text[size] = '\0';
            r2d_vfs_free(data);

            char err[256];
            R2dJson *root = r2d_json_parse(text, err, sizeof err);
            if (root) {
                apply_json(project, root, packed);
                r2d_json_free(root);
                SDL_free(text);
                return true;
            }
            R2D_WARN("манифест %s: %s", packed, err);
            SDL_free(text);
        }
    }

    // 2. Обычный проект: project.json рядом с точкой входа.
    return r2d_project_load_dir(project, game_dir);
}

bool r2d_project_load_dir(R2dProject *project, const char *game_dir)
{
    if (!project) return false;
    if (game_dir && game_dir[0]) {
        char path[4096];
        SDL_snprintf(path, sizeof path, "%s/project.json", game_dir);

        size_t size = 0;
        char *text = (char *)SDL_LoadFile(path, &size);
        if (text && size > 0) {
            char err[256];
            R2dJson *root = r2d_json_parse(text, err, sizeof err);
            if (root) {
                apply_json(project, root, path);
                r2d_json_free(root);
                SDL_free(text);
                return true;
            }
            R2D_WARN("манифест %s: %s", path, err);
            SDL_free(text);
        }
    }

    return false;
}
