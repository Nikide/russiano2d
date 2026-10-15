#!/usr/bin/env python3
# ===========================================================================
# Фиксированный шаг и плавность кадра платформера.
#
# Проверяются три утверждения, а не «кажется плавно»:
#   1. `--fixed-dt` детерминирован: два одинаковых прогона (зерно, шаг, ввод)
#      дают побитово одинаковые положения игрока и камеры;
#   2. за кадр симуляция делает РОВНО один шаг: engine.dt == fixedDt, а
#      `$.time.now()` растёт на один и тот же шаг — значит рендер показывает
#      точный момент симуляции и интерполировать «между шагами» нечего;
#   3. картинка не дёргается: при постоянной скорости цели экранные приращения
#      камеры после разгона одинаковы (нет чередования «длинный/короткий шаг»),
#      и полный путь равен числу кадров × шаг × скорость.
#
# Запуск после сборки:
#   python3 tests/agent/highlevel_camera_fixedstep_test.py
# ===========================================================================

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

GAME = os.path.join("tests", "fixtures", "text")
DT = 1.0 / 60.0
SPEED = 200.0        # px/с: цель едет вправо в $.update
WARMUP = 40          # кадров разгона сглаживания камеры
WINDOW = 60          # кадров окна замера
FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


SCENE = """
    $.world.gravity(0, 0).color('#101820').bounds(-100000, 0, 200000, 600);
    $('#world').remove(); $('#hud').remove(); $('#go').remove();
    $('<sprite>', { id: 'runner', w: 16, h: 16 }).at(0, 300).appendTo($.world);
    $.camera.follow('#runner', { smooth: 0.3, lookahead: 64, lookaheadSmooth: 0 });
    $.update((dt) => { $('#runner').move(%f * dt, 0); });
""" % SPEED


def run(frames):
    """Прогон сцены и покадровая запись: (camera.x, runner.x, screen.x, dt, now)."""
    rows = []
    with Agent(game=GAME, seed=11, fixed_dt=DT) as a:
        a.eval(SCENE)
        a.step(2)
        for _ in range(frames):
            a.step(1)
            rows.append((
                float(a.eval("$.camera.x()")),
                float(a.eval("$('#runner').pos().x")),
                float(a.eval("$.camera.worldToScreen($('#runner')).x")),
                float(a.eval("engine.dt")),
                float(a.eval("$.time.now()")),
            ))
        state = json.dumps(a.eval("JSON.stringify($('#runner').pos())"))
        a.quit()
    return rows, state


def main():
    rows, state_a = run(WARMUP + WINDOW)

    # --- 2. Один шаг за кадр -------------------------------------------------
    # engine.dt — float32, поэтому сравнение с допуском, а не на равенство.
    steps = {round(r[3], 7) for r in rows}
    check(len(steps) == 1 and abs(next(iter(steps)) - DT) < 1e-6,
          f"engine.dt постоянен и равен fixedDt: {steps}")
    now = [r[4] for r in rows]
    deltas = [now[i + 1] - now[i] for i in range(len(now) - 1)]
    check(max(deltas) - min(deltas) < 1e-7,
          f"$.time.now() растёт на один и тот же шаг (разброс {max(deltas) - min(deltas):.2e})")
    check(abs(sum(deltas) / len(deltas) - DT) < 1e-6,
          "средний шаг времени равен fixedDt")

    # --- Позиция цели: точное кратное шага, без остатка ----------------------
    x0 = rows[0][1]
    step = SPEED * DT
    off = max(abs(r[1] - (x0 + step * i)) for i, r in enumerate(rows))
    check(off < 1e-3, f"цель двигается ровно на скорость × шаг (макс. отклонение {off:.2e})")

    # --- 3. Плавность: приращения камеры после разгона одинаковы -------------
    cam = [r[0] for r in rows]
    d = [cam[i + 1] - cam[i] for i in range(len(cam) - 1)]
    tail = d[-WINDOW // 2:]
    mean = sum(tail) / len(tail)
    spread = max(tail) - min(tail)
    print(f"  --   камера: приращение {mean:.6f} px/кадр, разброс {spread:.2e} px")
    check(abs(mean - SPEED * DT) < 0.01,
          f"после разгона камера едет со скоростью цели: {mean:.4f} px/кадр")
    check(spread < 1e-6, f"приращения одинаковы — дёрганья нет (разброс {spread:.2e})")

    # Цель на экране стоит на месте: камера компенсирует её движение ровно.
    screen = [r[2] for r in rows][-WINDOW // 2:]
    screen_spread = max(screen) - min(screen)
    print(f"  --   цель на экране: разброс {screen_spread:.2e} px")
    check(screen_spread < 1e-3, f"цель не «дрожит» на экране (разброс {screen_spread:.2e} px)")

    # --- 1. Детерминизм: второй прогон даёт тот же результат -----------------
    rows_b, state_b = run(WARMUP + WINDOW)
    check(state_a == state_b, f"позиция цели совпала побитово: {state_a}")
    same_camera = all(abs(x[0] - y[0]) < 1e-9 for x, y in zip(rows, rows_b))
    check(same_camera, "покадровые положения камеры совпали в двух прогонах")

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
