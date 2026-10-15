// ===========================================================================
// Stress-стенд §35.2: точка измерения производительности.
//
//   ./build/russiano2d --game demos/stress --scene physics
//   python3 tools/bench_stress.py            // перцентили и счётчики
// ===========================================================================

import install from './index.js';

$.ready(($) => {
    $.gfx.color('#0e1420');
    install($);
    const scenes = ['physics', 'tilemap', 'vfx', 'lights', 'ui', 'all'];
    const requested = $.startScene;
    $.scene.load(scenes.indexOf(requested) >= 0 ? requested : 'all', { transition: 'none' });
});
