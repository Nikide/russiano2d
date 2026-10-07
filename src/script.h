// ===========================================================================
// Скриптовый слой: QuickJS-ng, объект globalThis.engine и hot reload.
// ===========================================================================
#pragma once

#include "r2d.h"

#include "app.h"
#include "audio.h"
#include "bsp.h"
#include "gui.h"
#include "physics.h"
#include "render.h"

#include <quickjs.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct R2DScript {
    JSRuntime *rt;
    JSContext *ctx;

    R2DApp      *app;
    R2DRenderer *renderer;
    R2DPhysics  *physics;
    R2DGui      *gui;
    R2DAudio    *audio;

    // 2D BSP-дерево. Одно на рантайм: JS строит его под конкретную сцену
    // и перестраивает при смене уровня.
    R2DBsp       bsp;

    char entry_path[2048];        // путь к точке входа (для логов и hot reload)
    char entry_name[256];         // имя модуля точки входа, напр. "main.js"
    char game_dir[2048];          // каталог с игровыми скриптами
    bool loaded;                  // скрипт успешно загружен
    bool has_update;              // определена функция onUpdate(dt)
    bool has_render;              // определена функция onRender()

    // Zero-copy представление массива трансформов физики для JS.
    JSValue transforms_array;     // Float32Array поверх physics->transforms
    bool    transforms_valid;

    // Объект globalThis.engine и обработчики кадра.
    JSValue engine_obj;
    JSValue update_fn;
    JSValue render_fn;
    JSValue exit_fn;              // engine.setExit(fn) — хук завершения
    JSValue snapshot_fn;          // engine.setSnapshot(fn) — снимок для агента
    bool    has_exit;

    // Параметры запуска, видимые из JS как engine.agent/headless/seed/fixedDt.
    bool     agent_mode;
    bool     headless;
    double   fixed_dt;
    uint32_t seed;

    // Реестр JS-функций, на которые ссылаются слушатели событий RmlUi.
    JSValue callbacks[256];
    int     callback_count;

    // Hot reload
    bool   hot_reload;
    bool   reload_requested;   // запрошен перезапуск на границе кадра
    char   reload_reason[128]; // почему: правка файла, F5, запрос игры
    double reload_check_timer;
    double entry_mtime;

    uint64_t reload_count;
    char     last_error[1024];
} R2DScript;

// Создаёт рантайм и загружает game/<entry>. Возвращает false, если скрипт
// не загрузился (движок при этом продолжает работать — окно не падает).
// agent_mode/headless/fixed_dt/seed видны из JS как engine.agent/headless/
// fixedDt/seed и используются $.agent и $.random.
bool r2d_script_init(R2DScript *s, R2DApp *app, R2DRenderer *renderer,
                      R2DPhysics *physics, R2DGui *gui, R2DAudio *audio,
                      const char *entry_relative, bool hot_reload,
                      bool agent_mode, bool headless, double fixed_dt, uint32_t seed);

void r2d_script_shutdown(R2DScript *s);

// Пересоздаёт JSContext и заново выполняет точку входа.
bool r2d_script_reload(R2DScript *s);

void r2d_script_call_update(R2DScript *s, float dt);
void r2d_script_call_render(R2DScript *s);

// Раз в кадр: проверяет mtime файлов и при изменении ЗАПРАШИВАЕТ перезапуск
// рантайма (сам перезапуск делает главный цикл на границе кадра).
void r2d_script_poll_hot_reload(R2DScript *s, float dt);

// Попросить перезапуск скриптов. Перезапуск случится на границе кадра, а не в
// середине: иначе старый рантайм уничтожался бы прямо во время обработки
// события, и кадр оставался недоигранным.
void r2d_script_request_reload(R2DScript *s, const char *reason);

// Забрать запрос перезапуска (true — был и снят) и причину.
bool r2d_script_take_reload_request(R2DScript *s, const char **reason_out);

// Разрешён ли следить за изменениями .js.
bool r2d_script_hot_reload_enabled(const R2DScript *s);

const char *r2d_script_last_error(const R2DScript *s);
int  r2d_script_callback_count(const R2DScript *s);

// --- Агентский доступ к игровому JS -----------------------------------------

// Выполняет код в том же контексте, что и игра (доступны engine и $).
// При успехе возвращает true и кладёт в out_json результат, приведённый к JSON
// через JSON.stringify (вызывающий освобождает через SDL_free).
// При ошибке возвращает false и кладёт текст ошибки в out_error.
bool r2d_script_eval(R2DScript *s, const char *code, char **out_json, char **out_error);

// Снимок состояния: вызывает провайдер, зарегистрированный игрой через
// engine.setSnapshot(fn). Если провайдера нет — возвращает false.
bool r2d_script_snapshot(R2DScript *s, char **out_json, char **out_error);

// Вызывает engine.setExit-хук (если игра его поставила).
void r2d_script_call_exit(R2DScript *s);

// Мост к отладочному оверлею: engine.setOverlay(on) из игры.
// Реализация оверлея живёт в main.c, поэтому связь идёт через указатель.
typedef void (*R2DOverlayFn)(void *user, bool visible);
void r2d_script_set_overlay_hook(R2DOverlayFn fn, void *user);

#ifdef __cplusplus
}
#endif
