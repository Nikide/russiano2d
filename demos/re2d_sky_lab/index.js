// ===========================================================================
// Re2D sky-portal lab (P2): two authored rooms connected by a portal whose
// opening is a window to the panorama sky. `re2dSky.set(true)` marks the portal
// as sky: visibility stops at the far cell, so the opening shows the sky
// background instead of the neighbouring room. This is not a 3D portal render
// pass and not a mesh: the 2D 2.5D topology decides reachability.
// ===========================================================================
'use strict';

const MAP = 're2d_sky_lab/sky.re2dworld';
const VIEW = { x: 150, y: 150, h: 80, yaw: 0, pitch: 0, fov: 75, near: 4 };
const FRAME = { w: 640, h: 360 };

export default function install($) {
    let world = null;
    let hud = null;
    let view = { ...VIEW };

    function setMirror(on) {
        if (!world) return null;
        if (on) world.portalSky(0, false);
        world.portalMirror(0, on);
        return { on: !!on, mirror: world.portalMirrorGet(0) };
    }

    function setSky(on) {
        if (!world) return null;
        if (on) world.portalMirror(0, false);
        world.portalSky(0, on);
        world.sky({ color: '#ff00cc' });
        return { on: !!on, sky: world.portalSkyGet(0) };
    }

    $.agent.expose('re2dSkyLab', () => {
        if (!world) return {};
        const info = world.info();
        return { sky: world.portalSkyGet(0), mirror: world.portalMirrorGet(0), cells: info.cells, portals: info.portals,
                 surfaces: info.visibleSurfaces, backend: info.backend };
    });
    globalThis.re2dSky = { set: setSky, mirror: setMirror };

    $.render(() => {
        if (!world) return;
        world.camera(view);
        world.render(view, FRAME.w, FRAME.h);
    });

    $.scene.add('re2d_sky_lab', {
        enter($) {
            $.world.gravity(0, 0).color('#0b0e14');
            world = $.re2dWorld.load(MAP).backend('gpu');
            world.camera(view);
            world.sky({ color: '#ff00cc' });
            world.lighting({ mode: 'classic', dynamic: true, shadows: false, distanceScale: 0.001 });
            hud = $.ui.doc('demos/re2d_sky_lab/sky.rml').show();
        },
        leave() {
            if (hud) hud.hide(); hud = null;
            if (world) { world.dispose(); world = null; }
            globalThis.re2dSky = null;
        },
    });

    $.update(() => {
        if (!world) return;
        if ($.input.pressed('f1')) globalThis.re2dSky.mirror(!world.portalMirrorGet(0));
        if ($.input.pressed('f2')) globalThis.re2dSky.set(!world.portalSkyGet(0));
        if ($.input.pressed('f3')) { globalThis.re2dSky.mirror(false); globalThis.re2dSky.set(false); }
        if (hud) hud.text('status', `portal: ${world.portalMirrorGet(0) ? 'MIRROR' : world.portalSkyGet(0) ? 'SKY' : 'normal'} · cells ${world.info().cells} · portals ${world.info().portals}`);
        if ($.input.pressed('escape')) $.quit();
    });
}
