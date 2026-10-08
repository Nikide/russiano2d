// ===========================================================================
// Игровой GUI на RmlUi: HUD, меню, инвентарь.
//
// RmlUi рендерит поверх нашей сцены в тот же SDL_GPUCommandBuffer и
// swapchain-текстуру. Её RenderInterface открывает свой render pass с
// LOADOP_LOAD, поэтому спрайты, нарисованные раньше, не затираются.
// ===========================================================================
#pragma once

#include "r2d.h"

#include <SDL3/SDL.h>
#include <SDL3/SDL_gpu.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct R2DGui R2DGui;

// Вызывается, когда пользователь взаимодействует с элементом, на который
// через JS повешен обработчик. callback_id выдаётся скриптовым слоем.
// `target_id` — id элемента, до которого дошло событие (при всплытии это может
// быть потомок слушателя); `target_key` — значение data-key ближайшего к цели
// элемента вверх по дереву до слушателя (делегирование списков: один
// обработчик на контейнер вместо сотен на строки). Оба могут быть пустой
// строкой.
typedef void (*R2DGuiEventFn)(void *user, int callback_id, const char *element_id,
                               const char *event_name, const char *target_id,
                               const char *target_key);

R2DGui *r2d_gui_create(SDL_GPUDevice *device, SDL_Window *window, const char *base_path);
void     r2d_gui_destroy(R2DGui *g);

// Пробрасывает событие SDL в RmlUi (мышь, клавиатура, текст).
void r2d_gui_process_event(R2DGui *g, const SDL_Event *ev);

// Обновляет layout (внутри вызывается контекст RmlUi).
void r2d_gui_update(R2DGui *g, int width, int height);

// Рисует GUI. Вызывать после собственной сцены и до SubmitGPUCommandBuffer.
void r2d_gui_render(R2DGui *g, SDL_GPUCommandBuffer *cmd, SDL_GPUTexture *swapchain,
                     uint32_t width, uint32_t height);

// --- Документы --------------------------------------------------------------
// Возвращает id документа (>= 0) или -1 при ошибке.
int  r2d_gui_load_document(R2DGui *g, const char *path);
// То же, но документ задаётся строкой разметки, а не файлом. `name` — ключ
// кэша и имя источника для RmlUi (DevTools строит интерфейс кодом).
int  r2d_gui_load_markup(R2DGui *g, const char *name, const char *markup);
void r2d_gui_show(R2DGui *g, int doc);
void r2d_gui_hide(R2DGui *g, int doc);
void r2d_gui_unload(R2DGui *g, int doc);
// Снимает все документы разом. Нужно при горячей перезагрузке скриптов:
// слушатели RmlUi держат числовые id колбэков старого JS-контекста.
void r2d_gui_unload_all(R2DGui *g);
bool r2d_gui_document_visible(const R2DGui *g, int doc);

void r2d_gui_set_text(R2DGui *g, int doc, const char *element_id, const char *text);
// Как set_text, но содержимое разбирается как разметка RML — удобно для
// динамически построенных списков и кнопок.
void r2d_gui_set_html(R2DGui *g, int doc, const char *element_id, const char *html);
void r2d_gui_set_class(R2DGui *g, int doc, const char *element_id, const char *class_name, bool add);
void r2d_gui_set_property(R2DGui *g, int doc, const char *element_id,
                           const char *property, const char *value);

// Чтение состояния элемента: нужно инструментам (поля ввода) и тестам агента.
// Все функции возвращают false, если документа или элемента нет.
bool r2d_gui_get_value(R2DGui *g, int doc, const char *element_id, char *out, size_t cap);
bool r2d_gui_set_value(R2DGui *g, int doc, const char *element_id, const char *value);
bool r2d_gui_get_text(R2DGui *g, int doc, const char *element_id, char *out, size_t cap);
bool r2d_gui_get_attr(R2DGui *g, int doc, const char *element_id, const char *name, char *out, size_t cap);
bool r2d_gui_set_attr(R2DGui *g, int doc, const char *element_id, const char *name, const char *value);
// Нажать элемент программно: RmlUi рассылает ему обычное событие click (так
// интерфейс проверяет агент: виртуальная мышь SDL-событий не рождает).
bool r2d_gui_click(R2DGui *g, int doc, const char *element_id);
// Абсолютный прямоугольник элемента в координатах окна: x, y, w, h.
bool r2d_gui_get_rect(R2DGui *g, int doc, const char *element_id, float out[4]);

// Подписка на событие элемента. callback_id трактуется скриптовым слоем.
bool r2d_gui_add_listener(R2DGui *g, int doc, const char *element_id,
                           const char *event_name, int callback_id);

void r2d_gui_set_event_dispatch(R2DGui *g, R2DGuiEventFn fn, void *user);

int  r2d_gui_document_count(const R2DGui *g);

#ifdef __cplusplus
}
#endif
