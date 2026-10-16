#!/usr/bin/env python3
# ===========================================================================
# Пример §31-3 Спецификации: «Pattern arena» (demos/arena).
#
# Проверяется законченный сценарий, а не наличие методов:
#   * фазы меняются по явным правилам (HP, таймер, маркер);
#   * interrupt отменяет фазу: после него за 90 кадров ни одного нового
#     снаряда — «отложенных выстрелов» не остаётся;
#   * 140+ спавнов из пула не растят узлы: пул переиспользует created;
#   * пауза останавливает таймеры фазы, снаряды и §44-обработку, resume
#     продолжает без потерь;
#   * смерть считается один раз, после неё фазы молчат;
#   * restart возвращает узлы/тела/подписки/таймеры/области к исходным числам.
#
# Запуск:
#   python3 tools/run_tests.py arena_test
#   R2D_BINARY=build-2d/russiano2d python3 tools/run_tests.py arena_test
# ===========================================================================

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

GAME = os.path.join("demos", "arena")
FAILURES = []
COUNT_FIELDS = ("nodes", "bodies", "subs", "waits", "timers", "tasks", "flows", "scopes")


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def errors_of(a):
    return [line.strip() for line in a.stderr_text().splitlines()
            if "$: ошибка" in line or "[error]" in line]


def counts(a):
    return json.loads(a.eval("JSON.stringify($.arena.counts())"))


def state(a):
    return json.loads(a.eval("JSON.stringify($.arena.state())"))


def step_until(a, expr, limit=90, frames=4):
    for _ in range(limit):
        a.step(frames)
        if a.eval(expr):
            return True
    return False


