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

    globalThis.boomerLab = {
        moveProbe,
        setProbeRow(row) { if (probe) probe.node.get(0).sprite_row = Math.max(0, row | 0); },
        setProbeAngle(rad) { if (probe) { probe.def.angle = rad; probe.node.angle(rad); } },
        backend(name) { if (world) world.backend(name); },
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
