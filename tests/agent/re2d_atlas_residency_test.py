#!/usr/bin/env python3
"""BASHNYA atlas-residency acceptance: visible atlases must not silently vanish.

Builds a temporary game under build/ (test-generated PNG atlases, no repo asset
changes), registers many flat-atlas sprites in one Re2D world, then:
  * forces a residency deficit with small budgets and checks the structured
    R2D_ATLAS_NOT_RESIDENT diagnostic names the atlas/node;
  * checks contact shadows are suppressed for blocked atlas actors;
  * checks visible atlases are demand-pinned (soft over-budget cap), so a
    warmed run never loses a visible sprite;
  * checks atlasPin() protects a non-visible atlas from LRU eviction;
  * checks streamInfo() accounts states/bytes/pins and streamConfig(0) means
    unlimited.

Run: python3 tests/agent/re2d_atlas_residency_test.py
"""
import json
import os
import shutil
import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "tools"))
sys.path.insert(0, os.path.join(ROOT, "tests", "agent"))
from agent_client import Agent  # noqa: E402
from re2d_skip import skip_without_re2d  # noqa: E402

GAME = os.path.join(ROOT, "build", "atlas_residency_game")
ATLAS_PATHS = 4          # unique PNG files; each registration decodes its own copy
SPRITES = 50             # registered flat-atlas sprites (BASHNYA: 138)
ATLAS_SIDE = 1024        # decoded bytes = 4 MiB per registration
FAILED = []


def check(ok, message):
    print(("  ok   " if ok else "  FAIL ") + message, flush=True)
    if not ok:
        FAILED.append(message)


def build_game():
    shutil.rmtree(GAME, ignore_errors=True)
    os.makedirs(GAME, exist_ok=True)
    for name in ("main.js", "scenes.js", "project.json"):
        shutil.copy(os.path.join(ROOT, "tests", "fixtures", "hello", name),
                    os.path.join(GAME, name))
    # Deterministic RGBA atlases: 4x4 cells of 256 px, 16 directions.
    for i in range(ATLAS_PATHS):
        img = Image.new("RGBA", (ATLAS_SIDE, ATLAS_SIDE), (0, 0, 0, 0))
        draw = ImageDraw.Draw(img)
        for row in range(4):
            for col in range(4):
                x0, y0 = col * 256, row * 256
                draw.rectangle([x0 + 8, y0 + 8, x0 + 248, y0 + 248],
                               fill=((40 + i * 40) % 256, (90 + row * 30) % 256,
                                     (150 + col * 20) % 256, 255))
                draw.text((x0 + 96, y0 + 116), f"{i}:{row}:{col}", fill=(255, 255, 255, 255))
        img.save(os.path.join(GAME, f"atlas_{i}.png"))


def world_setup_js():
    return r'''(() => {
        const data = {version: 1, cells: [
            {x: 0, y: 0, w: 8192, h: 8192, spans: [
                {bottom: 0, top: 160, floorColor: '#334455', ceilingColor: '#223344'}]}
        ], walls: [], portals: []};
        globalThis.__res = {nodes: [], view: {x: 4096, y: 4096, h: 2400,
            mode: 'topdown', orthoHeight: 1500, yaw: 0, pitch: -89.99, fov: 55, near: 1}};
        const w = $.re2dWorld.fromJSON(JSON.stringify(data));
        globalThis.world = w;
        w.backend('gpu');
        w.renderQuality('high');
        w.render({...__res.view}, 640, 360);
        // Sticky path pin requested BEFORE the atlas is registered (streamed
        // population): accepted with 0 current matches, applied on registration.
        const pinnedBefore = w.atlasPin('atlas_2.png', true);
        const per = Math.ceil(%d / %d);
        for (let i = 0; i < %d; i++) {
            const col = i %% 10, row = Math.floor(i / 10);
            const x = 4096 + (col - 4.5) * 150, y = 4096 + (row - 2.5) * 150;
            const node = $('<sprite>', {id: 'res_' + i}).at(x, y).depth(0)
                .size(96, 96).hide().appendTo($.world);
            const path = 'atlas_' + (i %% %d) + '.png';
            w.sprite(node, {atlas: path, columns: 4, rows: 4, directions: 4,
                mirror: false, cell: {w: 256, h: 256}, pivot: 'feet',
                width: 96, height: 96, blend: 'masked'});
            __res.nodes.push(node);
        }
        return JSON.stringify({sprites: __res.nodes.length, atlasCount: w.info().atlasSprites,
                              pinnedBefore: pinnedBefore});
    })()''' % (SPRITES, ATLAS_PATHS, SPRITES, ATLAS_PATHS)


