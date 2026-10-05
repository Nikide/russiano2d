#!/usr/bin/env python3
# ===========================================================================
# Агентский тест подсистемы HTTP ($.http) — без выхода в интернет.
#
# Проверяет то, что важно в живом движке:
#   * публичное API на месте, $.http.backend()/available() честно отвечают;
#   * запрос к заведомо закрытому локальному порту отклоняется (деградация
#     без сети) и не подвешивает Promise;
#   * подменённый бэкенд ($.http._setBackend) проходит через кадровый tickHttp
#     и разрешает Promise;
#   * ошибка запроса не роняет движок.
#
# Реальный HTTP никуда не отправляется: 127.0.0.1:1 закрыт на любой машине,
# поэтому тест годится и для офлайн-CI.
#
# Запуск (после сборки):
#   python3 tests/agent/highlevel_http_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "http")


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def settle(a, flag, frames=120):
    """Крутить кадры, пока игра не выставит globalThis.<flag> = 1."""
    for _ in range(frames):
        if a.eval(f"globalThis.{flag}") == 1:
            return True
        a.step(1)
    return a.eval(f"globalThis.{flag}") == 1


def main():
    with Agent(game=GAME, seed=7) as a:
        # --- Публичное API -----------------------------------------------------
        check(a.eval("typeof $.http") == "object", "$.http доступно")
        for name in ("get", "post", "put", "delete", "request", "json", "text",
                     "download", "pending", "backend", "available", "_setBackend"):
            check(a.eval(f"typeof $.http.{name}") == "function", f"$.http.{name} — функция")

        backend = a.eval("$.http.backend()")
        check(backend in ("curl", "socket", "none"), f"бэкенд называется понятно ({backend})")
        check(isinstance(a.eval("$.http.available()"), bool), "$.http.available() возвращает bool")
        check(a.eval("$.http.pending()") == 0, "в начале очередь запросов пуста")

        state = a.state().get("httpState")
        check(isinstance(state, dict) and state.get("backend") == backend,
              "состояние подсистемы видно агенту ($.agent.expose)")

        # --- Деградация без сети: закрытый локальный порт ---------------------
        a.eval("globalThis.__netDone = 0; globalThis.__netErr = null")
        a.eval(
            "$.http.get('http://127.0.0.1:1/nope', { timeout: 800 })"
            ".then(() => { globalThis.__netDone = 1; globalThis.__netErr = 'неожиданный успех'; },"
            "      (e) => { globalThis.__netDone = 1; globalThis.__netErr = e.message; })"
        )
        settled = settle(a, "__netDone")
        check(settled, "Promise запроса завершился, а не завис (закрытый порт)")
        check(a.eval("$.http.pending()") == 0, "после завершения очередь пуста")
        net_err = a.eval("globalThis.__netErr") or ""
        check(isinstance(net_err, str) and net_err.startswith("$.http: "),
              f"ошибка помечена подсистемой («{net_err[:60]}»)")
        check(len(net_err) > len("$.http: "), "текст ошибки не пустой и объясняет причину")

        # --- Невалидный URL: тоже reject, а не исключение в кадре -------------
        a.eval("globalThis.__badDone = 0; globalThis.__badErr = null")
        a.eval(
            "$.http.get('не-url')"
            ".then(() => { globalThis.__badDone = 1; globalThis.__badErr = 'неожиданный успех'; },"
            "      (e) => { globalThis.__badDone = 1; globalThis.__badErr = e.message; })"
        )
        check(settle(a, "__badDone", frames=10), "невалидный URL завершает Promise")
        bad_err = a.eval("globalThis.__badErr") or ""
        check("URL" in bad_err or "бэкенд" in bad_err,
              f"текст про невалидный URL понятен («{bad_err[:60]}»)")

        # --- Подмена бэкенда: очередь Promise проходит через tickHttp ---------
        a.eval("globalThis.__mockValue = 0")
        a.eval(
            "$.http._setBackend(() => ({ status: 200, body: '{\"n\": 5}',"
            " headers: 'HTTP/1.1 200 OK\\r\\nContent-Type: application/json\\r\\n\\r\\n' }))"
        )
        a.eval(
            "$.http.get('http://local.test/data')"
            ".then((r) => { globalThis.__mockValue = r.json().n; },"
            "      (e) => { globalThis.__mockValue = -1; globalThis.__mockErr = e.message; })"
        )
        check(a.eval("$.http.pending()") >= 1, "подменённый запрос встал в очередь")
        a.step(3)
        check(a.eval("globalThis.__mockValue") == 5,
              "Promise разрешился ответом подменённого бэкенда через кадры")
        check(a.eval("$.http.pending()") == 0, "очередь очистилась после ответа")
        check(a.eval("$.http.backend()") == "mock", "backend() показывает подмену")
        a.eval("$.http._setBackend(null)")
        check(a.eval("$.http.backend()") == backend, "подмена снята, вернулся настоящий бэкенд")

        # --- Таймаут: запрос не висит дольше заданного ------------------------
        a.eval("globalThis.__tDone = 0; globalThis.__tErr = null")
        a.eval(
            "$.http.request({ url: 'http://127.0.0.1:1/slow', timeout: 50 })"
            ".then(() => { globalThis.__tDone = 1; },"
            "      (e) => { globalThis.__tDone = 1; globalThis.__tErr = e.message; })"
        )
        check(settle(a, "__tDone", frames=60), "запрос с таймаутом завершился")
        check(a.eval("$.http.pending()") == 0, "очередь пуста после таймаута")

        # --- Ошибки не роняют кадр --------------------------------------------
        a.step(5)
        check(a.eval("engine.frame") > 0, "движок продолжает считать кадры после ошибок HTTP")
        check(a.ping().get("pong") is True, "движок жив после ошибок HTTP")

        # --- Обычные кадры без запросов ---------------------------------------
        a.step(10)
        check(a.eval("$.http.pending()") == 0, "без новых запросов очередь остаётся пустой")

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
