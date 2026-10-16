#!/usr/bin/env python3
# ===========================================================================
# §9 (транзакционный жизненный цикл комнаты) через агентский интерфейс.
#
# Проверяется ровно приёмка §9 на РЕАЛЬНОМ прогоне движка:
#   * сборка комнаты, которая падает ПОСЕРЕДИНЕ (узел + тело + таймер +
#     подписка уже созданы, потом исключение), возвращает handle.ok === false
#     и НЕ меняет мир: $.scene.current(), $.scene.counts(), число native-тел и
#     реестр occluders света — те же, что до отказа;
#   * $.room.unload() возвращает узлы/тела/подписки/таймеры к значениям ДО
#     входа в комнату, оставляет $.scene.counts().timers === 0;
#   * после выгрузки за 30 кадров не приходит НИ ОДНОГО события контакта и ни
#     одного срабатывания подписки комнаты, при этом глобальная подписка
#     продолжает получать сигналы (значит, сигнал реально рассылался, а не
#     «тишина из-за отсутствия emit»).
#
# Фикстура tests/fixtures/room_unload: вне комнаты — глобальный пол и
# глобальная подписка; комната alpha — карта (визуал/коллизия/occluders),
# prefab-инстанс падает на глобальный пол и каждый кадр шлёт 'stay'; комната
# trap_room падает в prefab-фабрике.
#
# Запуск:
#   python3 tests/agent/highlevel_room_unload_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

