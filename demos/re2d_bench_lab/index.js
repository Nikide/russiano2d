// ===========================================================================
// Re2D benchmark lab (P4): switchable worst-case scenarios with measured
// numbers. This is a measurement scene, not a game: every scenario loads
// authored Re2D topology and registers native work, then reports the native
// profiler snapshot. No thresholds are asserted here — numbers are recorded by
// tests/agent/re2d_bench_lab_test.py and docs/RE2D_WORLD_PERF.md.
// ===========================================================================
'use strict';

const ROOM_MAP = 're2d_testroom/testroom.re2dworld';
const PORTAL_MAP = 're2d_dust2/dust2.re2dworld';
const ART = 're2d_testroom/assets/enemy_sheet.png';
const CELL = { w: 198, h: 198 };
const CAMERA = { x: 800, y: 1080, h: 76, yaw: -90, pitch: 0, fov: 72, near: 4 };
const FRAME = { w: 640, h: 360 };

export default function install($) {
    let world = null;
    let view = { ...CAMERA };
    let scenario = 'base';
    let actors = [];
    let lights = [];
    let hud = null;

    function resetWorld(map) {
        for (const node of actors) { world.remove(node); node.remove(); }
        actors = [];
        for (const light of lights) { try { light.remove(); } catch (error) { /* gone */ } }
        lights = [];
        world.particles.clear();
        if (world && world._map !== map) {
            world.dispose();
            world = $.re2dWorld.load(map).backend('gpu');
            world._map = map;
        }
        world.quality({ poseBudget: 4, poseStep: 3 });
        world.camera(view);
        world.lighting({ mode: 'classic', dynamic: true, shadows: true, distanceScale: 0.001 });
        // Synchronous frame timing: frameMs then includes the GPU fence wait.
        world.profile({ gpuWait: true });
    }

    function spawnActors(count) {
        for (let i = 0; i < count; i++) {
            const x = 120 + (i % 16) * 96;
            const y = 140 + Math.floor(i / 16) * 150;
            const node = $('<sprite>', { id: `bench-actor-${i}` })
                .at(x, y).depth(0).size(120, 120).angle(-Math.PI / 2).hide().appendTo($.world);
            node.get(0).sprite_row = i % 4;
            world.sprite(node, { atlas: ART, columns: 5, rows: 8, directions: 5, mirror: true,
                cell: CELL, pivot: 'feet', width: 120, height: 120, blend: 'masked' });
            actors.push(node);
        }
    }

    function spawnLights(count) {
        for (let i = 0; i < count; i++) {
            lights.push(world.light({ x: 100 + (i % 8) * 190, y: 120 + Math.floor(i / 8) * 180,
                h: 160, radius: 260, intensity: 1.4, color: i % 2 ? '#ff9a60' : '#7fb2ff', shadow: i < 8 }));
        }
    }

    function apply(name) {
        scenario = name;
        world.particles.budget(2048);
        if (name === 'portals' || name === 'movers') {
            if (!world || world._map !== PORTAL_MAP) {
                resetWorld(PORTAL_MAP);
                view = { x: 0, y: 0, h: 76, yaw: 0, pitch: 0, fov: 72, near: 4 };
                world.camera(view);
            }
            for (const node of actors) { world.remove(node); node.remove(); } actors = [];
            for (const light of lights) { try { light.remove(); } catch (error) { } } lights = [];
            world.particles.clear();
            world.navBuild({ radius: 14, height: 56, step: 18 });
            if (name === 'movers') {
                for (let i = 0; i < 16 && i < world.info().spans; i++) {
                    const m = world.mover({ type: i % 2 ? 'lift' : 'platform', span: i,
                        from: 0, to: 64, speed: 120 + i, wait: 0.2, autoReturn: true });
                    m.open(); lights.push(m);
                }
            }
            return;
        }
        world.particles.budget(2048);
        if (world._map !== ROOM_MAP) {
            resetWorld(ROOM_MAP);
            view = { ...CAMERA };
            world.camera(view);
        } else {
            for (const node of actors) { world.remove(node); node.remove(); } actors = [];
            for (const light of lights) { try { light.remove(); } catch (error) { } } lights = [];
            world.particles.clear();
        }
        if (name === 'actors_100' || name === 'worstcase') spawnActors(100);
        if (name === 'lights_32' || name === 'worstcase') spawnLights(32);
        if (name === 'particles_2000' || name === 'worstcase') {
            world.particles.burst({ x: 800, y: 860, h: 80, count: 2000, life: 30, size: 22,
                color: '#ff7040', alpha: .7, blend: 'additive', mode: 'billboard', seed: 11 });
        }
        if (name === 'worstcase') {
            world.particles.burst({ x: 700, y: 700, h: 60, count: 1000, life: 30, size: 14,
                color: '#80c0ff', alpha: .5, blend: 'translucent', mode: 'billboard', seed: 12 });
        }
    }

    function hudText() {
        if (!world) return '';
        const i = world.info();
        return `frame ${i.frameMs.toFixed(2)}ms · vis ${i.visibilityMs.toFixed(2)} · actor ${i.actorMs.toFixed(2)} · surface ${i.surfaceMs.toFixed(2)} · draws ${i.gpuDraws} · actors ${i.atlasSprites} · lights ${i.lights} · particles ${i.particles}`;
    }
    function snapshot() {
        const info = world.info();
        return {
            scenario, map: world._map || ROOM_MAP, backend: info.backend,
            actors: info.atlasSprites, lights: info.lights, particles: info.particles,
            surfaces: info.visibleSurfaces, draws: info.gpuDraws,
            frameMs: info.frameMs, visibilityMs: info.visibilityMs, actorMs: info.actorMs,
            surfaceMs: info.surfaceMs, compositionMs: info.compositionMs,
            navMs: info.navMs, movers: info.movers, hud: hudText(),
        };
    }

    $.agent.expose('re2dBenchLab', snapshot);
    globalThis.re2dBench = { apply, snapshot };

    $.render(() => { if (world) { world.camera(view); world.render(view, FRAME.w, FRAME.h); } });

    $.scene.add('re2d_bench_lab', {
        enter($) {
            $.world.gravity(0, 0).color('#0b0e14');
            world = $.re2dWorld.load(ROOM_MAP).backend('gpu');
            world._map = ROOM_MAP;
            view = { ...CAMERA };
            world.camera(view);
            world.lighting({ mode: 'classic', dynamic: true, shadows: true, distanceScale: 0.001 });
            world.quality({ poseBudget: 4, poseStep: 3 });
            world.profile({ gpuWait: true });
            apply('base');
            hud = $.ui.doc('demos/re2d_bench_lab/bench.rml').show();
        },
        leave() {
            if (hud) hud.hide(); hud = null;
            for (const node of actors) { world.remove(node); node.remove(); } actors = [];
            for (const light of lights) { try { light.remove(); } catch (error) { } } lights = [];
            if (world) { world.dispose(); world = null; }
            globalThis.re2dBench = null;
        },
    });

    $.update(() => {
        if (!world) return;
        if (hud) { hud.text('status', `${scenario}: actors ${actors.length} · lights ${world.info().lights} · particles ${world.info().particles}`); hud.text('profiler', hudText()); }
        if ($.input.pressed('escape')) $.quit();
    });
}
