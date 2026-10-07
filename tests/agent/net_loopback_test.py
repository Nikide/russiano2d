#!/usr/bin/env python3
# ===========================================================================
# Сетевой тест: два экземпляра движка на localhost, транспорт SDL3_net.
#
# Проверяем ТРАНСПОРТ и связку с ним: движок собрал SDL3_net, сервер слушает
# порт, клиент подключается, датаграмма доходит до сервера, сервер связывает
# пира с игроком по АДРЕСУ, счётчики считают байты, а симуляция потерь не
# ломает приём.
#
# ЧЕСТНО: обратный путь (ответ сервера клиенту) пока не работает — это
# записано в docs/highlevel/net.md. Тест проверяет то, что работает, и не
# выдаёт неработающее за работающее.
#
# Запуск после сборки:
#   python3 tests/agent/net_loopback_test.py
# ===========================================================================

import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

GAME = os.path.join("tests", "fixtures", "text")
PORT = 47911

FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


SERVER_SETUP = """
globalThis.__log = [];
$.net.bindEngine();
$.net.host(%d, { maxPlayers: 4 });
$.net.on('input', (player, data) => __log.push('input:' + player + ':' + data.seq));
$.net.on('join', (p) => __log.push('join:' + p));
$.update(() => { $.net.poll(); });
"""

CLIENT_SETUP = """
$.net.bindEngine();
$.net.join('127.0.0.1', %d);
$.update(() => { $.net.poll(); });
"""


def main():
    with Agent(game=GAME, seed=5) as server, Agent(game=GAME, seed=6) as client:
        check(server.eval("typeof engine.netStatus") == "function",
              "привязки сети есть в движке")
        status = server.eval("JSON.stringify(engine.netStatus())")
        check('"available":true' in status, f"SDL3_net собран и доступен: {status}")
        check(server.eval("$.net.bindEngine()") is True,
              "транспорт движка подключился к $.net")

        server.eval(SERVER_SETUP % PORT)
        check(server.eval("$.net.isServer()") is True, "сервер слушает порт")
        client.eval(CLIENT_SETUP % PORT)

        connected = False
        for _ in range(40):
            server.step(1)
            client.step(1)
            if client.eval("engine.netStatus().connected") is True:
                connected = True
                break
            time.sleep(0.05)
        check(connected, "клиент разрешил адрес хоста и считает себя подключённым")

        client.eval("$.net.send('input', { seq: 1, right: true })")
        got_input = False
        for _ in range(40):
            server.step(1)
            client.step(1)
            if "input:1:1" in server.eval("__log.join('|')"):
                got_input = True
                break
            time.sleep(0.05)
        log = server.eval("__log.join('|')")
        check(got_input, f"сервер получил ввод клиента по петле: {log}")
        check("join:1" in log, "сервер завёл игрока по адресу пира")

        stats = server.eval("engine.netStatus()")
        check(stats["packetsReceived"] > 0, f"счётчик принятых пакетов: {stats['packetsReceived']}")
        check(stats["received"] > 0, f"счётчик принятых байт: {stats['received']}")
        check(server.eval("$.net.playerCount()") == 1, "в столе авторитета один игрок")
        check(server.eval("$.net.peers().length") == 1, "адрес пира запомнен")

        # Несколько пакетов подряд: сервер должен принять все номера.
        for i in range(2, 6):
            client.eval("$.net.send('input', { seq: %d, right: false })" % i)
            client.step(1)
            server.step(1)
        time.sleep(0.2)
        for _ in range(10):
            server.step(1)
            client.step(1)
        log = server.eval("__log.join('|')")
        check("input:1:5" in log, f"дошёл последний номер ввода: {log}")

        # Симуляция потерь: приём не должен сломаться (часть пакетов теряется).
        before = server.eval("engine.netStatus()")["packetsReceived"]
        server.eval("engine.netSimulate(40, 0, 7)")
        for i in range(10, 20):
            client.eval("$.net.send('input', { seq: %d })" % i)
            client.step(1)
            server.step(1)
        time.sleep(0.2)
        for _ in range(10):
            server.step(1)
            client.step(1)
        after = server.eval("engine.netStatus()")["packetsReceived"]
        check(after > before, f"при потерях пакеты всё равно доходят: {before} → {after}")

        # Сброс: узел выходит из сети, порт освобождается.
        client.eval("$.net.leave()")
        server.eval("$.net.leave()")
        check(server.eval("$.net.role()") == "offline", "сервер вышел из сети")
        check(server.eval("engine.netMode()") == 0, "транспорт закрыт")

    print()
    if FAILURES:
        print(f"ПРОВАЛОВ: {len(FAILURES)}")
        for f in FAILURES:
            print("  - " + f)
        return 1
    print("Все проверки пройдены")
    return 0


if __name__ == "__main__":
    sys.exit(main())