def main():
    with Agent(game=GAME, seed=7) as a:
        a.step(6)

        # --- Старт: арена, область владения, машина фаз ----------------------
        check(a.eval("$.scene.current()") == "arena", "арена открылась")
        check(a.eval("$.arena.phase()") == "prepare", "стартовая фаза — подготовка")
        check(a.eval("$.state.list().length") == 1, "машина фаз одна")
        check(a.eval("$.state.current('#boss')") == "prepare", "FSM согласована с фазой")
        hud_phase = a.eval("$.arena.hudText()['hud-phase']")
        check("Фаза: prepare" in hud_phase, f"HUD показывает фазу ({hud_phase})")
        baseline = counts(a)
        print("  числа после старта:", json.dumps(baseline, ensure_ascii=False))
        check(baseline["subs"] == 1, "подписка арены принадлежит области сцены")
        check(baseline["timers"] == 2, "два scoped-таймера: фаза + heartbeat")

        # --- Правила смены фаз ------------------------------------------------
        changed = step_until(a, "$.arena.phase() !== 'prepare'")
        check(changed, "таймер фазы сменил фазу")
        check(a.eval("$.arena.phase()") == "volley", f"после таймера — залп ({a.eval('$.arena.phase()')})")

        a.eval("$.arena.damage(30); 'ok'")
        a.step(2)
        check(a.eval("$.arena.phase()") == "volley", "HP 70 держит фазу залпа")
        a.eval("$.arena.damage(30); 'ok'")
        a.step(2)
        check(a.eval("$.arena.phase()") == "summon", f"HP 40 переводит в призыв ({a.eval('$.arena.phase()')})")
        a.eval("$.arena.damage(20); 'ok'")
        a.step(2)
        check(a.eval("$.arena.phase()") == "burst", f"HP 20 переводит в шквал ({a.eval('$.arena.phase()')})")

        check(a.eval("$.arena.marker('volley')") is True, "маркер переводит фазу явно")
        a.step(2)
        check(a.eval("$.arena.phase()") == "volley", "маркер сработал")
        check(a.eval("$.arena.state().marker") == "volley", "маркер записан в состояние")

        # --- Отмена фазы: отложенных выстрелов не остаётся ---------------------
        check(a.eval("$.arena.marker('burst')") is True, "возврат в шквал по маркеру")
        fired = step_until(a, "$.arena.state().shots > 0")
        check(fired, f"шквал начал стрелять ({a.eval('$.arena.state().shots')})")
        interrupts_before = state(a)["interrupts"]
        check(a.eval("$.arena.cancel('тест')") is True, "фаза отменена")
        a.step(2)
        st = state(a)
        check(st["phase"] == "idle", f"после отмены фаза idle ({st['phase']})")
        check(st["interrupts"] == interrupts_before + 1, "отмена посчитана один раз")
        shots_at_cancel = st["shots"]
        spawned_at_cancel = st["spawned"]
        active_at_cancel = a.eval("$.pool.get('arena-shots').active")
        after_cancel = counts(a)
        check(after_cancel["scopes"] == 1, f"область фазы закрыта (scopes={after_cancel['scopes']})")
        check(after_cancel["timers"] == 1, "таймеры фазы сняты, heartbeat остался")
        a.step(90)
        st = state(a)
        check(st["shots"] == shots_at_cancel,
              f"после отмены за 90 кадров ни одного снаряда ({shots_at_cancel} → {st['shots']})")
        check(st["spawned"] == spawned_at_cancel,
              f"и ни одного спавна ({spawned_at_cancel} → {st['spawned']})")
        active_after = a.eval("$.pool.get('arena-shots').active")
        check(active_after <= active_at_cancel,
              f"новых снарядов в пуле не появилось ({active_at_cancel} → {active_after})")

        # --- Пул: 140+ спавнов не растят узлы ---------------------------------
        a.eval("$.arena.releaseAll(); 'ok'")
        a.step(2)
        nodes_base = counts(a)["nodes"]
        peak = nodes_base
        for _ in range(3):
            a.eval("$.arena.spawnWave(60); 'ok'")
            a.step(2)
            now_nodes = counts(a)["nodes"]
            peak = max(peak, now_nodes)
            active_now = a.eval("$.pool.get('arena-minions').active")
            check(active_now <= 48, f"выдано не больше потолка пула ({active_now})")
            a.eval("$.arena.releaseAll(); 'ok'")
            a.step(1)
            check(counts(a)["nodes"] == nodes_base,
                  f"после releaseAll узлы вернулись к базе ({counts(a)['nodes']})")
        pool = json.loads(a.eval("JSON.stringify($.pool.get('arena-minions'))"))
        check(pool["created"] == 48, f"пул создал ровно потолок узлов ({pool['created']})")
        check(pool["spawned"] >= 140, f"выдач больше 140 ({pool['spawned']})")
        check(pool["skipped"] >= 1, f"переполнение пула было отмечено ({pool['skipped']})")
        check(peak <= nodes_base + 48, f"узлы не превысили базу+потолок ({peak} ≤ {nodes_base + 48})")

        # --- Пауза -------------------------------------------------------------
        a.eval("$.arena.marker('volley'); 'ok'")
        step_until(a, "$.pool.get('arena-shots').active > 0")
        flow_before = a.eval("$.flow.now()")
        pos_before = a.eval("JSON.stringify($.pool.get('arena-shots').nodes().pos())")
        phase_before = a.eval("$.arena.phase()")
        shots_before = a.eval("$.arena.state().shots")
        timers_before = counts(a)["timers"]
        check(a.eval("$.arena.pause(true)") is True, "пауза включена")
        check(a.eval("$('#boss').processing('update')") is False
              and a.eval("$('#boss').processing('physics')") is False
              and a.eval("$('#boss').processing('timers')") is False,
              "на паузе §44-обработка босса выключена")
        a.step(30)
        check(a.eval("$.flow.now()") == flow_before, "игровое время на паузе стоит")
        check(a.eval("JSON.stringify($.pool.get('arena-shots').nodes().pos())") == pos_before,
              "снаряд на паузе не двигается")
        check(a.eval("$.arena.phase()") == phase_before, "фаза на паузе не меняется")
        check(a.eval("$.arena.state().shots") == shots_before, "новых выстрелов на паузе нет")
        check(counts(a)["timers"] == timers_before, "таймеры на паузе не теряются")
        check(a.eval("$.arena.pause(false)") is False, "пауза снята")
        check(a.eval("$('#boss').processing('update')") is True, "§44-обработка вернулась")
        a.step(30)
        check(a.eval("$.flow.now()") > flow_before, "после resume игровое время идёт")
        resumed = a.eval("JSON.stringify($.pool.get('arena-shots').nodes().pos())")
        check(resumed != pos_before or a.eval("$.pool.get('arena-shots').active") == 0,
              "после resume снаряд продолжил движение")

        # --- Смерть и рестарт: числа возвращаются к исходным -------------------
        a.eval("$.arena.restart(); 'ok'")
        a.step(6)
        check(a.eval("$.scene.current()") == "arena", "рестарт вернул арену")
        check(counts(a) == baseline,
              f"числа после рестарта равны исходным ({json.dumps(counts(a), ensure_ascii=False)})")

        a.eval("$.arena.spawnWave(40); $.arena.damage(30); 'ok'")
        a.step(30)
        before_death = state(a)
        check(before_death["spawned"] > 0 and before_death["shots"] > 0,
              f"арена играет перед смертью (спавнов {before_death['spawned']}, выстрелов {before_death['shots']})")
        check(a.eval("$.arena.hitPlayer(999)") is True, "смертельный удар принят")
        a.step(2)
        st = state(a)
        check(st["deaths"] == 1, f"смерть посчитана один раз ({st['deaths']})")
        check(st["playerDead"] is True and st["phase"] == "dead", "арена в состоянии смерти")
        check(a.eval("$.arena.hitPlayer(999)") is False, "второй смертельный удар отклонён")
        a.step(2)
        check(state(a)["deaths"] == 1, "повторный удар не увеличил счётчик смертей")
        shots_dead = state(a)["shots"]
        spawned_dead = state(a)["spawned"]
        a.step(90)
        st = state(a)
        check(st["shots"] == shots_dead and st["spawned"] == spawned_dead,
              f"после смерти фазы молчат ({shots_dead}/{spawned_dead})")
        check(a.eval("$.pool.get('arena-shots').active") == 0, "снаряды смерти убраны")

        a.eval("$.arena.restart(); 'ok'")
        a.step(6)
        st = state(a)
        check(st["hp"] == 100 and st["wave"] == 0 and st["deaths"] == 0
              and st["playerDead"] is False and st["phase"] == "prepare",
              f"прогресс начался заново по явному правилу ({json.dumps(st, ensure_ascii=False)})")
        check(counts(a) == baseline,
              f"узлы/тела/подписки/таймеры вернулись к исходным ({json.dumps(counts(a), ensure_ascii=False)})")
        check(a.eval("$.state.list().length") == 1, "машина фаз не размножилась")
        a.eval("$.signal.emit('arena:hit'); 'ok'")
        a.step(2)
        check(state(a)["hits"] == 1, f"подписка после рестарта одна ({state(a)['hits']})")

        errs = errors_of(a)
        check(not errs, f"журнал без ошибок ({errs[:3]})")
        check(a.ping().get("pong") is True, "движок жив")

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
