#!/usr/bin/env python3
# ===========================================================================
# task-67 (r2dvfx), милстоуны M1/M5: реестр эффектов и управление.
#
# Проверяется факт, а не наличие имён:
#   * в реестре ≥ 20 готовых эффектов из docs/VFX_ROADMAP.md §D3;
#   * `play` возвращает хендл `{stop, seek, setRate, query}` и он реально
#     управляет эффектом;
#   * `spawn(node|point, spec)` играет спеку без регистрации;
#   * `$.vfx.stats()` показывает активные эффекты/частицы/эмиттеры/degraded;
#   * `load(path)` / `loadAll(dir)` читают спеки из данных через `$.fs`;
#   * M5: примитив `clip.<имя>` играет клип из ДВУХ листов.
#
# Модуль: src/highlevel/vfx.js.
#
# Запуск:
#   python3 tests/agent/vfx_registry_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, AgentError   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "vfx")

BUILTINS = [
    "hit.spark", "hit.metal", "hit.soft", "crit",
    "jump.dust", "land.dust", "dash.wind", "footstep",
    "torch.flame", "campfire", "magic.circle",
    "explosion", "shockwave", "slash", "parry",
    "fade", "flash.screen", "quake", "slowmo",
    "pickup", "quest.done", "warning",
]

PRIMITIVES = [
    "particles.preset", "particles.burst", "fx.flash", "fx.shake", "fx.hitStop",
    "fx.shockwave", "fx.lightning", "fx.pulse", "fx.ribbon", "fx.trail",
    "fx.attractor", "light.emitter", "sound.playBank", "layers.fadeTo",
]


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def ev(a, code, default=None):
    try:
        return a.eval(code)
    except AgentError as exc:
        print("  --   eval не выполнился: %s" % str(exc).splitlines()[0][:160])
        return default


