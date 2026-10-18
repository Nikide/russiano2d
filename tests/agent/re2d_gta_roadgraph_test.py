#!/usr/bin/env python3
# ===========================================================================
# P1.4 road/walk graph (demos/re2d_gta_sandbox/lib/roadgraph.js)
#
# Изолированная сцена без Re2D: проверяются маршруты, one-way, ограничения
# скорости, полосы, парковки/точки спавна, пешеходный граф, авто-пересечения
# дорог-«крестов», surface tags (fake world.groundAt — тот же контракт, что у
# P0.1) и детерминизм/ошибки данных.
#
# Запуск: python3 tests/agent/re2d_gta_roadgraph_test.py
# ===========================================================================

import json
import os
import shutil
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "tools"))
from agent_client import Agent, ROOT  # noqa: E402

LIB = os.path.join(ROOT, "demos", "re2d_gta_sandbox", "lib")
GAME = "/tmp/r2d_gta_roadgraph_test"
FAILURES = []


def check(ok, message):
    print(("  ok   " if ok else "  FAIL ") + message)
    if not ok:
        FAILURES.append(message)


MAIN_JS = r"""
import { createRoadGraph, loadRoadGraph, laneCenter, segmentCross } from './lib/roadgraph.js';
import { createAI } from './lib/ai.js';

$.ready(() => {
    $.world.gravity(0, 0).bounds(0, 0, 900, 900);

    const fake = {
        groundAt(x, y, opts = {}) {
            if (x > 890 && opts.h === undefined) throw new RangeError('groundAt: ambiguous XY, h required');
            if (x > 890) return { surface: 3, tags: ['sidewalk', 'spawn'], height: opts.h };
            return { surface: 1, tags: y > 500 ? ['sidewalk', 'walkable'] : ['road', 'driveable'], height: 0 };
        },
    };

    const cross = createRoadGraph({
        roads: [
            { id: 'ew', kind: 'road', oneWay: false, speedLimit: 240, laneOffset: 24,
              points: [[0, 480], [900, 480]] },
            { id: 'ns', kind: 'road', oneWay: false, speedLimit: 240, laneOffset: 24,
              points: [[480, 0], [480, 900]] },
        ],
        walk: [
            { id: 'w.row', points: [[0, 560], [900, 560]] },
        ],
        spawns: [{ id: 'ped1', kind: 'pedestrian', x: 100, y: 560, tags: ['sidewalk'] },
                 { id: 'car1', kind: 'car', x: 200, y: 480, tags: ['road'] }],
        parking: [{ x: 700, y: 460, angle: 0 }],
    });
    cross.setWorld(fake);

    const simple = createRoadGraph({
        nodes: [{ id: 'a', x: 0, y: 0, intersection: false },
                { id: 'b', x: 300, y: 0 }],
        roads: [{ id: 'straight', from: 'a', to: 'b', lanes: 2, oneWay: false,
                  speedLimit: 100, laneWidth: 20, spawns: true, parking: false }],
    });

    const oneWay = createRoadGraph({
        roads: [{ id: 'ow', points: [[0, 100], [200, 100]], lanes: 2, oneWay: true,
                  speedLimit: 60, laneWidth: 20, spawns: true }],
    });

    const walk = createRoadGraph({
        walk: { zones: [{ id: 'side', x: 0, y: 0, w: 200, h: 100, spacing: 50, tags: ['sidewalk'] }] },
    });

    // Карта-крест без author-узла на пересечении: autoIntersections должен
    // вставить общий узел, иначе маршрут не повернёт.
    function loadJson() {
        const data = {
            roads: [{ id: 'j1', points: [[0, 0], [500, 0]], lanes: 1, speedLimit: 80 },
                    { id: 'j2', points: [[250, -200], [250, 200]], lanes: 1, speedLimit: 80 }],
        };
        const g = loadRoadGraph(JSON.stringify(data));
        return { info: g.info(), route: g.route([10, 0], [250, 190]), ids: g.nodesList().map((n) => n.id) };
    }

    function attempt(fn) {
        try { fn(); return null; } catch (e) { return e && e.message ? e.message : String(e); }
    }

    // --- AI primitives: узлы без тела двигаются через .at -----------------
    const walker = $('<sprite>', { id: 'walker', class: 'walker' }).at(0, 0).size(10, 10).appendTo($.world);
    const target = $('<sprite>', { id: 'target' }).at(200, 0).size(10, 10).appendTo($.world);
    const ai = createAI($, {});
    const ctrl = ai.controller(walker, { speed: 100, accel: 1000, arrive: 4 });
    const stimuli = [];
    ctrl.onStimulus((s) => stimuli.push({ type: s.type, x: s.x }));

    const aiDrive = createAI($, { roadGraph: simple });
    const car = $('<sprite>', { id: 'car' }).at(0, 0).size(12, 12).appendTo($.world);
    const vehicle = { calls: [], control(input) { this.calls.push({ ...input }); car.at(car.x + 2, car.y); } };
    const driver = aiDrive.controller(car, { speed: 100, vehicle });

    function run(c, seconds) {
        const frames = Math.max(1, Math.round(seconds * 60));
        for (let i = 0; i < frames; i++) c.update(1 / 60);
        return c.state();
    }

    const aiState = {};
    const zcalls = { enter: 0, leave: 0 };

    globalThis.GTA = {
        cross, simple, oneWay, walk, fake,
        info: () => cross.info(),
        simpleRoute: () => simple.route('a', 'b'),
        owForward: () => oneWay.route('ow#0', 'ow#1'),
        owBackward: () => oneWay.route('ow#1', 'ow#0'),
        crossRoute: () => cross.route([10, 480], [490, 890]),
        lanes: () => ({
            simple0: laneCenter(simple.segments[0], 0),
            simple1: laneCenter(simple.segments[0], 1),
            ow0: laneCenter(oneWay.segments[0], 0),
            ow1: laneCenter(oneWay.segments[0], 1),
        }),
        pathAlong(roadId, opts) { return cross.pathAlong(roadId, opts); },
        nearest(x, y) {
            const near = cross.nearestRoad(x, y);
            return near ? { roadId: near.roadId, distance: near.distance, t: near.t,
                            laneOffset: near.laneOffset, lanePoint: near.lanePoint,
                            oneWay: near.oneWay, speedLimit: near.speedLimit } : null;
        },
        spawns(opts) { return cross.spawnPoints(opts); },
        tags(x, y, h) { return cross.tagsAt(x, y, h === undefined || h === null ? {} : { h }); },
        walkRoute() {
            const nodes = walk.walkNodesList();
            const r = walk.route({ x: nodes[0].x, y: nodes[0].y },
                                 { x: nodes[nodes.length - 1].x, y: nodes[nodes.length - 1].y },
                                 { kind: 'walk', walkSpeed: 50 });
            return { nodes: nodes.length, edges: walk.walk.edges.length,
                     route: r ? { points: r.points.length, duration: r.duration, length: r.length } : null };
        },
        debugLines: () => cross.debugLines(),
        j: loadJson,
        errors: () => ({
            duplicate: attempt(() => { const g = createRoadGraph(); g.addRoad({ id: 'r', points: [[0, 0], [10, 0]] }); g.addRoad({ id: 'r', points: [[0, 10], [10, 10]] }); }),
            badPoint: attempt(() => createRoadGraph({ roads: [{ id: 'bad', points: [[0, 0], 'nope'] }] })),
            pad: attempt(() => createRoadGraph().pathAlong('nope')),
            badRoute: attempt(() => simple.route('a', 'nope')),
        }),
        segmentCross: () => segmentCross({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 }),
        det() {
            const a = JSON.stringify(cross.route([10, 480], [490, 890]));
            const b = JSON.stringify(cross.route([10, 480], [490, 890]));
            return { equal: a === b, a };
        },
        ai: {
            move() {
                walker.at(0, 0);
                ctrl.moveTo({ x: 100, y: 0 }, { direct: true });
                aiState.move = run(ctrl, 2.0);
                return { state: aiState.move, x: walker.x };
            },
            patrol() {
                walker.at(0, 0);
                ctrl.patrolTo([{ x: 60, y: 0 }, { x: 120, y: 0 }], { loop: false });
                const st = run(ctrl, 3.0);
                return { state: st, x: walker.x };
            },
            follow() {
                walker.at(0, 0);
                ctrl.follow({ x: 200, y: 0 }, { stopDistance: 20 });
                run(ctrl, 1.0);
                const d1 = Math.abs(walker.x - 200);
                run(ctrl, 1.0);
                const d2 = Math.abs(walker.x - 200);
                ctrl.stop();
                return { d1, d2 };
            },
            flee() {
                walker.at(0, 0);
                ctrl.fleeFrom({ x: 50, y: 0 }, { radius: 100 });
                const st = run(ctrl, 1.5);
                const out = { x: walker.x, status: st.status };
                ctrl.stop();
                return out;
            },
            look() {
                walker.at(0, 0);
                ctrl.lookAt({ x: 0, y: 10 });
                run(ctrl, 0.3);
                const a = walker.get(0).angle;
                ctrl.stop();
                return { angle: a };
            },
            stop() {
                walker.at(0, 0);
                ctrl.moveTo({ x: 100, y: 0 }, { direct: true });
                run(ctrl, 0.3);
                ctrl.stop();
                const before = walker.x;
                run(ctrl, 0.5);
                return { before, after: walker.x };
            },
            stimulus() {
                stimuli.length = 0;
                ai.stimulus({ type: 'gunshot', x: 40, y: 10, radius: 300 });
                return stimuli.slice();
            },
            zone() {
                zcalls.enter = 0; zcalls.leave = 0;
                const z = ai.zone({ name: 'testzone', x: 400, y: 0, w: 80, h: 80, detect: '#walker',
                                    onEnter: () => zcalls.enter++, onLeave: () => zcalls.leave++ });
                walker.at(400, 0);
                return { zone: z.name, inside: z.inside('#walker') };
            },
            zoneCalls() { return { ...zcalls }; },
            drive() {
                car.at(0, 0);
                driver.driveTo({ x: 300, y: 0 });
                const st = run(driver, 1.0);
                return { state: st, calls: vehicle.calls.length, x: car.x };
            },
        },
    };
});
"""


