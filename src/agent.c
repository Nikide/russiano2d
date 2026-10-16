// ===========================================================================
// Агентский режим: JSON-строка на запрос, JSON-строка на ответ.
//
// Идея: движок сам по себе не должен знать, кто им управляет. Поэтому здесь
// только транспорт и команды, а «прогнать кадр» и «снять скриншот» приходят
// снаружи через R2DAgentHooks (их даёт src/main.c, где живёт цикл кадров).
//
// Почему отдельный файл, а не ветка в main.c: протокол — это то, с чем
// работают ИИ-агенты и CI, у него должна быть одна читаемая реализация.
// ===========================================================================
#include "agent.h"

#include "app.h"
#include "json.h"
#include "physics.h"
#include "profile.h"
#include "script.h"

#include <SDL3/SDL.h>

// io.h/unistd.h нужны, чтобы увести stdout в stderr: RmlUi и Box2D
// пишут туда напрямую своими print()/printf(), и в агентском режиме они бы
// смешались с JSON.
#ifdef _WIN32
#include <io.h>
#define r2d__dup  _dup
#define r2d__dup2 _dup2
#define r2d__write _write
#else
#include <unistd.h>
#define r2d__dup  dup
#define r2d__dup2 dup2
#define r2d__write write
#endif

#include <string.h>

struct R2DAgent {
    R2DApp    *app;
    R2DScript *script;
    bool       saw_command;   // была ли хоть одна команда (для логов)
};

// Дескриптор настоящего stdout: ответы идут туда, минуя перенаправление.
static int g_stdout_fd = -1;

// Кнопка мыши, которую надо отпустить после ближайшего кадра: так «click»
// превращается в настоящее нажатие с фронтом, а не в мгновенный импульс.
static int g_pending_mouse_release = 0;

void r2d_agent_capture_stdout(void)
{
    if (g_stdout_fd >= 0) return;

    // Дублируем stdout, затем подменяем его stderr: всё, что печатают
    // сторонние библиотеки, попадает в журнал, а протокол остаётся чистым.
    g_stdout_fd = r2d__dup(1);
    if (g_stdout_fd < 0) {
        R2D_WARN("не удалось сохранить stdout — протокол может смешаться с журналом");
        return;
    }
    if (r2d__dup2(2, 1) < 0) {
        R2D_WARN("не удалось перенаправить stdout в stderr");
    }
    // Журнал движка тоже уходит в stderr — см. src/r2d.h.
    r2d_log_stderr = true;
}

void r2d_agent_write_line(const char *line)
{
    if (!line) return;
    const size_t len = SDL_strlen(line);

    if (g_stdout_fd >= 0) {
        // write() вправе записать меньше запрошенного (длинный ответ в трубу):
        // раньше короткая запись молча оставляла обрезанный JSON.
        size_t off = 0;
        while (off < len) {
            const long n = (long)r2d__write(g_stdout_fd, line + off, (unsigned)(len - off));
            if (n <= 0) break;
            off += (size_t)n;
        }
        r2d__write(g_stdout_fd, "\n", 1);
        return;
    }
    fwrite(line, 1, len, stdout);
    fputc('\n', stdout);
    fflush(stdout);
}

R2DAgent *r2d_agent_create(R2DApp *app, R2DScript *script)
{
    R2DAgent *a = (R2DAgent *)SDL_calloc(1, sizeof(R2DAgent));
    if (!a) return NULL;
    a->app = app;
    a->script = script;
    return a;
}

void r2d_agent_destroy(R2DAgent *a)
{
    SDL_free(a);
}

void r2d_agent_signal_ready(const R2DAgent *a)
{
    R2dSb sb;
    r2d_sb_init(&sb);
    r2d_sb_puts(&sb, "{\"event\":\"ready\",\"version\":\"");
    r2d_sb_puts(&sb, R2D_VERSION_STRING);
    r2d_sb_puts(&sb, "\",\"agent\":true,\"headless\":");
    r2d_sb_puts(&sb, (a && a->app && a->app->headless) ? "true" : "false");
    r2d_sb_puts(&sb, ",\"fixed_dt\":");
    r2d_sb_put_json_number(&sb, a && a->app ? (double)a->app->fixed_dt : 0.0);
    r2d_sb_puts(&sb, ",\"scene\":");
    r2d_sb_put_json_string(&sb, (a && a->app && a->app->start_scene) ? a->app->start_scene : "");
    r2d_sb_puts(&sb, "}");
    r2d_agent_write_line(sb.data);
    r2d_sb_free(&sb);
}

// ---------------------------------------------------------------------------
// Ответы
// ---------------------------------------------------------------------------

// Открывает ответ: {"ok":true,"id":...  (id эхом, если клиент его прислал).
static void begin_response(R2dSb *sb, const R2dJson *req, bool ok)
{
    r2d_sb_init(sb);
    r2d_sb_puts(sb, ok ? "{\"ok\":true" : "{\"ok\":false");
    const R2dJson *id = r2d_json_get(req, "id");
    if (id) {
        r2d_sb_puts(sb, ",\"id\":");
        switch (id->type) {
        case R2D_JSON_STR: r2d_sb_put_json_string(sb, id->string); break;
        case R2D_JSON_NUM: r2d_sb_put_json_number(sb, id->number); break;
        case R2D_JSON_BOOL: r2d_sb_puts(sb, id->boolean ? "true" : "false"); break;
        default: r2d_sb_puts(sb, "null"); break;
        }
    }
}

