// ===========================================================================
// Collision alignment fixture (tests/agent/collision_align_test.py).
//
// Not a game: a compiled one-room map, one native player controller, and one
// flat atlas sprite drawn the way the GTA-city test game places its hero
// (node.x = controller.x - width/2, depth = feet + height/2 + 3). The fixture
// exposes ALIGN so the agent test can move the controller in four directions
// and into the room walls, then compare the rendered sprite centroid with the
// controller's projected ground point.
//
// There is no HUD, weapon overlay or second render path: the screenshot shows
// only the world frame, so the pixel centroid measures the sprite itself.
// ===========================================================================
'use strict';

const MAP = 'align.re2dworld';
const ART = 'magenta128.png';
const START = { x: 600, y: 450 };
const HERO_SIZE = 112;
// Eye height is above the room's 320-unit walls: the near-top-down camera then
// sees no wall face that could occlude the probe at wall contact.
const view = {
    x: START.x, y: START.y, h: 900, projection: 'perspective',
    pitch: -89.99, yaw: 0, fov: 55, near: 1,
};

$.ready(() => {
    const world = $.re2dWorld.load(MAP);
    world.camera(view);
    const node = $('<sprite>', { id: 'align-probe' })
        .at(0, 0).depth(0).size(HERO_SIZE, HERO_SIZE).hide().appendTo($.world);
    world.sprite(node, {
        atlas: ART, columns: 1, rows: 1, directions: 1,
        cell: { w: 128, h: 128 }, pivot: 'center',
        width: HERO_SIZE, height: HERO_SIZE, blend: 'masked',
    });
    const ctrl = world.controller({ radius: 10, height: 48, step: 8, slopeLimit: 50 });

    const S = {
        world, view, node, ctrl,
        start: { ...START }, state: ctrl.state() ?? null,
        wish: { x: 0, y: 0 }, contact: false, still: 0, frames: 0,
        placement: 'game',          // 'game' | 'center'
        overlay: false,             // draw the exact controller footprint
    };

    const placeNode = (st) => {
        const off = S.placement === 'game' ? HERO_SIZE / 2 : 0;
        node.at(st.x - off, st.y).depth(st.feet + HERO_SIZE / 2 + 3).show();
    };

    S.reset = () => {
        ctrl.place(START.x, START.y, 0);
        S.state = ctrl.state();
        S.wish.x = 0;
        S.wish.y = 0;
        S.contact = false;
        S.still = 0;
        S.frames = 0;
        view.x = START.x;
        view.y = START.y;
        placeNode(S.state);
    };
    S.reset();

    $.update((dt) => {
        const prev = S.state;
        const st = ctrl.move({ dx: S.wish.x, dy: S.wish.y,
            dt: Math.min(Math.max(dt, 1e-4), 0.05) });
        S.state = st;
        S.frames += 1;
        placeNode(st);
        view.x = st.x;
        view.y = st.y;
        const moving = Math.hypot(S.wish.x, S.wish.y) > 0;
        const moved = Math.hypot(st.x - prev.x, st.y - prev.y);
        if (moving && moved < 0.001) S.still += 1; else S.still = 0;
        if (moving && S.still >= 6) S.contact = true;
    });

    $.render(() => {
        world.camera(view);
        world.render(null, 1024, 576);
        if (S.overlay) {
            const s = $.window.size();
            world.debug.draw(view, { width: s.w, height: s.h, controllers: [ctrl] });
        }
    });

    globalThis.ALIGN = S;
});
