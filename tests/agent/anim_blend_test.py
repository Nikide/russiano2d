#!/usr/bin/env python3
# ===========================================================================
# Смешивание клипов $.anim: кроссфейд за время.
#
# До правки: $.anim.blend существует только у ТАЙМЛАЙНОВ (animplayer), а у
# клипов $.anim.define перехода между двумя клипами не было вообще
# ($.anim.crossfade/blendInfo — undefined, 0 определений).
#
# Проверяется на живом движке:
#   * отказы — понятной ошибкой (неизвестный клип, ms <= 0, пустая цель);
#   * доля смешивания по кадрам монотонна: t=0 — 100 % from, t=ms — 100 % to;
#   * значения дорожек ровно по формуле (1-t)*from + t*to;
#   * работа с --fixed-dt: шаг 50 мс → ровно 10 кадров на 500 мс;
#   * спрайтовые кадры дискретны (кадр берётся у клипа с большим весом);
#   * состояние опрашиваемо: $.anim.blendInfo() и хендл crossfade;
#   * события берутся у to-клипа; playClip/stopClip снимают переход.
#
# Запуск: python3 tests/agent/anim_blend_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

GAME = os.path.join("tests", "fixtures", "animblend")
FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def js(agent, code):
    """eval, который не роняет тест: исключение движка → {'__error': ...}."""
    try:
        return agent.eval(code)
    except Exception as error:            # noqa: BLE001 — нужен текст для отчёта
        return {"__error": str(error)}


def error_of(value):
    return value.get("__error", "") if isinstance(value, dict) else ""


def refusal(agent, call):
    return js(agent, "(function(){try{%s; return 'НЕТ ОШИБКИ';}"
                     "catch(e){return String(e && e.message ? e.message : e);}})()" % call)