static void send_error(const R2dJson *req, const char *message)
{
    R2dSb sb;
    begin_response(&sb, req, false);
    r2d_sb_puts(&sb, ",\"error\":");
    r2d_sb_put_json_string(&sb, message);
    r2d_sb_puts(&sb, "}");
    r2d_agent_write_line(sb.data);
    r2d_sb_free(&sb);
}

static void send_ok_end(R2dSb *sb)
{
    r2d_sb_puts(sb, "}");
    r2d_agent_write_line(sb->data);
    r2d_sb_free(sb);
}

/** Короткий успешный ответ без данных: `{id, ok:true}`. */
static void send_ok(const R2dJson *req)
{
    R2dSb sb;
    begin_response(&sb, req, true);
    send_ok_end(&sb);
}

// ---------------------------------------------------------------------------
// Команды
// ---------------------------------------------------------------------------

static void cmd_ping(R2DAgent *a, const R2dJson *req)
{
    R2dSb sb;
    begin_response(&sb, req, true);
    r2d_sb_puts(&sb, ",\"pong\":true,\"frame\":");
    r2d_sb_put_json_number(&sb, (double)a->app->frame);
    r2d_sb_puts(&sb, ",\"time\":");
    r2d_sb_put_json_number(&sb, a->app->time);
    send_ok_end(&sb);
}

static void cmd_frames(R2DAgent *a, const R2dJson *req)
{
    R2dSb sb;
    begin_response(&sb, req, true);
    r2d_sb_puts(&sb, ",\"frame\":");
    r2d_sb_put_json_number(&sb, (double)a->app->frame);
    r2d_sb_puts(&sb, ",\"time\":");
    r2d_sb_put_json_number(&sb, a->app->time);
    send_ok_end(&sb);
}

/**
 * Параметры урезания снимка из команды `state` (отчёт BASHNYA A8):
 *
 *   {"cmd":"state","entities":{"limit":50,"sel":".enemy","fields":["id","x","y"]}}
 *
 * Собираем их обратно в JSON-строку и отдаём провайдеру снимка: режется
 * JS-сторона (`$.agent.snapshot`), потому что именно она собирает сущности.
 * NULL — параметров нет, снимок полный, как раньше.
 */
static char *entities_opts_json(const R2dJson *req)
{
    const R2dJson *opts = r2d_json_get(req, "entities");
    if (!opts || opts->type != R2D_JSON_OBJ) return NULL;

    R2dSb sb;
    r2d_sb_init(&sb);
    // Обёртка та же, что в запросе: провайдер снимка читает opts.entities,
    // поэтому форма параметров не меняется по дороге C → JS.
    r2d_sb_puts(&sb, "{\"entities\":{");
    bool first = true;

    const R2dJson *limit = r2d_json_get(opts, "limit");
    if (limit && limit->type == R2D_JSON_NUM) {
        r2d_sb_puts(&sb, "\"limit\":");
        r2d_sb_put_json_number(&sb, limit->number);
        first = false;
    }

    const R2dJson *sel = r2d_json_get(opts, "sel");
    if (sel && sel->type == R2D_JSON_STR && sel->string && *sel->string) {
        if (!first) r2d_sb_puts(&sb, ",");
        r2d_sb_puts(&sb, "\"sel\":");
        r2d_sb_put_json_string(&sb, sel->string);
        first = false;
    }

    const R2dJson *fields = r2d_json_get(opts, "fields");
    if (fields && fields->type == R2D_JSON_ARR && fields->count > 0) {
        if (!first) r2d_sb_puts(&sb, ",");
        r2d_sb_puts(&sb, "\"fields\":[");
        int written = 0;
        for (int i = 0; i < fields->count; ++i) {
            const R2dJson *f = r2d_json_at(fields, i);
            if (!f || f->type != R2D_JSON_STR || !f->string || !*f->string) continue;
            if (written++) r2d_sb_puts(&sb, ",");
            r2d_sb_put_json_string(&sb, f->string);
        }
        r2d_sb_puts(&sb, "]");
    }

    r2d_sb_puts(&sb, "}}");
    return r2d_sb_take(&sb);
}

// Снимок состояния: сначала спрашиваем игру (engine.setSnapshot), если она
// ничего не зарегистрировала — отдаём встроенный минимум.
static void cmd_state(R2DAgent *a, const R2dJson *req)
{
    char *json = NULL;
    char *err = NULL;
    char *opts = entities_opts_json(req);
    bool ok = r2d_script_snapshot(a->script, opts, &json, &err);
    SDL_free(opts);

    R2dSb sb;
    begin_response(&sb, req, true);
    r2d_sb_puts(&sb, ",\"state\":");
    if (ok && json) {
        r2d_sb_puts(&sb, json);
    } else {
        r2d_sb_printf(&sb,
            "{\"frame\":%llu,\"time\":", (unsigned long long)a->app->frame);
        r2d_sb_put_json_number(&sb, a->app->time);
        r2d_sb_puts(&sb, ",\"fps\":");
        r2d_sb_put_json_number(&sb, a->app->fps);
        r2d_sb_puts(&sb, ",\"scene\":");
        r2d_sb_put_json_string(&sb, a->app->start_scene ? a->app->start_scene : "");
        r2d_sb_puts(&sb, ",\"game\":null");
        // Провайдер снимка есть, но УПАЛ — это ошибка, а не «мало данных».
        // Раньше клиент получал правдоподобный неполный ответ и не знал об
        // этом (отчёт Lead по регрессу H7): теперь в ответе есть код и текст,
        // плюс строка в журнал. Если провайдера нет вовсе (игра на голом
        // engine.*) — это документированный минимум, и пометки нет.
        if (err) {
            R2D_ERROR("снимок состояния не удался: %s", err);
            r2d_sb_puts(&sb, ",\"error\":{\"code\":\"R2D_AGENT_SNAPSHOT_FAILED\",\"message\":");
            r2d_sb_put_json_string(&sb, err);
            r2d_sb_puts(&sb, "}");
        }
        r2d_sb_putc(&sb, '}');
    }
    r2d_sb_puts(&sb, ",\"frame\":");
    r2d_sb_put_json_number(&sb, (double)a->app->frame);
    r2d_sb_puts(&sb, ",\"time\":");
    r2d_sb_put_json_number(&sb, a->app->time);
    send_ok_end(&sb);

    SDL_free(json);
    SDL_free(err);
}

