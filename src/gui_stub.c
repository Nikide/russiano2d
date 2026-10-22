// ===========================================================================
// Заглушки игрового GUI.
//
// Компилируются вместо gui.cpp, когда движок собран с -DR2D_ENABLE_RMLUI=OFF.
// Нужны, чтобы скриптовый слой не обрастал #ifdef: вызовы engine.ui.* просто
// ничего не делают и возвращают «неудачу».
// ===========================================================================

#include "gui.h"

#include <SDL3/SDL.h>

#include <string.h>

// Реестр подписок без RmlUi: add/off/query должны вести себя как в сборке с
// RmlUi (id возвращается, снятие возвращает число, слоты переиспользуются),
// иначе SDK на сборке без RmlUi получал бы другой контракт того же API.
// Сам r2d_gui_create здесь возвращает NULL, поэтому реестр статический.
typedef struct R2DStubListener {
    int   callback_id;
    int   doc;
    char *element_id;
    char *event;
} R2DStubListener;

#define R2D_STUB_LISTENERS 256
static R2DStubListener stub_listeners[R2D_STUB_LISTENERS];
static int              stub_listener_count;
static R2DGuiDetachFn   stub_detach_fn;
static void            *stub_detach_user;

static bool stub_event_matches(const R2DStubListener *listener, int doc,
                               const char *element_id, const char *event)
{
    return listener->doc == doc
        && listener->element_id && SDL_strcmp(listener->element_id, element_id) == 0
        && listener->event && SDL_strcmp(listener->event, event) == 0;
}

R2DGui *r2d_gui_create(SDL_GPUDevice *device, SDL_Window *window, const char *base_path, const struct R2DApp *app)
{
    R2D_UNUSED(device);
    R2D_UNUSED(window);
    R2D_UNUSED(base_path);
    R2D_UNUSED(app);
    R2D_WARN("движок собран без RmlUi (R2D_ENABLE_RMLUI=OFF) — engine.ui.* недоступен");
    return NULL;
}

void r2d_gui_destroy(R2DGui *g)
{
    R2D_UNUSED(g);
    for (int i = 0; i < stub_listener_count; ++i) {
        SDL_free(stub_listeners[i].element_id);
        SDL_free(stub_listeners[i].event);
    }
    stub_listener_count = 0;
}

void r2d_gui_process_event(R2DGui *g, const SDL_Event *ev)
{
    R2D_UNUSED(g);
    R2D_UNUSED(ev);
}

void r2d_gui_update(R2DGui *g, int width, int height)
{
    R2D_UNUSED(g);
    R2D_UNUSED(width);
    R2D_UNUSED(height);
}

void r2d_gui_render(R2DGui *g, SDL_GPUCommandBuffer *cmd, SDL_GPUTexture *swapchain,
                     uint32_t width, uint32_t height)
{
    R2D_UNUSED(g);
    R2D_UNUSED(cmd);
    R2D_UNUSED(swapchain);
    R2D_UNUSED(width);
    R2D_UNUSED(height);
}

int r2d_gui_load_document(R2DGui *g, const char *path)
{
    R2D_UNUSED(g);
    R2D_UNUSED(path);
    return -1;
}

// Загрузка документа из строки (engine.ui.loadMarkup): без RmlUi документа
// создать не из чего, поэтому «неудача», как и у загрузки из файла.
int r2d_gui_load_markup(R2DGui *g, const char *name, const char *markup)
{
    R2D_UNUSED(g);
    R2D_UNUSED(name);
    R2D_UNUSED(markup);
    return -1;
}

void r2d_gui_show(R2DGui *g, int doc) { R2D_UNUSED(g); R2D_UNUSED(doc); }
void r2d_gui_hide(R2DGui *g, int doc) { R2D_UNUSED(g); R2D_UNUSED(doc); }
void r2d_gui_unload(R2DGui *g, int doc) { R2D_UNUSED(g); R2D_UNUSED(doc); }
void r2d_gui_unload_all(R2DGui *g) { R2D_UNUSED(g); }

bool r2d_gui_document_visible(const R2DGui *g, int doc)
{
    R2D_UNUSED(g);
    R2D_UNUSED(doc);
    return false;
}

void r2d_gui_set_text(R2DGui *g, int doc, const char *element_id, const char *text)
{
    R2D_UNUSED(g); R2D_UNUSED(doc); R2D_UNUSED(element_id); R2D_UNUSED(text);
}

void r2d_gui_set_html(R2DGui *g, int doc, const char *element_id, const char *html)
{
    R2D_UNUSED(g); R2D_UNUSED(doc); R2D_UNUSED(element_id); R2D_UNUSED(html);
}

void r2d_gui_set_class(R2DGui *g, int doc, const char *element_id, const char *class_name, bool add)
{
    R2D_UNUSED(g); R2D_UNUSED(doc); R2D_UNUSED(element_id);
    R2D_UNUSED(class_name); R2D_UNUSED(add);
}

void r2d_gui_set_property(R2DGui *g, int doc, const char *element_id,
                           const char *property, const char *value)
{
    R2D_UNUSED(g); R2D_UNUSED(doc); R2D_UNUSED(element_id);
    R2D_UNUSED(property); R2D_UNUSED(value);
}

