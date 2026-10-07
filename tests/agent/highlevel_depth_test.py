#!/usr/bin/env python3
# ===========================================================================
# Тест z-буфера: он включён по умолчанию и НЕ меняет вид обычной сцены.
#
# Что проверяется:
#   * глубина включена сразу после старта и управляется из игры;
#   * кадр со спрайтами одинаков при включённом и выключенном тесте глубины
#     (главное: z-буфер не должен ломать прежнюю отрисовку — спрайты пишут
#     z = 0, поэтому порядок между ними сохраняется);
#   * повторное включение не роняет кадр и не теряет картинку.
#
# Запуск после сборки:
#   python3 tests/agent/highlevel_depth_test.py
# ===========================================================================

import hashlib
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

GAME = os.path.join("tests", "fixtures", "text")

FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def shot(a, path):
    a.cmd("screenshot", path=path)
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


def check_mesh_draw(a):
    """
    Меш заливается И рисуется. Раньше здесь стояла защита: отрисовка якобы
    роняла Metal. Причина была в отсутствии SDL_BindGPUIndexBuffer в
    r2d_render_draw_mesh — меш рисуется первым в проходе, а индексный буфер
    биндят участки спрайтов, то есть позже. Подробности и проверку по пикселям
    держит tests/agent/highlevel_mesh_test.py.
    """
    a.eval("""$.update(() => engine.submitMesh(new Float32Array([
        300,200,0.5, 0,0, 1,0,0,
        500,200,0.5, 1,0, 0,1,0,
        400,400,0.5, 0.5,1, 0,0,1])));""")
    a.step(3)
    info = json.loads(a.eval("JSON.stringify(engine.depthInfo())"))
    return info


def main():
    with Agent(game=os.path.join("tests", "fixtures", "text"), seed=5) as a:
        check(a.eval("$.gfx.depth()") is True, "глубина включена по умолчанию")
        check(a.eval("typeof engine.setDepth") == "function", "управление из игры есть")

        a.eval("$.world.color('#000000')")
        a.eval("""$('<sprite>', { id: 'big', w: 300, h: 300 })
            .sprite('assets/tiles.png').at(400, 300).appendTo($.world);""")
        a.step(3)
        on = shot(a, "/tmp/depth_on.png")

        check(a.eval("$.gfx.depth(false)") is False, "глубину можно выключить")
        a.step(3)
        off = shot(a, "/tmp/depth_off.png")
        check(on == off, "включённый z-буфер не меняет вид спрайтовой сцены")

        check(a.eval("$.gfx.depth(true)") is True, "глубину можно вернуть")
        a.step(3)
        again = shot(a, "/tmp/depth_again.png")
        check(again == on, "после возврата кадр тот же")

    with Agent(game=GAME, seed=5) as a:
        info = check_mesh_draw(a)
        check(info["meshBuf"] is True, "GPU-буфер меша создан")
        check(info["peak"] >= 3, f"вершины доехали до заливки (peak = {info['peak']})")
        check(info["uploads"] >= 1, f"заливок: {info['uploads']}")
        check(info["meshFrames"] >= 1, f"проход отрисовки выполнен ({info['meshFrames']})")
        check(info["blocked"] == 0, f"меш НЕ отключён защитой (blocked = {info['blocked']})")

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
