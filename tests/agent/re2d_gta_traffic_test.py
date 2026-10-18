#!/usr/bin/env python3
# ===========================================================================
# P1.3 population streaming + P2 polish smoke
# (demos/re2d_gta_sandbox/lib/population.js, lib/polish.js)
#
# Проверяет НАСТОЯЩИЙ движок: маленькая изолированная сцена, узлы Box2D не
# нужны — population работает с любыми узлами, а фокус задаётся точкой.
#   * counts/target/cooldown и maxPerUpdate;
#   * spawnDistance / despawnDistance / area of interest;
#   * filter-предикат и фильтр по declared/live tags (world.groundAt);
#   * защита persistent/mission через внедрённый ownership;
#   * детерминизм seed и отсутствие синглтона (два независимых пула);
#   * polish smoke: decal pool с лимитом/fade, VFX-эмиттер, top-down camera,
#     debug overlays и roof-fade audit (нет API → supported:false).
#
# Запуск: python3 tests/agent/re2d_gta_traffic_test.py
# ===========================================================================

import os
import shutil
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "tools"))
from agent_client import Agent, ROOT  # noqa: E402

LIB = os.path.join(ROOT, "demos", "re2d_gta_sandbox", "lib")
GAME = "/tmp/r2d_gta_traffic_test"
FAILURES = []


def check(ok, message):
    print(("  ok   " if ok else "  FAIL ") + message)
    if not ok:
        FAILURES.append(message)


def prepare():
    os.makedirs(os.path.join(GAME, "lib"), exist_ok=True)
    for name in ("roadgraph.js", "population.js", "polish.js"):
        shutil.copy2(os.path.join(LIB, name), os.path.join(GAME, "lib", name))
    with open(os.path.join(GAME, "project.json"), "w", encoding="utf-8") as f:
        f.write('{"title": "gta traffic test", "width": 640, "height": 360}')
    with open(os.path.join(GAME, "main.js"), "w", encoding="utf-8") as f:
        f.write(MAIN_JS)