bool r2d_gui_add_listener(R2DGui *g, int doc, const char *element_id,
                           const char *event_name, int callback_id)
{
    R2D_UNUSED(g);
    if (!element_id || !event_name || callback_id < 0) return false;
    if (stub_listener_count >= R2D_STUB_LISTENERS) return false;
    char *element = SDL_strdup(element_id);
    char *event = SDL_strdup(event_name);
    if (!element || !event) {
        SDL_free(element);
        SDL_free(event);
        return false;
    }
    R2DStubListener *listener = &stub_listeners[stub_listener_count++];
    listener->callback_id = callback_id;
    listener->doc = doc;
    listener->element_id = element;
    listener->event = event;
    return true;
}

bool r2d_gui_remove_listener(R2DGui *g, int callback_id)
{
    R2D_UNUSED(g);
    for (int i = 0; i < stub_listener_count; ++i) {
        if (stub_listeners[i].callback_id != callback_id) continue;
        SDL_free(stub_listeners[i].element_id);
        SDL_free(stub_listeners[i].event);
        stub_listeners[i] = stub_listeners[--stub_listener_count];
        return true;
    }
    return false;
}

int r2d_gui_listener_query(const R2DGui *g, int doc, const char *element_id,
                            const char *event_name, int *out_ids, int cap)
{
    R2D_UNUSED(g);
    if (!element_id || !event_name || !out_ids || cap <= 0) return 0;
    int count = 0;
    for (int i = 0; i < stub_listener_count && count < cap; ++i) {
        if (stub_event_matches(&stub_listeners[i], doc, element_id, event_name)) {
            out_ids[count++] = stub_listeners[i].callback_id;
        }
    }
    return count;
}

int r2d_gui_listener_count(const R2DGui *g)
{
    R2D_UNUSED(g);
    return stub_listener_count;
}

void r2d_gui_set_detach_notify(R2DGui *g, R2DGuiDetachFn fn, void *user)
{
    R2D_UNUSED(g);
    stub_detach_fn = fn;
    stub_detach_user = user;
}

void r2d_gui_set_event_dispatch(R2DGui *g, R2DGuiEventFn fn, void *user)
{
    R2D_UNUSED(g); R2D_UNUSED(fn); R2D_UNUSED(user);
}

int r2d_gui_document_count(const R2DGui *g)
{
    R2D_UNUSED(g);
    return 0;
}

bool r2d_gui_get_value(R2DGui *g, int doc, const char *element_id, char *out, size_t cap)
{
    R2D_UNUSED(g); R2D_UNUSED(doc); R2D_UNUSED(element_id); R2D_UNUSED(out); R2D_UNUSED(cap);
    return false;
}

bool r2d_gui_set_value(R2DGui *g, int doc, const char *element_id, const char *value)
{
    R2D_UNUSED(g); R2D_UNUSED(doc); R2D_UNUSED(element_id); R2D_UNUSED(value);
    return false;
}

bool r2d_gui_get_text(R2DGui *g, int doc, const char *element_id, char *out, size_t cap)
{
    R2D_UNUSED(g); R2D_UNUSED(doc); R2D_UNUSED(element_id); R2D_UNUSED(out); R2D_UNUSED(cap);
    return false;
}

bool r2d_gui_get_attr(R2DGui *g, int doc, const char *element_id, const char *name, char *out, size_t cap)
{
    R2D_UNUSED(g); R2D_UNUSED(doc); R2D_UNUSED(element_id); R2D_UNUSED(name); R2D_UNUSED(out); R2D_UNUSED(cap);
    return false;
}

bool r2d_gui_set_attr(R2DGui *g, int doc, const char *element_id, const char *name, const char *value)
{
    R2D_UNUSED(g); R2D_UNUSED(doc); R2D_UNUSED(element_id); R2D_UNUSED(name); R2D_UNUSED(value);
    return false;
}

bool r2d_gui_get_rect(R2DGui *g, int doc, const char *element_id, float out[4])
{
    R2D_UNUSED(g); R2D_UNUSED(doc); R2D_UNUSED(element_id); R2D_UNUSED(out);
    return false;
}

bool r2d_gui_click(R2DGui *g, int doc, const char *element_id)
{
    R2D_UNUSED(g); R2D_UNUSED(doc); R2D_UNUSED(element_id);
    return false;
}

bool r2d_gui_place(R2DGui *g, int doc, float x, float y, float w, float h)
{
    R2D_UNUSED(g); R2D_UNUSED(doc); R2D_UNUSED(x); R2D_UNUSED(y); R2D_UNUSED(w); R2D_UNUSED(h);
    return false;
}

bool r2d_gui_typing(R2DGui *g)
{
    R2D_UNUSED(g);
    return false;
}

bool r2d_gui_front(R2DGui *g, int doc)
{
    R2D_UNUSED(g); R2D_UNUSED(doc);
    return false;
}

bool r2d_gui_scroll(R2DGui *g, int doc, const char *element_id, int mode, float offset)
{
    R2D_UNUSED(g); R2D_UNUSED(doc); R2D_UNUSED(element_id); R2D_UNUSED(mode); R2D_UNUSED(offset);
    return false;
}

bool r2d_gui_focus(R2DGui *g, int doc, const char *element_id, bool focus)
{
    R2D_UNUSED(g); R2D_UNUSED(doc); R2D_UNUSED(element_id); R2D_UNUSED(focus);
    return false;
}
