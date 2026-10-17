// ===========================================================================
// Re2D boomer lab: native world sprites without the ui.image overlay hack.
//
// Stage P0-A of the boomer-shooter roadmap. The room geometry is the existing
// compiled testroom map; enemies are flat directional atlas frames drawn by the
// native world compositor:
//   * direction column is chosen in C from actor facing and camera position;
//   * feet pivot puts the authored pivot at the node depth;
//   * depth test hides a sprite behind the inner wall per pixel, no world.ray;
//   * world light/fog apply through the same path as world surfaces;
//   * no JS projection loop and no `ui.image` enemy overlay.
//
// Agent / manual probe: camera stands south of the inner wall, one probe sprite
// sits in front of it (centre of the screen) and the other sits behind the wall.
// Moving the probe with boomerLab.moveProbe() proves native pixel occlusion.
// ===========================================================================
'use strict';

const MAP = 're2d_testroom/testroom.re2dworld';
const ART = 're2d_testroom/assets/enemy_sheet.png';
const SHEET = { cols: 5, rows: 8, cw: 198, ch: 198 };
const HEIGHT = 150;

// Facing is radians; 0 = +X. The camera stands at (800,1080) looking north.
const ACTORS = [
    { id: 'left', x: 620, y: 860, angle: Math.PI, row: 1 },         // faces west
    { id: 'right', x: 980, y: 860, angle: 0, row: 2 },              // faces east
    { id: 'back', x: 700, y: 720, angle: Math.PI / 2, row: 3 },     // faces away
];
const CAMERA = { x: 800, y: 1080, h: 76, yaw: -90, pitch: 0, fov: 72, near: 4 };
const FRAME_W = 640;
const FRAME_H = 360;