GAME = os.path.join("tests", "fixtures", "room_unload")
FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def main():
    with Agent(game=GAME, seed=5, fixed_dt=1.0 / 60.0) as a:
        a.step(3)
        base = a.eval("$.fixture.counts()")
        print(f"       до входа: {base}")

        # --- вход в комнату ---------------------------------------------------
        res = a.eval("$.fixture.enterRoom('alpha')")
        check(res["ok"] is True and res["id"] == "alpha" and res["stage"] == "committed",
              f"§9 комната alpha собрана и опубликована: {res}")
        a.step(2)
        check(a.eval("$.scene.current()") == "room:alpha",
              f"§9 комната — текущая сцена: {a.eval('$.scene.current()')}")
        check(a.eval("$.fixture.state()")["crate"] == 1
              and a.eval("$.fixture.state()")["map"] == 1,
              f"§9 узлы комнаты в мире: {a.eval('$.fixture.state()')}")

        # Комната берёт под владение таймер и подписку — иначе проверять
        # «возврат к прежним значениям» было бы не на чем.
        arm = a.eval("$.fixture.armRoom('alpha')")
        check(arm["timers"] == 1 and a.eval("$.scene.counts().timers") == 1,
              f"§9 у комнаты свой таймер: {arm}")
        check(a.eval("$.scene.counts().subs") == base["scene"]["subs"] + 1,
              f"§9 у комнаты своя подписка: subs={a.eval('$.scene.counts().subs')} "
              f"(было {base['scene']['subs']})")
        live = a.eval("$.fixture.counts()")
        check(live["scene"]["nodes"] > base["scene"]["nodes"]
              and live["bodies"] > base["bodies"] and live["occluders"] > base["occluders"],
              f"§9 комната добавила узлы/тела/occluders: {live}")

        a.step(80)      # тело падает на глобальный пол и начинает шлать 'stay'
        ev = a.eval("$.fixture.events()")
        check(ev["collide"] >= 1 and ev["stay"] >= 1,
              f"§9 узел комнаты реально сталкивается (collide={ev['collide']}, stay={ev['stay']})")
        check(ev["timer"] >= 1, f"§9 таймер комнаты тикает: {ev['timer']}")

        # --- §9: сборка комнаты падает ПОСЕРЕДИНЕ -----------------------------
        before_trap = a.eval("$.fixture.counts()")
        scene_before = a.eval("$.scene.current()")
        trap = a.eval("$.fixture.enterTrap()")
        check(trap["ok"] is False and trap["stage"] == "build",
              f"§9 упавшая сборка вернула ok=false: {trap}")
        check(any("падает намеренно" in e for e in trap["errors"]),
              f"§9 ошибка сборки структурирована и объясняет причину: {trap['errors']}")
        check(a.eval("$.fixture.events().trap_spawned") == 1,
              "§9 фабрика успела создать узел/тело/таймер ДО падения (отказ не на входе)")
        a.step(3)
        check(a.eval("$.fixture.counts()") == before_trap,
              f"§9 отказ не изменил мир: {a.eval('$.fixture.counts()')} == {before_trap}")
        check(a.eval("$.scene.counts()") == before_trap["scene"],
              f"§9 узлы/тела/подписки/таймеры те же: {a.eval('$.scene.counts()')}")
        check(a.eval("$.scene.counts().timers") == before_trap["scene"]["timers"]
              and a.eval("$.scene.counts().subs") == before_trap["scene"]["subs"],
              "§9 таймер и подписка упавшей сборки отменены вместе с staging-областью")
        check(a.eval("$.scene.current()") == scene_before,
              f"§9 текущая сцена не сменилась: {a.eval('$.scene.current()')} == {scene_before}")
        check(a.eval("$.room.current().id") == "alpha",
              f"§9 текущая комната прежняя: {a.eval('$.room.current().id')}")
        check(a.eval("$.fixture.state()")["trap_node"] == 0,
              "§9 узел упавшей сборки уничтожен (нет мусора в мире)")
        check(a.eval("$.fixture.state()")["crate"] == 1,
              "§9 мир прежней комнаты остался полностью валидным")

        # --- §9: выгрузка комнаты --------------------------------------------
        unloaded = a.eval("$.fixture.unload()")
        check(unloaded is True, f"§9 $.room.unload() выполнена: {unloaded}")
        a.step(3)
        # §10: идентичность сцены/комнаты обязана совпадать с фактическим миром.
        # Раньше unload() закрывал область комнаты, но машина сцен продолжала
        # указывать на 'room:alpha': $.scene.current() обещал исчезнувший мир,
        # сейв записывал scene:'room:alpha', а $.room.adopt() на таком снимке
        # падал с R2D_ROOM_ADOPT.
        check(a.eval("$.scene.current()") is None,
              f"§9 после выгрузки текущей сцены нет: {a.eval('$.scene.current()')}")
        check(a.eval("$.room.current()") is None,
              f"§9 и текущей комнаты нет: {a.eval('$.room.current()')}")
        saved_scene = a.eval("(() => { $.save.dir('build/test_saves');"
                             " $.save.save(77);"
                             " const p = JSON.parse($.fs.readText('build/test_saves/slot-77.json'));"
                             " return (p.namespaces && p.namespaces.room && p.namespaces.room.scene)"
                             " || p.scene || null; })()")
        check(saved_scene != "room:alpha",
              f"§9 сейв не записывает исчезнувшую комнату: {saved_scene}")
        after = a.eval("$.fixture.counts()")
        check(after == base,
              f"§9 выгрузка вернула счётчики к значениям ДО входа: {after} == {base}")
        check(after["scene"]["nodes"] == base["scene"]["nodes"]
              and after["scene"]["bodies"] == base["scene"]["bodies"],
              f"§9 узлы и тела вернулись: {after['scene']}")
        check(after["bodies"] == base["bodies"],
              f"§9 native-тела вернулись: {after['bodies']} == {base['bodies']}")
        check(after["scene"]["subs"] == base["scene"]["subs"],
              f"§9 подписки вернулись: {after['scene']['subs']} == {base['scene']['subs']}")
        check(after["occluders"] == base["occluders"],
              f"§9 реестр occluders света вернулся: {after['occluders']} == {base['occluders']}")
        check(a.eval("$.scene.counts().timers") == 0,
              f"§9 таймеров не осталось: $.scene.counts().timers = {a.eval('$.scene.counts().timers')}")
        check(a.eval("$.room.current()") is None, "§9 текущей комнаты нет")
        state = a.eval("$.fixture.state()")
        check(state["crate"] == 0 and state["map"] == 0 and state["floor"] == 1,
              f"§9 узлы комнаты выгружены, глобальные остались: {state}")
        # Наблюдение (не приёмка §9): сцена при этом всё ещё называет себя
        # комнатой — unload закрывает область, но не трогает машинку сцен.
        print(f"       после unload: $.scene.current() = {a.eval('$.scene.current()')}, "
              f"$.room.current() = {a.eval('$.room.current()')}")

        # --- §9/§7.1: 30 кадров без событий выгруженной комнаты ---------------
        ev0 = a.eval("$.fixture.events()")
        for _ in range(30):
            a.eval("$.fixture.ping()")      # сигнал рассылается каждый кадр
            a.step(1)
        ev1 = a.eval("$.fixture.events()")
        check(ev1["sub"] == ev0["sub"],
              f"§9 подписка комнаты не сработала за 30 кадров: {ev0['sub']} → {ev1['sub']}")
        check(ev1["collide"] == ev0["collide"] and ev1["stay"] == ev0["stay"],
              f"§9 контактов после выгрузки нет: collide {ev0['collide']}→{ev1['collide']}, "
              f"stay {ev0['stay']}→{ev1['stay']}")
        check(ev1["timer"] == ev0["timer"],
              f"§9 таймер комнаты не тикает после выгрузки: {ev0['timer']} → {ev1['timer']}")
        check(ev1["global_sub"] == ev0["global_sub"] + 30,
              f"§9 глобальная подписка жива (сигнал реально рассылался): "
              f"{ev0['global_sub']} → {ev1['global_sub']}")

        # Ожидаемая ошибка ровно одна — намеренное падение сборки trap_room.
        errors = [line for line in a.stderr_text().splitlines() if "$: ошибка" in line]
        unexpected = [line for line in errors if "падает намеренно" not in line]
        check(len(errors) == 1 and not unexpected,
              f"§9 в логе только ожидаемая ошибка упавшей сборки: {unexpected[:2]}")

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
