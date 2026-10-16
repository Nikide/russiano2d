#!/usr/bin/env python3
# ===========================================================================
# BASHNYA I17 (task-62): «что умеет этот билд» — `$.version()` и capabilities.
#
# Что было до правки (замер): `$.version` — undefined, `$.platform` — undefined,
# `$.web` — undefined; известно было только `engine.version` (свойство низкого
# уровня) и точечный `$.agent.has(...)`. Игра обходила это пробами в 16 местах
# (`player.js:310,346`, `bootstrap.js:198,303,561,619,676,773`,
# `lighting.js:180,199,248,267,296,299,463`, `lighting_props.js:545-550`,
# `level1.js:737`, `fx/shaders.js:61`) — и каждая проба врёт по-своему, когда
# метод переименовали.
#
# Что проверяется: форма ответа, согласованность с ЖИВЫМИ фактами движка
# (audio/channels/hrtf/net/physics), разделение с `has` (никакого списка имён)
# и РАЗМЕР ответа числом.
#
# Запуск: python3 tests/agent/agent_capabilities_test.py
# ===========================================================================

import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, ROOT   # noqa: E402

BINARY = os.environ.get("R2D_BINARY", os.path.join(ROOT, "build", "russiano2d"))
GAME = os.path.join(ROOT, "game")

FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def note(message):
    print("  --   " + message)


def main():
    if not os.path.exists(BINARY):
        print("  FAIL движок не собран: %s" % BINARY)
        return 1

    with Agent(binary=BINARY, game=GAME, seed=7) as a:
        # --- 1. $.version() -------------------------------------------------
        version = a.eval("$.version()")
        check(isinstance(version, str) and re.fullmatch(r"\d+\.\d+\.\d+", version) is not None,
              "$.version() отдаёт версию: %r" % version)
        check(version == a.eval("engine.version"),
              "$.version() совпадает с engine.version (%r)" % a.eval("engine.version"))
        check(a.eval("$.agent.has('version')") is True,
              "$.agent.has видит новое имя (division of labour: has — про имена)")

        # --- 2. Команда capabilities ----------------------------------------
        resp = a.cmd("capabilities")
        caps = resp.get("capabilities") or {}
        raw = json.dumps(resp, ensure_ascii=False)
        size = len(raw.encode("utf-8"))
        note("ответ capabilities: %d Б" % size)

        check(caps.get("version") == version, "capabilities.version = %r" % caps.get("version"))
        platform = caps.get("platform")
        check(isinstance(platform, str) and platform == ("macOS" if sys.platform == "darwin" else platform),
              "capabilities.platform = %r (ожидание для этой ОС)" % platform)
        gpu = caps.get("gpu")
        check(isinstance(gpu, str) and gpu, "capabilities.gpu = %r" % gpu)
        if sys.platform == "darwin":
            check(gpu == "metal", "на macOS драйвер GPU — metal (получено %r)" % gpu)

        agent_info = caps.get("agent") or {}
        check(agent_info.get("mode") is True and agent_info.get("headless") is True,
              "режим агента виден: %s" % json.dumps(agent_info, ensure_ascii=False))
        check(abs(float(agent_info.get("fixed_dt", 0)) - 0.0166666667) < 1e-6,
              "fixed_dt виден: %s" % agent_info.get("fixed_dt"))

        # --- 3. Согласованность с живыми фактами ----------------------------
        systems = caps.get("systems") or {}
        channels = a.eval("$.sound.channels()")
        check(systems.get("channels") == channels,
              "systems.channels = %s, движок говорит %s" % (systems.get("channels"), channels))
        check(systems.get("audio") == (channels > 0),
              "systems.audio согласован с числом каналов (%s)" % systems.get("audio"))
        check(systems.get("net") == (a.eval("typeof $.net") == "object"),
              "systems.net согласован с наличием $.net (%s)" % systems.get("net"))
        check(systems.get("physics") == (a.eval("typeof $.physics") == "object"),
              "systems.physics согласован (%s)" % systems.get("physics"))
        hrtf = a.eval("$.audio.hrtf()") or {}
        expect_hrtf = (hrtf.get("backend") or "synthetic") if hrtf.get("on") else False
        check(systems.get("hrtf") == expect_hrtf,
              "systems.hrtf = %r, фактический бэкенд %r (не «есть в сборке», а «работает»)"
              % (systems.get("hrtf"), expect_hrtf))
        check(systems.get("web") == (platform == "Emscripten"),
              "systems.web выведен из платформы: %s" % systems.get("web"))

        # --- 4. Разделение с has: списка имён здесь нет ---------------------
        check(caps.get("probe") == "has",
              "ответ сам говорит, чем спрашивать имена: probe=%r" % caps.get("probe"))
        longest = max([len(v) for v in caps.values() if isinstance(v, list)] or [0])
        check("names" not in caps and longest <= 8,
              "в capabilities нет списка имён (самый длинный массив — %d элементов)" % longest)
        check(size < 1024,
              "ответ маленький: %d Б (< 1 КБ; для сравнения полный список имён ≈60 КБ)" % size)

        # Точечный вопрос по имени — дешевле и по делу:
        one = a.cmd("has", names=["$.audio.captureStart"])
        one_size = len(json.dumps(one, ensure_ascii=False).encode("utf-8"))
        note("для сравнения: ответ has на одно имя — %d Б, capabilities — %d Б "
             "(в 16 пробах игры это было бы ≈%d Б)" % (one_size, size, 16 * one_size))
        check(one_size < 128, "ответ has остаётся точечным: %d Б" % one_size)

    print()
    if FAILURES:
        print("ПРОВАЛОВ: %d" % len(FAILURES))
        for f in FAILURES:
            print("  - " + f)
        return 1
    print("Все проверки пройдены")
    return 0


if __name__ == "__main__":
    sys.exit(main())
