#!/usr/bin/env python3
# ===========================================================================
# §9 (транзакционный жизненный цикл сцены) через агентский интерфейс.
#
# Проверяется приёмка §9 на РЕАЛЬНОМ прогоне: «Если новая room/scene не смогла
# подготовиться: старый world остаётся полностью валидным». Сцена — это
# `$.scene.prepare` → `commit`/`discard` (src/highlevel/scene.js:432-513), на
# ней же построена транзакция комнаты (§23), поэтому путь проверяется отдельно
# от комнатного теста:
#
#   * prepare, падающий ПОСЛЕ создания узла с телом, таймера и подписки:
#     handle.ok === false, ошибка в handle.error, временная область закрыта;
#   * prepare, возвращающий { ok: false }, и prepare незарегистрированной
#     сцены — те же последствия;
#   * мир ДО/ПОСЛЕ отказа совпадает по $.scene.counts(), native-телам
#     ($.debug.limits().bodies) и реестру occluders света ($.gfx.light.count());
#   * старый мир не просто «не изменился», а ЖИВОЙ: его тело снова падает и
#     снова касается пола;
#   * commit отказавшего handle ничего не делает; успешный prepare НЕ меняет
#     $.scene.current() — сцена переключается только commit'ом, на границе
#     кадра, и прежние узлы закрываются вместе с её областью;
#   * discard подготовленной сцены возвращает узлы/тела/occluders/таймеры/
#     подписки к значениям до подготовки, и после него за 20 кадров ни таймер,
#     ни подписка отброшенной сцены не срабатывают.
#
# Фикстура tests/fixtures/scene_tx. Запуск:
#   python3 tests/agent/highlevel_scene_transaction_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

