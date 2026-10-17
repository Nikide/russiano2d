// ===========================================================================
// Re2D rotating polywall lab (P3): an authored wall rotates in place around an
// XY pivot. Coords are mutated in world.walls, so trace/blocked/render all see
// the same rotating segment without mesh/vertices or a topology rebuild.
// ===========================================================================
'use strict';

const MAP = 're2d_polywall_lab/polywall.re2dworld';
const VIEW = { x: 90, y: 200, h: 80, yaw: 0, pitch: 0, fov: 78, near: 4 };
const FRAME = { w: 640, h: 360 };

export default function install($) {
    let world = null;
    let hud = null;
    let group = null;
    let view = { ...VIEW };

    function traceAcross() {
        return world.trace({ from: { x: 100, y: 160, h: 80 }, to: { x: 380, y: 160, h: 80 }, mask: ['world'] });
    }

    $.agent.expose('re2dPolywallLab', () => {
        if (!world) return {};
        const info = group && group.info();
        const hit = traceAcross();
        return { angle: info ? info.angle : null, speed: info ? info.speed : null,
                 hit: hit ? { fraction: hit.fraction, type: hit.type, x: hit.x, y: hit.y } : null };
    });
    globalThis.re2dPolywall = {
        pause: () => { if (group) group.speed(0); return group && group.info(); },
        resume: (speed = 1.0) => { if (group) group.speed(speed); return group && group.info(); },
        angle: () => group && group.info().angle,
    };

    $.render(() => {
        if (!world) return;
        world.camera(view);
        world.render(view, FRAME.w, FRAME.h);
    });

    $.scene.add('re2d_polywall_lab', {
        enter($) {
            $.world.gravity(0, 0).color('#0b0e14');
            world = $.re2dWorld.load(MAP).backend('gpu');
            world.camera(view);
            world.lighting({ mode: 'classic', dynamic: true, shadows: false, distanceScale: 0.001 });
            // Wall index 4 is the authored spinner; outer walls stay static.
            group = world.polywall({ walls: [4], pivot: { x: 200, y: 200 }, angle: 0, speed: 0 });
            group.speed(1.0);
            hud = $.ui.doc('demos/re2d_polywall_lab/polywall.rml').show();
        },
        leave() {
            if (hud) hud.hide(); hud = null;
            if (group) { group.remove(); group = null; }
            if (world) { world.dispose(); world = null; }
            globalThis.re2dPolywall = null;
        },
    });

    $.update(() => {
        if (!world) return;
        if (hud && group) hud.text('status', `rotating polywall: angle ${group.info().angle.toFixed(2)} rad`);
        if ($.input.pressed('escape')) $.quit();
    });
}
