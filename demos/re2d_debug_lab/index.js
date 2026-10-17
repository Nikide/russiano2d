// ===========================================================================
// Re2D debug-overlay lab (P4): automap skeleton, semantic entities and boss
// hit-zone markers driven by world.debug.overlay/draw onto the engine's debug
// draw layer. Data comes from the world, drawing stays in the $ API.
// ===========================================================================
'use strict';

const MAP = 're2d_testroom/testroom.re2dworld';
const VIEW = { x: 800, y: 1080, h: 76, yaw: -90, pitch: 0, fov: 72, near: 4 };
const FRAME = { w: 640, h: 360 };

export default function install($) {
    let world = null;
    let hud = null;
    let enabled = true;
    let view = { ...VIEW };
    let overlay = { lines: 0, points: 0 };

    function setup() {
        world.camera(view);
        world.lighting({ mode: 'classic', dynamic: true, shadows: true, distanceScale: 0.001 });
        world.trigger({ id: 'debug.gate', target: 'gate', x: 800, y: 960, radius: 48, bottom: 0, top: 160 });
        world.secret({ id: 'debug.secret', x: 600, y: 900, radius: 36, bottom: 0, top: 96, once: true });
        const boss = $('<sprite>', { id: 'debug-boss' }).at(1000, 900).depth(0).size(150, 150).angle(-Math.PI / 2).hide().appendTo($.world);
        world.hit(boss, { radius: 48, height: 150, category: 'enemy', zones: [
            { from: 0, to: .45, multiplier: 1 }, { from: .45, to: .8, multiplier: 2 }, { from: .8, to: 1, multiplier: 4 }] });
        world.navBuild({ radius: 14, height: 56, step: 18 });
        world.automapLines();
    }

    $.render(() => {
        if (!world) return;
        world.camera(view);
        world.render(view, FRAME.w, FRAME.h);
        if (enabled) {
            overlay = world.debug.draw(view, { width: 1280, height: 720, hitZones: true }) || overlay;
        } else if ($.gfx && $.gfx.draw) $.gfx.draw.clear();
    });

    $.agent.expose('re2dDebugLab', () => ({
        enabled, lines: overlay.lines.length || 0, points: overlay.points.length || 0,
        nav: world ? world.info().navQueries : 0,
    }));
    globalThis.re2dDebugLab = {
        toggle: on => { enabled = on === undefined ? !enabled : !!on; return enabled; },
        enabled: () => enabled,
    };

    $.scene.add('re2d_debug_lab', {
        enter($) {
            $.world.gravity(0, 0).color('#0b0e14');
            world = $.re2dWorld.load(MAP).backend('gpu');
            view = { ...VIEW };
            setup();
            hud = $.ui.doc('demos/re2d_debug_lab/debug.rml').show();
        },
        leave() {
            if (hud) hud.hide(); hud = null;
            if ($.gfx && $.gfx.draw) $.gfx.draw.clear();
            if (world) { world.dispose(); world = null; }
            globalThis.re2dDebugLab = null;
        },
    });

    $.update(() => {
        if (!world) return;
        if (hud) hud.text('status', `debug overlay: ${enabled ? 'ON' : 'off'} · lines ${overlay.lines.length || 0} · points ${overlay.points.length || 0}`);
        if ($.input.pressed('f1')) globalThis.re2dDebugLab.toggle();
        if ($.input.pressed('escape')) $.quit();
    });
}
