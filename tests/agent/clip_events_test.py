#!/usr/bin/env python3
# ===========================================================================
# BASHNYA I3 (task-61): события клипа — кадр и «доиграл».
#
# Первичны события УЗЛА: `anim:frame` (с номером кадра) и `anim:end`
# (с числом оборотов). `onFrame`/`onEnd` в `$.clip.define(...)` — сахар,
# который подписывается на те же события: внутренний путь ОДИН.
#
# Проверяется числами: номера кадров, сколько раз сработал `anim:end` на
# проигрывание (loop:false), на каждый оборот (loop:true), что `off` снимает
# подписку, что удаление узла не оставляет обработчиков и сколько стоит
# подписка (мс на 1000 кадров анимации с подписками и без).
#
# Запуск:
#   python3 tests/agent/clip_events_test.py
#   R2D_BINARY=build-2d/russiano2d python3 tests/agent/clip_events_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

GAME = os.path.join("demos", "litsprites")
FAILURES = []
NUMBERS = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def number(text):
    NUMBERS.append(text)
    print("  --   " + text)


SPRITES = """[{ src: 'assets/atlas.png', x: 0, y: 0, w: 16, h: 16 },
             { src: 'assets/normal.png', x: 0, y: 0, w: 16, h: 16 }]"""


def main():
    with Agent(game=GAME, seed=5, fixed_dt=1.0 / 60.0) as a:
        a.step(5)

        # --- события узла: кадр и конец -------------------------------------
        a.eval("""globalThis.__pt = { frames: [], ends: [] };
            $.clip.define('walk', { frames: %s, fps: 10, loop: false,
                onFrame: (d) => globalThis.__pt.frames.push(d.frame_in_clip),
                onEnd: (d) => globalThis.__pt.ends.push(d.loops) });
            const n = $('<sprite>', { id: 'hero' }).size(32, 32).at(300, 300).appendTo($.world);
            globalThis.__node_frames = []; globalThis.__node_ends = [];
            n.on('anim:frame', (e) => globalThis.__node_frames.push(e.data.frame_in_clip));
            n.on('anim:end', (e) => globalThis.__node_ends.push(e.data.loops));
            n.animate({ clip: 'walk' });""" % SPRITES)
        a.step(20)
        frames = a.eval("globalThis.__pt.frames")
        ends = a.eval("globalThis.__pt.ends")
        node_frames = a.eval("globalThis.__node_frames")
        node_ends = a.eval("globalThis.__node_ends")
        number("кадры (сахар onFrame): %s" % frames)
        number("anim:end (сахар onEnd): %s | события узла: кадры %s, конец %s" % (ends, node_frames, node_ends))
        check(len(frames) >= 2 and frames[:2] == [0, 1],
              "onFrame несёт номер кадра: %s" % frames[:4])
        check(node_frames == frames, "события узла и сахар — один путь (одинаковые номера)")
        check(len(ends) == 1 and len(node_ends) == 1,
              "anim:end ровно один раз за проигрывание: %s / %s" % (ends, node_ends))

        # повторный запуск — снова ровно один раз
        a.eval("globalThis.__pt.ends = []; $('#hero').animate({ clip: 'walk' })")
        a.step(20)
        again = a.eval("globalThis.__pt.ends")
        check(again == [1], "повторный запуск даёт ещё одно событие: %s" % again)

        # --- loop: true — событие на каждый оборот --------------------------
        a.eval("""globalThis.__loops = [];
            $.clip.define('spin', { frames: %s, fps: 20, loop: true,
                onEnd: (d) => globalThis.__loops.push(d.loops) });
            $('#hero').animate({ clip: 'spin' });""" % SPRITES)
        a.step(30)
        loops = a.eval("globalThis.__loops")
        number("loop:true за 30 кадров при fps=20 → события: %s" % loops)
        check(len(loops) >= 2 and loops[:3] == [1, 2, 3][:len(loops[:3])],
              "на каждый оборот своё событие с номером: %s" % loops)

        # --- off и удаление узла -------------------------------------------
        a.eval("""globalThis.__after = 0;
            globalThis.__h = () => { globalThis.__after++; };
            $('#hero').on('anim:frame', globalThis.__h);""")
        a.step(5)
        with_h = a.eval("globalThis.__after")
        a.eval("$('#hero').off('anim:frame', globalThis.__h)")
        a.step(5)
        check(a.eval("globalThis.__after") == with_h, "off() снимает подписку: %s событий, потом ни одного" % with_h)

        removed_before = a.eval("globalThis.__pt.frames.length")
        a.eval("$('#hero').remove(); 1")
        a.step(10)
        check(a.eval("globalThis.__pt.frames.length") == removed_before,
              "после удаления узла события не идут (обработчиков не осталось)")
        check(a.eval("$.clip.remove('spin')") is True, "клип удаляется без ошибок")

        # --- цена подписки --------------------------------------------------
        def cost(with_listeners):
            code = """(() => {
                const nodes = [];
                for (let i = 0; i < 40; ++i) {
                    const n = $('<sprite>', { id: 'p' + i }).size(8, 8).at(20 + i, 60).appendTo($.world);
                    n.animate({ clip: 'walk' });
                    %s
                    nodes.push(n);
                }
                return nodes.length;
            })()""" % ("n.on('anim:frame', () => {});" if with_listeners else "")
            a.eval(code)
            import time
            started = time.perf_counter()
            for _ in range(25):
                a.step(2)
            ms = (time.perf_counter() - started) * 1000.0
            a.eval("(() => { for (const n of $('<sprite>').nodes.slice()) {} return 1; })()")
            a.eval("$('[id^=p]').remove(); 1")
            a.step(2)
            return ms

        plain = cost(False)
        subscribed = cost(True)
        number("цена: 40 узлов × 50 кадров — без подписок %.0f мс, с подписками %.0f мс" % (plain, subscribed))
        check(subscribed < plain * 3 + 50,
              "подписка не удорожает кадр кратно: %.0f против %.0f мс" % (subscribed, plain))

        check(a.ping().get("pong") is True, "движок отвечает")

    print()
    for line in NUMBERS:
        print("  --   " + line)
    print("\nВсе проверки пройдены" if not FAILURES else "\nПРОВАЛЕНО: %d" % len(FAILURES))
    for f in FAILURES:
        print("  - " + f)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
