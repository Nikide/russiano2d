// ===========================================================================
// Агентский режим: движок слушает stdin и отвечает JSON-строками в stdout.
//
// Полное описание протокола — docs/AGENT_API.md. Коротко:
//   * одна строка JSON на запрос, одна на ответ;
//   * кадры сами не идут: их продвигает команда step;
//   * весь остальной вывод движка уходит в stderr — stdout чист.
// ===========================================================================
#pragma once

#include "r2d.h"

#include <stdbool.h>
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct R2DApp    R2DApp;
typedef struct R2DScript R2DScript;

typedef struct R2DAgent R2DAgent;

// Прогоняет ровно один кадр. shot_path != NULL — заодно сохранить кадр в PNG.
// Возвращает false, если приложение остановилось.
typedef bool (*R2DAgentFrameFn)(void *user, const char *shot_path);

typedef struct R2DAgentHooks {
    void            *user;
    R2DAgentFrameFn  frame;      // обязателен
} R2DAgentHooks;

// Переводит весь журнал движка в stderr, а stdout отдаёт протоколу.
// Вызывать до первого вывода, который мог бы испортить протокол (в том числе
// до инициализации RmlUi и ImGui — они печатают в stdout напрямую).
// Возвращает сохранённый дескриптор stdout (нужен для ответов).
void r2d_agent_capture_stdout(void);

R2DAgent *r2d_agent_create(R2DApp *app, R2DScript *script);
void      r2d_agent_destroy(R2DAgent *a);

// Печатает {"event":"ready",...} — клиент ждёт это до первого запроса.
void r2d_agent_signal_ready(const R2DAgent *a);

// Основной цикл: читает команды со stdin и выполняет их до quit или закрытия
// stdin. Возвращает false, если приложение просит выход.
bool r2d_agent_serve(R2DAgent *a, const R2DAgentHooks *hooks);

// Печатает одну строку-ответ в stdout (в обход буферов stdio).
void r2d_agent_write_line(const char *line);

#ifdef __cplusplus
}
#endif
