#!/usr/bin/env python3
# ===========================================================================
# task-69 (M0): разделение `$.fx` на `$.sfx` + `$.vfx`.
#
# Проверяется три вещи, ровно как в §F2 docs/VFX_ROADMAP.md:
#   1. `$.fx.*` остаётся РАБОТАЮЩИМ алиасом: каждый старый вызов даёт те же
#      числа/состояние, что новый `$.vfx.*`;
#   2. предупреждение о старом имени приходит РОВНО ОДИН раз на сырую команду
#      (ключ дедупликации — `$.fx.flash`, а не текст сообщения);
#   3. звук удара живёт в `$.sfx`: `$.fx.impact` и `$.vfx.impact` зовут один и
#      тот же `$.sfx.play`.
#
# Модули: src/highlevel/fx.js (алиас), src/highlevel/vfx.js, src/highlevel/sfx.js.
#
# Запуск (после сборки):
#   python3 tests/agent/fx_split_mapping_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, AgentError   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "vfx")

#: Старое имя → новое имя. Ровно таблица F1 docs/VFX_ROADMAP.md.
MAPPING = [
    ("flash", "flash"),
    ("flashLeft", "flashLeft"),
    ("shockwave", "shockwave"),
    ("lightning", "lightning"),
    ("pulse", "pulse"),
    ("trail", "trail"),
    ("ribbon", "ribbon"),
    ("pushRibbon", "pushRibbon"),
    ("attractor", "attractor"),
    ("hitStop", "hitStop"),
    ("impact", "impact"),
    ("clear", "clear"),
    ("stats", "stats"),
]

#: Ни одно визуальное имя не должно жить в $.sfx (правило раздела).
VISUAL_IN_SFX = ["flash", "flashLeft", "shockwave", "lightning", "pulse", "trail",
                 "ribbon", "pushRibbon", "attractor", "hitStop", "impact", "clear",
                 "stats"]


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


def caught(a, body):
    """Выполнить body и вернуть {ok:true} либо {ok:false, code, message}."""
    code = ("(function(){ try { %s ; return {ok:true}; }"
            " catch (e) { return {ok:false, code:String(e && e.code || ''),"
            " message:String(e && e.message || e)}; } })()" % body)
    return ev(a, code, {"ok": False, "code": "", "message": "eval failed"})


def legacy_warnings(a, raw):
    """Сколько записей дедуплицированного предупреждения дано на raw-имя."""
    entries = ev(a, "$.debug.errors('R2D_FX_DEPRECATED')", []) or []
    return [e for e in entries if isinstance(e, dict)
            and (e.get("data") or {}).get("raw") == raw]


def reset(a):
    ev(a, "$.vfx.clear(); $.time.unfreeze();")
    ev(a, "$.debug.clearErrors();")


