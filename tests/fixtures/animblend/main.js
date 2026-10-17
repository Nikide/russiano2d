// ===========================================================================
// Фикстура tests/agent/anim_blend_test.py: кроссфейд клипов $.anim.define.
//
// Два клипа задают РАЗНЫЕ позы одного узла (x, alpha, scale_x) — по ним
// видно долю смешивания. Отдельный спрайт с двумя кадрами проверяет, что
// кадровая дорожка в смешивании дискретна (кадр берётся у клипа с большим
// весом), как и в $.anim.player.blend.
// ===========================================================================

$.ready(() => {
    $.world.gravity(0, 0).color('#101820').bounds(0, 0, 1280, 720);

    // Поза A: слева, непрозрачная, обычный масштаб.
    $.anim.define('idle-pose', {
        duration: 1000,
        loop: 'loop',
        tracks: [
            { prop: 'x', keys: [{ t: 0, v: 0 }, { t: 1, v: 0 }] },
            { prop: 'alpha', keys: [{ t: 0, v: 1 }, { t: 1, v: 1 }] },
            { prop: 'scale_x', keys: [{ t: 0, v: 1 }, { t: 1, v: 1 }] },
        ],
    });

    // Поза B: справа, полупрозрачная, вдвое крупнее.
    $.anim.define('run-pose', {
        duration: 1000,
        loop: 'loop',
        tracks: [
            { prop: 'x', keys: [{ t: 0, v: 100 }, { t: 1, v: 100 }] },
            { prop: 'alpha', keys: [{ t: 0, v: 0.2 }, { t: 1, v: 0.2 }] },
            { prop: 'scale_x', keys: [{ t: 0, v: 2 }, { t: 1, v: 2 }] },
        ],
        events: [{ at: 0.5, name: 'step', data: { n: 1 } }],
    });

    // Кадровые клипы: один кадр листа на клип.
    $.anim.define('frame-a', {
        duration: 1000,
        loop: 'loop',
        tracks: [{ anim: { from: 0, to: 0 } }],
    });
    $.anim.define('frame-b', {
        duration: 1000,
        loop: 'loop',
        tracks: [{ anim: { from: 1, to: 1 } }],
    });

    $('<rect>', { id: 'hero' }).at(0, 0).size(20, 20).appendTo($.world);
    $('#hero').on('step', () => {
        $.store.set('step', ($.store.get('step', 0) || 0) + 1);
    });
    $('#hero').playClip('idle-pose');

    $('<sprite>', { id: 'fx' }).at(60, 60).size(16, 16)
        .frames({ src: 'assets/hero.png', cols: 2, rows: 1, cw: 64, ch: 64 })
        .appendTo($.world);
    $('#fx').playClip('frame-a');

    $.agent.expose('animblend', () => ({
        hero: { x: $('#hero').get(0).x, alpha: $('#hero').get(0).alpha },
        fxFrame: $('#fx').get(0).frame_index,
        blend: typeof $.anim.blendInfo === 'function' ? $.anim.blendInfo('#hero') : null,
    }));
});
