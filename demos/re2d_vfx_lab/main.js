// ===========================================================================
// Re2D VFX lab (R-03): native FX bundles, cards/trails/light budget.
//
// All spawn work happens in C (src/re2d_world_vfx.c); this scene only loads the
// JSON pack through the asset pipeline and exposes a small probe for the agent
// test. No JS node is created per spark.
// ===========================================================================
'use strict';

const PACK = {
    combat: ['muzzle_flash', 'shotgun_smoke', 'pellet_impact_stone', 'pellet_impact_metal',
        'pellet_impact_flesh', 'blood_spray', 'blood_mist', 'blood_decal', 'scorch',
        'shell_eject', 'hit_spark', 'hit_dust'],
    fire: ['fire_small', 'fire_large', 'ember', 'fire_smoke', 'burning_actor',
        'heat_distortion', 'fire_light'],
    frost: ['frost_burst', 'ice_shards', 'frost_mist', 'frost_decal', 'freeze_overlay'],
    electric: ['spark', 'arc_card', 'electric_hit', 'pulse_light', 'screen_flash'],
    acid: ['acid_splash', 'acid_drip', 'acid_pool', 'acid_smoke', 'acid_decal'],
    magic: ['portal', 'glyph', 'soul', 'red_eye_glow', 'magic_mist', 'teleport',
        'vanish', 'boss_aura'],
    environment: ['dust', 'floating_ash', 'fog_strip', 'smoke_column', 'falling_debris',
        'dripping_water', 'rain', 'snow', 'wind_dust', 'light_shaft_dust', 'ambient_embers'],
};

$.ready(() => {
    const world = $.re2dWorld.fromJSON(JSON.stringify({
        version: 1, walls: [], portals: [],
        cells: [{
            x: 0, y: 0, w: 800, h: 600,
            spans: [{ bottom: 0, top: 160, floorColor: '#304050', ceilingColor: '#101820' }],
        }],
    }));
    const loaded = [];
    const failed = [];
    const loadAll = () => {
        loaded.length = 0;
        failed.length = 0;
        for (const category of Object.keys(PACK)) {
            for (const name of PACK[category]) {
                const path = 'assets/vfx/' + category + '/' + name + '.json';
                const text = $.fs.readText(path);
                if (text == null) { failed.push({ category, name, error: 'missing ' + path }); continue; }
                try { world.vfx.define(name, text); loaded.push({ category, name }); }
                catch (error) { failed.push({ category, name, error: String(error && error.message || error) }); }
            }
        }
        return loaded.length;
    };
    loadAll();
    globalThis.vfxLab = {
        world,
        loadAll,
        loaded,
        failed,
        spawn: (name, at = {}) => world.vfx.spawn(name, at),
        info: () => world.vfx.info(),
        debug: () => world.vfx.debug(),
        worldInfo: () => world.info(),
        catalog: PACK,
    };
});