MAIN_JS = r"""
import { createRoadGraph } from './lib/roadgraph.js';
import { createPopulation } from './lib/population.js';
import { createDecalPool, createVfxAttach, createTopDownCamera, createDebugOverlay, roofFadeAudit } from './lib/polish.js';

$.ready(() => {
    $.world.gravity(0, 0).bounds(0, 0, 900, 360);

    // Маленькая карта: прямая дорога + тротуары, точки спавна с тегами.
    const graph = createRoadGraph({
        roads: [{ id: 'main', points: [[0, 200], [900, 200]], lanes: 2, laneWidth: 32,
                  speedLimit: 120, parking: true, spawns: true }],
        walk: { zones: [{ x: 0, y: 240, w: 900, h: 40, spacing: 90 }] },
    });

    let focus = { x: 450, y: 200 };
    let population = null;
    let spawnSeq = 0;
    let fakeOwnership = null;
    const decalLog = { placed: 0, removed: 0, specs: [] };

    function fakeWorld() {
        // feature-detect путь population: живой world.groundAt без Re2D.
        return {
            groundAt(x, y) {
                if (x > 899.5) throw new RangeError('ambiguous XY');
                return { surface: 0, tags: y > 235 ? ['sidewalk'] : ['road'], height: 0 };
            },
        };
    }

    function worldFor(opts) {
        return opts.fakeWorld === true ? fakeWorld() : null;
    }

    function rebuild(opts = {}) {
        if (population) population.dispose();
        $('.pop').remove();
        spawnSeq = 0;
        const points = opts.points || graph.spawnPoints({ kind: 'ped' }).map((p) => ({ ...p, tags: ['sidewalk'] }));
        fakeOwnership = {
            kinds: new WeakMap(),
            mark(node, kind) { this.kinds.set(node, kind); },
            is(node, kind) {
                const k = this.kinds.get(node);
                return kind === undefined ? k !== undefined : k === kind;
            },
            handle(node) {
                return { node, alive: () => !node.removed && this.kinds.get(node) !== undefined,
                         get: () => (node.removed ? null : node) };
            },
        };
        population = createPopulation($, {
            targetCount: opts.targetCount === undefined ? 4 : opts.targetCount,
            spawnDistance: opts.spawnDistance === undefined ? 300 : opts.spawnDistance,
            despawnDistance: opts.despawnDistance === undefined ? 500 : opts.despawnDistance,
            minSpawnDistance: opts.minSpawnDistance || 0,
            cooldown: opts.cooldown || 0,
            maxPerUpdate: opts.maxPerUpdate || 1,
            minSeparation: opts.minSeparation || 0,
            seed: opts.seed === undefined ? 7 : opts.seed,
            tags: opts.tags || [],
            excludeTags: opts.excludeTags || ['no_spawn'],
            points,
            world: worldFor(opts),
            focus: () => focus,
            filter: opts.filter || null,
            ownership: opts.ownership === false ? null : fakeOwnership,
            spawn: (point, rng) => {
                const node = $('<npc>', { id: 'pop' + (spawnSeq++), class: 'pop' })
                    .at(point.x, point.y).size(10, 10).appendTo($.world);
                node.attr('spawnKind', point.kind || 'unknown');
                node.attr('zone', point.zone || '');
                node.attr('spawnTags', (point.tags || []).join(','));
                return node;
            },
        });
        return population;
    }

    function step(n = 1, dt = 1 / 60) {
        let out = null;
        for (let i = 0; i < n; i++) out = population.update(dt);
        return out;
    }

    globalThis.GTA = {
        graph,
        focus(x, y) { focus = { x, y }; return focus; },
        rebuild,
        step,
        target(n) { population.setTarget(n); return population.target(); },
        count() { return population.count(); },
        stats() { return population.stats(); },
        snapshot() { return population.snapshot(); },
        positions() { return population.snapshot().map((e) => [e.x, e.y, e.kind]); },
        spawnNow() { return population.spawnNow(); },
        protectFirst(kind) {
            const e = population.snapshot()[0];
            const node = $('#' + e.id).get(0);
            population.protect(node, kind || 'persistent');
            return population.snapshot().length;
        },
        clear() { return population.clear(); },
        dispose() { population.dispose(); population = null; },
        points() { return population.points(); },

        secondPool() {
            const p2 = createPopulation($, {
                targetCount: 2, spawnDistance: 900, cooldown: 0, seed: 1,
                points: [{ x: 450, y: 200, kind: 'car' }, { x: 460, y: 200, kind: 'car' }],
                focus: () => ({ x: 450, y: 200 }),
                ownership: fakeOwnership,
                spawn: (point) => $('<npc>', { class: 'pop2' }).at(point.x, point.y)
                    .size(10, 10).appendTo($.world),
            });
            p2.update(1 / 60);
            p2.update(1 / 60);
            const out = { second: p2.count(), first: population.count() };
            p2.dispose();
            $('.pop2').remove();
            return out;
        },

        re2dSurfaceTags() {
            if (!$.re2dWorld || typeof $.re2dWorld.fromJSON !== 'function') return { available: false };
            const text = JSON.stringify({ version: 1, cells: [
                { x: 0, y: 0, w: 200, h: 200, spans: [
                    { bottom: 0, top: 120, tags: ['road', 'driveable'] },
                    { bottom: 160, top: 280, tags: ['sidewalk', 'spawn'] } ] },
                { x: 200, y: 0, w: 200, h: 200, spans: [
                    { bottom: 0, top: 120, tags: ['sidewalk', 'no_spawn'] } ] },
            ], walls: [], portals: [] });
            const world = $.re2dWorld.fromJSON(text);
            const low = world.groundAt(50, 50, { h: 10 });
            const high = world.groundAt(50, 50, { h: 200 });
            let ambiguous = null;
            try { world.groundAt(50, 50); } catch (e) { ambiguous = e.message; }
            const g = createRoadGraph({ roads: [{ id: 'r', points: [[0, 50], [400, 50]],
                lanes: 1, spawns: [{ x: 50, y: 50 }, { x: 250, y: 50 }] }] });
            g.setWorld(world, { h: 10 });
            const roadSpawns = g.spawnPoints({ excludeTags: ['no_spawn'] });
            const sideSpawnsLow = g.spawnPoints({ tags: ['sidewalk'], excludeTags: [] });
            const gHigh = createRoadGraph({ roads: [{ id: 'r', points: [[0, 50], [400, 50]],
                lanes: 1, spawns: [{ x: 50, y: 50 }, { x: 250, y: 50 }] }] });
            gHigh.setWorld(world, { h: 200 });
            const sideSpawnsHigh = gHigh.spawnPoints({ tags: ['sidewalk'] });
            const out = {
                available: true, low, high, ambiguous,
                road: roadSpawns.map((p) => p.x), sideLow: sideSpawnsLow.map((p) => p.x),
                sideHigh: sideSpawnsHigh.map((p) => p.x),
                graphTags: g.tagsAt(50, 50),
            };
            try { world.dispose(); } catch (e) { /* Re2D world без dispose */ }
            return out;
        },

        polish() {
            const provider = {
                decal(spec) {
                    decalLog.placed++;
                    decalLog.specs.push({ ...spec });
                    return { remove() { decalLog.removed++; } };
                },
            };
            const decals = createDecalPool($, { max: 3, life: 1, provider });
            const a = decals.tyre(10, 10, { life: 10 });
            decals.tyre(20, 20, { life: 10 });
            decals.impact(30, 30, { life: 10 });
            decals.impact(40, 40, { life: 10 });   // лимит 3 → старейший вытеснен
            const afterLimit = { active: decals.count(), stats: decals.stats(), log: { placed: decalLog.placed, removed: decalLog.removed } };
            const expired = decals.update(10);
            const afterExpire = { active: decals.count(), expired, stats: decals.stats() };

            const target = $('<rect>', { id: 'camTarget', class: 'pop' }).at(200, 150).size(10, 10).appendTo($.world);
            const cam = createTopDownCamera($, { follow: '#camTarget', zoom: 1.5, bounds: { x: 0, y: 0, w: 900, h: 360 }, apply: true });
            cam.shake(5, 100);
            const camInfo = { zoom: $.camera.zoom(), limits: $.camera.limits(), followed: !!$.camera.followed() };

            const vfx = createVfxAttach($, {});
            const exhaust = vfx.exhaust(target, { amount: 4, preset: 'smoke' });
            const burst = vfx.burst('sparks', { x: 100, y: 100 }, { amount: 6 });
            const vfxInfo = { attached: !!exhaust, burst: !!burst, count: vfx.count(), stats: vfx.stats() };
            vfx.clear();

            const overlay = createDebugOverlay($, { roadGraph: graph, population, sampleStep: 128 });
            overlay.toggle('lanes', true);
            overlay.toggle('spawns', true);
            overlay.toggle('tags', true);
            const drawn = overlay.draw(0.016);
            const overlayInfo = { state: overlay.stats().state, drawn: !!drawn && drawn.drawn >= 0, stats: drawn };
            overlay.dispose();

            const roof = roofFadeAudit($, null);
            return { decals: { afterLimit, afterExpire }, cam: camInfo, vfx: vfxInfo, overlay: overlayInfo, roof };
        },
    };
});
"""


