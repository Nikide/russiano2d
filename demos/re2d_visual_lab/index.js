// ===========================================================================
// Re2D acceptance visual lab (roadmap 90/117/136/137/144/147).
//
// One deterministic GPU scene for the renderer acceptance pass:
//   50 active enemies, 150 props, ~1.2-1.8k native particles, decals,
//   12 lights (4 shadowed), authored materials/emissive, sky panorama,
//   weather/shaft VFX cards, region LOD/impostor request, VFX bundle pack.
//
// Everything is constrained 2.5D: native world surfaces, atlas world sprites,
// native particle pool, native VFX pools and postprocess descriptors. No mesh,
// no ECS, no renderer fork. The camera is fixed; screenshots are deterministic
// for a fixed step.
//
// Run:
//   ./build/russiano2d --game demos --scene re2d_visual_lab
//   python3 tests/agent/re2d_visual_lab_acceptance_test.py
// ===========================================================================
'use strict';

const MAP = 're2d_testroom/testroom.re2dworld';
const ART = 're2d_visual_lab/assets/';
const FRAME = { w: 960, h: 540 };
const VIEW = { x: 800, y: 900, h: 76, yaw: -90, pitch: 0, fov: 72, near: 4 };
const ENEMIES = 50;
const PROPS = 150;
const LIGHTS = 12;
const SHADOW_LIGHTS = 4;
const BASE_PARTICLES = 1200;