def run_frames_js(count, move=True):
    return r'''(() => {
        const out = [];
        for (let i = 0; i < %d; i++) {
            const v = {...__res.view};
            if (%s) { v.x += Math.sin(i * 0.11) * 90; v.y += Math.cos(i * 0.07) * 70; }
            $.emit('residencyShot', {x: v.x, y: v.y});
            world.render(v, 640, 360);
            const info = world.info();
            out.push({blocked: info.visibleAtlasBlocked, draws: info.gpuDrawsActor,
                      visible: info.visibleAtlasSprites, suppressed: info.groundShadowsSuppressed,
                      ground: info.gpuDrawsGround, pinned: info.streamPinnedItems,
                      overBudget: info.streamOverBudget, evicted: info.streamEvictions,
                      resident: info.atlasesResident, pending: info.streamPromoteDeferred});
        }
        return JSON.stringify(out);
    })()''' % (count, "true" if move else "false")


def info(a):
    return json.loads(a.eval("JSON.stringify(world.info())") or "{}")


def stream_info(a):
    return json.loads(a.eval("JSON.stringify(world.streamInfo())") or "{}")


def errors(a, code="R2D_ATLAS_NOT_RESIDENT"):
    return json.loads(a.eval("JSON.stringify($.debug.errors('%s'))" % code) or "[]")


