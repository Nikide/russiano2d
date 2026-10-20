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

struct R2DApp;
R2DGui *r2d_gui_create(SDL_GPUDevice *device, SDL_Window *window, const char *base_path, const struct R2DApp *app);
void     r2d_gui_destroy(R2DGui *g);

// Пробрасывает событие SDL в RmlUi (мышь, клавиатура, текст).
void r2d_gui_process_event(R2DGui *g, const SDL_Event *ev);

// Обновляет layout (внутри вызывается контекст RmlUi).
void r2d_gui_update(R2DGui *g, int width, int height);

// Рисует GUI. Вызывать после собственной сцены и до SubmitGPUCommandBuffer.
void r2d_gui_render(R2DGui *g, SDL_GPUCommandBuffer *cmd, SDL_GPUTexture *swapchain,
                     uint32_t width, uint32_t height);

// --- Шрифтовые лица ---------------------------------------------------------
// Регистрирует файл шрифта как именованное семейство с начертанием (RmlUi
// style/weight). Это лицо потом резолвит RCSS font-family/font-weight/
// font-style; кастомный текстовый рендерер (src/font.c) остаётся одноатласным
// и bold/italic не подделывает. weight — 1..1000 (400 normal, 700 bold),
// italic — Rml::Style::FontStyle::Italic. Возвращает false без GUI/контекста,
// при пустых path/family или если RmlUi не принял лицо.
//
// Без RmlUi те же имена дают честный «нет» (gui_stub.c): engine.ui.* обязан
// существовать и возвращать неудачу, а не ломать линковку.
#ifdef R2D_ENABLE_RMLUI
bool r2d_gui_load_font_face(R2DGui *g, const char *path, const char *family,
                            int weight, bool italic);
// Метаданные явно зарегистрированных лиц (для $.font.faces()).
int  r2d_gui_font_face_count(const R2DGui *g);
bool r2d_gui_font_face_info(const R2DGui *g, int index, char *family, size_t family_cap,
                            char *path, size_t path_cap, int *weight, bool *italic);
#else
static inline bool r2d_gui_load_font_face(R2DGui *g, const char *path,
                                          const char *family, int weight, bool italic)
{
    (void)g; (void)path; (void)family; (void)weight; (void)italic;
    return false;
}
static inline int r2d_gui_font_face_count(const R2DGui *g) { (void)g; return 0; }
static inline bool r2d_gui_font_face_info(const R2DGui *g, int index, char *family,
                                          size_t family_cap, char *path, size_t path_cap,
                                          int *weight, bool *italic)
{
    (void)g; (void)index; (void)family; (void)family_cap; (void)path; (void)path_cap;
    (void)weight; (void)italic;
    return false;
}
#endif

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
// Клавиатурный фокус элемента (поле ввода палитры/поиска в редакторе):
// focus=true — Element::Focus(), false — Blur(). false, если элемента нет или
// он не принимает фокус.
bool r2d_gui_focus(R2DGui *g, int doc, const char *element_id, bool focus);
// Встраивание документа в область другого (студия во вкладке редактора):
// place — прямоугольник документа в пикселях контекста, w/h <= 0 — вернуть
// раскладку из RCSS; front — поднять документ над остальными.
bool r2d_gui_place(R2DGui *g, int doc, float x, float y, float w, float h);
bool r2d_gui_front(R2DGui *g, int doc);
// Идёт ли набор текста: фокус RmlUi на <input type=text|password|search|number>
// или <textarea>. Горячие клавиши инструментов в это время молчат.
bool r2d_gui_typing(R2DGui *g);
// Абсолютный прямоугольник элемента в координатах окна: x, y, w, h.
bool r2d_gui_get_rect(R2DGui *g, int doc, const char *element_id, float out[4]);
// Геометрия раскладки: тот же бокс, но без проверки видимости (для проверок
// вычисленных размеров и инструментов; видимость спрашивайте у get_rect).
bool r2d_gui_get_layout_rect(R2DGui *g, int doc, const char *element_id, float out[4]);

// Подписка на событие элемента. callback_id трактуется скриптовым слоем:
// это id слота в пуле JS-обработчиков (он же возвращается из engine.ui.on).
bool r2d_gui_add_listener(R2DGui *g, int doc, const char *element_id,
                           const char *event_name, int callback_id);

// Снять слушателя по callback_id: RemoveEventListener + удаление записи
// реестра. Возвращает true, если живой слушатель был и снят.
bool r2d_gui_remove_listener(R2DGui *g, int callback_id);

// callback_id живых слушателей пары doc+element+event — для engine.ui.off
// (скриптовый слой сам решает, совпадает ли обработчик, и освобождает слот).
// Возвращает число записанных id (не больше cap).
int  r2d_gui_listener_query(const R2DGui *g, int doc, const char *element_id,
                             const char *event_name, int *out_ids, int cap);

// Сколько живых слушателей в реестре (для диагностики и тестов).
int  r2d_gui_listener_count(const R2DGui *g);

// Уведомление «RmlUi отсоединил слушателя» (документ выгружен, элемент
// удалён): скриптовый слой освобождает слот пула. Без этого слот оставался
// бы занят мёртвой JS-функцией до перезапуска рантайма.
typedef void (*R2DGuiDetachFn)(void *user, int callback_id);
void r2d_gui_set_detach_notify(R2DGui *g, R2DGuiDetachFn fn, void *user);

void r2d_gui_set_event_dispatch(R2DGui *g, R2DGuiEventFn fn, void *user);

int  r2d_gui_document_count(const R2DGui *g);

#ifdef __cplusplus
}
#endif