// `query`: список сущностей по селектору `$`. Селектор разбирает JS-сторона
// (`$.agent`), C только перевозит строку и упаковывает ответ: у DevTools,
// агента и игры одна реализация поиска (docs/DEVTOOLS.md §7).
static void cmd_query(R2DAgent *a, const R2dJson *req)
{
    const char *sel = r2d_json_str(r2d_json_get(req, "sel"), "*");
    const R2dJson *limit_node = r2d_json_get(req, "limit");
    const int limit = (limit_node && limit_node->type == R2D_JSON_NUM && limit_node->number > 0)
                          ? (int)limit_node->number : 0;

    char *json = NULL;
    char *err = NULL;
    if (!r2d_script_agent_query(a->script, sel, "list", limit, &json, &err)) {
        send_error(req, err ? err : "query недоступен: игра не вызвала $.agent.install()");
        SDL_free(json);
        SDL_free(err);
        return;
    }

    R2dSb sb;
    begin_response(&sb, req, true);
    r2d_sb_puts(&sb, ",\"sel\":");
    r2d_sb_put_json_string(&sb, sel);
    r2d_sb_puts(&sb, ",\"nodes\":");
    r2d_sb_puts(&sb, json ? json : "[]");
    send_ok_end(&sb);

    SDL_free(json);
    SDL_free(err);
}

// `inspect`: описание одной сущности; null — селектор ничего не нашёл.
static void cmd_inspect(R2DAgent *a, const R2dJson *req)
{
    const char *sel = r2d_json_str(r2d_json_get(req, "sel"), NULL);
    if (!sel) { send_error(req, "inspect: не передан параметр sel"); return; }

    char *json = NULL;
    char *err = NULL;
    if (!r2d_script_agent_query(a->script, sel, "one", 0, &json, &err)) {
        send_error(req, err ? err : "inspect недоступен: игра не вызвала $.agent.install()");
        SDL_free(json);
        SDL_free(err);
        return;
    }

    R2dSb sb;
    begin_response(&sb, req, true);
    r2d_sb_puts(&sb, ",\"sel\":");
    r2d_sb_put_json_string(&sb, sel);
    r2d_sb_puts(&sb, ",\"node\":");
    r2d_sb_puts(&sb, json ? json : "null");
    send_ok_end(&sb);

    SDL_free(json);
    SDL_free(err);
}

