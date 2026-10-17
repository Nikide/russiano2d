#!/usr/bin/env python3
# ===========================================================================
# task-65: приёмка смены сцены — переключатель, экран загрузки, отмена, свет.
#
# Проверяется на живом движке, с числами:
#   * A0.1 `change()` и `load()` дают одинаковый результат;
#   * A0.2 пять запросов в одном кадре = ОДИН переход, промежуточные сцены не
#     входят, событие before-change одно;
#   * A0.3 `$.scene.state()` отражает фазу/время/ratio, после — phase null;
#   * A0.4 `scene:before-change`/`scene:progress`/`scene:after-change`/`scene:error`;
#   * A0.5 падение загрузки не оставляет пустой мир: прежняя сцена жива,
#     затемнение снято, ошибка в `$.debug.errors()`;
#   * A0.6 `prepare()` + `promote()` — мгновенно и без повторного enter;
#   * A1 встроенный экран загрузки: полоса растёт по реальным шагам
#     (монотонно), экран виден ≥ min_loading_ms, мир на паузе, звук глушён;
#     свой RML реально показывается; timeout даёт R2D_SCENE_LOAD_TIMEOUT;
#   * A3 смена сцены сбрасывает глобальный свет и темноту, `keep_light`
#     сохраняет их (falling test на старом коде — двойное затемнение);
#   * A4 `cancel()` возвращает прежнюю сцену и гасит затемнение.
#
# Фикстура tests/fixtures/scene_change. Запуск:
#   python3 tests/agent/scene_change_test.py
# ===========================================================================

import json
import os
import sys

from PIL import Image

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

GAME = os.path.join("tests", "fixtures", "scene_change")
FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def ev(a):
    return a.eval("JSON.parse(JSON.stringify(__ev))")


def reset(a, keep_frames=False):
    a.eval("(() => { const e = __ev; e.before = []; e.after = []; e.error = [];"
           " e.progress = []; e.enter = []; e.exit = [];"
           + ("" if keep_frames else " e.loading_frames = 0; e.paused_frames = 0; e.muted_frames = 0;")
           + " return 1; })()")


def alive(a, selector):
    return a.eval(f"(() => {{ const n = $('{selector}').get(0); return !!n && !n.removed; }})()")


