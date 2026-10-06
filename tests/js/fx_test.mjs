// ===========================================================================
// Юнит-тесты VFX-слоя ($.fx): времена жизни и то, что эффекты действительно
// попадают в батч кадра.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/fx_test.mjs
// ===========================================================================

import { test, eq, truthy, falsy, finish } from './_harness.mjs';
import { ctx, Node, query } from '../../src/highlevel/core.js';
import { installFx, tickFx, resetFx, fxState } from '../../src/highlevel/fx.js';

// Считающий мок батча: сколько чего модуль положил в кадр.
const pushed = { tri: 0, line: 0, ring: 0, circle: 0 };
ctx.gfx = {
    push: {
        triangle() { pushed.tri++; },
        line() { pushed.line++; },
        ring() { pushed.ring++; },
        circle() { pushed.circle++; },
    },
};

const $ = { camera: { shake() {} }, time: { after() {} } };
installFx($);

const CAM = { x: 0, y: 0, zoom: 1 };
const draw = () => ctx.gfx._fxFlush(CAM);

function reset() {
    resetFx();
    pushed.tri = pushed.line = pushed.ring = pushed.circle = 0;
}

// --- Времена жизни ---------------------------------------------------------

test('ударная волна живёт ровно свой срок', () => {
    reset();
    $.fx.shockwave(100, 100, { radius: 120, ms: 200 });
    eq($.fx.stats().waves, 1, 'волна заведена');
    tickFx(0.1);
    eq($.fx.stats().waves, 1, 'на половине срока ещё жива');
    tickFx(0.15);
    eq($.fx.stats().waves, 0, 'после срока удалена');
});

test('молния гаснет по life', () => {
    reset();
    $.fx.lightning([0, 0], [200, 0], { life: 100 });
    eq($.fx.stats().bolts, 1);
    tickFx(0.05);
    draw();
    truthy(pushed.line > 0, 'молния рисуется линиями');
    tickFx(0.06);
    eq($.fx.stats().bolts, 0, 'после life удалена');
});

test('поле сил живёт свой life и видно частицам', () => {
    reset();
    const a = $.fx.attractor(50, 50, { life: 300, radius: 200 });
    eq(ctx.fx_fields.length, 1, 'поле попало в общий список частиц');
    tickFx(0.2);
    eq(ctx.fx_fields.length, 1);
    a.stop();
    tickFx(0.2);
    eq(ctx.fx_fields.length, 0, 'stop() убирает поле на следующем тике');
});

// --- Ленты -----------------------------------------------------------------

test('лента тянется за узлом и рисуется треугольниками', () => {
    reset();
    const node = new Node('sprite', { id: 'fx_hero' });
    node.x = 0; node.y = 0;

    $.fx.trail('#fx_hero', { ms: 400, width: 8, minStep: 1 });
    tickFx(0.016);

    node.x = 40; node.y = 0;
    tickFx(0.016);
    node.x = 80; node.y = 10;
    tickFx(0.016);

    draw();
    truthy(pushed.tri > 0, `лента дала треугольники: ${pushed.tri}`);

    // Точки стареют и вымываются: после паузы длиннее ms остаётся максимум
    // одна свежая точка (позиция цели сейчас), старых нет.
    tickFx(0.5);
    eq(fxState.trails.length, 1, 'лента живёт, пока жива цель');
    const pts = fxState.trails[0].points;
    truthy(pts.length <= 1, `старые точки вымылись: осталось ${pts.length}`);
});

test('разовая лента исчезает сама', () => {
    reset();
    $.fx.ribbon([[0, 0], [50, 50], [100, 20]], { ms: 100 });
    eq($.fx.stats().trails, 1);
    tickFx(0.15);
    eq($.fx.stats().trails, 0, 'после срока разовой ленты нет');
});

test('лента без цели не остаётся навсегда', () => {
    reset();
    let alive = true;
    $.fx.trail(() => (alive ? { x: 0, y: 0 } : null), { ms: 100, minStep: 1 });
    tickFx(0.05);
    eq($.fx.stats().trails, 1, 'пока цель есть — лента живёт');
    alive = false;
    tickFx(0.1);
    eq($.fx.stats().trails, 0, 'цель исчезла — лента тоже');
});

// --- Отсечение и очистка ---------------------------------------------------

test('эффект за экраном в батч не попадает', () => {
    reset();
    $.fx.shockwave(100000, 100000, { radius: 100, ms: 500 });
    draw();
    eq(pushed.ring, 0, 'далёкая волна отсечена');

    $.fx.shockwave(10, 10, { radius: 100, ms: 500 });
    tickFx(0.1);          // на первом кадре радиус ещё нулевой
    draw();
    truthy(pushed.ring > 0, 'близкая волна нарисована');
});

test('resetFx чистит всё разом', () => {
    reset();
    $.fx.shockwave(0, 0, {});
    $.fx.lightning([0, 0], [10, 10], {});
    $.fx.attractor(0, 0, {});
    truthy($.fx.stats().waves + $.fx.stats().bolts + $.fx.stats().fields > 0);
    resetFx();
    const s = $.fx.stats();
    eq(s.waves + s.bolts + s.fields + s.trails, 0);
});

test('нулевой и отрицательный dt не ломают тик', () => {
    reset();
    $.fx.shockwave(0, 0, { ms: 100 });
    tickFx(0);
    tickFx(-1);
    eq($.fx.stats().waves, 1, 'эффект не съеден мусорным dt');
});

finish();
