#!/usr/bin/env python3
# ===========================================================================
# task-67 (r2dvfx), милстоун M2: валидация спеки.
#
# Никакой тишины: опечатка в `use:` — ошибка R2D_VFX_UNKNOWN_PRIMITIVE со
# списком допустимых примитивов; битое поле спеки — R2D_VFX_BAD_SPEC с путём;
# функция внутри спеки — R2D_VFX_NOT_DATA. `extend` НЕ мутирует базу.
#
# Модуль: src/highlevel/vfx.js.
#
# Запуск:
#   python3 tests/agent/vfx_validation_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, AgentError   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "vfx")


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
    code = ("(function(){ try { %s ; return {ok:true}; }"
            " catch (e) { return {ok:false, code:String(e && e.code || ''),"
            " message:String(e && e.message || e), path:String(e && e.path || '')}; } })()"
            % body)
    return ev(a, code, {"ok": False, "code": "", "message": "eval failed"})


def main():
    with Agent(game=GAME, seed=7) as a:
        a.step(3)
        ev(a, "$.debug.clearErrors();")

        # --- 1. Опечатка в use: код + список допустимых ----------------------
        r = caught(a, "$.vfx.define('vfx.bad.use', { duration: 1, layers: ["
                       " { at: 0, use: 'fx.flsh', params: {} } ] })")
        check(r.get("ok") is False, "опечатка в use: ошибка, а не тишина")
        check(r.get("code") == "R2D_VFX_UNKNOWN_PRIMITIVE",
              "код R2D_VFX_UNKNOWN_PRIMITIVE (%s)" % r.get("code"))
        msg = str(r.get("message", ""))
        for word in ("fx.flsh", "fx.flash", "particles.burst", "sound.playBank"):
            check(word in msg, "сообщение называет %s" % word)
        entries = ev(a, "$.debug.errors('R2D_VFX_UNKNOWN_PRIMITIVE')", []) or []
        check(len(entries) >= 1, "ошибка попала в $.debug.errors()")
        check(ev(a, "$.vfx.get('vfx.bad.use')") is None,
              "невалидный define НЕ попал в реестр")

        # --- 2. Битые поля спеки ---------------------------------------------
        cases = [
            ("duration строкой",
             "$.vfx.define('vfx.bad.d', { duration: 'долго', layers: [] })",
             "R2D_VFX_BAD_SPEC", "duration"),
            ("duration ≤ 0",
             "$.vfx.define('vfx.bad.d2', { duration: 0, layers: [] })",
             "R2D_VFX_BAD_SPEC", "duration"),
            ("layers не массив",
             "$.vfx.define('vfx.bad.l', { duration: 1, layers: {} })",
             "R2D_VFX_BAD_SPEC", "layers"),
            ("at не число",
             "$.vfx.define('vfx.bad.a', { duration: 1, layers: [{ at: NaN, use: 'fx.flash' }] })",
             "R2D_VFX_BAD_SPEC", "at"),
            ("нет use",
             "$.vfx.define('vfx.bad.u', { duration: 1, layers: [{ at: 0 }] })",
             "R2D_VFX_BAD_SPEC", "use"),
            ("params не объект",
             "$.vfx.define('vfx.bad.p', { duration: 1, layers: [{ at: 0, use: 'fx.flash', params: 7 }] })",
             "R2D_VFX_BAD_SPEC", "params"),
            ("budget отрицательный",
             "$.vfx.define('vfx.bad.b', { duration: 1, budget: { particles: -5 }, layers: [] })",
             "R2D_VFX_BAD_SPEC", "budget"),
        ]
        for title, body, code, word in cases:
            r = caught(a, body)
            check(r.get("ok") is False and r.get("code") == code,
                  "%s → %s (%s)" % (title, code, r.get("code")))
            check(word in str(r.get("message", "")),
                  "%s: сообщение называет поле %r" % (title, word))

        # --- 3. Спека — чистые данные, функции запрещены ----------------------
        r = caught(a, "$.vfx.define('vfx.bad.fn', { duration: 1, layers: ["
                       " { at: 0, use: 'fx.flash', params: { done: function () {} } } ] })")
        check(r.get("code") == "R2D_VFX_NOT_DATA",
              "функция в params → R2D_VFX_NOT_DATA (%s)" % r.get("code"))
        check("function" in str(r.get("message", "")) or "функц" in str(r.get("message", "")),
              "сообщение объясняет запрет функций")

        # --- 4. Неизвестный эффект play ---------------------------------------
        r = caught(a, "$.vfx.play('vfx.no.such.effect')")
        check(r.get("code") == "R2D_VFX_UNKNOWN_EFFECT",
              "play неизвестного имени → R2D_VFX_UNKNOWN_EFFECT (%s)" % r.get("code"))
        check("hit.spark" in str(r.get("message", "")),
              "сообщение перечисляет известные эффекты")

        # --- 5. extend не мутирует базу ---------------------------------------
        r = ev(a, """
            (function(){
                $.vfx.define('vfx.base', {
                    duration: 1, seed: 'base', budget: { particles: 10, light: 1 },
                    layers: [{ at: 0, use: 'fx.flash', params: { ms: 50 } }],
                });
                var before = JSON.stringify($.vfx.get('vfx.base'));
                var ext = $.vfx.extend('vfx.base', {
                    duration: 2, budget: { light: 2 },
                    layers: [{ at: 0.5, use: 'fx.shockwave', params: { radius: 10 } }],
                });
                var after = JSON.stringify($.vfx.get('vfx.base'));
                return { before: before, after: after, ext: ext,
                         base_layers: $.vfx.get('vfx.base').layers.length };
            })()
        """, {})
        check(r.get("before") == r.get("after"), "extend не мутирует базу (JSON до = после)")
        ext = r.get("ext") or {}
        check(ext.get("duration") == 2, "extend перекрывает duration (2)")
        check((ext.get("budget") or {}).get("particles") == 10
              and (ext.get("budget") or {}).get("light") == 2,
              "extend сливает budget, а не затирает: %s" % (ext.get("budget"),))
        check(len(ext.get("layers") or []) == 2,
              "extend ДОБАВЛЯЕТ слои: %d" % len(ext.get("layers") or []))
        check(r.get("base_layers") == 1, "у базы остался один слой")

        # extend принимает и спеку-объект, а не только имя.
        r = caught(a, """
            var base = { duration: 1, budget: { particles: 1 },
                         layers: [{ at: 0, use: 'fx.flash' }] };
            var ext = $.vfx.extend(base, { layers: [{ at: 0.1, use: 'fx.pulse' }] });
            base.layers.push({ at: 0.2, use: 'fx.pulse' });
            if (ext.layers.length !== 2) throw new Error('extend разделяет массив с базой: ' +
                ext.layers.length);
        """)
        check(r.get("ok") is True,
              "extend(объект) не делит массивы с базой (%s)" % r.get("message"))

        # --- 6. Неизвестный клип в спеке — громко -----------------------------
        ev(a, "$.vfx.define('vfx.bad.clip', { duration: 0.2, budget: { particles: 0, light: 0 },"
               " layers: [{ at: 0, use: 'clip.no.such.clip' }] })")
        r = caught(a, "$.vfx.play('vfx.bad.clip', { at: [0, 0] })")
        check(r.get("code") == "R2D_VFX_UNKNOWN_CLIP",
              "неизвестный clip.<имя> → R2D_VFX_UNKNOWN_CLIP (%s)" % r.get("code"))
        check("vfx.twoSheets" in str(r.get("message", "")),
              "сообщение перечисляет известные клипы")

        check(a.ping().get("pong") is True, "движок отвечает после проверок")

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    for line in FAILURES:
        print("  - " + line)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