def main():
    with Agent(game=GAME, seed=13, fixed_dt=1.0 / 60.0) as a:
        a.step(4)

        # --- 0. Имена есть ----------------------------------------------------
        check(a.eval("typeof $.anim.crossfade") == "function",
              "$.anim.crossfade объявлен (до правки — undefined)")
        check(a.eval("typeof $.anim.blendInfo") == "function",
              "$.anim.blendInfo объявлен (до правки — undefined)")

        # --- 1. Отказы говорят, что не так -----------------------------------
        msg = refusal(a, "$.anim.crossfade('#hero','НЕТ-ТАКОГО','run-pose',300)")
        check("НЕТ-ТАКОГО" in msg and not msg.startswith("{"),
              "неизвестный from-клип: ошибка называет клип (%r)" % msg[:120])
        msg = refusal(a, "$.anim.crossfade('#hero','idle-pose','НЕТ-ТАКОГО',300)")
        check("НЕТ-ТАКОГО" in msg, "неизвестный to-клип: ошибка называет клип")
        msg = refusal(a, "$.anim.crossfade('#hero','idle-pose','run-pose',0)")
        check("ms" in msg.lower(), "ms=0: ошибка про ms (%r)" % msg[:120])
        msg = refusal(a, "$.anim.crossfade('#nobody','idle-pose','run-pose',300)")
        check("#nobody" in msg, "пустая цель: ошибка называет селектор")
        msg = refusal(a, "$.anim.crossfade('#hero','idle-pose','idle-pose',300)")
        check("разн" in msg.lower() or "тот же" in msg.lower(),
              "один и тот же клип: ошибка объясняет, что смешивать нечего")

        # --- 2. t=0 — ровно 100 % from ----------------------------------------
        h = js(a, "globalThis.__h = $.anim.crossfade('#hero','idle-pose','run-pose',500);"
                  "[__h.query(), __h.progress(), __h.done(), "
                  "$('#hero').get(0).x, $('#hero').get(0).alpha, "
                  "$('#hero').get(0).scale_x]")
        if isinstance(h, list) and len(h) == 6:
            info, progress, done, x0, a0, s0 = h
            check(info and info.get("from") == "idle-pose" and info.get("to") == "run-pose",
                  "blendInfo: from/to названы (%s → %s)"
                  % (info and info.get("from"), info and info.get("to")))
            check(info and abs(info.get("t", -1)) < 1e-9,
                  "t=0 сразу после запуска (t=%r)" % (info and info.get("t")))
            check(info and abs(info.get("fromWeight", -1) - 1) < 1e-9
                  and abs(info.get("toWeight", -1)) < 1e-9,
                  "веса t=0: from=1, to=0 (%r/%r)"
                  % (info and info.get("fromWeight"), info and info.get("toWeight")))
            check(abs(progress) < 1e-9 and done is False,
                  "хендл: progress=0, done=false")
            check(abs(x0) < 1e-9 and abs(a0 - 1) < 1e-9 and abs(s0 - 1) < 1e-9,
                  "поза t=0 — ровно from (x=%.3f alpha=%.3f scale=%.3f)" % (x0, a0, s0))
        else:
            check(False, "кроссфейд не запустился: %r" % (h,))

        # --- 3. Доля монотонна, значения = (1-t)*from + t*to -------------------
        samples = []
        for _ in range(30):
            a.step(1)
            v = js(a, "[$.anim.blendInfo('#hero'), $('#hero').get(0).x, "
                      "$('#hero').get(0).alpha, $('#hero').get(0).scale_x]")
            if not isinstance(v, list):
                samples.append(None)
                continue
            samples.append(v)

        good = [s for s in samples if s and s[0]]
        ts = [s[0]["t"] for s in good]
        check(len(ts) >= 20, "blendInfo опрашивается по кадрам (%d замеров)" % len(ts))
        check(len(ts) > 1 and all(ts[i] <= ts[i + 1] + 1e-9 for i in range(len(ts) - 1)),
              "t монотонно не убывает (%d кадров)" % len(ts))
        check(len(good) > 0
              and all(abs(s[0]["fromWeight"] - (1 - s[0]["t"])) < 1e-9
                      and abs(s[0]["toWeight"] - s[0]["t"]) < 1e-9 for s in good),
              "веса по кадрам: from = 1-t, to = t")
        check(len(good) > 0
              and all(abs(s[2] - (1 - 0.8 * s[0]["t"])) < 1e-6 for s in good),
              "alpha = (1-t)*1 + t*0.2 на каждом кадре")
        check(len(good) > 0
              and all(abs(s[1] - 100 * s[0]["t"]) < 1e-6 for s in good),
              "x = (1-t)*0 + t*100 на каждом кадре")
        alphas = [s[2] for s in good]
        xs = [s[1] for s in good]
        check(len(alphas) > 1
              and all(alphas[i] >= alphas[i + 1] - 1e-9 for i in range(len(alphas) - 1))
              and alphas[-1] < alphas[0],
              "alpha убывает монотонно (%s)" % (
                  "%.3f → %.3f" % (alphas[0], alphas[-1]) if alphas else "нет замеров"))
        check(len(xs) > 1
              and all(xs[i] <= xs[i + 1] + 1e-9 for i in range(len(xs) - 1))
              and xs[-1] > xs[0],
              "x растёт монотонно (%s)" % (
                  "%.3f → %.3f" % (xs[0], xs[-1]) if xs else "нет замеров"))

        # --- 4. t=ms — ровно 100 % to, blendInfo → null -----------------------
        end = js(a, "[$.anim.blendInfo('#hero'), $('#hero').get(0).x, "
                    "$('#hero').get(0).alpha, $('#hero').get(0).scale_x, "
                    "$('#hero').isPlayingClip(), $('#hero').clipProgress(), "
                    "__h.done(), __h.query()]")
        if isinstance(end, list):
            check(end[0] is None, "после ms blendInfo → null (переход завершён)")
            check(abs(end[1] - 100) < 1e-6 and abs(end[2] - 0.2) < 1e-6
                  and abs(end[3] - 2) < 1e-6,
                  "поза t=ms — ровно to (x=%.3f alpha=%.3f scale=%.3f)"
                  % (end[1], end[2], end[3]))
            check(end[4] is True, "to-клип продолжает играть после перехода")
            check(end[5] is not None and 0.45 < end[5] < 0.55,
                  "время to-клипа шло вместе с переходом (progress=%.3f)" % (end[5] or 0))
            check(end[6] is True and end[7] is None, "хендл: done=true, query=null")
        else:
            check(False, "конец перехода не прочитан: %r" % (end,))

        check(a.eval("$.store.get('step', 0)") == 1,
              "событие to-клипа (step на 50 %) пришло ровно один раз")

        # --- 5. --fixed-dt 50 мс: ровно 10 кадров на 500 мс -------------------
        # Отдельный прогон: fixed-dt — часть контракта, а не «на глаз».
    with Agent(game=GAME, seed=13, fixed_dt=0.05) as a:
        a.step(3)
        first = js(a, "globalThis.__h2 = $.anim.crossfade('#hero','idle-pose','run-pose',500);"
                      "[__h2.progress(), __h2.query().t, $('#hero').get(0).alpha]")
        if isinstance(first, list):
            check(abs(first[0] - 0.0) < 1e-9, "fixed-dt 50 мс: старт t=0")
        a.step(1)
        t1 = js(a, "[$.anim.blendInfo('#hero').t, $('#hero').get(0).alpha]")
        check(isinstance(t1, list) and abs(t1[0] - 0.1) < 1e-6
              and abs(t1[1] - 0.92) < 1e-6,
              "fixed-dt 50 мс: за 1 кадр t=0.1, alpha=0.92 (%r)" % (t1,))
        frames = 1
        while frames < 12:
            a.step(1)
            frames += 1
            info = js(a, "$.anim.blendInfo('#hero')")
            if info is None:
                break
        check(frames == 10, "fixed-dt 50 мс: переход закончился ровно на 10-м кадре (%d)" % frames)
        tail = js(a, "[$('#hero').get(0).alpha, $.anim.blendInfo('#hero')]")
        check(isinstance(tail, list) and abs(tail[0] - 0.2) < 1e-6 and tail[1] is None,
              "fixed-dt 50 мс: к концу перехода 100 % to")

        # --- 6. Спрайтовые кадры дискретны -----------------------------------
        fx0 = a.eval("$('#fx').get(0).frame_index")
        check(fx0 == 0, "до перехода кадр from (frame_index=%r)" % fx0)
        js(a, "globalThis.__hf = $.anim.crossfade('#fx','frame-a','frame-b',300)")
        mid_lo = js(a, "(function(){let f=$('#fx').get(0); return f.frame_index;})()")
        check(mid_lo == 0, "t=0: кадр ещё from (%r)" % mid_lo)
        a.step(8)   # 8*50 = 400 мс > 300 — переход уже кончился
        after = a.eval("$('#fx').get(0).frame_index")
        check(after == 1, "после перехода кадр to (%r)" % after)
        # На середине (t≈0.4) ещё from, чуть позже — to: переход по весу.
        js(a, "globalThis.__hf2 = $.anim.crossfade('#fx','frame-a','frame-b',300)")
        a.step(2)   # 100 мс → t≈0.33
        lo = a.eval("$('#fx').get(0).frame_index")
        a.step(2)   # 200 мс → t≈0.67
        hi = a.eval("$('#fx').get(0).frame_index")
        check(lo == 0 and hi == 1,
              "кадровый клип дискретен по весу: t≈0.33 → from, t≈0.67 → to (%r/%r)"
              % (lo, hi))

        # --- 7. playClip/stopClip снимают переход -----------------------------
        js(a, "$.anim.crossfade('#hero','run-pose','idle-pose',400)")
        a.step(2)
        js(a, "$('#hero').playClip('idle-pose', { restart: true })")
        cancelled = js(a, "[$.anim.blendInfo('#hero'), $('#hero').isPlayingClip(), "
                          "$('#hero').get(0).alpha]")
        check(isinstance(cancelled, list) and cancelled[0] is None
              and cancelled[1] is True and abs(cancelled[2] - 1) < 1e-9,
              "playClip во время перехода снимает blend и сразу применяет клип")
        js(a, "$.anim.crossfade('#hero','idle-pose','run-pose',400)")
        js(a, "$('#hero').stopClip()")
        stopped = js(a, "[$.anim.blendInfo('#hero'), $('#hero').isPlayingClip()]")
        check(isinstance(stopped, list) and stopped[0] is None and stopped[1] is False,
              "stopClip во время перехода снимает и blend, и клип")

    print()
    if FAILURES:
        print("ПРОВАЛОВ: %d" % len(FAILURES))
        for failure in FAILURES:
            print("  - " + failure)
        return 1
    print("Все проверки пройдены")
    return 0


if __name__ == "__main__":
    sys.exit(main())
