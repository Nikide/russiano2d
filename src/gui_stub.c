// ===========================================================================
// Заглушки игрового GUI.
//
// Компилируются вместо gui.cpp, когда движок собран с -DR2D_ENABLE_RMLUI=OFF.
// Нужны, чтобы скриптовый слой не обрастал #ifdef: вызовы engine.ui.* просто
// ничего не делают и возвращают «неудачу».
// ===========================================================================

#include "gui.h"

#include <SDL3/SDL.h>

R2DGui *r2d_gui_create(SDL_GPUDevice *device, SDL_Window *window, const char *base_path)
{
    R2D_UNUSED(device);
    R2D_UNUSED(window);
    R2D_UNUSED(base_path);
    R2D_WARN("движок собран без RmlUi (R2D_ENABLE_RMLUI=OFF) — engine.ui.* недоступен");
    return NULL;
}

void r2d_gui_destroy(R2DGui *g) { R2D_UNUSED(g); }

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
    R2D_UNUSED(g); R2D_UNUSED(doc); R2D_UNUSED(element_id);
    R2D_UNUSED(event_name); R2D_UNUSED(callback_id);
    return false;
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