def main():
    with Agent(game=GAME, seed=7) as a:
        a.step(3)

        # --- 1. Реестр --------------------------------------------------------
        names = ev(a, "$.vfx.list()", []) or []
        check(len(names) >= 20, "в реестре ≥ 20 эффектов (сейчас %d)" % len(names))
        missing = [n for n in BUILTINS if n not in names]
        check(not missing, "все эффекты §D3 в $.vfx.list (нет: %s)" % missing)
        check(ev(a, "JSON.stringify($.vfx.list())") ==
              ev(a, "JSON.stringify($.vfx.list().slice().sort())"),
              "$.vfx.list() отсортирован")

        spec_ok = True
        for name in BUILTINS:
            spec = ev(a, "$.vfx.get(%r)" % name)
            if not (isinstance(spec, dict) and spec.get("duration", 0) > 0
                    and isinstance(spec.get("layers"), list) and spec["layers"]):
                spec_ok = False
                print("  --   битая спека %s: %s" % (name, spec))
        check(spec_ok, "у каждого встроенного эффекта есть duration и layers")

        prims = ev(a, "$.vfx.primitives()", []) or []
        missing_prims = [p for p in PRIMITIVES if p not in prims]
        check(not missing_prims, "примитивы use: перечислены (нет: %s)" % missing_prims)
        check(any(p.startswith("shader.") for p in prims), "shader.<имя> в списке примитивов")
        check(any(p.startswith("clip.") for p in prims), "clip.<имя> в списке примитивов")

        # --- 2. play: хендл и управление -------------------------------------
        ev(a, "$.vfx.clear(); $.debug.clearErrors();")
        handle = ev(a, """
            (function(){
                $.vfx.define('vfx.test.handle', {
                    duration: 2.0, seed: 'handle',
                    budget: { particles: 0, light: 0 },
                    layers: [
                        { at: 0.0, use: 'fx.flash', params: { color: '#ffffff', ms: 40 } },
                        { at: 0.5, use: 'fx.pulse', params: { radius: 30, ms: 120 } },
                        { at: 1.5, use: 'fx.shockwave', params: { radius: 80 } },
                    ],
                });
                var h = $.vfx.play('vfx.test.handle', { at: [100, 100] });
                return { keys: Object.keys(h).sort(), time: h.query().time,
                         active: h.query().active };
            })()
        """, {})
        check(handle.get("keys") == ["query", "seek", "setRate", "stop"],
              "хендл отдаёт ровно stop/seek/setRate/query: %s" % handle.get("keys"))
        check(handle.get("active") is True, "свежий эффект активен")

        ev(a, "$.vfx._testHandle = $.vfx.play('vfx.test.handle', { at: [100, 100] });")
        a.step(10)
        q1 = ev(a, "$.vfx._testHandle.query()", {})
        check(0.0 < q1.get("time", -1) < 1.0,
              "время эффекта идёт по игровому dt (t=%.3f)" % q1.get("time", -1))
        check(0.0 < q1.get("progress", -1) < 1.0,
              "progress = t/duration (%s)" % q1.get("progress"))

        seek = ev(a, """
            (function(){
                var h = $.vfx.play('vfx.test.handle', { at: [0, 0] });
                h.seek(1.0);
                return h.query();
            })()
        """, {})
        check(abs(seek.get("time", -1) - 1.0) < 1e-6, "seek(1.0) ставит t=1.0")
        check(abs(seek.get("progress", -1) - 0.5) < 1e-6, "seek пересчитывает progress")

        rate = ev(a, """
            (function(){
                var h = $.vfx.play('vfx.test.handle', { at: [0, 0], rate: 2 });
                h.seek(0);
                h.setRate(2);
                return h.query();
            })()
        """, {})
        check(abs(rate.get("rate", -1) - 2) < 1e-6, "setRate(2) виден в query()")

        stopped = ev(a, """
            (function(){
                var h = $.vfx.play('vfx.test.handle', { at: [0, 0] });
                h.stop();
                return h.query();
            })()
        """, {})
        check(stopped.get("active") is False, "stop() гасит эффект")
        ev(a, "$.vfx.clear();")
        a.step(1)
        check(ev(a, "$.vfx.stats().effects") == 0, "clear() убирает активные эффекты")

        # --- 3. spawn без регистрации ---------------------------------------
        spawned = ev(a, """
            (function(){
                var h = $.vfx.spawn('#anchor', { duration: 0.2, seed: 'spawn',
                    budget: { particles: 0, light: 0 },
                    layers: [{ at: 0, use: 'fx.pulse',
                               params: { radius: 20, ms: 80 } }] });
                return { active: h.query().active, effects: $.vfx.stats().effects };
            })()
        """, {})
        check(spawned.get("active") is True and spawned.get("effects") == 1,
              "spawn(узел, спека) играет без регистрации: %s" % spawned)

        # --- 4. stats ---------------------------------------------------------
        st = ev(a, """
            (function(){
                $.vfx.clear();
                $.vfx.play('hit.spark', { at: [120, 160] });
                return $.vfx.stats();
            })()
        """, {})
        keys = ["effects", "particles", "emitters", "lights", "degraded",
                "skipped", "budget", "played"]
        check(all(k in st for k in keys), "stats() отдаёт %s" % keys)
        check(st.get("effects", 0) >= 1, "stats().effects видит живой эффект")
        check(st.get("particles", 0) > 0, "stats().particles учитывает бюджет искр")

        # --- 5. load / loadAll ------------------------------------------------
        loaded = ev(a, "$.vfx.load('data/hit.json')", None)
        check(isinstance(loaded, list) and "hit.json.spark" in loaded,
              "load(path) объявляет эффект из JSON: %s" % (loaded,))
        check(ev(a, "$.vfx.get('hit.json.spark') !== null") is True,
              "load(path) кладёт спеку в реестр")
        all_loaded = ev(a, "$.vfx.loadAll('data')", None)
        check(isinstance(all_loaded, list) and len(all_loaded) >= 2,
              "loadAll(каталог) читает манифест data/vfx.json: %s" % (all_loaded,))

        # --- 6. M5: clip.<имя> по кадрам из двух листов -----------------------
        ev(a, """
            $.vfx.define('vfx.test.clip', {
                duration: 0.6, seed: 'clip', budget: { particles: 0, light: 0 },
                layers: [{ at: 0, use: 'clip.vfx.twoSheets',
                           params: { scale: 2, class: 'vfx-clip' } }],
            });
        """)
        played = ev(a, """
            (function(){
                var h = $.vfx.play('vfx.test.clip', { at: [60, 60] });
                var n = $('.vfx-clip').get(0);
                return { active: h.query().active, count: $('.vfx-clip').length,
                         frames: n ? n.frames.length : -1,
                         frame0: n ? n.frame_index : -1 };
            })()
        """, {})
        check(played.get("count") == 1, "clip.<имя> завёл узел эффекта")
        check(played.get("frames") == 2, "эффект взял два кадра из двух листов")
        a.step(10)
        frame_a = ev(a, "$('.vfx-clip').length ? $('.vfx-clip').get(0).frame_index : -1")
        check(frame_a != played.get("frame0"), "кадр клипа реально меняется (%s → %s)"
              % (played.get("frame0"), frame_a))
        a.step(50)
        check(ev(a, "$('.vfx-clip').length") == 0,
              "узел клипа убирается по окончании эффекта")

        # --- 7. Смена сцены сбрасывает эффекты (resetFx из scene.js) ----------
        ev(a, """
            $.vfx.clear();
            $.vfx.play('flash.screen', { at: [0, 0] });
            $.scene.add('vfx.empty', { enter: function () {} });
            $.scene.load('vfx.empty', { transition: 'none', ms: 0 });
        """)
        a.step(2)
        check(ev(a, "$.vfx.stats().effects") == 0,
              "смена сцены сбрасывает активные эффекты через resetFx")
        a.step(5)

        check(a.ping().get("pong") is True, "движок отвечает после проверок")
        check(ev(a, "$.debug.report().clean") is True,
              "журнал чист по неустранимым ошибкам")

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    for line in FAILURES:
        print("  - " + line)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