def prepare():
    os.makedirs(os.path.join(GAME, "lib"), exist_ok=True)
    shutil.copy2(os.path.join(LIB, "roadgraph.js"), os.path.join(GAME, "lib", "roadgraph.js"))
    shutil.copy2(os.path.join(LIB, "ai.js"), os.path.join(GAME, "lib", "ai.js"))
    with open(os.path.join(GAME, "project.json"), "w", encoding="utf-8") as f:
        f.write('{"title": "gta roadgraph test", "width": 640, "height": 360}')
    with open(os.path.join(GAME, "main.js"), "w", encoding="utf-8") as f:
        f.write(MAIN_JS)


def main():
    prepare()
    with Agent(game=GAME, seed=7, fixed_dt=1.0 / 60.0) as a:
        info = a.eval("GTA.info()")
        check(info["roads"] == 2 and info["segments"] == 4, "крест: 2 дороги → 4 сегмента (пересечение разрезало обе)")
        check(info["intersections"] == 1, "пересечение помечено intersection (degree 4)")
        check(info["mapSpawns"] == 2 and info["mapParking"] == 1, "spawns/parking уровня карты учтены")

        # --- route: длина/время/скорость ------------------------------
        r = a.eval("GTA.simpleRoute()")
        check(abs(r["length"] - 300) < 1e-6, "route: длина = 300")
        check(abs(r["duration"] - 3.0) < 1e-9, "route: duration = length / speedLimit (300/100 = 3 c)")
        check(r["legs"][0]["speedLimit"] == 100, "leg несёт speedLimit дороги")
        check(len(r["points"]) == 2 and r["points"][1]["x"] == 300, "route: точки от старта до цели")

        cross_route = a.eval("GTA.crossRoute()")
        check(cross_route is not None and len(cross_route["nodes"]) == 3,
              "route поворачивает на пересечении (ew → ix → ns)")
        ix = [n for n in cross_route["nodes"] if n.startswith("ix:")]
        check(len(ix) == 1, "в маршруте ровно один общий узел пересечения")

        # --- one-way --------------------------------------------------
        fwd = a.eval("GTA.owForward()")
        back = a.eval("GTA.owBackward()")
        check(fwd is not None and abs(fwd["length"] - 200) < 1e-6, "oneWay: маршрут по направлению есть")
        check(back is None, "oneWay: обратный маршрут запрещён (null)")

        # --- полосы ---------------------------------------------------
        lanes = a.eval("GTA.lanes()")
        check(abs(lanes["simple0"]["offset"] - 10) < 1e-6 and lanes["simple0"]["dir"]["x"] == 1,
              "two-way lane 0: смещение +10, вперёд")
        check(abs(lanes["simple1"]["offset"] + 10) < 1e-6 and lanes["simple1"]["dir"]["x"] == -1,
              "two-way lane 1: смещение -10, назад (встречное)")
        check(abs(lanes["ow0"]["offset"] + 10) < 1e-6 and abs(lanes["ow1"]["offset"] - 10) < 1e-6,
              "oneWay: полосы симметричны по ширине, направление вперёд")

        # --- pathAlong ------------------------------------------------
        along = a.eval("GTA.pathAlong('ew', {lane: 1, step: 100})")
        check(len(along) >= 9, "pathAlong: точки с шагом не больше step")
        check(abs(along[0]["y"] - (480 - 12)) < 1e-6, "pathAlong lane 1 смещён на -12 от оси")
        rev = a.eval("GTA.pathAlong('ew', {lane: 0, direction: -1, step: 100})")
        check(abs(rev[0]["x"] - along[-1]["x"]) < 1e-6 or rev[0]["x"] > rev[-1]["x"],
              "pathAlong direction:-1 идёт против направления")

        # --- nearestRoad ---------------------------------------------
        near = a.eval("GTA.nearest(200, 510)")
        check(near is not None and abs(near["distance"] - 30) < 1e-6, "nearestRoad: расстояние до оси 30")
        check(abs(near["t"] - (200 / 480)) < 1e-3, "nearestRoad: t — доля вдоль сегмента (крест разрезан на x=480)")
        check(near["oneWay"] is False and near["speedLimit"] == 240, "nearestRoad отдаёт oneWay/speedLimit")
        check(near["lanePoint"] is not None and abs(near["lanePoint"]["y"] - (480 + 12)) < 1e-6,
              "nearestRoad: lanePoint на полосе 0 (+12)")

        # --- spawn/parking/kind/tags ---------------------------------
        cars = a.eval("GTA.spawns({kind:'car'})")
        peds = a.eval("GTA.spawns({kind:'ped'})")
        check(all(p["kind"] == "car" for p in cars) and any(p["source"] == "parking" for p in cars),
              "spawnPoints kind=car включает парковку, без пешеходов")
        check(all(p["kind"] == "ped" for p in peds), "spawnPoints kind=ped — только пешеходные точки")
        sidewalk = a.eval("GTA.spawns({kind:'ped', tags:['sidewalk']})")
        check(len(sidewalk) >= 1, "spawnPoints фильтрует по declared tags sidewalk")
        no_spawn = a.eval("GTA.spawns({kind:'ped', excludeTags:['sidewalk']})")
        check(no_spawn == [], "excludeTags убирает все sidewalk-точки")
        live = a.eval("GTA.spawns({kind:'car', tags:['road'], world: GTA.fake})")
        check(len(live) >= 1, "spawnPoints использует живой world.groundAt (road)")

        # --- surface tags --------------------------------------------
        tagged = a.eval("GTA.tags(500, 600)")
        check("sidewalk" in tagged["tags"] and "no_spawn" not in tagged["tags"],
              "tagsAt: живые теги из world.groundAt")
        merged = a.eval("GTA.tags(500, 600, 0)")
        check(isinstance(merged["live"], list) and merged["ambiguous"] is False, "tagsAt: live/ambiguous факты структурированы")
        amb = a.eval("GTA.tags(895, 600)")
        check(amb["ambiguous"] is True and amb["error"] is not None and amb["live"] == [],
              "tagsAt: неоднозначный XY без h → ambiguous, без выдуманных тегов")

        # --- walk graph ----------------------------------------------
        wr = a.eval("GTA.walkRoute()")
        check(wr["nodes"] == 8 and wr["edges"] > 0, "walk-зона семплирована узлами с рёбрами (4×2)")
        check(wr["route"] is not None and wr["route"]["points"] >= 2, "пешеходный route по walk-графу строится")
        check(abs(wr["route"]["duration"] - wr["route"]["length"] / 50) < 1e-9,
              "walk route: duration = length / walkSpeed")

        # --- JSON-загрузка и авто-пересечения ------------------------
        j = a.eval("GTA.j()")
        check(j["info"]["nodes"] >= 4, "loadRoadGraph из JSON-строки")
        check(j["route"] is not None and len(j["route"]["nodes"]) == 3,
              "JSON-крест автоматически получил узел пересечения")
        check(any(n.startswith("ix:") for n in j["ids"]), "общий узел пересечения в графе")

        # --- debug/детерминизм/ошибки --------------------------------
        lines = a.eval("GTA.debugLines()")
        check(len(lines) == 8 and all("dir" in line and "lane" in line for line in lines),
              "debugLines: по линии на полосу каждого сегмента")
        det = a.eval("GTA.det()")
        check(det["equal"] is True, "route детерминирован (два вызова совпадают побайтно)")
        sc = a.eval("GTA.segmentCross()")
        check(sc is not None and abs(sc["x"] - 5) < 1e-9 and abs(sc["y"] - 5) < 1e-9,
              "segmentCross: чистая функция пересечения")
        errs = a.eval("GTA.errors()")
        check(errs["duplicate"] is not None and "уже есть" in errs["duplicate"],
              "ошибка: дубликат id дороги")
        check(errs["badPoint"] is not None and "точк" in errs["badPoint"],
              "ошибка: битая точка данных")
        check(errs["pad"] is not None and "нет дороги" in errs["pad"],
              "ошибка: pathAlong неизвестной дороги")
        check(errs["badRoute"] is not None and "не найден" in errs["badRoute"],
              "ошибка: route на неизвестный узел")

        # --- AI primitives (P1.5) ------------------------------------
        mv = a.eval("GTA.ai.move()")
        check(mv["x"] > 80 and mv["state"]["status"] == "arrive", "AI moveTo: дошёл до цели и встал (arrive)")
        pt = a.eval("GTA.ai.patrol()")
        check(pt["state"]["status"] == "arrive" and abs(pt["x"] - 120) < 8,
              "AI patrolTo: прошёл точки по порядку и остановился")
        fl = a.eval("GTA.ai.follow()")
        check(fl["d2"] < fl["d1"], "AI follow: расстояние до цели сокращается")
        fr = a.eval("GTA.ai.flee()")
        check(fr["x"] < 0 and fr["status"] == "arrive", "AI fleeFrom: ушёл от угрозы и остановился")
        lk = a.eval("GTA.ai.look()")
        check(abs(lk["angle"] - 1.5708) < 0.05, "AI lookAt: угол смотрит на цель")
        sp = a.eval("GTA.ai.stop()")
        check(abs(sp["after"] - sp["before"]) < 1e-6 or abs(sp["after"] - sp["before"]) < 1.5,
              "AI stop: движение прекращено")
        stim = a.eval("GTA.ai.stimulus()")
        check(len(stim) == 1 and stim[0]["type"] == "gunshot",
              "AI stimulus: подписка через $.on('stimulus') получила событие")
        z = a.eval("GTA.ai.zone()")
        check(a.eval("GTA.ai.zoneCalls()")["enter"] == 0, "AI zone: до кадра enter ещё не сработал")
        a.step(3)
        check(a.eval("GTA.ai.zoneCalls()")["enter"] == 1, "AI zone: enter сработал на кадре")
        drv = a.eval("GTA.ai.drive()")
        check(drv["state"]["route"] is not None and drv["calls"] > 0,
              "AI driveTo: маршрут roadgraph и vehicle.control получает команды")
        check(drv["x"] > 0, "AI driveTo: машина двигается по маршруту")

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