// `profile`: что стоит запрос, без догадок. Отдаёт число тел, статистику
// нативного поиска (кандидаты broadphase, отсев по расстоянию, время) и зоны
// кадра. `allocations` — null: движок их не измеряет и притворяться не станет
// (AGENT_IMPLEMENTATION_RULES.md, правило 9).
static void cmd_profile(R2DAgent *a, const R2dJson *req)
{
    const char *sel = r2d_json_str(r2d_json_get(req, "sel"), NULL);
    const R2dJson *x_node = r2d_json_get(req, "x");
    const R2dJson *y_node = r2d_json_get(req, "y");
    const R2dJson *r_node = r2d_json_get(req, "radius");
    const bool has_circle = x_node && y_node && r_node
                            && x_node->type == R2D_JSON_NUM
                            && y_node->type == R2D_JSON_NUM
                            && r_node->type == R2D_JSON_NUM
                            && r_node->number > 0.0;

    // Число сущностей по селектору считает игровой JS — тот же код поиска,
    // что у query/inspect. Нет хука — честная ошибка, а не молчаливый ноль.
    char *count_json = NULL;
    char *count_err = NULL;
    if (sel && !r2d_script_agent_query(a->script, sel, "count", 0, &count_json, &count_err)) {
        send_error(req, count_err ? count_err : "profile: инспекция недоступна");
        SDL_free(count_json);
        SDL_free(count_err);
        return;
    }

    int candidates = 0;
    int results = 0;
    double query_ms = 0.0;
    if (has_circle && a->script && a->script->physics) {
        int ids[R2D_MAX_QUERY];
        const uint64_t t0 = SDL_GetPerformanceCounter();
        results = r2d_physics_query_circle(a->script->physics,
                                           (float)x_node->number, (float)y_node->number,
                                           (float)r_node->number, 0,
                                           ids, R2D_MAX_QUERY, &candidates);
        const uint64_t t1 = SDL_GetPerformanceCounter();
        const uint64_t freq = SDL_GetPerformanceFrequency();
        query_ms = freq > 0 ? (double)(t1 - t0) * 1000.0 / (double)freq : 0.0;
    }

    R2DProfileRow rows[R2D_PROF_ROW_MAX];
    const int row_count = r2d_prof_rows(rows, R2D_PROF_ROW_MAX);

    R2dSb sb;
    begin_response(&sb, req, true);
    r2d_sb_puts(&sb, ",\"profile\":{\"allocations\":null");

    if (sel) {
        r2d_sb_puts(&sb, ",\"sel\":");
        r2d_sb_put_json_string(&sb, sel);
        r2d_sb_puts(&sb, ",\"count\":");
        r2d_sb_puts(&sb, count_json ? count_json : "0");
    }

    r2d_sb_puts(&sb, ",\"bodies\":");
    r2d_sb_put_json_number(&sb, (a->script && a->script->physics)
                                    ? (double)r2d_physics_live_count(a->script->physics) : 0.0);

    r2d_sb_puts(&sb, ",\"query\":");
    if (has_circle) {
        r2d_sb_puts(&sb, "{\"native\":true,\"x\":");
        r2d_sb_put_json_number(&sb, x_node->number);
        r2d_sb_puts(&sb, ",\"y\":");
        r2d_sb_put_json_number(&sb, y_node->number);
        r2d_sb_puts(&sb, ",\"radius\":");
        r2d_sb_put_json_number(&sb, r_node->number);
        r2d_sb_puts(&sb, ",\"candidates\":");
        r2d_sb_put_json_number(&sb, candidates);
        r2d_sb_puts(&sb, ",\"results\":");
        r2d_sb_put_json_number(&sb, results);
        r2d_sb_puts(&sb, ",\"ms\":");
        r2d_sb_put_json_number(&sb, query_ms);
        r2d_sb_puts(&sb, ",\"cap\":");
        r2d_sb_put_json_number(&sb, R2D_MAX_QUERY);
        r2d_sb_puts(&sb, ",\"truncated\":");
        r2d_sb_puts(&sb, candidates >= R2D_MAX_QUERY ? "true" : "false");
        r2d_sb_puts(&sb, "}");
    } else {
        r2d_sb_puts(&sb, "null");
    }

    r2d_sb_puts(&sb, ",\"frame\":{\"frame_ms\":");
    r2d_sb_put_json_number(&sb, r2d_prof_frame_ms());
    r2d_sb_puts(&sb, ",\"real_ms\":");
    r2d_sb_put_json_number(&sb, r2d_prof_real_ms());
    r2d_sb_puts(&sb, ",\"unaccounted_ms\":");
    r2d_sb_put_json_number(&sb, r2d_prof_unaccounted_ms());
    r2d_sb_puts(&sb, ",\"frames\":");
    r2d_sb_put_json_number(&sb, r2d_prof_frames());
    r2d_sb_puts(&sb, ",\"zones\":[");
    for (int i = 0; i < row_count; ++i) {
        if (i > 0) r2d_sb_putc(&sb, ',');
        r2d_sb_puts(&sb, "{\"name\":");
        r2d_sb_put_json_string(&sb, rows[i].name ? rows[i].name : "");
        r2d_sb_puts(&sb, ",\"ms\":");
        r2d_sb_put_json_number(&sb, rows[i].ms);
        r2d_sb_puts(&sb, ",\"peak\":");
        r2d_sb_put_json_number(&sb, rows[i].peak);
        r2d_sb_puts(&sb, ",\"gpu\":");
        r2d_sb_puts(&sb, rows[i].gpu ? "true" : "false");
        r2d_sb_puts(&sb, ",\"valid\":");
        r2d_sb_puts(&sb, rows[i].valid ? "true" : "false");
        r2d_sb_puts(&sb, "}");
    }
    r2d_sb_puts(&sb, "]}}");
    send_ok_end(&sb);

    SDL_free(count_json);
    SDL_free(count_err);
}

static void cmd_eval(R2DAgent *a, const R2dJson *req)
{
    const char *code = r2d_json_str(r2d_json_get(req, "code"), NULL);
    if (!code) { send_error(req, "eval: не передан параметр code"); return; }

    char *json = NULL;
    char *err = NULL;
    if (!r2d_script_eval(a->script, code, &json, &err)) {
        send_error(req, err ? err : "ошибка выполнения кода");
        SDL_free(json);
        SDL_free(err);
        return;
    }

    R2dSb sb;
    begin_response(&sb, req, true);
    r2d_sb_puts(&sb, ",\"result\":");
    r2d_sb_puts(&sb, json ? json : "null");
    send_ok_end(&sb);

    SDL_free(json);
    SDL_free(err);
}

// Есть ли в движке такое имя (отчёт BASHNYA H12: «нет интроспекции API»).
//
// Клиент спрашивает конкретные имена — списком или одним:
//   {"cmd":"has","names":["$.audio.captureStart","$.sound.musicPlaying"]}
//   ← {"ok":true,"has":{"$.audio.captureStart":true,"$.sound.musicPlaying":false}}
// Полный список имён (их больше трёх тысяч, это ~60 КБ) намеренно НЕ отдаём:
// снимок агента уже один раз раздувался до 168 КБ, второй раз не надо.
// Ответ считает JS (`$.agent.has`), здесь только транспорт — одна реализация
// правила «что считать существующим» на всех клиентов.
static void cmd_has(R2DAgent *a, const R2dJson *req)
{
    const R2dJson *names = r2d_json_get(req, "names");
    const R2dJson *single = r2d_json_get(req, "name");
    if (!names && !single) {
        send_error(req, "has: нужен параметр names (список) или name (одно имя)");
        return;
    }

    R2dSb code;
    r2d_sb_init(&code);
    r2d_sb_puts(&code, "$.agent.has(");
    if (names) {
        if (names->type != R2D_JSON_ARR) {
            send_error(req, "has: names должен быть массивом строк");
            r2d_sb_free(&code);
            return;
        }
        r2d_sb_putc(&code, '[');
        for (int i = 0; i < names->count; ++i) {
            const R2dJson *item = r2d_json_at(names, i);
            if (i) r2d_sb_putc(&code, ',');
            r2d_sb_put_json_string(&code, item && item->type == R2D_JSON_STR ? item->string : "");
        }
        r2d_sb_putc(&code, ']');
    } else {
        r2d_sb_put_json_string(&code, single->type == R2D_JSON_STR ? single->string : "");
    }
    r2d_sb_puts(&code, ")");

    char *json = NULL;
    char *err = NULL;
    if (!r2d_script_eval(a->script, code.data, &json, &err)) {
        send_error(req, err ? err : "has: $.agent.has недоступен: игра не вызвала $.agent.install()");
        SDL_free(json);
        SDL_free(err);
        r2d_sb_free(&code);
        return;
    }

    R2dSb sb;
    begin_response(&sb, req, true);
    r2d_sb_puts(&sb, ",\"has\":");
    r2d_sb_puts(&sb, json ? json : "null");
    send_ok_end(&sb);

    SDL_free(json);
    SDL_free(err);
    r2d_sb_free(&code);
}