export default function install($) {
    let world = null;
    let view = null;
    let actors = [];
    let probe = null;
    let hud = null;
    let frames = 0;
    let mover = null;
    let trigger = null;
    let triggerSeen = [];

    function projectPoint(x, y, h) {
        const yaw = view.yaw * Math.PI / 180, pitch = view.pitch * Math.PI / 180;
        const dx = x - view.x, dy = y - view.y, dh = h - view.h;
        const cp = Math.cos(pitch), sp = Math.sin(pitch), cy = Math.cos(yaw), sy = Math.sin(yaw);
        const zf = dx * cy * cp + dy * sy * cp + dh * sp;
        if (zf < 8) return null;
        const right = -dx * sy + dy * cy;
        const up = -dx * sp * cy - dy * sp * sy + dh * cp;
        const focal = (FRAME_H / 2) / Math.tan(view.fov * Math.PI / 360);
        return { x: FRAME_W / 2 + focal * right / zf, y: FRAME_H / 2 - focal * up / zf, z: zf };
    }

    function makeActor(def) {
        const node = $('<sprite>', { id: 'lab-' + def.id })
            .at(def.x, def.y).depth(0).size(HEIGHT, HEIGHT).angle(def.angle)
            .hide()
            .appendTo($.world);
        node.get(0).sprite_row = def.row;
        // Native hit proxy: vertical cylinder attached to the existing node.
        world.hit(node, { radius: 45, height: HEIGHT, category: 'enemy' });
        const handle = world.sprite(node, {
            atlas: ART, columns: SHEET.cols, rows: SHEET.rows,
            directions: 5, mirror: true,
            cell: { w: SHEET.cw, h: SHEET.ch }, pivot: 'feet',
            width: HEIGHT, height: HEIGHT, blend: 'masked',
        });
        return { def, node, handle };
    }

    function frame() {
        if (!world || !view) return;
        world.render(view, FRAME_W, FRAME_H);
        frames++;
    }

    const summarize = hit => {
        if (!hit) return null;
        return {
            type: hit.type, fraction: Math.round(hit.fraction * 1000) / 1000,
            nodeId: hit.node ? hit.node.id : null,
            surface: hit.surface, span: hit.span,
        };
    };
    const trace = (to, mask, ignore) => summarize(world.trace({
        from: { x: view.x, y: view.y, h: view.h }, to, mask, ignore,
    }));
    const traceAll = (to, mask) => world.traceAll({
        from: { x: view.x, y: view.y, h: view.h }, to, mask,
    }).map(summarize);

    function moveProbe(x, y) {
        if (!probe) return false;
        probe.def.x = x;
        probe.def.y = y;
        probe.node.at(x, y);
        return true;
    }

    $.agent.expose('re2dBoomerLab', () => {
        const info = world && typeof world.info === 'function' ? world.info() : null;
        return {
            map: MAP,
            backend: info && info.backend,
            info: info ? {
                atlasSprites: info.atlasSprites,
                visibleAtlasSprites: info.visibleAtlasSprites,
                composedActors: info.composedActors,
                frameMs: info.frameMs,
            } : null,
            camera: view,
            probe: probe ? { x: probe.def.x, y: probe.def.y } : null,
            actors: actors.map((a) => ({
                id: a.def.id, x: a.def.x, y: a.def.y,
                angle: a.def.angle, row: a.def.row,
                screen: view ? projectPoint(a.def.x, a.def.y, 0) : null,
            })),
            frames,
            uiEnemyOverlays: 0,
            nativeWorldSprite: true,
        };
    });

    // High-level P0 probes: semantic IDs, controller, mover, trigger. They are
    // intentionally thin: the demo only calls the public $ API.
    const findProbe = () => ({
        north: world.findWall('north'),
        room: world.findCell('room'),
        missing: world.findWall('no.such.wall'),
        surfaceKind: world.findSurface('north')?.kind ?? null,
    });
    const controllerProbe = () => {
        const ctrl = world.controller({ radius: 14, height: 56, step: 9, slopeLimit: 50 });
        ctrl.place(800, 1080, 0);
        let state = ctrl.state();
        for (let i = 0; i < 60; i++) state = ctrl.move({ dx: 0, dy: -1, dt: 1 / 60 });
        ctrl.remove();
        return state;
    };
    const moverProbe = () => {
        mover = world.mover({ type: 'lift', span: 0, from: 0, to: 96, speed: 240, wait: 0.5, autoReturn: true });
        mover.open();
        return mover.info();
    };
    const triggerProbe = () => {
        triggerSeen = [];
        world.onTrigger('lab.use', event => triggerSeen.push(event.target));
        trigger = world.trigger({ type: 'use', id: 'lab.use', target: 'gate.main',
            x: view.x, y: view.y, radius: 200, bottom: 0, top: 150 });
        return true;
    };

    globalThis.boomerLab = {
        trace, traceAll,
        findProbe, controllerProbe, moverProbe, triggerProbe,
        triggerUse: () => world.triggerUse({ x: view.x, y: view.y, h: view.h }),
        triggerEvents: () => triggerSeen,
        navProbe: () => {
            const build = world.navBuild({ radius: 14, height: 56, step: 18 });
            const node = world.navNearest(800, 1080);
            const path = world.navPath(node, node);
            return { build, node, path };
        },
        automapProbe: () => {
            const lines = world.automapLines(null);
            return { lines: lines.length, first: lines[0] ?? null,
                     proj: world.automapProject({ cx: 800, cy: 600, scale: 0.5, rotation: 0 }, 800, 600) };
        },
        metadataProbe: () => ({
            meta: world.metadata(), count: world.spawns().length,
            player: world.spawn('player.start'), missing: world.spawn('nope'),
        }),
        particlesClear: () => world.particles.clear(),
        saveProbe: () => {
            world.particles.clear();
            if (!mover) mover = world.mover({ type: 'lift', span: 0, from: 0, to: 96,
                speed: 240, wait: 1, autoReturn: true });
            mover.open();
            const save = world.saveState();
            mover.close();
            const before = { movers: world.info().movers, triggers: world.info().triggers,
                spans: save.state.spans.length, portals: save.state.portals.length,
                sm: save.state.movers.length, st: save.state.triggers.length };
            let restored = false, error = null;
            try { restored = world.loadState(save); } catch (e) { error = String(e); }
            const info = mover.info();
            return { restored, error, before, hash: save.map.hash, fraction: info.fraction,
                     phase: info.phase, spans: save.state.spans.length,
                     portals: save.state.portals.length, movers: save.state.movers.length };
        },
        fxProbe: () => {
            world.particles.clear();
            if (!world._fxDefined) {
                world.fxDefine('lab.impact', {
                    particles: [{ count: 90, life: 2.5, size: 46, color: '#ff2040', alpha: 0.8,
                        blend: 'translucent', mode: 'billboard', speed: 0, spread: 0 }],
                    light: { radius: 260, intensity: 2, color: '#ff7040', life: 0.5, shadow: false },
                });
                world._fxDefined = true;
            }
            const before = world.info().lights;
            const spawned = world.fxSpawn('lab.impact', { x: 800, y: 900, h: 80, dx: 0, dy: -1 });
            return { spawned, particles: world.particles.info(), lightsBefore: before, lightsAfter: world.info().lights };
        },
        particleProbe: () => {
            world.particles.clear();
            const spawned = world.particles.burst({ x: 800, y: 900, h: 80, count: 80,
                life: 3, size: 50, color: '#ff2040', alpha: 0.8, blend: 'translucent',
                mode: 'billboard', seed: 7 });
            return { spawned, info: world.particles.info() };
        },
        particleInfo: () => world.particles.info(),
        moverProbeInfo: () => (mover ? mover.info() : null),
        moverClose: () => { if (mover) mover.close(); },
        moveProbe,
        setProbeRow(row) { if (probe) probe.node.get(0).sprite_row = Math.max(0, row | 0); },
        setProbeAngle(rad) { if (probe) { probe.def.angle = rad; probe.node.angle(rad); } },
        backend(name) { if (world) world.backend(name); },
        probeNode() { return probe ? probe.node.get(0) : null; },
        probeScreen() { return probe ? projectPoint(probe.def.x, probe.def.y, 0) : null; },
        state() { return { probe: probe && { x: probe.def.x, y: probe.def.y } }; },
    };

    $.render(frame);

    $.scene.add('re2d_boomer_lab', {
        enter($) {
            $.world.gravity(0, 0).color('#0b0e14');
            view = { ...CAMERA };
            world = $.re2dWorld.load(MAP).backend('gpu');
            world.lighting({ mode: 'classic', dynamic: true, shadows: true, distanceScale: 0.001 });
            world.camera(view);
            actors = ACTORS.map(makeActor);
            probe = makeActor({ id: 'probe', x: 800, y: 900, angle: -Math.PI / 2, row: 0 });
            frames = 0;
            hud = $.ui.doc('demos/re2d_boomer_lab/lab.rml').show();
        },
        leave() {
            if (hud) hud.hide();
            hud = null;
            if (world && typeof world.dispose === 'function') world.dispose();
            world = null;
            view = null;
            actors = [];
            probe = null;
            if (mover) { mover.remove(); mover = null; }
            if (trigger) { trigger.remove(); trigger = null; }
            globalThis.boomerLab = null;
        },
    });

    $.update(() => {
        if (!world) return;
        world.camera(view);
        if (hud) hud.text('status', `atlas sprites: ${actors.length + (probe ? 1 : 0)} · native world sprite`);
        if ($.input.pressed('escape')) $.quit();
    });
}