GAME = os.path.join("tests", "fixtures", "scene_tx")
FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def main():
    with Agent(game=GAME, seed=5, fixed_dt=1.0 / 60.0) as a:
        a.step(60)      # тело базовой сцены садится на глобальный пол
        base = a.eval("$.fixture.counts()")
        print(f"       базовое состояние: {base}")
        check(a.eval("$.scene.current()") == "base",
              f"§9 стартовая сцена загружена: {a.eval('$.scene.current()')}")
        check(a.eval("$.fixture.baseTouchingFloor()") is True,
              "§9 тело старого мира стоит на глобальном полу (мир живой)")

        # --- prepare падает ПОСЕРЕДИНЕ ----------------------------------------
        broken = a.eval("$.fixture.prepare('broken', 'broken')")
        check(broken["ok"] is False and broken["error"] is not None,
              f"§9 упавший prepare: ok={broken['ok']}, error={broken['error']}")
        check("намеренно" in (broken["error"] or ""),
              f"§9 причина отказа сохранена в handle.error: {broken['error']}")
        check(broken["scope"] is None,
              f"§9 временная область закрыта и обнулена: scope={broken['scope']}")
        check(a.eval("$.fixture.events().broken_spawned") == 1,
              "§9 prepare успел создать узел/тело/таймер ДО падения")
        check(a.eval("$.fixture.counts()") == base,
              f"§9 сразу после отказа счётчики прежние: {a.eval('$.fixture.counts()')}")

        a.step(3)
        check(a.eval("$.fixture.counts()") == base,
              f"§9 через 3 кадра мир тот же: {a.eval('$.fixture.counts()')} == {base}")
        after = a.eval("$.fixture.counts()")
        check(after["scene"] == base["scene"] and after["bodies"] == base["bodies"]
              and after["occluders"] == base["occluders"],
              f"§9 узлы/тела/подписки/таймеры, native-тела и occluders те же: {after}")
        check(a.eval("$.scene.counts().timers") == base["scene"]["timers"]
              and a.eval("$.scene.counts().subs") == base["scene"]["subs"],
              "§9 таймер и подписка упавшего prepare отменены")
        check(a.eval("$.scene.current()") == "base",
              f"§9 текущая сцена не сменилась: {a.eval('$.scene.current()')}")
        check(a.eval("$.fixture.state()")["broken_node"] == 0,
              "§9 узел упавшей подготовки уничтожен")

        # Старый мир не просто «не изменился» — он продолжает симулироваться.
        a.eval("$.fixture.dropBase()")
        y0 = a.eval("$.fixture.state()['base_y']")
        a.step(10)
        y1 = a.eval("$.fixture.state()['base_y']")
        check(y1 > y0 + 1.0,
              f"§9 тело старого мира снова падает после отказа (y {y0:.1f} → {y1:.1f})")
        a.step(70)
        check(a.eval("$.fixture.baseTouchingFloor()") is True,
              "§9 и снова приземляется на пол — мир полностью работоспособен")

        # --- второй путь отказа: prepare вернул { ok: false } ------------------
        flag = a.eval("$.fixture.prepare('flag', 'broken_flag')")
        check(flag["ok"] is False and "отказался явно" in (flag["error"] or ""),
              f"§9 prepare с ok:false отклонён: {flag}")
        a.step(3)
        check(a.eval("$.fixture.counts()") == base
              and a.eval("$.fixture.state()")["flag_node"] == 0,
              "§9 отказ по флагу тоже не оставил мусора")

        # --- незарегистрированная сцена ---------------------------------------
        nope = a.eval("$.fixture.prepare('nope', 'no_such_scene')")
        check(nope["ok"] is False and "не зарегистрирована" in (nope["error"] or ""),
              f"§9 незарегистрированная сцена — структурированный отказ: {nope}")

        # --- commit отказавшего handle ничего не делает ------------------------
        a.eval("$.fixture.commit('broken')")
        a.step(2)
        check(a.eval("$.scene.current()") == "base" and a.eval("$.fixture.counts()") == base,
              f"§9 commit отказавшего handle отклонён: scene={a.eval('$.scene.current()')}")

        # --- успешный prepare НЕ переключает сцену ----------------------------
        good = a.eval("$.fixture.prepare('good', 'good')")
        check(good["ok"] is True and good["scope"] is not None,
              f"§9 успешный prepare: {good}")
        check(a.eval("$.fixture.state()")["good_node"] == 1,
              "§9 подготовленный узел уже в мире (staging)")
        check(a.eval("$.scene.current()") == "base",
              f"§9 prepare не переключает сцену: {a.eval('$.scene.current()')}")
        staged = a.eval("$.fixture.counts()")
        check(staged["scene"]["nodes"] == base["scene"]["nodes"] + 1
              and staged["bodies"] == base["bodies"] + 1
              and staged["scene"]["scopes"] == base["scene"]["scopes"] + 1,
              f"§9 staging виден в счётчиках, но это ещё не текущая сцена: {staged}")

        # --- commit: публикация на границе кадра ------------------------------
        a.eval("$.fixture.commit('good')")
        a.step(3)
        state = a.eval("$.fixture.state()")
        check(a.eval("$.scene.current()") == "good",
              f"§9 после commit сцена переключилась: {a.eval('$.scene.current()')}")
        check(state["good_node"] == 1 and state["good_marker"] == 1,
              f"§9 узлы новой сцены в мире (enter тоже выполнен): {state}")
        check(state["base_node"] == 0 and state["base_marker"] == 0,
              "§9 узлы прежней сцены закрыты вместе с её областью")
        check(state["floor"] == 1, "§9 глобальные узлы вне сцен пережили переход")
        check(len(state["scopes"]) == 1 and state["scopes"][0] != "scene:base",
              f"§9 осталась ровно одна область сцены: {state['scopes']}")

        # --- discard подготовленной сцены -------------------------------------
        before_staged = a.eval("$.fixture.counts()")
        staged = a.eval("$.fixture.prepare('staged', 'staged')")
        check(staged["ok"] is True, f"§9 подготовлена сцена с картой: {staged}")
        a.step(2)       # тайлмап применяет occluders света
        mid = a.eval("$.fixture.counts()")
        check(mid["scene"]["timers"] == before_staged["scene"]["timers"] + 1
              and mid["scene"]["subs"] == before_staged["scene"]["subs"] + 1
              and mid["occluders"] > before_staged["occluders"]
              and mid["bodies"] > before_staged["bodies"],
              f"§9 подготовка взяла таймер/подписку и зарегистрировала occluders: {mid}")
        check(a.eval("$.fixture.discard('staged')") is True, "§9 discard выполнен")
        a.step(3)
        check(a.eval("$.fixture.counts()") == before_staged,
              f"§9 discard вернул всё к значениям до подготовки: "
              f"{a.eval('$.fixture.counts()')} == {before_staged}")
        check(a.eval("$.fixture.state()")["staged_node"] == 0,
              "§9 узел отброшенной сцены уничтожен")
        check(a.eval("$.scene.current()") == "good",
              f"§9 discard не тронул текущую сцену: {a.eval('$.scene.current()')}")

        ev0 = a.eval("$.fixture.events()")
        for _ in range(20):
            a.eval("$.fixture.ping()")
            a.step(1)
        ev1 = a.eval("$.fixture.events()")
        check(ev1["staged_sub"] == ev0["staged_sub"] and ev1["staged_timer"] == ev0["staged_timer"],
              f"§9 таймер и подписка отброшенной сцены мертвы: sub {ev0['staged_sub']}→"
              f"{ev1['staged_sub']}, timer {ev0['staged_timer']}→{ev1['staged_timer']}")
        check(ev1["good_timer"] == ev0["good_timer"],
              f"§9 чужие таймеры не сработали: {ev0['good_timer']} → {ev1['good_timer']}")
        check(ev1["global_sub"] == ev0["global_sub"] + 20,
              f"§9 глобальная подписка жива: {ev0['global_sub']} → {ev1['global_sub']}")

        errors = [line for line in a.stderr_text().splitlines() if "$: ошибка" in line]
        check(not errors, f"§9 нет необъявленных ошибок игрового кода: {errors[:2]}")
        logged = [line for line in a.stderr_text().splitlines() if "$.scene.prepare" in line]
        check(any("намеренно" in line for line in logged),
              f"§9 отказ prepare залогирован с причиной: {logged[:1]}")

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