// ---------------------------------------------------------------------------
// Ввод
// ---------------------------------------------------------------------------

static bool command_key(R2DAgent *a, const R2dJson *req)
{
    const char *name = r2d_json_str(r2d_json_get(req, "key"), NULL);
    if (!name) { send_error(req, "key: не передан параметр key"); return true; }

    const SDL_Scancode sc = SDL_GetScancodeFromName(name);
    if (sc == SDL_SCANCODE_UNKNOWN) {
        R2dSb sb;
        r2d_sb_init(&sb);
        r2d_sb_puts(&sb, "key: неизвестная клавиша \"");
        r2d_sb_puts(&sb, name);
        r2d_sb_puts(&sb, "\"");
        send_error(req, sb.data);
        r2d_sb_free(&sb);
        return true;
    }

    const char *action = r2d_json_str(r2d_json_get(req, "action"), "tap");
    if (SDL_strcmp(action, "down") == 0) {
        r2d_app_virtual_key(a->app, sc, true);
    } else if (SDL_strcmp(action, "up") == 0) {
        r2d_app_virtual_key(a->app, sc, false);
    } else if (SDL_strcmp(action, "tap") == 0) {
        r2d_app_virtual_tap(a->app, sc);
    } else {
        send_error(req, "key: action должен быть down, up или tap");
        return true;
    }

    R2dSb sb;
    begin_response(&sb, req, true);
    r2d_sb_puts(&sb, ",\"key\":");
    r2d_sb_put_json_string(&sb, name);
    r2d_sb_puts(&sb, ",\"action\":");
    r2d_sb_put_json_string(&sb, action);
    send_ok_end(&sb);
    return true;
}

static bool command_keys(R2DAgent *a, const R2dJson *req)
{
    const R2dJson *hold = r2d_json_get(req, "hold");
    if (!hold || hold->type != R2D_JSON_ARR) {
        send_error(req, "keys: нужен массив hold");
        return true;
    }

    // Набор заменяется целиком — так же, как зажатые клавиши у человека.
    r2d_app_virtual_release_all(a->app);

    for (int i = 0; i < hold->count; ++i) {
        const char *name = r2d_json_str(hold->items[i], NULL);
        if (!name) continue;
        const SDL_Scancode sc = SDL_GetScancodeFromName(name);
        if (sc == SDL_SCANCODE_UNKNOWN) {
            R2dSb sb;
            r2d_sb_init(&sb);
            r2d_sb_puts(&sb, "keys: неизвестная клавиша \"");
            r2d_sb_puts(&sb, name);
            r2d_sb_puts(&sb, "\"");
            send_error(req, sb.data);
            r2d_sb_free(&sb);
            return true;
        }
        r2d_app_virtual_key(a->app, sc, true);
    }

    R2dSb sb;
    begin_response(&sb, req, true);
    r2d_sb_puts(&sb, ",\"hold\":[");
    for (int i = 0; i < hold->count; ++i) {
        const char *name = r2d_json_str(hold->items[i], NULL);
        if (!name) continue;
        if (i) r2d_sb_putc(&sb, ',');
        r2d_sb_put_json_string(&sb, name);
    }
    r2d_sb_puts(&sb, "]");
    send_ok_end(&sb);
    return true;
}

// touch {action: down|move|up, x, y, finger} — виртуальный палец.
// SDL_EVENT_FINGER_* извне не синтезировать, а тач-интерфейс надо проверять
// в CI без настоящего экрана.
//
// ВАЖНО: номер пальца идёт в поле `finger`, а НЕ `id`: клиент протокола
// подставляет в `id` номер запроса, и `id: 0` превращался в 1 — палец
// оказывался в слоте 1 (нашлось тестом: touchCount() = 1, но touchDown(0)
// ложь, а touch(1) отдавал координаты).
static bool command_touch(R2DAgent *a, const R2dJson *req)
{
    const char *action = r2d_json_str(r2d_json_get(req, "action"), "down");
    const int id = r2d_json_int(r2d_json_get(req, "finger"), 0);
    const float x = (float)r2d_json_num(r2d_json_get(req, "x"), 0);
    const float y = (float)r2d_json_num(r2d_json_get(req, "y"), 0);

    if (SDL_strcmp(action, "clear") == 0) {
        r2d_app_virtual_touch_clear(a->app);
        send_ok(req);
        return true;
    }
    const bool down = SDL_strcmp(action, "up") != 0;
    r2d_app_virtual_touch(a->app, id, x, y, down);
    send_ok(req);
    return true;
}