export default function install($) {
    let world = null;
    let view = null;
    let enemies = [];
    let props = [];
    let lights = [];
    let decals = [];
    let vfxNames = [];
    let frames = 0;
    let hud = null;

    function spawnEnemy(i) {
        const angle = (i / ENEMIES) * Math.PI * 2;
        const radius = 230 + (i % 7) * 34;
        const x = 800 + Math.cos(angle) * radius;
        const y = 760 + Math.sin(angle) * radius * 0.62;
        const node = $('<sprite>', { id: 'enemy-' + i })
            .at(x, y).depth(0).size(64, 64)
            .angle(Math.atan2(VIEW.y - y, VIEW.x - x)).hide()
            .appendTo($.world);
        node.get(0).sprite_row = i % 4;      // idle rows 0..3
        node.get(0).angle = Math.atan2(VIEW.y - y, VIEW.x - x);
        world.sprite(node, {
            atlas: ART + 'warden_ultra16.png',
            columns: 16, rows: 15, directions: 16, mirror: false,
            cell: { w: 64, h: 64 }, pivot: 'feet',
            width: 64, height: 64, blend: 'masked',
        });
        world.hit(node, { radius: 20, height: 64, category: 'enemy' });
        return node;
    }

    function spawnProp(i) {
        const x = 180 + ((i * 137) % 1240);
        const y = 260 + ((i * 89) % 760);
        const node = $('<sprite>', { id: 'prop-' + i })
            .at(x, y).depth(0).size(48, 48)
            .angle((i * 0.37) % (Math.PI * 2)).hide()
            .appendTo($.world);
        node.get(0).sprite_row = 0;          // turret idle row
        world.sprite(node, {
            atlas: ART + 'turret_ultra16.png',
            columns: 16, rows: 6, directions: 16, mirror: false,
            cell: { w: 64, h: 64 }, pivot: 'feet',
            width: 48, height: 48, blend: 'masked',
        });
        return node;
    }

    function addMaterials() {
        world.material('brick', { albedo: ART + 'brick.png', uScale: 1 / 64, vScale: 1 / 64 });
        world.material('floor', { albedo: ART + 'floor.png', uScale: 1 / 64, vScale: 1 / 64 });
        world.material('panel', {
            albedo: ART + 'panel.png',
            emissive: ART + 'panel_e.png',
            emissiveStrength: 1.6, uScale: 1 / 64, vScale: 1 / 64,
        });
        const surfaces = world.info().surfaces;
        for (let i = 0; i < surfaces; i++) {
            const s = world.surface(i);
            if (!s) continue;
            s.material(s.kind === 1 ? 'floor' : 'brick');
        }
        // One authored emissive panel surface for the bloom/emissive reference.
        for (let i = 0; i < surfaces; i++) {
            const s = world.surface(i);
            if (s && s.kind === 0) { s.material('panel'); break; }
        }
    }

    function addDecals(count) {
        const floors = [];
        const surfaces = world.info().surfaces;
        for (let i = 0; i < surfaces; i++) {
            const s = world.surface(i);
            if (s && s.kind === 1) floors.push(i);
        }
        let made = 0;
        if (floors.length) {
            for (let i = 0; i < count; i++) {
                try {
                    world.decal({
                        surface: floors[i % floors.length], material: 'floor',
                        u: (i % 8) * 24, v: (i % 5) * 24,
                        width: 24, height: 24, life: 600,
                    });
                    made++;
                } catch (error) { /* material/surface rejected */ }
            }
        }
        // Also place a few by a downward trace, so the scene exercises the
        // authored hit->surface path and not only direct surface indices.
        for (let i = 0; i < count * 2 && made < count + 8; i++) {
            const x = 120 + ((i * 211) % 1360);
            const y = 120 + ((i * 157) % 960);
            const hit = world.trace({ from: { x, y, h: 180 }, to: { x, y, h: 0 }, mask: ['world'] });
            if (!hit || hit.type !== 1) continue;
            try {
                world.decal({ surface: hit.surface, material: 'floor', u: (i % 4) * 16,
                    v: (i % 7) * 16, width: 20, height: 20, life: 600 });
                made++;
            } catch (error) { /* surface/material does not accept a decal */ }
        }
        for (let i = 0; i < made; i++) decals.push(i);
        return made;
    }

    function addLights() {
        for (let i = 0; i < LIGHTS; i++) {
            const angle = (i / LIGHTS) * Math.PI * 2;
            const light = world.light({
                x: 800 + Math.cos(angle) * (260 + i * 18),
                y: 760 + Math.sin(angle) * (220 + i * 14),
                h: 80 + (i % 4) * 46,
                radius: 180 + (i % 5) * 40,
                intensity: 1.1 + (i % 3) * 0.4,
                color: ['#ffb060', '#9fe8ff', '#ff70a0', '#ffe8b0'][i % 4],
                shadow: i < SHADOW_LIGHTS,
            });
            lights.push(light);
        }
    }

    function addParticles() {
        const colors = ['#ffb060', '#9fe8ff', '#ff70a0', '#c0f0ff', '#ffe8b0'];
        let left = BASE_PARTICLES;
        for (let i = 0; left > 0; i++) {
            const count = Math.min(300, left);
            world.particles.burst({
                x: 800 + Math.cos(i * 1.7) * 380,
                y: 760 + Math.sin(i * 1.7) * 300,
                h: 30 + (i % 4) * 40,
                count, life: 12 + (i % 4) * 4, size: 3 + (i % 3),
                endSize: 0, color: colors[i % colors.length], alpha: 0.7, endAlpha: 0,
                blend: 'additive', mode: 'billboard', speed: 8, spread: 6,
                gravity: 0, drag: 0.2, seed: 100 + i,
            });
            left -= count;
        }
    }

    function defineVfx() {
        const names = ['muzzle_flash', 'fire_large', 'fire_small', 'portal', 'boss_aura',
            'light_shaft_dust', 'fog_strip', 'rain', 'snow', 'electric_hit', 'blood_spray'];
        for (const name of names) {
            const category = ({ muzzle_flash: 'combat', fire_large: 'fire', fire_small: 'fire',
                portal: 'magic', boss_aura: 'magic', light_shaft_dust: 'environment',
                fog_strip: 'environment', rain: 'environment', snow: 'environment',
                electric_hit: 'electric', blood_spray: 'combat' })[name];
            const text = $.fs.readText(ART + 'vfx/' + category + '/' + name + '.json');
            if (text != null) world.vfx.define(name, text);
        }
        vfxNames = names.filter((name) => world.vfx.defined(name));
    }

    function spawnWeatherVfx() {
        if (!world || !world.vfx) return;
        const spots = [
            ['light_shaft_dust', 600, 560, 150, 0.4, 0.2, -0.6],
            ['light_shaft_dust', 980, 700, 180, -0.4, 0.2, -0.6],
            ['fog_strip', 800, 850, 40, 0.2, 0.4, 0.0],
            ['fire_large', 560, 760, 20, 0.2, 0.4, 0.1],
            ['portal', 1080, 700, 48, -0.4, 0.2, 0.1],
            ['electric_hit', 900, 520, 70, 0.1, 0.3, -0.2],
            ['muzzle_flash', 800, 920, 60, 0, 0.8, 0],
            ['rain', 800, 400, 160, 0, 0.2, -0.9],
            ['snow', 700, 400, 180, 0, 0.2, -0.9],
            ['blood_spray', 620, 620, 40, 0.3, 0.4, -0.1],
        ];
        for (const [name, x, y, h, dx, dy, dz] of spots) {
            if (world.vfx.defined(name)) world.vfx.spawn(name, { x, y, h, dx, dy, dz, seed: 7 });
        }
    }

    function build() {
        world = $.re2dWorld.load(MAP).backend('gpu');
        world.lighting({ mode: 'classic', dynamic: true, shadows: true, distanceScale: 0.001 });
        world.qualityPreset('high');
        world.regionConfig(256, 1, 2);
        world.regionLod(400, 700, 1000, 1300, 1800);
        view = { ...VIEW };
        world.camera(view);
        addMaterials();
        for (let i = 0; i < ENEMIES; i++) enemies.push(spawnEnemy(i));
        for (let i = 0; i < PROPS; i++) props.push(spawnProp(i));
        addLights();
        addDecals(40);
        addParticles();
        addSky();
        defineVfx();
        spawnWeatherVfx();
        try {
            world.post.set('bloom', { strength: 1.1, extra0: 0.6 });
            world.post.enable('bloom', true);
        } catch (error) { /* post stack may be unavailable on this backend */ }
        globalThis.visualLab = {
            world,
            view,
            sceneCounts: () => ({
                enemies: enemies.length, props: props.length, lights: lights.length,
                shadowLights: SHADOW_LIGHTS, decals: decals.length,
                vfxBundles: vfxNames.length, impostors: world.impostors().length,
            }),
            counts: () => {
                const info = world.info();
                return {
                    enemies: enemies.length, props: props.length,
                    lights: lights.length, shadowLights: SHADOW_LIGHTS,
                    decals: info.decals, particles: info.particles,
                    atlasSprites: info.atlasSprites, visibleAtlasSprites: info.visibleAtlasSprites,
                    hitProxies: info.hitProxies, surfaces: info.surfaces, cells: info.cells,
                    vfxBundles: vfxNames.length, fxSpawns: world.vfx.info().fxSpawns,
                    tempLights: world.vfx.info().tempLights,
                    distortionCards: world.vfx.info().distortionCards,
                    visual: info.visual || {}, frameMs: info.frameMs || 0,
                    pageFrames: frames,
                };
            },
            mode(name, side) {
                const after = side !== 'before';
                const key = name === 'bevel_ao' ? 'bevel'
                    : (name === 'fog_haze' ? 'fog'
                    : (name === 'sky_layers' ? 'sky'
                    : (name === 'emissive_bloom' ? 'bloom' : name)));
                if (key === 'material' || key === 'bevel') {
                    world.qualityPreset(after ? 'high' : 'low');
                    view = { x: 800, y: 940, h: 76, yaw: -90, pitch: -8, fov: 58, near: 4 };
                } else if (key === 'fog' || key === 'haze') {
                    world.qualityPreset(after ? 'high' : 'low');
                    view = { x: 800, y: 900, h: 76, yaw: -90, pitch: 0, fov: 72, near: 4 };
                } else if (key === 'sky') {
                    world.qualityPreset(after ? 'high' : 'low');
                    view = { x: -400, y: -400, h: 76, yaw: 45, pitch: 18, fov: 78, near: 4 };
                } else if (key === 'bloom') {
                    world.qualityPreset('high');
                    view = { ...VIEW };
                    try { world.post.enable('bloom', after); world.post.set('bloom', { strength: after ? 1.8 : 0 }); } catch (error) {}
                } else if (key === 'vfx') {
                    world.qualityPreset('high');
                    view = { ...VIEW };
                    if (world.vfx) world.vfx.clear();
                    world.particles.clear();
                    if (after) {
                        world.particles.burst({
                            x: 800, y: 900, h: 80, count: 900, life: 8, size: 9,
                            endSize: 0, color: '#ffb060', alpha: 0.85, endAlpha: 0,
                            blend: 'additive', mode: 'billboard', speed: 90, spread: 220,
                            gravity: 40, drag: 0.4, seed: 42,
                        });
                        world.particles.burst({
                            x: 800, y: 900, h: 70, count: 500, life: 6, size: 7,
                            endSize: 1, color: '#9fe8ff', alpha: 0.7, endAlpha: 0,
                            blend: 'additive', mode: 'billboard', speed: 40, spread: 160,
                            gravity: 20, drag: 0.2, seed: 43,
                        });
                        spawnWeatherVfx();
                    }
                } else {
                    world.qualityPreset(after ? 'high' : 'low');
                    view = { ...VIEW };
                }
                world.camera(view);
                return { name, side, view: { ...view } };
            },
            restore() {
                world.qualityPreset('high');
                try { world.post.enable('bloom', true); world.post.set('bloom', { strength: 0.55, extra0: 0.8 }); } catch (error) {}
                view = { ...VIEW };
                world.camera(view);
                if (world.vfx) { world.vfx.clear(); spawnWeatherVfx(); }
            },
            vfxNames: () => vfxNames.slice(),
        };
    }

    function addSky() {
        world.sky({ color: '#2b3a55', yaw: 15, exposure: 0.2 });
        world.skyAnim({ yawSpeed: 0.15, pulseHz: 0.08, pulseAmount: 0.1, color: '#ffd0a0' });
    }

    $.render(() => {
        if (!world || !view) return;
        world.render(view, FRAME.w, FRAME.h);
        frames++;
    });

    $.scene.add('re2d_visual_lab', {
        enter($) {
            $.world.gravity(0, 0).color('#0b0e14');
            build();
            hud = $.ui.doc('re2d_visual_lab/assets/hud.rml')?.show?.() || null;
        },
        leave() {
            if (hud) hud.hide();
            hud = null;
            if (world && typeof world.dispose === 'function') world.dispose();
            world = null; view = null; enemies = []; props = []; lights = []; decals = [];
            vfxNames = []; frames = 0;
            globalThis.visualLab = null;
        },
    });

    $.update(() => {
        if (!world || !view) return;
        world.camera(view);
        if ($.input.pressed('escape')) $.quit();
    });
}
