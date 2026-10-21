// ===========================================================================
// Re2D Open World lab (R-04/R-05/R-06): a map authored as Hammer-like solid
// brushes is compiled by `r2d world compile` into rectangular cells/spans,
// walls/tool materials, portals and a region grid. The runtime loads only the
// ordinary `.re2dworld`; this demo has no custom renderer, no 3D mesh and no
// second scene graph.
//
// Build:
//   r2d world compile demos/re2d_openworld_lab/openworld.re2dmap \
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

// Compiler metadata from the shipped .re2dworld (r2d world compile).
const REGIONS = {
    size: 256, columns: 8, rows: 8, count: 25, pvsEdges: 600,
    // Occupied grid slots (row * columns + col), sorted row-major exactly like
    // the compiler's region indices.
    slots: [1,3,6,8,9,10,11,13,15,17,19,20,22,24,25,26,27,29,31,41,43,46,53,55,62],
    cellCounts: [1,1,1,1,1,1,2,2, 1,1,1,9,1,1,1,2, 2,2,1,1,1,1,1,1, 1],
    brushes: 17, solids: 11, toolBrushes: 9, brushCells: 39, brushWalls: 124,
    brushPortals: 65, areaPortals: 21, uselessHints: 0, entities: 7,
    occluderWalls: 8, hintWalls: 18,
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
                        occluderWalls: REGIONS.occluderWalls,
                        hintWalls: REGIONS.hintWalls,
                        entities: REGIONS.entities },
            world: info ? { cells: info.cells, portals: info.portals,
                            surfaces: info.visibleSurfaces, frame: frames,
                            gpuDraws: info.gpuDraws, mapPath: MAP } : null,
            view: { x: view.x, y: view.y, h: view.h, yaw: view.yaw },
            // Native runtime huge-world state (regions/PVS/clusters/streaming/
            // LOD/impostors). Numbers come straight from src/re2d.c info.
            native: info ? {
                regionCount: info.regionCount, regionCurrent: info.regionCurrent,
                regionActive: info.regionActive, regionPreload: info.regionPreload,
                regionCulled: info.regionCulled, regionPvsEdges: info.regionPvsEdges,
                regionPvsCulled: info.regionPvsCulled,
                regionSizeHint: info.regionSizeHint,
                clusterEdges: info.regionClusterEdges,
                occluderCulled: info.regionOccluderCulled,
                cellsAllowed: info.regionCellsAllowed, cellsCulled: info.regionCellsCulled,
                streamUploads: info.streamUploads,
                streamUploadBytes: info.streamUploadBytes,
                streamEvictions: info.streamEvictions,
                streamTotalUploads: info.streamTotalUploads,
                streamTotalUploadBytes: info.streamTotalUploadBytes,
                streamTotalEvictions: info.streamTotalEvictions,
                streamIoPayloads: info.streamIoPayloads,
                streamIoResidentPayloads: info.streamIoResidentPayloads,
                streamIoLoadingPayloads: info.streamIoLoadingPayloads,
                streamIoQueuedLoad: info.streamIoQueuedLoad,
                streamIoQueuedUnload: info.streamIoQueuedUnload,
                streamIoResidentBytes: info.streamIoResidentBytes,
                streamIoMaxTickBytes: info.streamIoMaxTickBytes,
                streamIoLoadBytes: info.streamIoLoadBytes,
                streamIoUnloadBytes: info.streamIoUnloadBytes,
                streamIoLoads: info.streamIoLoads,
                streamIoUnloads: info.streamIoUnloads,
                streamIoTotalBytes: info.streamIoTotalBytes,
                streamIoLoadBudgetBytes: info.streamIoLoadBudgetBytes,
                streamIoUnloadBudgetBytes: info.streamIoUnloadBudgetBytes,
                streamResidentBytes: info.streamResidentBytes,
                texturesResident: info.texturesResident,
                atlasesResident: info.atlasesResident,
                impostorCount: info.impostorCount,
                visibleImpostors: info.visibleImpostors,
                renderOrigin: info.regions ? info.regions.renderOrigin : null,
                lodHiddenActors: info.lodHiddenActors,
                lodThrottledActors: info.lodThrottledActors,
                lodHiddenAtlas: info.lodHiddenAtlas,
                lodCulledLights: info.lodCulledLights,
                lodCulledParticles: info.lodCulledParticles,
                lodCulledDecals: info.lodCulledDecals,
                audioRegionCulled: info.audioRegionCulled,
                frameMs: info.frameMs,
                frameMsStable: Number.isFinite(info.frameMs),
                gpuStreamUploads: info.gpuStreamUploads,
                gpuStreamUploadBytes: info.gpuStreamUploadBytes,
                gpuStreamEvictions: info.gpuStreamEvictions,
                gpuStreamTransitions: info.gpuStreamTransitions,
                gpuTexturesResident: info.gpuTexturesResident,
                gpuAtlasesResident: info.gpuAtlasesResident,
                gpuLightsCulled: info.gpuLightsCulled,
                gpuDecalsCulled: info.gpuDecalsCulled,
                gpuSpriteDirReduced: info.gpuSpriteDirReduced,
                gpuImpostorsDrawn: info.gpuImpostorsDrawn,
                gpuRenderOriginActive: info.gpuRenderOriginActive,
                gpuOriginX: info.gpuOriginX,
                gpuOriginY: info.gpuOriginY,
                hintWalls: info.hintWalls,
                skipWalls: info.skipWalls,
                occluderWalls: info.occluderWalls,
                regionOccluderCulled: info.regionOccluderCulled,
                regionPvsCulled: info.regionPvsCulled,
            } : null,
            impostors: world && typeof world.impostors === 'function' ? world.impostors() : [],
            note: 'region indices are the compiler row-major partition; native streaming states come from world.info()',
        };
    }

    function setPortalsClosed(closed) {
        if (!world) return 0;
        const count = world.info().portals;
        for (let i = 0; i < count; i++) world.portalClosed(i, !!closed);
        return count;
    }

    function teleport(x, y, h) {
        view.x = x;
        view.y = y;
        if (typeof h === 'number') view.h = h;
        lastRegion = regionAt(view.x, view.y);
        if (world) world.camera(view);
    }

    globalThis.re2dOpenWorld = {
        snapshot,
        regionAt,
        teleport,
        regionConfig: (...args) => world && world.regionConfig(...args),
        regionBudget: (bytes, items) => world && world.regionBudget(bytes, items),
        regionLod: (...args) => world && world.regionLod(...args),
        setPortalsClosed,
        regionLocal: (x, y) => world && world.regionLocal(x, y),
        // Pose budget only (since 1.2.7 world.quality never changes the visual
        // tier); tier is a separate explicit control.
        quality: (poseBudget) => world && world.quality({ poseBudget, poseStep: 0 }),
        renderQuality: (name) => world && world.renderQuality(name),
        info: () => world && world.info(),
        loadMap,
        mapPath: () => MAP,
        saveState: () => world && world.saveState(),
        loadState: (save) => world && world.loadState(save),
        saveMapHash: () => world && world.saveMapHash(),
        findCell: (id) => world && world.findCell(id),
        findSpan: (id) => world && world.findSpan(id),
        findPortal: (id) => world && world.findPortal(id),
        impostors: () => world && typeof world.impostors === 'function' ? world.impostors() : [],
        toggleHud: () => { visible = !visible; if (hud) visible ? hud.show() : hud.hide(); },
    };
    $.agent.expose('re2dOpenWorld', snapshot);

    // Shared visual/gameplay configuration for the original and scaled maps.
    function configureWorld() {
        if (!world) return;
        world.camera(view);
        world.sky({ color: '#2b3a55' });
        world.lighting({ mode: 'classic', dynamic: true, shadows: false, distanceScale: 0.001 });
        // One streamed material texture + broad lights + region-pool decals:
        // exercise residency upload/evict, GPU light LOD and decal culling.
        world.material('demo.floor', { albedo: 'demos/re2d_world_renderer_lab/floor.png',
                                       filter: 'linear', uScale: 1 / 64, vScale: 1 / 64 });
        const surfaceCount = world.info().surfaces;
        for (let i = 0; i < surfaceCount; i++) world.surface(i).material('demo.floor');
        world.light({ x: 650, y: 320, h: 96, radius: 5000, intensity: 1.0,
                      color: '#ffd8b0', shadow: false });
        world.light({ x: 1700, y: 1700, h: 96, radius: 5000, intensity: 1.5,
                      color: '#cfd8ff', shadow: false });
        let floors = 0;
        for (let i = 0; i < surfaceCount && floors < 96; i++) {
            const surface = world.surface(i);
            if (!surface || surface.kind !== 1) continue;
            try {
                world.decal({ surface: i, material: 'demo.floor', u: 0, v: 0,
                              width: 24, height: 24, life: 0 });
                floors++;
            } catch (e) { /* decal budget/material edge */ }
        }
    }

    // Benchmark hook: load any .re2dworld (base or generated scaled fixture)
    // into the same scene, keeping the fixed active/preload ring contract.
    function loadMap(path) {
        if (world) { world.dispose(); world = null; }
        world = $.re2dWorld.load(path).backend('gpu');
        configureWorld();
        lastRegion = regionAt(view.x, view.y);
        frames = 0;
        return world.info().cells;
    }

    $.scene.add('re2d_openworld_lab', {
        enter($) {
            $.world.gravity(0, 0).color('#101722');
            world = $.re2dWorld.load(MAP).backend('gpu');
            configureWorld();
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
                ` · areaportals ${REGIONS.areaPortals} · occluders ${REGIONS.occluderWalls} · hints ${REGIONS.hintWalls}`);
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
