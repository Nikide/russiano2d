// ===========================================================================
// Системные диалоги: см. src/dialog.h.
// ===========================================================================
#include "dialog.h"

#include <SDL3/SDL.h>

#include <stdlib.h>
#include <string.h>

#define R2D_DIALOG_MAX_FILTERS 16

// Запрос живёт, пока SDL не вызовет callback: фильтры обязаны быть валидны
// всё это время (SDL их не копирует).
typedef struct Request {
    int id;
    SDL_DialogFileFilter filters[R2D_DIALOG_MAX_FILTERS];
    char *filter_text[R2D_DIALOG_MAX_FILTERS * 2];
    int nfilters;
    struct Request *next;
} Request;

typedef struct Done {
    R2dDialogResult result;
    struct Done *next;
} Done;

static SDL_Mutex *g_lock;
static Request   *g_pending;
static Done      *g_done_head, *g_done_tail;
static int        g_next_id = 1;

static bool ensure_lock(void)
{
    if (!g_lock) g_lock = SDL_CreateMutex();
    return g_lock != NULL;
}

static void request_free(Request *r)
{
    if (!r) return;
    for (int i = 0; i < r->nfilters * 2; ++i) SDL_free(r->filter_text[i]);
    SDL_free(r);
}

static void SDLCALL on_done(void *userdata, const char *const *filelist, int filter)
{
    (void)filter;
    const int id = (int)(intptr_t)userdata;
    Done *d = (Done *)SDL_calloc(1, sizeof *d);
    if (d) {
        d->result.id = id;
        if (!filelist) {
            SDL_snprintf(d->result.error, sizeof d->result.error, "%s", SDL_GetError());
            if (!d->result.error[0]) SDL_snprintf(d->result.error, sizeof d->result.error, "диалог не открылся");
        } else {
            int n = 0;
            while (filelist[n]) n++;
            if (n > 0) {
                d->result.paths = (char **)SDL_calloc((size_t)n, sizeof(char *));
                if (d->result.paths) {
                    for (int i = 0; i < n; ++i) d->result.paths[i] = SDL_strdup(filelist[i]);
                    d->result.count = n;
                }
            }
        }
    }
    SDL_LockMutex(g_lock);
    Request **pp = &g_pending;
    while (*pp && (*pp)->id != id) pp = &(*pp)->next;
    Request *req = *pp;
    if (req) *pp = req->next;
    if (d) {
        if (g_done_tail) g_done_tail->next = d; else g_done_head = d;
        g_done_tail = d;
    }
    SDL_UnlockMutex(g_lock);
    request_free(req);
}

int r2d_dialog_open(SDL_Window *window, R2dDialogKind kind, const char *title,
                    const char *location, const R2dDialogFilter *filters, int nfilters,
                    bool many, char *err, int err_size)
{
    if (!ensure_lock()) {
        if (err) SDL_snprintf(err, (size_t)err_size, "нет мьютекса: %s", SDL_GetError());
        return -1;
    }
    if (nfilters < 0) nfilters = 0;
    if (nfilters > R2D_DIALOG_MAX_FILTERS) nfilters = R2D_DIALOG_MAX_FILTERS;

    Request *req = (Request *)SDL_calloc(1, sizeof *req);
    if (!req) {
        if (err) SDL_snprintf(err, (size_t)err_size, "нет памяти");
        return -1;
    }
    for (int i = 0; i < nfilters; ++i) {
        req->filter_text[i * 2] = SDL_strdup(filters[i].name ? filters[i].name : "");
        req->filter_text[i * 2 + 1] = SDL_strdup(filters[i].pattern ? filters[i].pattern : "*");
        req->filters[i].name = req->filter_text[i * 2];
        req->filters[i].pattern = req->filter_text[i * 2 + 1];
    }
    req->nfilters = nfilters;

    SDL_LockMutex(g_lock);
    req->id = g_next_id++;
    req->next = g_pending;
    g_pending = req;
    SDL_UnlockMutex(g_lock);
    const int id = req->id;

    SDL_FileDialogType type = kind == R2D_DIALOG_FOLDER ? SDL_FILEDIALOG_OPENFOLDER
                            : kind == R2D_DIALOG_SAVE_FILE ? SDL_FILEDIALOG_SAVEFILE
                            : SDL_FILEDIALOG_OPENFILE;
    SDL_PropertiesID props = SDL_CreateProperties();
    if (window) SDL_SetPointerProperty(props, SDL_PROP_FILE_DIALOG_WINDOW_POINTER, window);
    if (title && title[0]) SDL_SetStringProperty(props, SDL_PROP_FILE_DIALOG_TITLE_STRING, title);
    if (location && location[0]) SDL_SetStringProperty(props, SDL_PROP_FILE_DIALOG_LOCATION_STRING, location);
    if (nfilters > 0 && kind != R2D_DIALOG_FOLDER) {
        SDL_SetPointerProperty(props, SDL_PROP_FILE_DIALOG_FILTERS_POINTER, req->filters);
        SDL_SetNumberProperty(props, SDL_PROP_FILE_DIALOG_NFILTERS_NUMBER, nfilters);
    }
    SDL_SetBooleanProperty(props, SDL_PROP_FILE_DIALOG_MANY_BOOLEAN, many && kind == R2D_DIALOG_OPEN_FILE);
    // После этого вызова req может быть уже освобождён (callback синхронный
    // на части платформ), поэтому дальше используется только id.
    SDL_ShowFileDialogWithProperties(type, on_done, (void *)(intptr_t)id, props);
    SDL_DestroyProperties(props);
    return id;
}

bool r2d_dialog_poll(R2dDialogResult *out)
{
    if (!out || !g_lock) return false;
    SDL_LockMutex(g_lock);
    Done *d = g_done_head;
    if (d) {
        g_done_head = d->next;
        if (!g_done_head) g_done_tail = NULL;
    }
    SDL_UnlockMutex(g_lock);
    if (!d) return false;
    *out = d->result;
    SDL_free(d);
    return true;
}

void r2d_dialog_result_free(R2dDialogResult *r)
{
    if (!r || !r->paths) return;
    for (int i = 0; i < r->count; ++i) SDL_free(r->paths[i]);
    SDL_free(r->paths);
    r->paths = NULL;
    r->count = 0;
}

int r2d_dialog_pending(void)
{
    if (!g_lock) return 0;
    int n = 0;
    SDL_LockMutex(g_lock);
    for (Request *r = g_pending; r; r = r->next) n++;
    SDL_UnlockMutex(g_lock);
    return n;
}
