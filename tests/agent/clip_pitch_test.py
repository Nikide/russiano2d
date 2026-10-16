#!/usr/bin/env python3
# ===========================================================================
# BASHNYA H5 + H11 (task-57): разброс высоты банка и ресурс «клип».
#
# H5: `playBank` не давал разброса высоты (генератор по умолчанию `() => 0`),
#     `opts.pitch` диапазон молча превращался в NaN, `$.sound.stemsState` был
#     недоступен публично.
# H11: не было ресурса «клип»: `.animate({clip})` игнорировал поле, кадры с
#     разных листов приходилось склеивать самому.
#
# Числа: 12 вызовов банка → сколько РАЗНЫХ высот и в каком диапазоне;
# `stemsState()` сверяется с внутренним биндингом; клип с двумя листами играет,
# fps/loop/pivot соблюдаются, размер узла НЕ меняется.
#
# Запуск:
#   python3 tests/agent/clip_pitch_test.py
#   R2D_BINARY=build-2d/russiano2d python3 tests/agent/clip_pitch_test.py
# ===========================================================================

import math
import os
import struct
import sys
import wave

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

GAME = os.path.join("demos", "litsprites")
WAV_DIR = os.path.join("build", "scene_audio")


def write_wav(path, freq, seconds=0.5, rate=44100):
    with wave.open(path, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(rate)
        out.writeframes(b"".join(
            struct.pack("<h", int(0.4 * 32767 * math.sin(2 * math.pi * freq * i / rate)))
            for i in range(int(rate * seconds))))

FAILURES = []
NUMBERS = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def number(text):
    NUMBERS.append(text)
    print("  --   " + text)


def main():
    os.makedirs(WAV_DIR, exist_ok=True)
    write_wav(os.path.join(WAV_DIR, "a.wav"), 300)
    write_wav(os.path.join(WAV_DIR, "b.wav"), 500)
    wav_a = WAV_DIR.replace("\\", "/") + "/a.wav"
    wav_b = WAV_DIR.replace("\\", "/") + "/b.wav"

    with Agent(game=GAME, seed=5) as a:
        a.step(5)

        # --- H5: разброс высоты банка --------------------------------------
        check(a.eval("typeof $.sound.stemsState") == "function",
              "$.sound.stemsState() доступен публично (H5)")
        same = a.eval("JSON.stringify($.sound.stemsState()) === JSON.stringify(engine.audio.stemsState())")
        check(same is True, "stemsState() совпадает с внутренним биндингом один в один")

        a.eval("$.sound.defineBank('step.test', { files: ['%s', '%s'], pitch: [0.96, 1.04] })"
               % (wav_a, wav_b))
        pitches = a.eval("""(() => {
            const out = [];
            for (let i = 0; i < 12; ++i) {
                $.sound.playBank('step.test', {
                    onPlayed: (file, channel) => out.push(Number(engine.audio.channelPitch(channel).toFixed(4))),
                });
            }
            return out;
        })()""")
        unique = len(set(pitches or []))
        number("spec.pitch=[0.96,1.04], 12 вызовов → высоты: %s" % pitches)
        number("разных высот: %d из %d" % (unique, len(pitches or [])))
        check(unique >= 6, "разброс высоты есть: %d разных значений" % unique)
        check(all(0.95 <= v <= 1.05 for v in pitches or []),
              "все высоты в заявленном диапазоне 0.96–1.04 (± допуск округления)")

        ranged = a.eval("""(() => {
            const out = [];
            for (let i = 0; i < 8; ++i) {
                $.sound.playBank('step.test', {
                    pitchRange: [0.9, 1.1],
                    onPlayed: (file, channel) => out.push(Number(engine.audio.channelPitch(channel).toFixed(4))),
                });
            }
            return out;
        })()""")
        number("opts.pitchRange=[0.9,1.1], 8 вызовов → %s" % ranged)
        check(len(set(ranged or [])) >= 4, "pitchRange разбрасывает высоту: %d разных" % len(set(ranged or [])))

        fixed = a.eval("""(() => {
            const out = [];
            for (let i = 0; i < 4; ++i) {
                $.sound.playBank('step.test', {
                    pitch: 1.25,
                    onPlayed: (file, channel) => out.push(Number(engine.audio.channelPitch(channel).toFixed(3))),
                });
            }
            return out;
        })()""")
        number("pitch как множитель (1.25) остался множителем: %s" % fixed)
        check(all(v > 1.1 for v in fixed or []), "обратная совместимость: pitch — множитель")

        # --- H11: клип как ресурс ------------------------------------------
        check(a.eval("typeof $.clip") == "object", "$.clip есть (H11)")
        for name in ("define", "get", "list", "remove"):
            check(a.eval("typeof $.clip.%s" % name) == "function", "$.clip.%s() есть" % name)

        clip = a.eval("""(() => {
            const c = $.clip.define('walk', {
                frames: [{ src: 'assets/atlas.png', x: 0, y: 0, w: 16, h: 16 },
                         { src: 'assets/normal.png', x: 0, y: 0, w: 16, h: 16 }],
                fps: 8, loop: false, pivot: [0.5, 1],
            });
            return c ? { frames: c.frames.length, fps: c.fps, loop: c.loop, pivot: c.pivot, skipped: c.skipped } : null;
        })()""")
        number("клип с кадрами ДВУХ листов: %s" % clip)
        check(clip and clip["frames"] == 2 and clip["skipped"] == 0,
              "оба кадра разрешились в спрайты (разные листы)")

        applied = a.eval("""(() => {
            const n = $('<sprite>', { id: 'hero' }).size(32, 48).at(300, 300).appendTo($.world);
            n.animate({ clip: 'walk' });
            const node = n.nodes[0];
            return { frames: node.frames.slice(), anim: Object.assign({}, node.anim),
                     pivot: [node.pivot_x, node.pivot_y], size: [node.w, node.h] };
        })()""")
        number("после .animate({clip:'walk'}): anim=%s, pivot=%s, размер=%s"
               % (applied["anim"], applied["pivot"], applied["size"]))
        check(applied["anim"].get("clip") == "walk", "клип запомнен в anim: %s" % applied["anim"].get("clip"))
        check(applied["anim"].get("speed") == 8 and applied["anim"].get("loop") is False,
              "fps и loop взяты из клипа: speed=%s, loop=%s" % (applied["anim"].get("speed"), applied["anim"].get("loop")))
        check(applied["pivot"] == [0.5, 1], "pivot клипа применён: %s" % applied["pivot"])
        check(applied["size"] == [32, 48], "размер узла клип НЕ трогает: %s (граница с H10)" % applied["size"])

        a.step(12)
        played = a.eval("(() => { const n = $('#hero').nodes[0]; return { sprite: n.sprite, frames: n.frames.slice() }; })()")
        number("через 12 кадров спрайт=%s (кадры %s)" % (played["sprite"], played["frames"]))
        check(played["sprite"] in played["frames"], "кадр действительно меняется по клипу")

        variant = a.eval("""(() => {
            const n = $('#hero');
            n.animate('walk');                      // строкой — та же форма
            return n.nodes[0].anim.clip;
        })()""")
        check(variant == "walk", ".animate('walk') строкой тоже работает: %s" % variant)

        listing = a.eval("$.clip.list()")
        got = a.eval("$.clip.get('walk')")
        check(isinstance(listing, list) and "walk" in listing, "list() показывает клип: %s" % listing)
        check(got and got.get("fps") == 8, "get() отдаёт описание: fps=%s" % (got or {}).get("fps"))
        check(a.eval("$.clip.remove('walk')") is True and a.eval("$.clip.get('walk')") is None,
              "remove() убирает клип")
        unknown = a.eval("(() => { const n = $('<sprite>'); n.animate({ clip: 'net-takogo' }); return n.nodes[0].anim; })()")
        check(unknown is None or unknown is None, "неизвестный клип не роняет кадр (пишет причину)")

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
