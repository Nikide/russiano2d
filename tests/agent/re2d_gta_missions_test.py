#!/usr/bin/env python3
# ===========================================================================
# P1.6 mission hooks (demos/re2d_gta_sandbox/lib/missions.js)
#
# Миссии — данные + hooks поверх $.triggers.zone / $.signal / $.save и
# собственного update(dt). Изолированная сцена: игрок, две зоны доставки,
# чекпоинты, событие, счётчик, таймер и проверка сохранения состояния.
#
# Запуск: python3 tests/agent/re2d_gta_missions_test.py
# ===========================================================================

import json
import os
import shutil
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "tools"))
from agent_client import Agent, ROOT  # noqa: E402

LIB = os.path.join(ROOT, "demos", "re2d_gta_sandbox", "lib")
GAME = "/tmp/r2d_gta_missions_test"
FAILURES = []


def check(ok, message):
    print(("  ok   " if ok else "  FAIL ") + message)
    if not ok:
        FAILURES.append(message)


MAIN_JS = r"""
import { createMissions, deliveryMission, checkpointMission } from './lib/missions.js';

$.ready(() => {
    $.world.gravity(0, 0).bounds(0, 0, 900, 600);
    const player = $('<player>', { id: 'player', class: 'player' }).at(100, 300)
        .size(20, 20).appendTo($.world);

    let events = [];
    let missions = null;

    function record(name, payload) { events.push({ name, payload }); }

    function reset() {
        if (missions) missions.dispose();
        $('.mission-zone').remove();
        events = [];
        missions = createMissions($, { player: '#player', saveKey: 'gta.missions.test' });
        const signals = ['mission:started', 'mission:stage', 'mission:complete', 'mission:failed'];
        for (const name of signals) {
            $.signal.on(name, (payload) => record(name, { id: payload && payload.id, stage: payload && payload.stage,
                                                           reason: payload && payload.reason }));
        }
        return true;
    }

    function defineDelivery() {
        missions.define(deliveryMission({
            id: 'pizza', title: 'Пицца',
            pickup: { x: 250, y: 300, w: 80, h: 80 },
            dropoff: { x: 700, y: 300, w: 80, h: 80 },
            cargo: 'pizza', timeLimit: 30,
            onStart: () => record('hook:start', { id: 'pizza' }),
            onStage: (ctx, stage) => record('hook:stage', { id: 'pizza', stage }),
            onComplete: () => record('hook:complete', { id: 'pizza' }),
            onFail: (ctx, reason) => record('hook:fail', { id: 'pizza', reason }),
        }));
        return missions.def('pizza') !== null;
    }

    function defineAll() {
        defineDelivery();
        missions.define({
            id: 'timed', title: 'Таймер',
            timeLimit: 1.0,
            stages: [{ id: 'wait', kind: 'event', signal: 'go:now' }],
            onFail: (ctx, reason) => record('hook:fail', { id: 'timed', reason }),
        });
        missions.define(checkpointMission({
            id: 'checkpoints', title: 'Три точки',
            points: [{ x: 300, y: 420, radius: 40 }, { x: 500, y: 420, radius: 40 }, { x: 700, y: 420, radius: 40 }],
        }));
        missions.define({
            id: 'evented', title: 'Событие',
            stages: [{ id: 'wait', kind: 'event', signal: 'custom:done' },
                     { id: 'finish', kind: 'event', signal: 'custom:finish' }],
            onComplete: () => record('hook:complete', { id: 'evented' }),
        });
        missions.define({
            id: 'counted', title: 'Счётчик',
            stages: [{ id: 'kills', kind: 'counter', counter: 'kills', count: 2 }],
            onComplete: () => record('hook:complete', { id: 'counted' }),
        });
        return true;
    }

    globalThis.GTA = {
        reset() { return reset(); },
        defineDelivery,
        defineAll,
        accept(id) { return missions.accept(id); },
        update(ms) { missions.update(ms); return missions.active(); },
        status(id) { return missions.status(id); },
        state(id) { return missions.state(id); },
        counter(name, n) { return missions.counter(name, n); },
        emit(name, payload) { $.signal.emit(name, payload || {}); return true; },
        move(x, y) { player.at(x, y); return { x: player.x, y: player.y }; },
        events() { return events.slice(); },
        clearEvents() { events = []; return true; },
        zoneCount() { return $('.mission-zone').length; },
        playerPos() { return { x: player.x, y: player.y }; },
        save() { return missions.save(); },
        store() { return missions.saveToStore(); },
        loadStore() { return missions.loadFromStore(); },
        load(snapshot) { return missions.load(snapshot); },
        resetMissions() { missions.reset(); return true; },
        defs() { return missions.definitions().map((d) => d.id); },
        active() { return missions.active(); },
        deliveryCargo() {
            const st = missions.state('pizza');
            return st ? { status: st.status, stage: st.stage, cargo: st.data.pizza === true, remaining: st.remaining } : null;
        },
        timed() { const st = missions.state('timed'); return st ? { status: st.status, remaining: st.remaining } : null; },
        cp() { const st = missions.state('checkpoints'); return st ? { status: st.status, stage: st.stage } : null; },
        ev() { const st = missions.state('evented'); return st ? { status: st.status, stage: st.stage } : null; },
        counted() { const st = missions.state('counted'); return st ? { status: st.status, stage: st.stage, counters: st.counters } : null; },
        names() { return events.map((e) => e.name); },
        hookFailReason(id) {
            const e = events.find((x) => x.name === 'hook:fail' && x.payload.id === id);
            return e ? e.payload.reason : null;
        },
    };
});
"""


