#!/usr/bin/env python3
# ===========================================================================
# §30/§35 Спецификации: приёмка УСТАНОВЛЕННОГО профиля.
#
# Разница с остальными тестами: они проверяют исходники, а этот — то, что
# реально запускается. Проверяется главное обещание профиля «2D-платформер»:
# движок в конфигурации БЕЗ RE2D-authoring (R2D_ENABLE_RE2D=OFF) поднимает `$`,
# открывает игру и примеры, а заявленные подсистемы доступны игре.
#
# Это доказательство §35.3 «delivery: запуск установленного пакета» и §37
# «обычный 2D-профиль работает без зависимости от Re2D authoring».
#
# Запуск (нужна собранная OFF-конфигурация):
#   python3 tests/profile_2d_test.py
#   R2D_2D_BINARY=build-2d/russiano2d python3 tests/profile_2d_test.py
# ===========================================================================

import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(ROOT, "tools"))

from agent_client import Agent   # noqa: E402

BINARY = os.environ.get("R2D_2D_BINARY") or os.path.join("build-2d", "russiano2d")
FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


#: Подсистемы, которые обязана получить игра в 2D-профиле (все — через `$`).
REQUIRED_API = [
    "$.world", "$.camera", "$.input", "$.gfx", "$.ui", "$.particles", "$.sound",
    "$.time", "$.scene", "$.signal", "$.task", "$.save", "$.replay", "$.random",
    "$.agent", "$.debug", "$.trace", "$.combat", "$.hits", "$.tilemap",
    "$.loading", "$.resource", "$.prefab", "$.atlas", "$.anim", "$.processing",
    "$.activation", "$.triggers", "$.nav", "$.store", "$.physics",
]
#: Необязательные интеграции: их может не быть по решению платформы, и это не
#: провал профиля — проверяем отдельно и не требуем наличия.
OPTIONAL_API = ["$.steam"]

#: Подсистемы, которых в 2D-профиле быть НЕ должно (authoring 3D/Re2D).
FORBIDDEN_API = ["$.re2d", "$.rotsprite", "$.real2d", "$.cels", "$.mesh"]


def run(game, scene=None, steps=6):
    kwargs = dict(game=game, seed=11, fixed_dt=1.0 / 60.0, start_timeout=120)
    if scene:
        kwargs["scene"] = scene
    with Agent(binary=BINARY, **kwargs) as a:
        a.step(steps)
        booted = a.eval("typeof $")
        available = {name: a.eval("typeof " + name) for name in REQUIRED_API}
        forbidden = {name: a.eval("typeof " + name) for name in FORBIDDEN_API}
        optional = {name: a.eval("typeof " + name) for name in OPTIONAL_API}
        errors = [line for line in a.stderr_text().splitlines() if "$: ошибка" in line]
        frame = a.eval("engine.frame")
    return booted, available, forbidden, errors, frame, optional


def main():
    binary = os.path.join(ROOT, BINARY) if not os.path.isabs(BINARY) else BINARY
    print("== Профиль 2D (без RE2D authoring): %s ==" % BINARY)
    if not os.path.exists(binary):
        print("  пропуск: %s не собран (соберите: cmake -S . -B build-2d -DR2D_ENABLE_RE2D=OFF)" % BINARY)
        return 0

    # --- 1. Игра из репозитория поднимается ---------------------------------
    booted, available, forbidden, errors, frame, optional = run(os.path.join("game"))
    check(booted == "function", "движок поднял $ (typeof $ = %s)" % booted)
    check(isinstance(frame, int) and frame >= 5, "кадры идут (frame=%s)" % frame)
    missing = [name for name, kind in available.items() if kind in ("undefined", "string")]
    check(not missing, "подсистемы 2D-профиля доступны игре (нет: %s)" % (missing or "ничего"))
    leaked = [name for name, kind in forbidden.items() if kind == "object"]
    check(not leaked, "authoring-подсистем 3D в профиле нет (протекли: %s)" % (leaked or "ничего"))
    absent_optional = [name for name, kind in optional.items() if kind in ("undefined", "string")]
    if absent_optional:
        print("  ждёт: необязательные интеграции отсутствуют в этой сборке: %s" % absent_optional)
    check(not errors, "игра не пишет ошибок в stderr: %s" % errors[:2])

    # --- 2. Примеры работают в том же профиле --------------------------------
    for demo, scene in (("demos/foundations", None), ("demos/stress", "all")):
        if not os.path.exists(os.path.join(ROOT, demo)):
            print("  ждёт %s: примера ещё нет" % demo)
            continue
        booted, available, _forbidden, errors, frame, _optional = run(demo, scene)
        check(booted == "function", "%s: $ поднялся" % demo)
        check(isinstance(frame, int) and frame >= 5, "%s: кадры идут (frame=%s)" % (demo, frame))
        check(not errors, "%s: без ошибок игрового кода: %s" % (demo, errors[:2]))

    # --- 3. Возможности P0 доступны в профиле --------------------------------
    with Agent(binary=BINARY, game=os.path.join("game"), seed=11, fixed_dt=1.0 / 60.0,
               start_timeout=120) as a:
        a.step(4)
        facts = {
            "контексты ввода": a.eval("typeof $.input.context"),
            "виртуальный ввод": a.eval("typeof $.input.synthPress"),
            "потребление ввода": a.eval("typeof $.input.consume"),
            "области узла": a.eval("typeof $('#hero').area"),
            "локальные трансформы": a.eval("typeof $('#hero').localAt"),
            "стабильный nid": a.eval("typeof $('#hero').nid"),
            "структурированные ошибки": a.eval("typeof $.debug.reportError"),
            "экранное искажение": a.eval("typeof $.gfx.post"),
            "политики обработки": a.eval("typeof $.processing.set"),
            "наблюдение видимости": a.eval("typeof $.activation.watch"),
            "тики симуляции": a.eval("typeof $.time.everyTicks"),
            "снимок RNG": a.eval("typeof $.random.state"),
            "симплекс": a.eval("typeof $.random.simplex2D"),
            "боевая атака": a.eval("typeof $.combat.attack"),
        }
    bad = [name for name, kind in facts.items() if kind != "function"]
    check(not bad, "возможности P0 доступны в 2D-профиле (нет: %s)" % (bad or "ничего"))

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    for line in FAILURES:
        print("  - " + line)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