def main():
    prepare()
    with Agent(game=GAME, seed=7, fixed_dt=1.0 / 60.0) as a:
        # --- инвентарь -------------------------------------------------
        info = a.eval("GTA.graph.info()")
        check(info["roads"] == 1 and info["segments"] == 1, "граф загружен: 1 дорога/1 сегмент")
        check(info["walkNodes"] > 0, "пешеходные точки семплированы из walk-зоны")

        # --- counts / target ------------------------------------------
        a.eval("GTA.rebuild({targetCount: 4, spawnDistance: 900, cooldown: 0, points: GTA.graph.spawnPoints({kind:'car'})})")
        a.eval("GTA.step(10)")
        check(a.eval("GTA.count()") == 4, "население вышло на targetCount=4")
        snap = a.eval("GTA.snapshot()")
        check(all(e["kind"] == "car" for e in snap), "спавнятся только точки kind=car")
        check([e["seq"] for e in snap] == sorted(e["seq"] for e in snap), "snapshot упорядочен по seq (детерминизм)")

        # --- spawnDistance --------------------------------------------
        a.eval("GTA.rebuild({targetCount: 5, spawnDistance: 100, cooldown: 0, points: [{x:450,y:200,kind:'car'},{x:100,y:200,kind:'car'},{x:800,y:200,kind:'car'}], focus:null})")
        a.eval("GTA.focus(450, 200)")
        a.eval("GTA.step(6)")
        near = a.eval("GTA.snapshot()")
        check(len(near) == 1, "за пределами spawnDistance точки не спавнятся (1 из 3)")
        check(abs(near[0]["x"] - 450) < 1e-6, "спавн ровно в разрешённой точке AOI")

        # --- cooldown -------------------------------------------------
        a.eval("GTA.rebuild({targetCount: 3, cooldown: 1.0, spawnDistance: 900, points: [{x:450,y:200,kind:'car'},{x:460,y:200,kind:'car'},{x:470,y:200,kind:'car'}]})")
        a.eval("GTA.step(1, 0.1)")
        first = a.eval("GTA.count()")
        a.eval("GTA.step(3, 0.1)")
        still = a.eval("GTA.count()")
        cd = a.eval("GTA.stats()")["cooldown"]
        a.eval("GTA.step(1, 1.0)")
        after_cd = a.eval("GTA.count()")
        check(first == 1 and still == 1 and after_cd == 2, "cooldown держит спавн (1 → 1 → 2)")
        check(cd > 0, "cooldown отображается в stats, сек")

        # --- filter predicate -----------------------------------------
        a.eval("GTA.rebuild({targetCount: 3, spawnDistance: 900, filter: (p) => p.zone === 'ok',"
               " points: [{x:450,y:200,kind:'car',zone:'ok'},{x:460,y:200,kind:'car',zone:'no'},{x:470,y:200,kind:'car',zone:'no'}]})")
        a.eval("GTA.step(6)")
        filtered = a.eval("GTA.snapshot()")
        check(len(filtered) == 1 and abs(filtered[0]["x"] - 450) < 1e-6, "filter-предикат отбрасывает неподходящие точки")

        # --- tags (declared + live) -----------------------------------
        a.eval("GTA.rebuild({targetCount: 3, spawnDistance: 900, tags: ['sidewalk'], fakeWorld: true,"
               " points: [{x:450,y:250,kind:'ped'},{x:460,y:200,kind:'ped'},{x:470,y:250,kind:'ped'}]})")
        a.eval("GTA.step(6)")
        tagged = a.eval("GTA.snapshot()")
        check(len(tagged) == 2 and all(abs(e["y"] - 250) < 1e-6 for e in tagged),
              "фильтр по живым surface tags (sidewalk) работает")

        a.eval("GTA.rebuild({targetCount: 3, spawnDistance: 900, excludeTags: ['no_spawn'],"
               " points: [{x:450,y:200,kind:'car',tags:['no_spawn']},{x:460,y:200,kind:'car',tags:['road']}]})")
        a.eval("GTA.step(6)")
        excluded = a.eval("GTA.snapshot()")
        check(len(excluded) == 1 and abs(excluded[0]["x"] - 460) < 1e-6, "excludeTags no_spawn отбрасывает точку")

        # --- despawnDistance / AOI ------------------------------------
        a.eval("GTA.rebuild({targetCount: 3, spawnDistance: 900, despawnDistance: 200, points: [{x:450,y:200,kind:'car'},{x:460,y:200,kind:'car'}]})")
        a.eval("GTA.step(3)")
        check(a.eval("GTA.count()") == 2, "два объекта заспавнены")
        a.eval("GTA.target(0)")
        a.eval("GTA.focus(0, 0)")
        a.eval("GTA.step(1)")
        check(a.eval("GTA.count()") == 0, "объекты за despawnDistance выгружены")

        # --- ownership protection ------------------------------------
        a.eval("GTA.rebuild({targetCount: 2, spawnDistance: 900, despawnDistance: 100, points: [{x:450,y:200,kind:'car'},{x:460,y:200,kind:'car'}]})")
        a.eval("GTA.focus(450, 200)")
        a.eval("GTA.step(4)")
        before_protect = a.eval("GTA.count()")
        a.eval("GTA.protectFirst('persistent')")
        a.eval("GTA.target(0)")
        a.eval("GTA.focus(0, 0)")
        a.eval("GTA.step(1)")
        snap_after = a.eval("GTA.snapshot()")
        check(before_protect == 2 and len(snap_after) == 1 and snap_after[0]["persistent"] is True,
              "persistent-объект пережил выгрузку, temporary удалён")
        check(a.eval("GTA.stats()")["hasOwnership"] is True, "ownership подключён через dependency injection")

        # --- seed determinism и отсутствие синглтона -----------------
        a.eval("GTA.rebuild({targetCount: 3, spawnDistance: 900, cooldown: 0, seed: 42, points: GTA.graph.spawnPoints({kind:'car'})})")
        a.eval("GTA.step(5)")
        first_run = a.eval("GTA.positions()")
        a.eval("GTA.rebuild({targetCount: 3, spawnDistance: 900, cooldown: 0, seed: 42, points: GTA.graph.spawnPoints({kind:'car'})})")
        a.eval("GTA.step(5)")
        second_run = a.eval("GTA.positions()")
        check(first_run == second_run, "одинаковый seed → одинаковый набор точек (детерминизм)")
        a.eval("GTA.rebuild({targetCount: 2, spawnDistance: 900, cooldown: 0, points: GTA.graph.spawnPoints({kind:'car'})})")
        a.eval("GTA.step(2)")
        one = a.eval("GTA.count()")
        pools = a.eval("GTA.secondPool()")
        check(one == 2 and pools["first"] == one and pools["second"] == 2,
              "два независимых пула: нет синглтона, счётчики не смешиваются")

        # --- реальный Re2D groundAt + roadgraph (P0.1 interop) -------
        r2 = a.eval("GTA.re2dSurfaceTags()")
        check(r2["available"] is True and r2["low"]["tags"] == ["road", "driveable"]
              and r2["high"]["tags"] == ["sidewalk", "spawn"],
              "Re2D groundAt: road на h=10, sidewalk на h=200 в одной XY")
        check(r2["ambiguous"] is not None and "ambiguous" in r2["ambiguous"],
              "Re2D groundAt без h на двух span'ах — RangeError (не молчаливый этаж)")
        check(r2["road"] == [50] and "road" in r2["graphTags"]["tags"],
              "roadgraph читает живые теги и фильтрует no_spawn (реальный Re2D world)")
        check(r2["sideLow"] == [250] and r2["sideHigh"] == [50],
              "spawnPoints по sidewalk учитывает h (разные этажи → разные точки)")

        # --- polish smoke --------------------------------------------
        p = a.eval("GTA.polish()")
        check(p["decals"]["afterLimit"]["active"] == 3 and p["decals"]["afterLimit"]["stats"]["recycled"] == 1,
              "decal pool соблюдает лимит и вытесняет старейший decal")
        check(p["decals"]["afterExpire"]["active"] == 0 and p["decals"]["afterExpire"]["expired"] == 3,
              "decal pool истекает по жизни (fade/life), remove() вызван")
        check(p["cam"]["zoom"] == 1.5 and p["cam"]["followed"] is True and p["cam"]["limits"] is not None,
              "top-down camera preset: follow + zoom + bounds применены")
        check(p["vfx"]["attached"] is True and p["vfx"]["burst"] is True and p["vfx"]["count"] >= 1,
              "VFX: привязанный эмиттер exhaust и разовый burst созданы")
        check(p["overlay"]["drawn"] is True and p["overlay"]["stats"]["drawn"] >= 0,
              "debug overlay: lanes/spawns/tags отрисованы без падения")
        check(p["overlay"]["stats"]["samples"] >= 0, "debug overlay отдаёт счётчик семплов тегов")
        check(p["roof"]["supported"] is False and isinstance(p["roof"]["limitation"], str),
              "roof fade: API нет → supported:false с причиной (не подделка)")

        a.eval("GTA.dispose()")

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