// Виртуальный геймпад: сброс слота живёт в app.c рядом с инъекцией.
extern void r2d_app_virtual_gamepad_reset(R2DApp *app, int slot);

/** Кнопка из JSON: номер или имя SDL («a», «dpup»). -1 — не распознано. */
static int r2d__pad_button_arg(const R2dJson *v)
{
    if (!v) return -1;
    if (v->type == R2D_JSON_STR) {
        const SDL_GamepadButton b = SDL_GetGamepadButtonFromString(v->string);
        return b == SDL_GAMEPAD_BUTTON_INVALID ? -1 : (int)b;
    }
    const int n = r2d_json_int(v, -1);
    return (n < 0 || n >= SDL_GAMEPAD_BUTTON_COUNT) ? -1 : n;
}

/** Ось из JSON: номер или имя SDL («leftx», «lefttrigger»). -1 — не распознано. */
static int r2d__pad_axis_arg(const R2dJson *v)
{
    if (!v) return -1;
    if (v->type == R2D_JSON_STR) {
        const SDL_GamepadAxis ax = SDL_GetGamepadAxisFromString(v->string);
        return ax == SDL_GAMEPAD_AXIS_INVALID ? -1 : (int)ax;
    }
    const int n = r2d_json_int(v, -1);
    return (n < 0 || n >= SDL_GAMEPAD_AXIS_COUNT) ? -1 : n;
}

// pad {slot, button|axis, down|value} — виртуальный геймпад.
//
// `button`/`axis` принимают НОМЕР (SDL_GamepadButton/SDL_GamepadAxis) или ИМЯ
// в написании SDL: «a», «dpup», «leftx», «lefttrigger». `reset: true` снимает
// всё, что накопила инъекция по слоту, — тем же состоянием, что и отключение
// устройства: тест проверяет, что зажатая кнопка не остаётся нажатой.
static bool command_pad(R2DAgent *a, const R2dJson *req)
{
    const int slot = r2d_json_int(r2d_json_get(req, "slot"), 0);
    const int slots = r2d_pad_slot_count();
    if (slot < 0 || slot >= slots) {
        send_error(req, "pad: слот вне диапазона");
        return true;
    }
    if (r2d_json_bool(r2d_json_get(req, "reset"), false)) {
        r2d_app_virtual_gamepad_reset(a->app, slot);
        send_ok(req);
        return true;
    }
    const R2dJson *button = r2d_json_get(req, "button");
    const R2dJson *axis = r2d_json_get(req, "axis");

    if (button) {
        const int b = r2d__pad_button_arg(button);
        if (b < 0) {
            send_error(req, "pad: неизвестная кнопка (номер 0..14 или имя SDL: \"a\", \"dpup\")");
            return true;
        }
        r2d_app_virtual_gamepad(a->app, slot, b, r2d_json_bool(r2d_json_get(req, "down"), true));
    } else if (axis) {
        const int ax = r2d__pad_axis_arg(axis);
        if (ax < 0) {
            send_error(req, "pad: неизвестная ось (номер 0..5 или имя SDL: \"leftx\", \"lefttrigger\")");
            return true;
        }
        r2d_app_virtual_gamepad_axis(a->app, slot, ax,
                                     (float)r2d_json_num(r2d_json_get(req, "value"), 0));
    } else {
        send_error(req, "pad: нужен button, axis или reset");
        return true;
    }
    send_ok(req);
    return true;
}

static bool command_mouse(R2DAgent *a, const R2dJson *req)
{
    const int button = r2d_json_int(r2d_json_get(req, "button"), 1);
    const char *action = r2d_json_str(r2d_json_get(req, "action"), "click");

    if (SDL_strcmp(action, "down") == 0) {
        r2d_app_virtual_mouse(a->app, button, true);
    } else if (SDL_strcmp(action, "up") == 0) {
        r2d_app_virtual_mouse(a->app, button, false);
    } else if (SDL_strcmp(action, "click") == 0) {
        // Клик — это нажатие в этом кадре и отпускание сразу после него:
        // обработчики клика видят фронт, а кнопка не «залипает».
        r2d_app_virtual_mouse(a->app, button, true);
        g_pending_mouse_release = button;
    } else {
        send_error(req, "mouse: action должен быть down, up или click");
        return true;
    }

    R2dSb sb;
    begin_response(&sb, req, true);
    r2d_sb_puts(&sb, ",\"button\":");
    r2d_sb_put_json_number(&sb, button);
    r2d_sb_puts(&sb, ",\"action\":");
    r2d_sb_put_json_string(&sb, action);
    send_ok_end(&sb);
    return true;
}

static void command_mouse_move(R2DAgent *a, const R2dJson *req)
{
    const R2dJson *dx = r2d_json_get(req, "dx");
    const R2dJson *dy = r2d_json_get(req, "dy");
    const R2dJson *x = r2d_json_get(req, "x");
    const R2dJson *y = r2d_json_get(req, "y");

    if (dx || dy) {
        r2d_app_virtual_mouse_move(a->app,
                                   (float)r2d_json_num(dx, 0.0),
                                   (float)r2d_json_num(dy, 0.0));
    }
    if (x || y) {
        const float nx = (float)r2d_json_num(x, a->app->mouse_x);
        const float ny = (float)r2d_json_num(y, a->app->mouse_y);
        r2d_app_virtual_mouse_pos(a->app, nx, ny);
    }

    R2dSb sb;
    begin_response(&sb, req, true);
    r2d_sb_puts(&sb, ",\"x\":");
    r2d_sb_put_json_number(&sb, a->app->mouse_x);
    r2d_sb_puts(&sb, ",\"y\":");
    r2d_sb_put_json_number(&sb, a->app->mouse_y);
    send_ok_end(&sb);
}

