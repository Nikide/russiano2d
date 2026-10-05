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
    const int number = (int)(value->number + 0.5);
    return number > 0 ? number : fallback;
}

static void apply_json(R2dProject *project, R2dJson *root, const char *source)
{
    if (!root || root->type != R2D_JSON_OBJ) {
        R2D_WARN("манифест %s: ожидался объект JSON — беру значения по умолчанию", source);
        return;
    }

    char title[R2D_TITLE_MAX] = { 0 };
    read_string(root, "title", title, sizeof title);
    if (title[0]) {
        SDL_snprintf(project->title, sizeof project->title, "%s", title);
        project->has_title = true;
    }

    char version[64] = { 0 };
    read_string(root, "version", version, sizeof version);
    if (version[0]) SDL_snprintf(project->version, sizeof project->version, "%s", version);

    const int width  = read_int(root, "width", 0);
    const int height = read_int(root, "height", 0);
    if (width > 0) project->width = width;
    if (height > 0) project->height = height;
    if (width > 0 || height > 0) project->has_size = true;

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
