#!/usr/bin/env python3
# ===========================================================================
# Проверка катсцен в движке: ввод забирается, узлы идут, камера возвращается.
#
# Катсцена — это ДИРИЖЁР в текущей сцене: он забирает управление у игрока,
# ведёт любые узлы, двигает камеру и возвращает всё как было, не перезагружая
# мир. Здесь проверяется именно поведение, а не «метод существует».
#
# Запуск после сборки:
#   python3 tests/agent/highlevel_cutscene_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

GAME = os.path.join("tests", "fixtures", "cutscene")
FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


SCENE = """
$.cutscene.define('bridge', [
    { take: 'input' },
    { letterbox: 0.12 },
    { camera: { at: [1200, 300], zoom: 1.5, ms: 200 } },
    { walk: '#npc', to: [1000, 300], speed: 200, ms: 400 },
    { wait: 200 },
    { give: 'input' },
    { letterbox: 0 },
    { camera: 'restore', ms: 200 },
]);
"""


def main():
    with Agent(game=GAME, seed=5, fixed_dt=1.0 / 60.0) as a:
        check(a.eval("typeof $.cutscene") == "object", "$.cutscene подсистема есть")
        check(a.eval("$.cutscene.running()") is False, "до старта катсцена не идёт")
        check(a.eval("$.cutscene.blocking()") is False, "и ввод не забран")

        a.eval(SCENE)
        check(a.eval("$.cutscene.has('bridge')") is True, "сценарий описан")
        check(a.eval("$.cutscene.duration('bridge')") >= 800, "длительность посчитана")

        # Камера до катсцены: следит за игроком.
        cam_before = a.eval("$.camera.followed() ? $.camera.followed().nodes[0].id : null")
        check(cam_before == "hero", f"до катсцены камера следит за игроком: {cam_before}")

        check(a.eval("$.cutscene.play('bridge')") is True, "катсцена запущена")
        a.step(1)
        check(a.eval("$.cutscene.running()") is True, "катсцена идёт")
        check(a.eval("$.cutscene.blocking()") is True, "ввод забран")
        check(a.eval("$.input.taken()") is True, "$.input тоже видит гейт")
        check(a.eval("$('#hero').nodes[0].attrs.controls") is None,
              "признак управления с игрока снят")
        check(a.eval("$.cutscene.letterbox()") > 0, "полосы включены")

        # Пытаемся управлять игроком прямо во время катсцены: не должен сдвинуться.
        hero_before = a.eval("$('#hero').pos().x")
        a.key("Right", "down")
        a.step(4)
        hero_after = a.eval("$('#hero').pos().x")
        check(abs(hero_after - hero_before) < 0.5,
              f"игрок НЕ двигается, пока ввод забран (сдвиг {abs(hero_after - hero_before):.2f} px)")

        # NPC ведёт режиссёр.
        npc_before = a.eval("$('#npc').pos().x")
        a.step(20)
        npc_after = a.eval("$('#npc').pos().x")
        print(f"  npc: {npc_before:.0f} → {npc_after:.0f} (ведёт режиссёр)")
        check(npc_after > npc_before + 20, "режиссёр провёл NPC")

        # Камера уехала туда, куда сказал сценарий. ВАЖНО смотреть в СЕРЕДИНЕ
        # катсцены: последний шаг возвращает камеру, и после конца она снова
        # у игрока (это проверяется ниже отдельно).
        cam_moves = []
        for _ in range(25):
            a.step(1)
            cam_moves.append(a.eval("$.camera.x()"))
            if not a.eval("$.cutscene.running()"):
                break
        cam_max = max(cam_moves) if cam_moves else 0
        print(f"  камера: максимум x = {cam_max:.0f} (цель сценария — 1200)")
        check(cam_max > 900, f"камера доехала к точке сценария: максимум x = {cam_max:.0f}")

        # Доигрываем до конца.
        a.step(60)
        check(a.eval("$.cutscene.running()") is False, "катсцена закончилась")
        check(a.eval("$.cutscene.blocking()") is False, "ввод возвращён")
        check(a.eval("$.cutscene.letterbox()") == 0, "полосы убраны")

        # Управление вернулось именно игроку, а камера — к слежению за ним.
        check(a.eval("$('#hero').nodes[0].attrs.controls") is not None,
              "признак управления на игроке восстановлен")
        cam_after = a.eval("$.camera.followed() ? $.camera.followed().nodes[0].id : null")
        check(cam_after == "hero", f"камера снова следит за игроком: {cam_after}")

        # Теперь игрок снова слушается: отпускаем клавишу и жмём в другую сторону.
        a.key("Right", "up")
        a.key("Left", "down")
        h1 = a.eval("$('#hero').pos().x")
        a.step(6)
        h2 = a.eval("$('#hero').pos().x")
        a.key("Left", "up")
        check(h2 < h1 - 5, f"после катсцены игрок снова управляем ({h1:.0f} → {h2:.0f})")

        # Пропуск: шаг с skip пропускается целиком.
        a.eval("""
            $.cutscene.define('long', [
                { wait: 5000 },
                { ns: 'долгий' },
            ]);
            $.cutscene.define('short', [
                { wait: 100, skip: true },
                { ns: 'быстрый' },
            ]);
        """)
        a.eval("$.cutscene.play('short')")
        a.step(1)
        a.eval("$.cutscene.skip()")
        a.step(3)
        check(a.eval("$.cutscene.running()") is False,
              "скип завершил катсцену, не дожидаясь 100 мс")

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