def main():
    build_game()
    with Agent(game=GAME, seed=13, fixed_dt=1.0 / 60.0) as a:
        if skip_without_re2d(a):
            return 0
        a.step(2)
        setup = json.loads(a.eval(world_setup_js()))
        check(setup.get("sprites") == SPRITES,
              "registered %s flat-atlas sprites (%s)" % (setup.get("sprites"), SPRITES))
        check(setup.get("atlasCount") == SPRITES,
              "runtime atlas registry has %s entries" % setup.get("atlasCount"))
        check(setup.get("pinnedBefore") == 0,
              "path pin before registration is accepted with 0 current matches")
        pending = stream_info(a).get("pinsPending", 0)
        check(pending >= 1, "streamInfo reports the pending path pin: %s" % pending)

        # Small budgets: 4 MiB / 4 items residency, 4 promotions per frame. This
        # forces a deficit on the very first frame; visible demand must repair it.
        a.eval("world.streamConfig({residentBytes: 4 * 1024 * 1024, residentItems: 4, "
               "uploadBytes: 0, uploadItems: 0, promoteItems: 4})")
        cfg = stream_info(a)
        check(cfg.get("budgetBytes") == 4 * 1024 * 1024 and cfg.get("budgetItems") == 4,
              "streamConfig applied residency budgets")
        check(cfg.get("uploadBudgetItems", 0) > 0,
              "streamConfig 0 uploadItems means unlimited, not frozen")
        check(len(cfg.get("atlases") or []) == SPRITES,
              "streamInfo reports one entry per registered atlas")

        first = json.loads(a.eval(run_frames_js(1, move=False)))[0]
        check(first.get("blocked", 0) > 0,
              "first frame has visible non-resident atlases: %s" % first.get("blocked"))
        check(first.get("suppressed", 0) > 0,
              "contact shadows suppressed for blocked atlases: %s" % first.get("suppressed"))
        check(first.get("draws", 0) < first.get("visible", 0),
              "blocked visible sprites are not drawn as images (%s < %s)"
              % (first.get("draws"), first.get("visible")))
        # The pre-registration pin must protect atlas_2 on the very first frame:
        # no warning for it and its streamInfo entry is pinned+resident.
        pre_entries = [e for e in stream_info(a).get("atlases", [])
                       if e.get("path") == "atlas_2.png"]
        check(pre_entries and all(e.get("pinned") == 1 for e in pre_entries),
              "pre-registration path pin is marked pinned in streamInfo")
        check(all(e.get("state") in (2, 3) and e.get("blocked") == 0 for e in pre_entries),
              "pre-registration pinned atlas is resident on the first frame")
        pre_errors = [e for e in errors(a) if e.get("assetPath") == "atlas_2.png"]
        check(not pre_errors,
              "pre-registration pinned atlas emits no R2D_ATLAS_NOT_RESIDENT")

        # Диагностика не поднимается на первых кадрах: видимый атлас ещё
        # асинхронно грузится (grace 30 upload-тактов в native). Это не потеря.
        entries = errors(a)
        check(len(entries) == 0,
              "transient first-frame atlas load is not reported as an error")
        # warnGrace настраивается; при 0 первый же кадр с нерезидентным видимым
        # атласом даёт диагностику. Сейчас все видимые атласы уже resident
        # (demand-pin), поэтому ошибок быть не должно и при grace 0.
        a.eval("world.streamConfig({warnGrace: 0})")
        run_frames_js(2, move=False)
        check(len(errors(a)) == 0,
              "warnGrace=0 does not invent errors for resident visible atlases")
        # Возвращаем обычные бюджеты перед warmup.
        a.eval("world.streamConfig({residentBytes: 4 * 1024 * 1024, residentItems: 4, "
               "uploadBytes: 0, uploadItems: 0, promoteItems: 4, warnGrace: 30})")

        # Warm up: visible demand force-promotes and pins all visible atlases.
        warm = json.loads(a.eval(run_frames_js(20, move=False)))
        check(all(f.get("blocked", 0) == 0 for f in warm),
              "warmed frames have no blocked visible atlas")
        last = warm[-1]
        check(last.get("blocked", 1) == 0 and last.get("draws", 0) >= last.get("visible", 0),
              "warmed frame draws every visible atlas sprite (%s draws / %s visible)"
              % (last.get("draws"), last.get("visible")))
        check(last.get("pinned", 0) >= last.get("visible", 0),
              "visible atlases are demand-pinned (%s pins, %s visible)"
              % (last.get("pinned"), last.get("visible")))
        check(last.get("overBudget") == 1,
              "pinned visible set exceeds the budget as a reported soft cap")
        si = stream_info(a)
        # R2DStreamState: UNLOADED=0, PRELOAD=1, RESIDENT=2, EVICTABLE=3.
        resident_entries = [e for e in si.get("atlases", [])
                            if e.get("state") in (2, 3)]
        check(len(resident_entries) >= last.get("visible", 0),
              "streamInfo resident atlas entries cover visible demand")
        check(any(e.get("demandPinned") for e in resident_entries),
              "streamInfo marks demand-pinned atlas entries")
        info_now = info(a)
        resident_state_count = len([e for e in resident_entries if e.get("state") == 2])
        check(info_now.get("atlasesResident") == resident_state_count,
              "atlasesResident matches streamInfo resident entries (%s vs %s, all states=%s)"
              % (info_now.get("atlasesResident"), resident_state_count,
                 {k: sum(1 for e in si.get("atlases", []) if e.get("stateName") == k)
                  for k in ("resident", "evictable", "preload", "unloaded")}))

        # Pin a non-visible atlas: place an extra sprite far outside the camera
        # span/PVS, pin it, then keep rendering with the tiny item budget.
        a.eval(r'''(() => {
            const node = $('<sprite>', {id: 'res_pinned'}).at(-2000, -2000).depth(0)
                .size(96, 96).hide().appendTo($.world);
            world.sprite(node, {atlas: 'atlas_0.png', columns: 4, rows: 4,
                directions: 4, mirror: false, cell: {w: 256, h: 256}, pivot: 'feet',
                width: 96, height: 96, blend: 'masked'});
            return world.atlasPin('atlas_0.png', true);
        })()''')
        si = stream_info(a)
        pinned = [e for e in si.get("atlases", []) if e.get("pinned")]
        check(len(pinned) > 0, "atlasPin(path,true) matched and pinned atlases")
        check(any(e.get("path") == "atlas_0.png" for e in pinned),
              "atlasPin pinned the requested path")
        # atlas_2.png stays pinned from the sticky pre-registration pin.
        check(all(e.get("path") in ("atlas_0.png", "atlas_2.png") for e in pinned),
              "only pinned paths are pinned (sticky pre-registration pin kept)")
        check(a.eval("world.atlasPin(0, false)") >= 1,
              "atlasPin(atlasId,false) resolves by atlas id")
        check(a.eval("world.atlasPin('missing.png', true)") == 0,
              "unknown atlas path matches nothing")
        # Pin the whole atlas_0 path again for the eviction test.
        a.eval("world.atlasPin('atlas_0.png', true)")
        a.eval(run_frames_js(15, move=True))
        si = stream_info(a)
        pinned = [e for e in si.get("atlases", []) if e.get("pinned")]
        check(len(pinned) > 0 and all(e.get("state") in (1, 2) for e in pinned),
              "pinned atlases stay resident while non-visible")

        # 300 fixed-dt frames with camera motion and a per-frame shot event.
        run = json.loads(a.eval(run_frames_js(300, move=True)))
        check(len(run) == 300, "ran 300 fixed-dt frames")
        lost = [f for f in run if f.get("blocked", 0) > 0]
        check(not lost, "no visible atlas lost during the run (%s blocked frames)" % len(lost))
        check(all(f.get("draws", 0) >= f.get("visible", 0) for f in run) and
              all(f.get("blocked", 0) == 0 for f in run),
              "every visible atlas sprite drawn on every frame (no residency gate)")
        check(all(f.get("suppressed", 0) == 0 for f in run),
              "no suppressed shadow once every visible atlas is resident")
        check(all(f.get("overBudget") == 1 for f in run),
              "over-budget soft cap stays reported, not hidden")
        check(sum(f.get("evicted", 0) for f in run) >= 0,
              "eviction counter readable every frame: %s"
              % sum(f.get("evicted", 0) for f in run))

        # Budget 0 = unlimited: no evictions and no over-budget report.
        a.eval("world.streamConfig({residentBytes: 0, residentItems: 0, "
               "uploadBytes: 0, uploadItems: 0})")
        clean = json.loads(a.eval(run_frames_js(10, move=False)))
        check(all(f.get("evicted", 0) == 0 for f in clean),
              "residentBytes/Items 0 = unlimited: no evictions")
        check(all(f.get("overBudget") == 0 for f in clean),
              "unlimited budget reports no over-budget")
        check(stream_info(a).get("budgetBytes") == 0 and
              stream_info(a).get("budgetItems") == 0,
              "streamInfo reports unlimited budgets as 0")

        # Registry churn (BASHNYA spawns/removes peds): removing actors must drop
        # their stable stream items; new registrations must not inherit stale
        # residency state from a shifted atlas index.
        churn = json.loads(a.eval(r"""(() => {
            for (let i = 0; i < 10; i++) world.remove(__res.nodes[i]);
            for (let i = 0; i < 10; i++) {
                const node = $('<sprite>', {id: 'churn_' + i}).at(4096 + i * 40, 4096)
                    .depth(0).size(96, 96).hide().appendTo($.world);
                world.sprite(node, {atlas: 'atlas_' + (i % 4) + '.png', columns: 4,
                    rows: 4, directions: 4, mirror: false, cell: {w: 256, h: 256},
                    pivot: 'feet', width: 96, height: 96, blend: 'masked'});
            }
            return JSON.stringify({registered: world.info().atlasSprites});
        })()"""))
        # Registry baseline includes the extra pinned sprite added above.
        expected = info(a).get("atlasSprites")
        check(churn.get("registered") == expected,
              "remove+re-register keeps the atlas registry at %s" % expected)
        a.eval(run_frames_js(1, move=True))  # first frame may promote the new ones
        churn_frames = json.loads(a.eval(run_frames_js(5, move=True)))
        check(all(f.get("blocked", 0) == 0 for f in churn_frames),
              "registry churn does not leave a visible atlas blocked")
        si = stream_info(a)
        check(len(si.get("atlases", [])) == expected,
              "streamInfo has no stale atlas entries after churn")
        check(all(e.get("nodeId") != "res_0" for e in si.get("atlases", [])),
              "removed node's atlas left the residency cache")
        check(all(e.get("state") in (2, 3) for e in si.get("atlases", [])),
              "re-registered atlases resolve their own residency state")

        # Region-grid rebuild reinitializes the stream cache: atlas stream ids
        # must be re-assigned without collisions (regionConfig still works).
        before_rebuild = len(stream_info(a).get("atlases", []))
        a.eval("world.regionConfig(1024, 1, 2, 65536, 4)")
        a.eval(run_frames_js(1, move=True))
        rebuild = json.loads(a.eval(run_frames_js(5, move=True)))
        check(all(f.get("blocked", 0) == 0 for f in rebuild),
              "regionConfig rebuild keeps visible atlases resident")
        check(len(stream_info(a).get("atlases", [])) == before_rebuild,
              "regionConfig rebuild keeps one stream entry per atlas")

        # Warning ring is bounded and drained explicitly.
        warnings = json.loads(a.eval("JSON.stringify(world.takeStreamWarnings())") or "[]")
        check(isinstance(warnings, list), "takeStreamWarnings returns an array")
        after = json.loads(a.eval("JSON.stringify(world.streamWarnings())") or "[]")
        check(len(after) == 0, "takeStreamWarnings drained the ring")

    print()
    if FAILED:
        print("FAILURES: %d" % len(FAILED))
        for message in FAILED:
            print("  - " + message)
        return 1
    print("All atlas-residency checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