def main():
    with Agent(game=GAME, seed=3, fixed_dt=1.0 / 60.0) as a:
        a.step(2)
        check(a.eval("$.scene.current()") == "a",
              f"стартовая сцена: {a.eval('$.scene.current()')}")

        # --- A0.1: load и change одинаковы ---------------------------------
        a.eval("$.scene.load('b', { transition: 'none' })")
        a.step(2)
        node_b = a.eval("$('#node_b').length")
        check(a.eval("$.scene.current()") == "b",
              f"A0.1 load привёл в b ({a.eval('$.scene.current()')}), узлов node_b={node_b}")
        a.eval("$.scene.change('a', { transition: 'none' })")
        a.step(2)
        check(a.eval("$.scene.current()") == "a",
              f"A0.1 change привёл в a ({a.eval('$.scene.current()')})")
        check(a.eval("$('#node_a').length") == 1,
              "A0.1 у сцены a есть свой узел")

        # --- A0.2: склейка рапидных запросов --------------------------------
        reset(a)
        a.eval("['b','c','b','c','b'].forEach((n) => $.scene.change(n, { ms: 300 }))")
        st = a.eval("$.scene.state()")
        check(st["pending"] == "b" and st["phase"] == "out" and st["from"] == "a",
              f"A0.2 в одном кадре остался один переход на b: {st}")
        check(a.eval("$.scene.busy()") is True, "A0.2 busy() во время перехода")
        check(len(ev(a)["enter"]) == 0, "A0.2 до затемнения ни одна сцена не вошла")
        a.step(22)
        events = ev(a)
        check(a.eval("$.scene.current()") == "b",
              f"A0.2 после затемнения сцена b ({a.eval('$.scene.current()')})")
        check(events["enter"] == ["b"], f"A0.2 вошла ровно одна сцена: {events['enter']}")
        check(events["exit"] == ["a"], f"A0.2 вышла ровно одна сцена: {events['exit']}")
        check(len(events["before"]) == 1,
              f"A0.2 одно scene:before-change: {len(events['before'])}")
        a.step(25)
        check(a.eval("$.scene.busy()") is False and a.eval("$.scene.state()")["phase"] is None,
              "A0.2 после перехода busy() false, phase null")

        # --- A0.3: наблюдаемый переход --------------------------------------
        a.eval("$.scene.change('c', { ms: 300 })")
        st = a.eval("$.scene.state()")
        check(st["from"] == "b" and st["to"] == "c" and st["phase"] == "out" and st["t"] == 0,
              f"A0.3 старт перехода: {st}")
        a.step(5)
        mid = a.eval("$.scene.state()")
        check(mid["phase"] == "out" and 0.1 < mid["ratio"] < 0.9,
              f"A0.3 ratio посередине затемнения: {mid['ratio']:.3f}")
        a.step(19)
        tail = a.eval("$.scene.state()")
        check(a.eval("$.scene.current()") == "c" and tail["phase"] == "in",
              f"A0.3 вход в c и фаза in: {tail}")
        a.step(25)
        done = a.eval("$.scene.state()")
        check(done["phase"] is None and a.eval("$.scene.busy()") is False,
              f"A0.3 после перехода phase null: {done}")

        # --- A0.4: события жизненного цикла ---------------------------------
        reset(a)
        a.eval("$.scene.change('a', { transition: 'none' })")
        a.step(2)
        e = ev(a)
        check(len(e["before"]) == 1 and e["before"][0]["from"] == "c" and e["before"][0]["to"] == "a",
              f"A0.4 before-change: {e['before']}")
        check(len(e["after"]) == 1 and e["after"][0]["from"] == "c" and e["after"][0]["to"] == "a",
              f"A0.4 after-change: {e['after']}")

        # --- A0.5: падение загрузки не оставляет пустой мир -----------------
        reset(a)
        nodes_before = a.eval("$.scene.counts().nodes")
        a.eval("$.scene.change('async', { loading: true, ms: 0, timeout_ms: 5000,"
               " resources: ['no_such_asset_zzz.png'] })")
        a.step(8)
        e = ev(a)
        nodes_after = a.eval("$.scene.counts().nodes")
        check(a.eval("$.scene.current()") == "a",
              f"A0.5 сцена прежняя после отказа: {a.eval('$.scene.current()')}")
        check(alive(a, "#node_a") is True, "A0.5 узел прежней сцены жив")
        check(nodes_after >= nodes_before,
              f"A0.5 узлы не пропали: {nodes_before} → {nodes_after}")
        check(len(e["error"]) == 1,
              f"A0.5 пришло одно scene:error: {e['error']}")
        check(e["error"] and str(e["error"][0]["code"]).startswith("R2D_"),
              f"A0.5 код ошибки структурный: {e['error']}")
        check(a.eval("$.scene.busy()") is False and a.eval("$.scene.state()")["phase"] is None,
              "A0.5 затемнение снято, busy() false")
        check(a.eval("$.loading.visible()") is False, "A0.5 экран загрузки убран")
        errors = a.eval("$.debug.errors()")
        codes = [str(item.get("code")) for item in errors if isinstance(item, dict)]
        check(any(code.startswith("R2D_") for code in codes[-6:]),
              f"A0.5 ошибка попала в $.debug.errors(): {codes[-6:]}")

        # --- A1: экран загрузки, реальные шаги, min_loading_ms, пауза -------
        reset(a)
        a.eval("$.scene.loading({ rml: null, theme: null, min_ms: 0, timeout_ms: 0 })")
        a.eval("$.scene.change('async', { loading: true, ms: 0, min_loading_ms: 200,"
               " steps: ["
               "   { label: 'один', total: 40, budget: 1, work: () => { __ev.steps++; } },"
               "   { label: 'два',  total: 10, budget: 1, work: () => { __ev.steps++; } }"
               " ] })")
        a.step(45)
        e = ev(a)
        ratios = [p["ratio"] for p in e["progress"]]
        monotone = all(b >= a2 - 1e-9 for a2, b in zip(ratios, ratios[1:]))
        check(a.eval("$.scene.current()") == "async",
              f"A1 после загрузки сцена async: {a.eval('$.scene.current()')}")
        check(e["steps"] == 50, f"A1 шаги реально выполнены: {e['steps']}")
        check(len(ratios) > 0 and ratios[-1] == 1,
              f"A1 прогресс дошёл до 1: {ratios[-1] if ratios else None}")
        check(monotone, f"A1 прогресс монотонный: {[round(r, 2) for r in ratios[:8]]}…")
        totals = [p["total"] for p in e["progress"]]
        check(totals and max(totals) == 50,
              f"A1 total шагов в событиях: {totals[:3]}…{totals[-3:] if totals else []}")
        # 200 мс при 60 fps — 12 кадров; последний кадр уже после publish,
        # поэтому «видимых» кадров 11, а длительность экрана ≥ 200 мс.
        check(e["loading_frames"] >= 11,
              f"A1 экран виден ≥ min_loading_ms (200 мс): кадров {e['loading_frames']}")
        check(e["paused_frames"] >= 10,
              f"A1 мир на паузе во время загрузки: кадров {e['paused_frames']}")
        check(e["muted_frames"] >= 10,
              f"A1 звук заглушён во время загрузки: кадров {e['muted_frames']}")
        check(a.eval("$.time.isPaused()") is False and a.eval("$.sound.mute()") is False,
              "A1 после загрузки пауза и mute сняты")

        # --- A1: свой RML ---------------------------------------------------
        reset(a)
        a.eval("$.scene.loading({ rml: 'ui/loading.rml' })")
        a.eval("$.scene.change('a', { loading: true, ms: 0, min_loading_ms: 200, timeout_ms: 4000,"
               " steps: [{ label: 'свой', total: 30, budget: 1, work: () => { __ev.steps++; } }] })")
        a.step(4)
        rect = a.eval("(() => { const d = $.ui.doc('ui/loading.rml');"
                      " const r = d.layoutRect('loading_progress');"
                      " return r ? { w: r.w, h: r.h, text: d.content('loading_progress') } : null; })()")
        check(rect is not None and rect["w"] > 0 and rect["h"] > 0,
              f"A1 свой RML показан (loading_progress виден): {rect}")
        check(bool(rect and rect["text"] and "%" in rect["text"]),
              f"A1 в свой RML пишется прогресс: {rect and rect['text']}")
        a.step(45)
        hidden = a.eval("(() => { const d = $.ui.doc('ui/loading.rml');"
                        " return d.rect('loading_progress'); })()")
        check(hidden is None, f"A1 после загрузки свой RML скрыт: {hidden}")
        check(a.eval("$.scene.current()") == "a", "A1 свой RML не сломал переход")
        a.eval("$.scene.loading({ rml: null })")

        # --- A1: timeout ----------------------------------------------------
        reset(a)
        a.eval("$.scene.change('async', { loading: true, ms: 0, timeout_ms: 100,"
               " steps: [{ label: 'вечный', total: 100000, budget: 1, work: () => {} }] })")
        a.step(12)
        e = ev(a)
        check(a.eval("$.scene.current()") == "a",
              f"A1 timeout: сцена прежняя ({a.eval('$.scene.current()')})")
        check(any(err["code"] == "R2D_SCENE_LOAD_TIMEOUT" for err in e["error"]),
              f"A1 timeout дал R2D_SCENE_LOAD_TIMEOUT: {e['error']}")
        check(a.eval("$.scene.busy()") is False, "A1 timeout снял затемнение")

        # --- A2: переходы кроме fade (шторка, шахматка, shader) -------------
        reset(a)
        a.eval("$.scene.change('b', { transition: 'wipe', dir: 'left', soft: 0.15, ms: 300 })")
        a.step(6)
        st = a.eval("$.scene.state()")
        shot = a.screenshot(os.path.join("build", "scene_wipe.png"))
        img = Image.open(shot).convert("L")
        w, h = img.size
        left = img.getpixel((10, h // 2))
        right = img.getpixel((w - 10, h // 2))
        dark_share = sum(1 for v in img.getdata() if v < 80) / float(w * h)
        check(st["phase"] == "out" and 0.2 < st["ratio"] < 0.6,
              f"A2 шторка идёт в фазе out: {st['phase']} ratio={st['ratio']:.2f}")
        check(left < 60 and right > 180,
              f"A2 шторка закрыла левую часть, правая светлая: {left} / {right}")
        check(0.15 < dark_share < 0.65,
              f"A2 доля закрытого кадра у шторки: {dark_share:.2f}")
        a.step(30)

        a.eval("$.scene.change('a', { transition: 'checker', cols: 6, rows: 6, ms: 300 })")
        a.step(9)
        st = a.eval("$.scene.state()")
        shot = a.screenshot(os.path.join("build", "scene_checker.png"))
        img = Image.open(shot).convert("L")
        w, h = img.size
        tl = img.getpixel((w // 12, h // 12))
        br = img.getpixel((w - w // 12, h - h // 12))
        greys = [v for v in img.getdata()]
        dark = sum(1 for v in greys if v < 80) / float(len(greys))
        light = sum(1 for v in greys if v > 180) / float(len(greys))
        check(st["phase"] == "out", f"A2 шахматка в фазе out: {st['phase']}")
        check(tl < 80 and br > 180,
              f"A2 шахматка идёт по диагонали (левый верх тёмный, правый низ светлый): {tl} / {br}")
        check(dark > 0.1 and light > 0.1,
              f"A2 в шахматке есть и закрытые, и открытые клетки: {dark:.2f} / {light:.2f}")
        a.step(30)

        # Стоимость перехода: рендер кадра со шторкой против обычного кадра.
        reset(a)
        a.eval("$.scene.change('b', { transition: 'wipe', ms: 600 })")
        a.step(4)
        wipe_ms = a.eval(
            "(() => { const t0 = performance.now(); for (let i = 0; i < 30; i++) $.gfx._render();"
            " return (performance.now() - t0) / 30; })()")
        a.eval("$.scene.cancel()")
        a.step(40)
        plain_ms = a.eval(
            "(() => { const t0 = performance.now(); for (let i = 0; i < 30; i++) $.gfx._render();"
            " return (performance.now() - t0) / 30; })()")
        check(wipe_ms - plain_ms <= 1.0,
              f"A2 переход ≤1 мс на кадр: шторка {wipe_ms:.2f} мс против {plain_ms:.2f} мс без перехода")

        # shader-переход: наш пост-проход, настройки игры возвращаются.
        reset(a)
        before_post = a.eval("$.gfx.post()")
        a.eval("$.scene.change('b', { transition: 'shader', name: 'wave', ms: 300 })")
        a.step(5)
        mid_post = a.eval("$.gfx.post()")
        check(mid_post.get("distort", 0) > 0,
              f"A2 shader-переход включил пост-эффект: distort={mid_post.get('distort')}")
        a.step(40)
        after_post = a.eval("$.gfx.post()")
        check(abs(after_post.get("distort", 0)) < 1e-6,
              f"A2 после shader-перехода пост возвращён: distort={after_post.get('distort')}")
        check(a.eval("$.scene.busy()") is False and a.eval("$.scene.current()") == "b",
              "A2 shader-переход дошёл до новой сцены")

        # Неизвестный тип — честная ошибка и fade, а не тишина.
        reset(a)
        a.eval("$.scene.change('a', { transition: 'zigzag', ms: 100 })")
        codes = [str(e.get("code")) for e in a.eval("$.debug.errors()")]
        check(any(c == "R2D_SCENE_TRANSITION_UNKNOWN" for c in codes[-4:]),
              f"A2 неизвестный переход даёт R2D_SCENE_TRANSITION_UNKNOWN: {codes[-4:]}")
        st = a.eval("$.scene.state()")
        check(st["phase"] == "out", f"A2 неизвестный переход заменён на fade: {st['phase']}")
        a.step(40)

        # --- A3: свет и темнота сбрасываются, keep_light сохраняет ----------
        a.eval("$.scene.change('lit', { transition: 'none' })")
        a.step(2)
        lit = a.eval("({ ambient: $.gfx.light.ambient(), map: $.gfx.light.map() })")
        check(lit["ambient"] is not None and lit["map"]["on"] is True,
              f"A3 сцена lit включила свет: {lit}")
        a.eval("$.scene.change('a', { transition: 'none' })")
        a.step(2)
        after = a.eval("({ ambient: $.gfx.light.ambient(), map: $.gfx.light.map() })")
        check(after["ambient"] is None and after["map"]["on"] is False,
              f"A3 свет и темнота сброшены: {after}")
        a.eval("$.scene.change('lit', { transition: 'none' })")
        a.step(2)
        a.eval("$.scene.change('b', { transition: 'none', keep_light: true })")
        a.step(2)
        kept = a.eval("({ ambient: $.gfx.light.ambient(), map: $.gfx.light.map() })")
        check(kept["ambient"] is not None and kept["map"]["on"] is True,
              f"A3 keep_light:true сохранил свет: {kept}")
        a.eval("$.gfx.light.ambient.off(); $.gfx.light.map({ on: false }); 'ok'")

        # --- A0.6: prepare + promote ---------------------------------------
        reset(a)
        a.eval("$.scene.change('a', { transition: 'none' })")
        a.step(2)
        prepared = a.eval("(() => { const h = $.scene.prepare('prepared');"
                          " return { ok: h.ok, stage: h.stage }; })()")
        check(prepared["ok"] is True, f"A0.6 prepare удался: {prepared}")
        st = a.eval("$.scene.state()")
        check(st["prepared"] == ["prepared"] and a.eval("$.scene.current()") == "a",
              f"A0.6 подготовленная сцена в state, но не показана: {st}")
        a.eval("$.scene.promote('prepared')")
        e = ev(a)
        check(a.eval("$.scene.current()") == "prepared",
              f"A0.6 promote без кадра показал сцену: {a.eval('$.scene.current()')}")
        check(e["enter"].count("prepared") == 1,
              f"A0.6 enter выполнен один раз (без повторной сборки): {e['enter']}")
        check(alive(a, "#node_prepared") is True, "A0.6 узел подготовленной сцены жив")

        # --- A4: отмена перехода -------------------------------------------
        reset(a)
        a.eval("$.scene.change('c', { ms: 300 })")
        a.step(5)
        alpha_mid = a.eval("$.scene._transitionAlpha()")
        cancelled = a.eval("$.scene.cancel('передумали')")
        st = a.eval("$.scene.state()")
        check(cancelled is True and 0.1 < alpha_mid < 0.6,
              f"A4 отмена на затемнении: alpha={alpha_mid:.3f}, cancel={cancelled}")
        check(st["pending"] is None and st["phase"] == "in",
              f"A4 после отмены фаза in, pending пуст: {st}")
        a.step(25)
        check(a.eval("$.scene.current()") == "prepared",
              f"A4 мир остался прежним: {a.eval('$.scene.current()')}")
        check(a.eval("$.scene._transitionAlpha()") == 0 and a.eval("$.scene.busy()") is False,
              "A4 затемнение 0, busy() false")
        check(a.eval("$.scene.cancel()") is False, "A4 отменять нечего — false")

        # A4 при экране загрузки: лоадер останавливается, мир прежний.
        reset(a)
        a.eval("$.scene.change('async', { loading: true, ms: 0, timeout_ms: 8000,"
               " steps: [{ label: 'долго', total: 100000, budget: 1, work: () => { __ev.steps++; } }] })")
        a.step(4)
        check(a.eval("$.scene.state()")["phase"] == "load",
              "A4 загрузка идёт в фазе load")
        check(a.eval("$.scene.cancel()") is True, "A4 отмена во время загрузки")
        a.step(3)
        check(a.eval("$.scene.current()") == "prepared" and a.eval("$.loading.visible()") is False,
              "A4 отмена загрузки оставила прежнюю сцену и убрала экран")

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