static void command_wheel(R2DAgent *a, const R2dJson *req)
{
    r2d_app_virtual_wheel(a->app, (float)r2d_json_num(r2d_json_get(req, "amount"), 0.0));
    R2dSb sb;
    begin_response(&sb, req, true);
    r2d_sb_puts(&sb, ",\"amount\":");
    r2d_sb_put_json_number(&sb, r2d_json_num(r2d_json_get(req, "amount"), 0.0));
    send_ok_end(&sb);
}

// Ввод текста: синтезировать SDL_EVENT_TEXT_INPUT снаружи нельзя, поэтому
// агент дописывает символы прямо в буфер кадра — так тестируются <ui.input>.
static void command_text(R2DAgent *a, const R2dJson *req)
{
    const char *text = r2d_json_str(r2d_json_get(req, "text"), NULL);
    if (text) r2d_app_virtual_text(a->app, text);

    R2dSb sb;
    begin_response(&sb, req, true);
    r2d_sb_puts(&sb, ",\"text\":");
    r2d_sb_put_json_string(&sb, text ? text : "");
    send_ok_end(&sb);
}

// Снимок кадра: рисуем ровно один кадр и читаем его из swapchain.
static bool command_screenshot(R2DAgent *a, const R2DAgentHooks *hooks, const R2dJson *req)
{
    const char *path = r2d_json_str(r2d_json_get(req, "path"), NULL);
    if (!path) { send_error(req, "screenshot: не передан параметр path"); return true; }

    char full[4096];
    r2d_app_resolve_path(a->app, full, sizeof full, path);

    if (!hooks->frame(hooks->user, full)) {
        send_error(req, "screenshot: кадр не отрисован (приложение останавливается)");
        return false;
    }

    // Кадр мог быть отрисован без изображения: у скрытого окна на Vulkan SDL
    // отдаёт NULL-swapchain (не ошибка драйвера, см. SDL_gpu_vulkan.c), и
    // копировать в PNG нечего. Раньше команда всё равно отвечала ok:true с
    // размером кадра — вызывающий считал снимок сделанным, файла не было, и
    // это выяснялось только глазами. Теперь молчаливого успеха нет: причина
    // названа, а путь к отсутствующему файлу не выдаётся за результат.
    if (!SDL_GetPathInfo(full, NULL)) {
        send_error(req, "screenshot: кадр не содержит изображения — окно скрыто "
                        "(--headless) или нет доступного swapchain; запустите без --headless");
        return true;
    }

    R2dSb sb;
    begin_response(&sb, req, true);
    r2d_sb_puts(&sb, ",\"path\":");
    r2d_sb_put_json_string(&sb, full);
    r2d_sb_puts(&sb, ",\"width\":");
    r2d_sb_put_json_number(&sb, a->app->pixel_width);
    r2d_sb_puts(&sb, ",\"height\":");
    r2d_sb_put_json_number(&sb, a->app->pixel_height);
    send_ok_end(&sb);
    return true;
}

// Шаги вперёд: именно здесь «идёт время» в агентском режиме.
static bool command_step(R2DAgent *a, const R2DAgentHooks *hooks, const R2dJson *req)
{
    int frames = r2d_json_int(r2d_json_get(req, "frames"), 1);
    if (frames < 0) frames = 0;
    if (frames > 100000) {
        send_error(req, "step: слишком много кадров за раз (максимум 100000)");
        return true;
    }

    const R2dJson *dt = r2d_json_get(req, "dt");
    if (dt && dt->type == R2D_JSON_NUM && dt->number > 0.0) {
        a->app->fixed_dt = (float)dt->number;
    }

    int done = 0;

    // Отложенный клик: первый кадр идёт с нажатой кнопкой, затем отпускаем.
    if (frames > 0 && g_pending_mouse_release > 0) {
        if (!hooks->frame(hooks->user, NULL)) {
            send_error(req, "step: приложение остановилось во время прогона кадров");
            return false;
        }
        r2d_app_virtual_mouse(a->app, g_pending_mouse_release, false);
        g_pending_mouse_release = 0;
        done = 1;
    }

    for (int i = done; i < frames; ++i) {
        if (!hooks->frame(hooks->user, NULL)) {
            send_error(req, "step: приложение остановилось во время прогона кадров");
            return false;
        }
    }

    R2dSb sb;
    begin_response(&sb, req, true);
    r2d_sb_puts(&sb, ",\"frames\":");
    r2d_sb_put_json_number(&sb, frames);
    r2d_sb_puts(&sb, ",\"frame\":");
    r2d_sb_put_json_number(&sb, (double)a->app->frame);
    r2d_sb_puts(&sb, ",\"time\":");
    r2d_sb_put_json_number(&sb, a->app->time);
    send_ok_end(&sb);
    return true;
}

static bool command_reload(R2DAgent *a, const R2dJson *req)
{
    const bool ok = r2d_script_reload(a->script);
    R2dSb sb;
    begin_response(&sb, req, true);
    r2d_sb_puts(&sb, ",\"reloads\":");
    r2d_sb_put_json_number(&sb, (double)a->script->reload_count);
    r2d_sb_puts(&sb, ",\"ok_js\":");
    r2d_sb_puts(&sb, ok ? "true" : "false");
    send_ok_end(&sb);
    return true;
}

