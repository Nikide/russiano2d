#!/usr/bin/env python3
# ===========================================================================
# P1.1: сиденья, вход/выход, input lock, безопасный eject
# (demos/re2d_gta_sandbox/lib/seats.js + lib/character.js как композиция)
#
# Живой движок, изолированная сцена:
#   * вход/выход, несколько мест, выбор по seat/side/door;
#   * пассажир привязан к кузову (.appendTo) и едет вместе с ним (update-синк);
#   * жёсткий input lock на посадке и его снятие при выходе;
#   * выход по двери: смещение перпендикулярно кузову, сторона door;
#   * машина уничтожена с пассажирами — они высажены до destroy(), не убиты,
#     привязок не осталось, callback onEject получил reason 'vehicle_destroyed';
#   * событие 'death' машины (combat.js) высаживает всех;
#   * композиция с character.js: canControl()/onSeat() при посадке и выходе;
#   * release/clear снимают guard и состояния.
#
# Запуск: python3 tests/agent/re2d_gta_seats_test.py
# ===========================================================================

import json
import math
import os
import shutil
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

FIXTURE = os.path.join("build", "_gta_test_seats")
FAILURES = []

FIXTURE_MAIN = """import { createSeats } from '../../demos/re2d_gta_sandbox/lib/seats.js';
import { createCharacter } from '../../demos/re2d_gta_sandbox/lib/character.js';

$.ready(() => {
    globalThis.__gta = { createSeats, createCharacter };
});
"""


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def make_fixture():
    shutil.rmtree(FIXTURE, ignore_errors=True)
    os.makedirs(FIXTURE, exist_ok=True)
    with open(os.path.join(FIXTURE, "main.js"), "w", encoding="utf-8") as f:
        f.write(FIXTURE_MAIN)


def run(a, code):
    return json.loads(a.eval("JSON.stringify((() => { %s })())" % code))


SETUP = """
    $.world.gravity(0, 0);
    $('<player>', {id: 'hero'}).at(100, 200).health(100).gravity(false).appendTo($.world);
    $('<enemy>', {id: 'ped'}).at(140, 200).health(100).gravity(false).appendTo($.world);
    $('<enemy>', {id: 'ped2'}).at(180, 200).health(100).gravity(false).appendTo($.world);
    $('<enemy>', {id: 'ped3'}).at(220, 200).health(100).gravity(false).appendTo($.world);
    $('<rect>', {id: 'car'}).at(700, 400).size(96, 48).body('dynamic').gravity(false)
        .appendTo($.world);
    globalThis.__veh = { node: $('#car').get(0), seatsData: [
        { x: 8, y: 0, side: 'front', door: 'left' },
        { x: -24, y: 0, side: 'rear', door: 'left' },
        { x: -24, y: 16, side: 'rear', door: 'right' },
    ] };
    globalThis.__ejects = [];
    globalThis.__enters = [];
    globalThis.__seatLog = [];
    globalThis.__seats = __gta.createSeats($, {
        ejectOffset: 24,
        onEnter: (i) => __enters.push({ index: i.index, id: i.node.id }),
        onEject: (i) => __ejects.push({ reason: i.reason, index: i.index, id: i.node.id,
                                        x: i.x, y: i.y }),
    });
    globalThis.__chars = {};
    const mk = (id) => __gta.createCharacter($, {
        node: '#' + id, readInput: false,
        canControl: () => true,
        onSeat: (info) => __seatLog.push({ id, seated: !!info,
                                           index: info ? info.seat.index : null }),
    });
    __chars.hero = mk('hero');
    __chars.ped = mk('ped');
    __chars.ped2 = mk('ped2');
    __chars.ped3 = mk('ped3');
    return { ok: true };
"""


def enter(a, who, opts="{}", vehicle="__veh"):
    return run(a, """
        const e = __seats.enter(%s, __chars.%s, %s);
        return { ok: e.ok, reason: e.reason || null, index: e.index,
                 x: e.x, y: e.y, occupantCount: __seats.occupants(%s).length,
                 locks: $.input.lockCount(), hard: $.input.hardLocked(),
                 locked: $.input.locked('vehicle'),
                 parent: ($('#%s').parent().get(0) || {}).id || null,
                 nodeX: $('#%s').get(0).x, nodeY: $('#%s').get(0).y,
                 canControl: __chars.%s.canControl(),
                 seated: __chars.%s.isSeated() };
    """ % (vehicle, who, opts, vehicle, who, who, who, who, who))


