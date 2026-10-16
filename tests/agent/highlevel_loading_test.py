#!/usr/bin/env python3
# ===========================================================================
# Приёмка §45: асинхронная загрузка, progress, отмена и failure.
#
# Гоняет фикстуру tests/fixtures/loading (тяжёлый PNG 2048×2048, сцены,
# инстанциация шагами $.task). Проверяются ЧИСЛА: сколько кадров прожила
# «анимация» за время загрузки, максимальный бюджет кадра (hitch), за сколько
# миллисекунд отреагировала отмена, точные байты прогресса.
#
# Запуск после сборки:
#   python3 tests/agent/highlevel_loading_test.py
# ===========================================================================

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "loading")
# Бюджет кадра: один GPU upload тяжёлой текстуры — самая дорогая операция.
# Порог щедрый: он ловит «загрузка встала колом», а не шум машины.
FRAME_BUDGET_MS = 250.0
CANCEL_BUDGET_MS = 50.0


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def wait_state(a, expr, states, limit=240):
    """Крутить кадры, пока выражение не даст одно из состояний. Возвращает (state, frames)."""
    for i in range(limit):
        a.step(1)
        state = a.eval(expr)
        if state in states:
            return state, i + 1
    return (a.eval(expr), limit)


def main():
    with Agent(game=GAME, seed=5, fixed_dt=1.0 / 60.0) as a:
        a.step(3)
        check(a.eval("$.scene.current()") == "menu", "фикстура стартует в меню")
        check(a.eval("typeof $.resource.request") == "function", "$.resource.request есть")
        workers = a.eval("engine.async.stats().workers")
        check(workers == 1, f"рабочий поток I/O поднят (workers={workers})")
        print(f"  --   async workers={workers}, "
              f"heavy.png={a.eval('engine.async.size(\"tests/fixtures/loading/assets/heavy.png\")')} Б")

        # --- §45: тяжёлый PNG не блокирует анимацию ---------------------------
        a.eval("""
            globalThis.T0 = $.time.perfNow();
            globalThis.max_hitch = 0;
            globalThis.prev = $.time.perfNow();
            globalThis.watch = $.update(() => {
                const now = $.time.perfNow();
                const dt = now - globalThis.prev;
                globalThis.prev = now;
                if (dt > globalThis.max_hitch) globalThis.max_hitch = dt;
            });
            S.requestHeavy();
        """)
        # Первый кадр после постановки задания: считаем «до» отдельно.
        frames_lived = 0
        per_frame = []
        while True:
            a.step(1)
            frames_lived += 1
            state = a.eval("S.lastRequest().state()")
            per_frame.append(a.eval("$.time.perfNow() - globalThis.prev"))
            if state in ("ready", "failed"):
                break
            if frames_lived > 60:
                break
        elapsed = a.eval("$.time.perfNow() - globalThis.T0")
        progress = a.eval("S.lastRequest().progress()")
        max_hitch = max(per_frame) if per_frame else 0.0
        print(f"  --   тяжёлый PNG: {frames_lived} кадров, {elapsed:.1f} мс всего, "
              f"макс. кадр {max_hitch:.1f} мс, state={state}")
        check(state == "ready", "тяжёлая текстура загрузилась")
        check(frames_lived >= 2, f"анимация прожила {frames_lived} кадров за время загрузки")
        check(max_hitch <= FRAME_BUDGET_MS,
              f"бюджет кадра соблюдён: {max_hitch:.1f} мс ≤ {FRAME_BUDGET_MS:.0f} мс")
        check(progress["bytes_total"] == a.eval("engine.async.size('tests/fixtures/loading/assets/heavy.png')"),
              f"знаменатель прогресса — реальный размер файла ({progress['bytes_total']} Б)")
        check(progress["bytes_done"] == progress["bytes_total"], "байты сошлись к концу загрузки")
        check(progress["estimated"] is False, "I/O-стадия не помечена оценочной")
        check(progress["stage"] == "done", "стадия завершена")

        # --- §45: отмена в согласованном бюджете ------------------------------
        a.eval("globalThis.C0 = $.time.perfNow(); S.requestHeavy();")
        a.step(1)
        a.eval("globalThis.cancel_ok = S.lastRequest().cancel()")
        cancel_ms = a.eval("$.time.perfNow() - globalThis.C0")
        state = a.eval("S.lastRequest().state()")
        print(f"  --   отмена: {cancel_ms:.1f} мс, state={state}")
        check(a.eval("globalThis.cancel_ok") is True, "cancel() вернул true")
        check(state == "cancelled", "запрос отменён")
        check(cancel_ms <= CANCEL_BUDGET_MS,
              f"отмена уложилась в бюджет: {cancel_ms:.1f} мс ≤ {CANCEL_BUDGET_MS:.0f} мс")
        cancelled_name = a.eval("S.lastRequest().names()[0]")
        check(a.eval("$.resource.info('%s').state" % cancelled_name) != "ready",
              f"отменённый ресурс не попал в реестр готовым ({cancelled_name})")
        a.step(3)
        check(a.eval("S.lastRequest().state()") == "cancelled",
              "поздний результат отменённого запроса не применяется")

        # --- §45: неверный путь — failed с причиной и структурной ошибкой -----
        a.eval("$.debug.clearErrors(); S.requestBad();")
        state, spent = wait_state(a, "S.lastRequest().state()", ("failed",))
        err = a.eval("S.lastRequest().error()")
        print(f"  --   неверный путь: state={state} за {spent} кадров, error={json.dumps(err, ensure_ascii=False)}")
        check(state == "failed", "неверный путь даёт failed")
        check(isinstance(err, dict) and err.get("code") == "R2D_LOAD_RESOURCE",
              "ошибка структурирована (code)")
        check("нет-такого-файла" in (err.get("message") or ""), "в причине назван путь")
        errors = a.eval("JSON.stringify($.debug.errors('R2D_LOAD_RESOURCE'))")
        check(errors != "[]", f"$.debug.reportError записал провал: {errors[:120]}")

        # --- §45: отменённая сцена не появляется ни сейчас, ни позже ----------
        a.eval("S.loadLevel()")
        a.step(1)
        check(a.eval("S.handleState().state") == "loading", "сцена начала загрузку")
        check(a.eval("S.cancelPending()") is True, "cancelPending() отменил загрузку")
        check(a.eval("S.handleState().state") == "cancelled", "handle помечен cancelled")
        for _ in range(90):
            a.step(1)
        check(a.eval("$.scene.current()") != "level", "отменённая сцена не появилась и позже")
        check(a.eval("S.entered") != "level", "enter у отменённой сцены не вызывался")
        check(a.eval("$.scene.pending().progress().cancelled") is True,
              "прогресс отменённой загрузки говорит cancelled")

        # --- §45: отмена ЗАПРОСА отменяет зависящую сцену ---------------------
        a.eval("""
            globalThis.req = $.resource.request(S.levelResources());
            S.loadScene('other', { resources: globalThis.req });
        """)
        a.step(1)
        a.eval("globalThis.req.cancel()")
        a.step(1)
        for _ in range(60):
            a.step(1)
        check(a.eval("$.scene.current()") != "other",
              "отмена запроса ресурсов отменила зависящую сцену")
        check(a.eval("S.handleState().state") == "cancelled", "handle сцены тоже cancelled")

        # --- §45: политика часов — загрузка не считается прохождением ---------
        a.eval("""
            S.resumeClock();
            globalThis.clock0 = S.clock();
            S.loadLevel({ resources: S.levelResources() });
        """)
        state, spent = wait_state(a, "S.handleState().state", ("ready", "failed"))
        check(state == "ready", "загрузка уровня завершилась")
        clock_during = a.eval("S.clock() - globalThis.clock0")
        check(a.eval("S.pausedNow()") is True, "на время загрузки игровые часы на паузе")
        check(abs(clock_during) < 1e-6,
              f"таймер прохождения не счёт время загрузки: dt={clock_during:.6f}")
        # Сцену доводим до конца: шаги + переход.
        state, spent = wait_state(a, "$.scene.current()", ("level",), limit=240)
        check(state == "level", "после загрузки сцена открылась")
        check(a.eval("S.steps_done") == 600, "инстанциация прошла шагами $.task (600)")
        a.eval("S.resumeClock()")

        # --- §45: старый синхронный API работает как раньше -------------------
        check(a.eval("$.resource.load('sync_atlas', { kind: 'texture', path: 'assets/atlas.png' })") is not None,
              "$.resource.load (синхронный) вернул текстуру")
        check(isinstance(a.eval("$.resource.get('sync_atlas')"), int), "$.resource.get отдаёт значение")
        check(a.eval("$.resource.preload(['sync_atlas']).loaded") == 1, "preload работает")
        check(a.eval("$.resource.free('sync_atlas')") == 0, "free отпустил ссылку")
        a.eval("$('<rect>', { id: 'probe' }).at(0, 0).appendTo($.world)")
        a.eval("$.scene.load('menu', { transition: 'none' })")
        a.step(2)
        check(a.eval("$.scene.current()") == "menu", "$.scene.load (синхронный) работает как раньше")

        # --- §45: прогресс в известных единицах на живой загрузке -------------
        a.eval("globalThis.REQ = $.resource.request(S.levelResources());")
        a.step(1)
        live = a.eval("JSON.stringify(globalThis.REQ.progress())")
        check('"bytes_known":true' in live, "прогресс знает точный знаменатель: " + live[:160])
        a.eval("globalThis.REQ.cancel()")

        check(a.ping().get("pong") is True, "движок жив после всех сценариев")

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