// ---------------------------------------------------------------------------
// Цикл
// ---------------------------------------------------------------------------

// Буфер строки команды живёт до следующего вызова: он растёт по мере чтения.
static char  *g_line = NULL;
static size_t g_line_cap = 0;

// Читает строку команды произвольной длины. Возвращает NULL на конце ввода.
//
// fgets() с фиксированным буфером разрезал бы команду >= 64 КиБ на две: движок
// ответил бы дважды («одна строка — один ответ» ломается), и следующий ответ
// доставался бы не тому запросу. Поэтому читаем посимвольно и растём.
static char *read_command_line(void)
{
    size_t len = 0;
    bool got = false;
    int c;

    while ((c = fgetc(stdin)) != EOF) {
        got = true;
        if (c == '\n') break;
        if (len + 2 > g_line_cap) {
            const size_t cap = g_line_cap ? g_line_cap * 2 : 4096;
            char *grown = (char *)SDL_realloc(g_line, cap);
            if (!grown) return NULL;
            g_line = grown;
            g_line_cap = cap;
        }
        g_line[len++] = (char)c;
    }
    if (!got) return NULL;
    if (!g_line) return NULL;
    g_line[len] = '\0';
    return g_line;
}

bool r2d_agent_serve(R2DAgent *a, const R2DAgentHooks *hooks)
{
    if (!a || !hooks || !hooks->frame) return false;

    bool running = true;

    while (running) {
        // Блокирующее чтение: в агентском режиме ждать команду — норма, и это
        // то, что делает прогон детерминированным (кадры не идут сами).
        char *line = read_command_line();
        if (!line) {
            R2D_LOG("stdin закрыт — завершаю агентский режим");
            break;
        }

        size_t len = SDL_strlen(line);
        while (len > 0 && (line[len - 1] == '\n' || line[len - 1] == '\r')) line[--len] = '\0';
        if (len == 0) continue;

        char err[256];
        R2dJson *req = r2d_json_parse(line, err, sizeof err);
        if (!req) {
            // Ответ на неразобранную строку — без эха id: его просто нет.
            R2dSb sb;
            r2d_sb_init(&sb);
            r2d_sb_puts(&sb, "{\"ok\":false,\"error\":\"не удалось разобрать JSON: ");
            for (const char *p = err; *p; ++p) {
                if (*p == '"' || *p == '\\') r2d_sb_putc(&sb, '\\');
                r2d_sb_putc(&sb, *p);
            }
            r2d_sb_puts(&sb, "\"}");
            r2d_agent_write_line(sb.data);
            r2d_sb_free(&sb);
            continue;
        }

        const char *cmd = r2d_json_str(r2d_json_get(req, "cmd"), NULL);
        if (!cmd) {
            send_error(req, "в запросе нет поля cmd");
            r2d_json_free(req);
            continue;
        }

        a->saw_command = true;

        if (SDL_strcmp(cmd, "ping") == 0) {
            cmd_ping(a, req);
        } else if (SDL_strcmp(cmd, "frames") == 0) {
            cmd_frames(a, req);
        } else if (SDL_strcmp(cmd, "state") == 0) {
            cmd_state(a, req);
        } else if (SDL_strcmp(cmd, "query") == 0) {
            cmd_query(a, req);
        } else if (SDL_strcmp(cmd, "inspect") == 0) {
            cmd_inspect(a, req);
        } else if (SDL_strcmp(cmd, "profile") == 0) {
            cmd_profile(a, req);
        } else if (SDL_strcmp(cmd, "eval") == 0) {
            cmd_eval(a, req);
        } else if (SDL_strcmp(cmd, "has") == 0) {
            cmd_has(a, req);
        } else if (SDL_strcmp(cmd, "step") == 0) {
            running = command_step(a, hooks, req);
        } else if (SDL_strcmp(cmd, "screenshot") == 0) {
            running = command_screenshot(a, hooks, req);
        } else if (SDL_strcmp(cmd, "key") == 0) {
            command_key(a, req);
        } else if (SDL_strcmp(cmd, "keys") == 0) {
            command_keys(a, req);
        } else if (SDL_strcmp(cmd, "touch") == 0) {
            running = command_touch(a, req);
        } else if (SDL_strcmp(cmd, "pad") == 0) {
            running = command_pad(a, req);
        } else if (SDL_strcmp(cmd, "mouse") == 0) {
            command_mouse(a, req);
        } else if (SDL_strcmp(cmd, "mouseMove") == 0) {
            command_mouse_move(a, req);
        } else if (SDL_strcmp(cmd, "wheel") == 0) {
            command_wheel(a, req);
        } else if (SDL_strcmp(cmd, "text") == 0) {
            command_text(a, req);
        } else if (SDL_strcmp(cmd, "reload") == 0) {
            running = command_reload(a, req);
        } else if (SDL_strcmp(cmd, "quit") == 0) {
            R2dSb sb;
            begin_response(&sb, req, true);
            send_ok_end(&sb);
            running = false;
        } else {
            R2dSb sb;
            r2d_sb_init(&sb);
            r2d_sb_puts(&sb, "неизвестная команда: ");
            r2d_sb_puts(&sb, cmd);
            send_error(req, sb.data);
            r2d_sb_free(&sb);
        }

        // Отложенное отпускание мыши после click: кнопка должна дожить до
        // кадра, который прогонит step, иначе клика никто не увидит.
        r2d_json_free(req);
        if (!a->app->running) break;
    }

    SDL_free(g_line);
    g_line = NULL;
    g_line_cap = 0;
    return a->app->running;
}