def prepare():
    os.makedirs(os.path.join(GAME, "lib"), exist_ok=True)
    shutil.copy2(os.path.join(LIB, "missions.js"), os.path.join(GAME, "lib", "missions.js"))
    with open(os.path.join(GAME, "project.json"), "w", encoding="utf-8") as f:
        f.write('{"title": "gta missions test", "width": 640, "height": 360}')
    with open(os.path.join(GAME, "main.js"), "w", encoding="utf-8") as f:
        f.write(MAIN_JS)


def main():
    prepare()
    with Agent(game=GAME, seed=7, fixed_dt=1.0 / 60.0) as a:
        # --- доставка: pickup → dropoff -------------------------------
        a.eval("GTA.reset()")
        check(a.eval("GTA.defineDelivery()") is True, "deliveryMission определена")
        check(a.eval("GTA.accept('pizza')") is True, "миссия взята (accept) → active")
        st = a.eval("GTA.state('pizza')")
        check(st["status"] == "active" and st["stage"] == 0, "старт: этап 0 (pickup)")
        check(a.eval("GTA.zoneCount()") == 1, "для текущего этапа создана одна trigger-зона")
        check("mission:started" in a.eval("GTA.names()"), "сигнал mission:started отправлен")

        a.eval("GTA.move(250, 300)")
        a.step(3)
        st = a.eval("GTA.deliveryCargo()")
        check(st["stage"] == 1 and st["cargo"] is True, "pickup: этап 1, груз получен (data.pizza)")
        check("mission:stage" in a.eval("GTA.names()"), "сигнал mission:stage отправлен на переходе")
        check("hook:stage" in a.eval("GTA.names()"), "hook onStage вызван")

        a.eval("GTA.move(700, 300)")
        a.step(3)
        st = a.eval("GTA.deliveryCargo()")
        check(st["status"] == "done", "dropoff: миссия завершена (done)")
        check("mission:complete" in a.eval("GTA.names()"), "сигнал mission:complete отправлен")
        check("hook:complete" in a.eval("GTA.names()"), "hook onComplete вызван")
        check(a.eval("GTA.zoneCount()") == 0, "зоны завершённой миссии убраны (нет утечки trigger-узлов)")
        check(a.eval("GTA.accept('pizza')") is False, "не-repeatable миссию нельзя взять повторно")

        # --- сохранение/загрузка через $.save ------------------------
        check(a.eval("GTA.store()") is True, "состояние записано в $.save")
        a.eval("GTA.reset()")
        a.eval("GTA.defineAll()")
        loaded = a.eval("GTA.loadStore()")
        check(loaded >= 1 and a.eval("GTA.status('pizza')") == "done",
              "loadFromStore восстановил завершённую миссию")
        check(a.eval("GTA.zoneCount()") == 0, "после загрузки done-миссии зоны не создаются")

        # --- timeLimit → fail ----------------------------------------
        a.eval("GTA.reset()")
        a.eval("GTA.defineAll()")
        a.eval("GTA.accept('timed')")
        a.eval("GTA.update(0.5)")
        check(a.eval("GTA.timed()")["status"] == "active", "таймер: 0.5 из 1.0 c — активна")
        a.eval("GTA.update(0.6)")
        check(a.eval("GTA.timed()")["status"] == "failed", "таймер: 1.1 c → failed")
        check(a.eval("GTA.hookFailReason('timed')") == "timeout", "hook onFail получил reason=timeout")
        check("mission:failed" in a.eval("GTA.names()"), "сигнал mission:failed отправлен")

        # --- checkpoint: порядок нельзя перескочить -------------------
        a.eval("GTA.reset()")
        a.eval("GTA.defineAll()")
        a.eval("GTA.accept('checkpoints')")
        check(a.eval("GTA.cp()")["stage"] == 0, "чекпоинты: старт с 0")
        a.eval("GTA.move(300, 420)")
        a.step(3)
        check(a.eval("GTA.cp()")["stage"] == 1, "чекпоинт 0 пройден → этап 1")
        a.eval("GTA.move(700, 420)")     # третий чекпоинт, минуя второй
        a.step(3)
        check(a.eval("GTA.cp()")["stage"] == 1, "перескок через чекпоинт не засчитан (этап всё ещё 1)")
        a.eval("GTA.move(500, 420)")
        a.step(3)
        check(a.eval("GTA.cp()")["stage"] == 2, "чекпоинт 1 пройден → этап 2")
        a.eval("GTA.move(700, 420)")
        a.step(3)
        check(a.eval("GTA.cp()")["status"] == "done", "последний чекпоинт завершил миссию")

        # --- event-этап ----------------------------------------------
        a.eval("GTA.reset()")
        a.eval("GTA.defineAll()")
        a.eval("GTA.accept('evented')")
        a.eval("GTA.emit('custom:done')")
        check(a.eval("GTA.ev()")["stage"] == 1, "event-этап: сигнал перевёл на этап 1")
        a.eval("GTA.emit('custom:finish')")
        check(a.eval("GTA.ev()")["status"] == "done", "event-этап: второй сигнал завершил миссию")

        # --- counter-этап --------------------------------------------
        a.eval("GTA.reset()")
        a.eval("GTA.defineAll()")
        a.eval("GTA.accept('counted')")
        a.eval("GTA.counter('kills', 1)")
        check(a.eval("GTA.counted()")["stage"] == 0, "counter: 1 из 2 — этап ещё не пройден")
        a.eval("GTA.counter('kills', 1)")
        check(a.eval("GTA.counted()")["status"] == "done", "counter: 2 из 2 — миссия завершена")
        check(a.eval("GTA.counted()")["counters"]["kills"] == 2, "counter сохранил накопленное значение")

        # --- save()/load() снимком и reset() -------------------------
        a.eval("GTA.reset()")
        a.eval("GTA.defineDelivery()")
        a.eval("GTA.accept('pizza')")
        a.eval("GTA.move(250, 300)")
        a.step(3)
        snap = a.eval("GTA.save()")
        check(snap["version"] == 1 and snap["missions"]["pizza"]["stage"] == 1,
              "save(): снимок содержит версию и этап миссии")
        a.eval("GTA.resetMissions()")
        check(a.eval("GTA.status('pizza')") == "available", "reset() вернул миссию в available")
        a.eval("GTA.load(" + json.dumps(snap) + ")")
        check(a.eval("GTA.status('pizza')") == "active" and a.eval("GTA.deliveryCargo()")["stage"] == 1,
              "load(): активная миссия восстановлена на том же этапе")
        check(a.eval("GTA.deliveryCargo()")["cargo"] is True, "load(): данные миссии (груз) восстановлены")
        check(a.eval("GTA.zoneCount()") == 1, "load(): зона текущего этапа пересоздана")

        # --- детерминизм одинакового сценария -----------------------
        a.eval("GTA.reset()")
        a.eval("GTA.defineDelivery()")
        a.eval("GTA.accept('pizza')")
        a.eval("GTA.move(250, 300)")
        a.step(2)
        run1 = a.eval("GTA.state('pizza')")
        a.eval("GTA.reset()")
        a.eval("GTA.defineDelivery()")
        a.eval("GTA.accept('pizza')")
        a.eval("GTA.move(250, 300)")
        a.step(2)
        run2 = a.eval("GTA.state('pizza')")
        check(run1 == run2, "одинаковый сценарий при fixed-dt даёт одинаковое состояние")

    print()
    if FAILURES:
        print("ПРОВАЛОВ: %d" % len(FAILURES))
        for f in FAILURES:
            print("  - " + f)
        return 1
    print("все проверки пройдены")
    return 0


if __name__ == "__main__":
    sys.exit(main())