def main():
    make_fixture()
    try:
        with Agent(game=FIXTURE, seed=7, fixed_dt=1.0 / 60.0) as a:
            run(a, SETUP)

            # --- 1. Вход водителя --------------------------------------------
            r = enter(a, "hero", "{ seat: 0 }")
            check(r["ok"] is True and r["index"] == 0, "вход на место 0 (водитель)")
            check(r["occupantCount"] == 1 and r["locks"] == 1 and r["locked"] is True,
                  "один пассажир, один advisory input lock")
            check(r["hard"] is False,
                  "advisory lock не гасит ввод: машиной и выходом управляют те же клавиши")
            check(r["parent"] == "car", "пассажир привязан к узлу машины")
            check(abs(r["nodeX"] - 708) < 0.01 and abs(r["nodeY"] - 400) < 0.01,
                  "пассажир стоит на якоре места (708,400), есть (%s,%s)" % (r["nodeX"], r["nodeY"]))
            check(r["canControl"] is False and r["seated"] is True,
                  "character.canControl()=false и isSeated()=true на посадке")
            check(run(a, "return {log: __seatLog[0]};")["log"]["seated"] is True,
                  "onSeat(true) вызван у персонажа")
            check(run(a, "return {enter: __enters[0]};")["enter"]["id"] == "hero",
                  "onEnter менеджера получил пассажира")

            # --- 2. Несколько мест / выбор / отказы --------------------------
            r = enter(a, "ped", "{}")
            check(r["ok"] is True and r["index"] == 1,
                  "следующий свободный — место 1 (%s)" % r["index"])
            r = enter(a, "ped2", "{ side: 'rear', door: 'right' }")
            check(r["ok"] is True and r["index"] == 2,
                  "выбор по side/door — место 2 (%s)" % r["index"])
            check(r["locks"] == 3, "три занятых места — три lock-токена")
            r = enter(a, "ped3", "{}")
            check(r["ok"] is False and r["reason"] == "no_free_seat",
                  "четвёртый пассажир: no_free_seat (%s)" % r["reason"])
            r = enter(a, "ped", "{}")
            check(r["ok"] is False and r["reason"] == "passenger_seated",
                  "повторная посадка того же пассажира: passenger_seated")
            r = enter(a, "ped3", "{ seat: 1 }")
            check(r["ok"] is False and r["reason"] == "seat_taken",
                  "занятое место: seat_taken (%s)" % r["reason"])

            # --- 3. Синк позиций при движении машины -------------------------
            r = run(a, """
                $('#car').at(800, 500).angle(0.5);
                __seats.update(1 / 60);
                const ax = 8, ay = 0, a = 0.5;
                const ex = 800 + ax * Math.cos(a) - ay * Math.sin(a);
                const ey = 500 + ax * Math.sin(a) + ay * Math.cos(a);
                const hx = $('#hero').get(0).x, hy = $('#hero').get(0).y;
                const px2 = $('#ped2').get(0);
                const bx = -24, by = 16;
                const ex2 = 800 + bx * Math.cos(a) - by * Math.sin(a);
                const ey2 = 500 + bx * Math.sin(a) + by * Math.cos(a);
                return { heroDx: Math.abs(hx - ex), heroDy: Math.abs(hy - ey),
                         ped2Dx: Math.abs(px2.x - ex2), ped2Dy: Math.abs(px2.y - ey2),
                         heroV: $('#hero').velocity() };
            """)
            check(r["heroDx"] < 0.01 and r["heroDy"] < 0.01,
                  "update-синк: водитель на повёрнутом якоре")
            check(r["ped2Dx"] < 0.01 and r["ped2Dy"] < 0.01,
                  "update-синк: пассажир на повёрнутом якоре")
            check(abs(r["heroV"]["x"]) < 0.01 and abs(r["heroV"]["y"]) < 0.01,
                  "пассажир не «уезжает» своим телом (скорость 0)")

            # --- 4. Выход по двери + снятие lock ------------------------------
            r = run(a, """
                const info = __seats.exit(__chars.ped);
                const a = 0.5, cx = 800, cy = 500;
                const wx = cx + (-24) * Math.cos(a), wy = cy + (-24) * Math.sin(a);
                const dx = info.x - wx, dy = info.y - wy;
                const fwd = { x: Math.cos(a), y: Math.sin(a) };
                const perp = { x: -Math.sin(a), y: Math.cos(a) };
                return { ok: info.ok, reason: info.reason, index: info.index,
                         nodeId: info.node.id, x: info.x, y: info.y,
                         forwardDot: Math.abs(dx * fwd.x + dy * fwd.y),
                         sideDot: dx * perp.x + dy * perp.y,
                         length: Math.hypot(dx, dy),
                         locks: $.input.lockCount(), hard: $.input.hardLocked(),
                         locked: $.input.locked('vehicle'),
                         canControl: __chars.ped.canControl(),
                         seated: __chars.ped.isSeated(),
                         parent: ($('#ped').parent().get(0) || {}).id || null,
                         nodeX: $('#ped').get(0).x, nodeY: $('#ped').get(0).y };
            """)
            check(r["ok"] is True and r["reason"] == "manual" and r["index"] == 1,
                  "выход пассажира с места 1 (%s)" % r["reason"])
            check(abs(r["forwardDot"]) < 0.01 and abs(r["length"] - 24) < 0.01,
                  "выход смещён перпендикулярно кузову на ejectOffset (%s)" % r["length"])
            check(r["sideDot"] < 0, "сторона door='left' даёт отрицательное смещение")
            check(abs(r["nodeX"] - r["x"]) < 0.01 and abs(r["nodeY"] - r["y"]) < 0.01,
                  "после выхода узел стоит в точке выхода")
            check(r["parent"] is None, "прежняя привязка к машине снята")
            check(r["locks"] == 2 and r["locked"] is True, "lock другого пассажира остался")
            check(r["canControl"] is True and r["seated"] is False,
                  "после выхода canControl()=true, isSeated()=false")
            check(run(a, "return {log: __seatLog[__seatLog.length - 1]};")["log"]["seated"] is False,
                  "onSeat(null) вызван при выходе")

            # --- 5. lock восстанавливается до нуля ---------------------------
            run(a, "__seats.exit(__chars.ped2); return {ok:true};")
            run(a, "__seats.exit(__chars.hero); return {ok:true};")
            r = run(a, """
                return { locks: $.input.lockCount(), hard: $.input.hardLocked(),
                         occupants: __seats.occupants(__veh).length };
            """)
            check(r["locks"] == 0 and r["hard"] is False and r["occupants"] == 0,
                  "после всех выходов lock-токенов нет")

            # --- 6. Advisory lock не мешает машине/выходу --------------------
            a.hold(["D"])
            a.step(1)
            before = a.eval("$.input.down('D')")
            run(a, "__seats.enter(__veh, __chars.hero, {seat: 0}); return {ok:true};")
            during = run(a, """
                return { down: $.input.down('D'), vec: $.input.vec('wasd'),
                         locked: $.input.locked('vehicle'),
                         canControl: __chars.hero.canControl() };
            """)
            run(a, "__seats.exit(__chars.hero); return {ok:true};")
            a.step(1)
            after = a.eval("$.input.down('D')")
            check(before is True and during["down"] is True,
                  "advisory lock оставляет клавиши машине и выходу")
            check(during["vec"]["x"] == 1, "input.vec() продолжает работать для управления машиной")
            check(during["locked"] is True and during["canControl"] is False,
                  "посадка помечена lock-токеном, ходить персонажу запрещает canControl")
            check(after is True, "после выхода клавиша по-прежнему читается")

            # жёсткий вариант — явный opts.hardLock (для сцен/катсцен)
            r = run(a, """
                $('<rect>', {id: 'car4'}).at(1100, 400).size(96, 48).body('dynamic')
                    .gravity(false).appendTo($.world);
                const veh4 = { node: $('#car4').get(0), seatsData: [{x: 0, y: 0}] };
                const hard = __gta.createSeats($, { hardLock: true });
                const e = hard.enter(veh4, __chars.ped3, { seat: 0 });
                const duringHard = { down: $.input.down('D'), hard: $.input.hardLocked(),
                                     vec: $.input.vec('wasd') };
                hard.exit(__chars.ped3);
                return { ok: e.ok, duringHard, afterDown: $.input.down('D'),
                         afterHard: $.input.hardLocked() };
            """)
            a.release_all()
            check(r["ok"] is True and r["duringHard"]["down"] is False
                  and r["duringHard"]["hard"] is True,
                  "hardLock:true явно гасит клавиши")
            check(r["duringHard"]["vec"]["x"] == 0, "hardLock:true гасит input.vec()")
            check(r["afterDown"] is True and r["afterHard"] is False,
                  "после выхода жёсткий лок снят")

            # --- 7. Событие 'death' машины высаживает -----------------------
            run(a, """
                __seats.enter(__veh, __chars.hero, {seat: 0});
                __seats.enter(__veh, __chars.ped, {seat: 1});
                return {ok: true};
            """)
            ejects_before = a.eval("__ejects.length")
            r = run(a, """
                $('#car').emit('death', { type: 'explosion' });
                return { occ: __seats.occupants(__veh).length,
                         locks: $.input.lockCount(),
                         heroAlive: !$('#hero').get(0).removed,
                         heroParent: ($('#hero').parent().get(0) || {}).id || null,
                         pedParent: ($('#ped').parent().get(0) || {}).id || null,
                         ejects: __ejects.length };
            """)
            check(r["occ"] == 0 and r["locks"] == 0, "death машины высадил всех и снял lock")
            check(r["heroAlive"] is True and r["heroParent"] is None and r["pedParent"] is None,
                  "после death пассажиры живы и не привязаны к машине")
            check(r["ejects"] == ejects_before + 2, "onEject сработал на обоих")
            check(run(a, "return {r: __ejects[__ejects.length - 1].reason};")["r"] == "vehicle_destroyed",
                  "reason последнего eject — vehicle_destroyed")

            # --- 8. Машина уничтожена через remove() с пассажирами ----------
            run(a, "__seats.release(__veh); return {ok:true};")
            run(a, "$('<rect>', {id: 'car2'}).at(700, 400).size(96, 48).body('dynamic')"
                    ".gravity(false).appendTo($.world);"
                    "__veh2 = { node: $('#car2').get(0), seatsData: ["
                    "{x:8,y:0,side:'front',door:'left'},{x:-24,y:0,side:'rear',door:'left'}] };"
                    "__seats.enter(__veh2, __chars.hero, {seat: 0});"
                    "__seats.enter(__veh2, __chars.ped, {seat: 1});"
                    "return { ok: true };")
            ejects_before = a.eval("__ejects.length")
            locks_before = a.eval("$.input.lockCount()")
            check(locks_before == 2, "перед destroy оба пассажира держат lock")
            r = run(a, """
                $('#car2').remove();
                __seats.update(1 / 60);
                return { carGone: $('#car2').length === 0,
                         heroAlive: !$('#hero').get(0).removed,
                         pedAlive: !$('#ped').get(0).removed,
                         heroParent: ($('#hero').parent().get(0) || {}).id || null,
                         pedParent: ($('#ped').parent().get(0) || {}).id || null,
                         locks: $.input.lockCount(),
                         ejects: __ejects.length,
                         heroX: $('#hero').get(0).x, heroY: $('#hero').get(0).y,
                         stateCount: __seats.count(),
                         children: __veh2.node.child_nodes.length,
                         canHero: __chars.hero.canControl() };
            """)
            check(r["carGone"] is True, "машина действительно удалена")
            check(r["heroAlive"] is True and r["pedAlive"] is True,
                  "пассажиры не уничтожены рекурсивным destroy()")
            check(r["heroParent"] is None and r["pedParent"] is None and r["children"] == 0,
                  "привязок к уничтоженной машине не осталось")
            check(r["locks"] == 0, "destroy машины снял lock-токены")
            check(r["ejects"] == ejects_before + 2, "destroy машины вызвал onEject на обоих")
            check(math.isfinite(r["heroX"]) and math.isfinite(r["heroY"]),
                  "высаженный пассажир получил конечную позицию")
            check(r["stateCount"] == 0, "состояние уничтоженной машины убрано из менеджера")
            check(r["canHero"] is True, "после уничтожения машины персонажем снова управляют")

            # --- 9. release снимает guard, менеджер переиспользуем -------------
            run(a, "$('<rect>', {id: 'car3'}).at(900, 400).size(96, 48).body('dynamic')"
                    ".gravity(false).appendTo($.world);"
                    "__veh3 = { node: $('#car3').get(0), seatsData: [{x:0,y:0}] };"
                    "__seats.enter(__veh3, __chars.hero, {seat: 0});"
                    "return { ok: true };")
            r = run(a, """
                const guarded = __seats._hasGuard(__veh3);
                const released = __seats.release(__veh3);
                return { guarded, released, guardAfter: __seats._hasGuard(__veh3),
                         locks: $.input.lockCount(), count: __seats.count() };
            """)
            check(r["guarded"] is True, "на время посадки стоит guard destroy()")
            check(r["released"] is True and r["guardAfter"] is False,
                  "release снимает guard")
            check(r["locks"] == 0 and r["count"] == 0, "release высадил всех и очистил состояние")
            r = run(a, """
                __seats.enter(__veh3, __chars.hero, {seat: 0});
                const again = __seats.occupants(__veh3).length;
                __seats.clear('scene');
                return { again, count: __seats.count(), locks: $.input.lockCount() };
            """)
            check(r["again"] == 1, "после release машину можно использовать снова")
            check(r["count"] == 0 and r["locks"] == 0, "clear() высадил всех (смена сцены)")
    finally:
        shutil.rmtree(FIXTURE, ignore_errors=True)

    print()
    if FAILURES:
        print("ПРОВАЛОВ: %d" % len(FAILURES))
        for f in FAILURES:
            print("  - " + f)
        sys.exit(1)
    print("Все проверки пройдены")
    sys.exit(0)


if __name__ == "__main__":
    main()