def main():
    with Agent(game=GAME, seed=7) as a:
        a.step(3)

        # --- 1. Пространства существуют и разложены по правилу ----------------
        check(ev(a, "typeof $.vfx") == "object", "$.vfx существует")
        check(ev(a, "typeof $.sfx") == "object", "$.sfx существует")
        check(ev(a, "typeof $.fx") == "object", "$.fx остался объектом-алиасом")

        names_ok = all(ev(a, "typeof $.fx.%s" % old) == "function" for old, _ in MAPPING)
        check(names_ok, "у $.fx остались ВСЕ старые методы (%d имён)" % len(MAPPING))
        new_ok = all(ev(a, "typeof $.vfx.%s" % new) == "function" for _, new in MAPPING)
        check(new_ok, "у $.vfx есть целевые методы (%d имён)" % len(MAPPING))

        visual_leaks = [name for name in VISUAL_IN_SFX
                        if ev(a, "typeof $.sfx.%s" % name) == "function"]
        check(not visual_leaks, "в $.sfx нет визуальных имён (найдено: %s)" % visual_leaks)

        # --- 2. Дедуплицированное предупреждение ------------------------------
        reset(a)
        ev(a, "$.fx.flash('#ff0000', { ms: 100 });"
               "$.fx.flash('#00ff00', { ms: 100 });")
        warn_flash = legacy_warnings(a, "$.fx.flash")
        check(len(warn_flash) == 1,
              "два вызова $.fx.flash дают ОДНО предупреждение (получено %d)"
              % len(warn_flash))
        ev(a, "$.fx.shockwave(10, 10); $.fx.shockwave(20, 20);")
        warn_wave = legacy_warnings(a, "$.fx.shockwave")
        check(len(warn_wave) == 1,
              "два вызова $.fx.shockwave дают одно предупреждение (получено %d)"
              % len(warn_wave))
        if warn_flash:
            text = str(warn_flash[0].get("message", ""))
            check("$.vfx.flash" in text,
                  "текст предупреждения называет замену: %s" % text[:120])

        # --- 3. Старый и новый вызов дают одинаковые числа --------------------
        # Вспышка экрана.
        reset(a)
        ev(a, "$.fx.flash('#ffffff', { ms: 200, alpha: 0.5 })")
        old_left = ev(a, "$.fx.flashLeft()")
        old_stats = ev(a, "$.fx.stats()", {})
        reset(a)
        ev(a, "$.vfx.flash('#ffffff', { ms: 200, alpha: 0.5 })")
        new_left = ev(a, "$.vfx.flashLeft()")
        new_stats = ev(a, "$.vfx.stats()", {})
        check(old_left == new_left == 200,
              "flash/flashLeft одинаковы (старое %s, новое %s)" % (old_left, new_left))
        check(old_stats.get("flashes") == new_stats.get("flashes") == 1,
              "flash оставляет одну вспышку по обоим именам")

        # Волна, импульс, молния, лента, поле.
        pairs = [
            ("$.fx.shockwave(10, 10, { radius: 50, ms: 300 })",
             "$.vfx.shockwave(10, 10, { radius: 50, ms: 300 })", "waves"),
            ("$.fx.pulse(10, 10, { radius: 20, ms: 100 })",
             "$.vfx.pulse(10, 10, { radius: 20, ms: 100 })", "pulses"),
            ("$.fx.lightning([0, 0], [40, 0], { life: 100 })",
             "$.vfx.lightning([0, 0], [40, 0], { life: 100 })", "bolts"),
            ("$.fx.ribbon([[0, 0], [30, 20]], { ms: 100 })",
             "$.vfx.ribbon([[0, 0], [30, 20]], { ms: 100 })", "trails"),
            ("$.fx.attractor(5, 5, { life: 300 })",
             "$.vfx.attractor(5, 5, { life: 300 })", "fields"),
            ("$.fx.trail('#anchor', { ms: 200 })",
             "$.vfx.trail('#anchor', { ms: 200 })", "trails"),
        ]
        for old_call, new_call, field in pairs:
            reset(a)
            ev(a, old_call)
            s_old = ev(a, "$.fx.stats()", {})
            reset(a)
            ev(a, new_call)
            s_new = ev(a, "$.vfx.stats()", {})
            check(s_old.get(field) == s_new.get(field) == 1,
                  "%s: старое и новое совпадают (%s=%s)" % (field, s_old.get(field),
                                                            s_new.get(field)))

        # Hit-stop одинаков: значение уходит в $.time одной и той же длиной.
        reset(a)
        ev(a, "$.fx.hitStop(90)")
        old_freeze = ev(a, "$.time.freezeLeft()")
        reset(a)
        ev(a, "$.vfx.hitStop(90)")
        new_freeze = ev(a, "$.time.freezeLeft()")
        check(round(old_freeze or -1) == round(new_freeze or -2) == 90,
              "hitStop одинаков (старое %s, новое %s)" % (old_freeze, new_freeze))

        # impact: та же волна и тот же микро-стоп.
        reset(a)
        ev(a, "$.fx.impact(30, 30, { radius: 70, shake: 0, hitStop: 50 })")
        old_impact = ev(a, "[$.fx.stats().waves, $.time.freezeLeft()]")
        reset(a)
        ev(a, "$.vfx.impact(30, 30, { radius: 70, shake: 0, hitStop: 50 })")
        new_impact = ev(a, "[$.vfx.stats().waves, $.time.freezeLeft()]")
        check(old_impact == new_impact,
              "impact даёт тот же кадр/состояние (%s vs %s)" % (old_impact, new_impact))

        # clear: оба имени чистят одно и то же состояние.
        reset(a)
        ev(a, "$.fx.shockwave(1, 1); $.fx.flash('#fff'); $.fx.clear()")
        old_clear = ev(a, "$.fx.stats()", {})
        reset(a)
        ev(a, "$.vfx.shockwave(1, 1); $.vfx.flash('#fff'); $.vfx.clear()")
        new_clear = ev(a, "$.vfx.stats()", {})
        same_zero = all(old_clear.get(k) == new_clear.get(k) == 0
                        for k in ("waves", "flashes", "pulses", "trails", "bolts", "fields"))
        check(same_zero, "clear обнуляет одинаковые счётчики")

        # --- 4. Звук: старый и новый impact зовут один $.sfx.play -------------
        calls = ev(a, """
            (function(){
                $.hits.preset('vfx.sound', { sound: 'hit', particles: null,
                    flash: null, screen: null, shake: 0, hitStop: 0,
                    knockback: 0, squash: 0 });
                var out = [];
                var orig = $.sfx.play;
                $.sfx.play = function (what, opts) {
                    out.push([String(what), opts && opts.bank !== undefined ? opts.bank : null]);
                    return 7;
                };
                $.vfx.clear();
                $.fx.impact(10, 10, { shake: 0, hitStop: 0, sound: 'vfx.sound' });
                $.vfx.impact(10, 10, { shake: 0, hitStop: 0, sound: 'vfx.sound' });
                $.sfx.play = orig;
                return out;
            })()
        """, [])
        check(len(calls) == 2 and calls[0] == calls[1],
              "impact старого и нового имени зовёт $.sfx.play одинаково: %s" % (calls,))

        # Пресеты — ОДИН реестр: список из $.sfx совпадает с $.hits.
        check(ev(a, "JSON.stringify($.sfx.presets().slice().sort())") ==
              ev(a, "JSON.stringify($.hits.presets().slice().sort())"),
              "$.sfx.presets() — тот же список, что $.hits.presets()")

        check(a.ping().get("pong") is True, "движок отвечает после проверок")

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    for line in FAILURES:
        print("  - " + line)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
