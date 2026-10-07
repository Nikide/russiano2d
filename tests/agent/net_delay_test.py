#!/usr/bin/env python3
# ===========================================================================
# Симуляция задержки сети: два экземпляра движка на localhost.
#
# Зачем: в §12.15 «симуляция задержки пакетов» числилась незакрытой, и в C это
# было прямо написано — `R2D_UNUSED(delay_ms); // задержку пока не откладываем`.
# Были только потери. Теперь задержка делается ОЧЕРЕДЬЮ отложенных отправок:
# спать в кадре нельзя, поэтому пакет ждёт своего времени и уходит из poll().
#
# Проверяем, что задержка ДЕЙСТВИТЕЛЬНО задерживает: сразу после отправки пакет
# в очереди и до сервера не дошёл, а через время — дошёл.
#
# Запуск после сборки:
#   python3 tests/agent/net_delay_test.py
# ===========================================================================

import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

GAME = os.path.join("tests", "fixtures", "text")
PORT = 47913
FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


SERVER_SETUP = """
globalThis.__log = [];
$.net.bindEngine();
$.net.host(%d, { maxPlayers: 4 });
$.net.on('input', (player, data) => __log.push('input:' + data.seq));
$.update(() => { $.net.poll(); });
"""

CLIENT_SETUP = """
globalThis.__log = [];
$.net.bindEngine();
$.net.join('127.0.0.1', %d);
$.update(() => { $.net.poll(); });
"""


def pump(server, client, n=1):
    for _ in range(n):
        server.step(1)
        client.step(1)
        time.sleep(0.02)


def main():
    with Agent(game=GAME, seed=5) as server, Agent(game=GAME, seed=6) as client:
        check(server.eval("typeof engine.netDelayed") == "function",
              "engine.netDelayed есть (видно очередь задержки)")
        check(server.eval("typeof $.net.simulate") == "function",
              "$.net.simulate есть")

        server.eval(SERVER_SETUP % PORT)
        client.eval(CLIENT_SETUP % PORT)
        for _ in range(60):
            pump(server, client)
            if client.eval("engine.netStatus().connected") is True:
                break
        check(client.eval("engine.netStatus().connected") is True,
              "клиент подключился к серверу")

        # --- БЕЗ задержки: пакет доходит сразу ---
        client.eval("$.net.send('input', { seq: 1 })")
        for _ in range(30):
            pump(server, client)
            if "input:1" in server.eval("__log.join('|')"):
                break
        log = server.eval("__log.join('|')")
        check("input:1" in log, f"без задержки пакет дошёл быстро: {log}")

        # --- С задержкой 200 мс ---
        info = client.eval("JSON.stringify($.net.simulate({ delay: 200, seed: 7 }))")
        print(f"  simulate: {info}")
        check('"delay":200' in info, "simulate принял задержку")
        check(client.eval("JSON.stringify($.net.simulation())") == info,
              "simulation() читается обратно")

        server.eval("__log.length = 0")
        client.eval("$.net.send('input', { seq: 2 })")
        # Сразу после отправки: пакет в ОЧЕРЕДИ, до сервера не дошёл.
        pump(server, client, 1)
        delayed = client.eval("engine.netDelayed()")
        early = "input:2" in server.eval("__log.join('|')")
        print(f"  сразу после отправки: в очереди {delayed}, у сервера {early}")
        check(delayed >= 1, f"пакет ЖДЁТ в очереди задержки ({delayed})")
        check(not early, "и до сервера он ещё НЕ дошёл")

        # Ждём: через 200 мс должен дойти.
        arrived = False
        waited = 0.0
        for _ in range(60):
            pump(server, client)
            waited += 0.02
            if "input:2" in server.eval("__log.join('|')"):
                arrived = True
                break
        print(f"  дошёл через ~{waited:.2f} с ожидания")
        check(arrived, "с задержкой пакет всё-таки дошёл")
        check(waited >= 0.1, f"и это заняло заметное время ({waited:.2f} с)")

        # --- Задержка снимается ---
        client.eval("$.net.simulateOff()")
        check('"delay":0' in client.eval("JSON.stringify($.net.simulation())"),
              "simulateOff снял задержку")
        server.eval("__log.length = 0")
        client.eval("$.net.send('input', { seq: 3 })")
        fast = False
        for _ in range(30):
            pump(server, client)
            if "input:3" in server.eval("__log.join('|')"):
                fast = True
                break
        check(fast, "без симуляции пакет снова доходит быстро")

        # --- Потери всё ещё работают (раньше были только они) ---
        client.eval("$.net.simulate({ loss: 100, seed: 3 })")
        server.eval("__log.length = 0")
        for i in range(10, 15):
            client.eval("$.net.send('input', { seq: %d })" % i)
        pump(server, client, 40)
        lost = server.eval("__log.join('|')")
        print(f"  при 100% потерь до сервера дошло: {lost!r}")
        check("input:" not in lost, f"100% потерь — ничего не дошло ({lost})")

        client.eval("$.net.simulateOff()")

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
