// ===========================================================================
// Re2D Open World lab (R-04/R-05/R-06): a map authored as Hammer-like solid
// brushes is compiled by `r2d-sdk world compile` into rectangular cells/spans,
// walls/tool materials, portals and a region grid. The runtime loads only the
// ordinary `.re2dworld`; this demo has no custom renderer, no 3D mesh and no
// second scene graph.
//
// Build:
//   r2d-sdk world compile demos/re2d_openworld_lab/openworld.re2dmap \
//       --renderer --region-size 256 \
//       --output demos/re2d_openworld_lab/openworld.re2dworld
//
// Controls: WASD walk, arrows look, F1 toggle HUD, Escape quit.
// ===========================================================================
'use strict';

const MAP = 're2d_openworld_lab/openworld.re2dworld';
const FRAME = { w: 960, h: 540 };
const SPAWN = { x: 160, y: 160, h: 96, yaw: 0.6, pitch: 0, fov: 1.15, near: 4 };
const PLAYER = { radius: 14, height: 56, speed: 260, step: 10, eye: 64 };

// Compiler metadata from the shipped .re2dworld (r2d-sdk world compile).
const REGIONS = {
    size: 256, columns: 8, rows: 8, count: 25, pvsEdges: 600,
    // Occupied grid slots (row * columns + col), sorted row-major exactly like
    // the compiler's region indices.
    slots: [1,3,6,8,9,10,11,13,15,17,19,20,22,24,25,26,27,29,31,41,43,46,53,55,62],
    cellCounts: [1,1,1,1,1,1,2,2, 1,1,1,9,1,1,1,2, 2,2,1,1,1,1,1,1, 1],
    brushes: 16, solids: 11, toolBrushes: 8, brushCells: 38, brushWalls: 100,
    brushPortals: 64, areaPortals: 20, uselessHints: 0, entities: 7,
};

export default function install($) {
    let world = null;
    let hud = null;
    let visible = true;
    const view = { ...SPAWN };
    let frames = 0;
    let lastRegion = -1;

    function regionAt(x, y) {
        const col = Math.floor(x / REGIONS.size);
        const row = Math.floor(y / REGIONS.size);
        if (col < 0 || row < 0 || col >= REGIONS.columns || row >= REGIONS.rows) return -1;
        return REGIONS.slots.indexOf(row * REGIONS.columns + col);
    }

    function move(dt) {
        const speed = PLAYER.speed * dt;
        const forward = $.input.down('w') - $.input.down('s');
        const strafe = $.input.down('d') - $.input.down('a');
        if (!forward && !strafe) return;
        const yaw = view.yaw;
        let dx = (Math.cos(yaw) * forward - Math.sin(yaw) * strafe) * speed;
        let dy = (Math.sin(yaw) * forward + Math.cos(yaw) * strafe) * speed;
        const bottom = view.h - PLAYER.eye;
        const nx = view.x + dx;
        if (world && typeof world.blocked === 'function' &&
            world.blocked(nx, view.y, PLAYER.radius, bottom, bottom + PLAYER.height)) {
            dx = 0;
        }
        const ny = view.y + dy;
        if (world && typeof world.blocked === 'function' &&
            world.blocked(view.x + dx, ny, PLAYER.radius, bottom, bottom + PLAYER.height)) {
            dy = 0;
        }
        view.x += dx;
        view.y += dy;
        const support = world && typeof world.support === 'function'
            ? world.support(view.x, view.y, view.h - PLAYER.eye + 0.01,
                            PLAYER.height, PLAYER.step)
            : null;
        if (support !== null && support !== undefined && support >= 0) {
            view.h = support + PLAYER.eye;
        }
    }

    function snapshot() {
        const info = world && typeof world.info === 'function' ? world.info() : null;
        const region = regionAt(view.x, view.y);
        if (region !== lastRegion) lastRegion = region;
        return {
            loaded: !!world,
            camera: { x: view.x, y: view.y, h: view.h },
            region,
            regionGrid: { size: REGIONS.size, columns: REGIONS.columns,
                          rows: REGIONS.rows, count: REGIONS.count,
                          pvsEdges: REGIONS.pvsEdges },
            compiler: { brushes: REGIONS.brushes, solids: REGIONS.solids,
                        toolBrushes: REGIONS.toolBrushes, cells: REGIONS.brushCells,
                        walls: REGIONS.brushWalls, portals: REGIONS.brushPortals,
                        areaPortals: REGIONS.areaPortals,
                        uselessHints: REGIONS.uselessHints,
                        entities: REGIONS.entities },
            world: info ? { cells: info.cells, portals: info.portals,
                            surfaces: info.visibleSurfaces, frame: frames } : null,
            note: 'region indices are the compiler row-major partition; runtime streaming states are native',
        };
    }

    globalThis.re2dOpenWorld = { snapshot, regionAt, toggleHud: () => { visible = !visible; if (hud) visible ? hud.show() : hud.hide(); } };
    $.agent.expose('re2dOpenWorld', snapshot);

    $.scene.add('re2d_openworld_lab', {
        enter($) {
            $.world.gravity(0, 0).color('#101722');
            world = $.re2dWorld.load(MAP).backend('gpu');
            world.camera(view);
            world.sky({ color: '#2b3a55' });
            world.lighting({ mode: 'classic', dynamic: true, shadows: false, distanceScale: 0.001 });
            hud = $.ui.doc('demos/re2d_openworld_lab/lab.rml').show();
            frames = 0;
        },
        leave() {
            if (hud) { hud.hide(); hud = null; }
            if (world) { world.dispose(); world = null; }
            globalThis.re2dOpenWorld = null;
        },
    });

    $.update((dt) => {
        if (!world) return;
        if ($.input.pressed('escape')) { $.quit(); return; }
        if ($.input.pressed('f1')) globalThis.re2dOpenWorld.toggleHud();
        if ($.input.pressed('left')) view.yaw -= 0.03;
        if ($.input.pressed('right')) view.yaw += 0.03;
        if ($.input.pressed('up')) view.pitch = Math.min(0.8, view.pitch + 0.02);
        if ($.input.pressed('down')) view.pitch = Math.max(-0.8, view.pitch - 0.02);
        move(Math.min(dt, 0.1));
        world.camera(view);
        if (hud) {
            const s = snapshot();
            hud.text('status', `region ${s.region < 0 ? '—' : s.region}/${REGIONS.count}` +
                ` · cells ${s.world ? s.world.cells : '?'} · portals ${s.world ? s.world.portals : '?'}` +
                ` · areaportals ${REGIONS.areaPortals}`);
            hud.text('stats', `brushes ${REGIONS.brushes} · solids ${REGIONS.solids}` +
                ` · tools ${REGIONS.toolBrushes} · pvs edges ${REGIONS.pvsEdges}` +
                ` · grid ${REGIONS.columns}×${REGIONS.rows} @ ${REGIONS.size}`);
        }
    });

    $.render(() => {
        if (!world) return;
        world.camera(view);
        world.render(view, FRAME.w, FRAME.h);
        frames++;
    });
}
