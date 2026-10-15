// ===========================================================================
// §9. Контракт урона: причина отказа, дедупликация попаданий, отражение.
// Плюс новый чистый помощник §8 (ускорение/угол поверхности).
//
// Проверяется без движка: `damageReason`, `hitAllowed`, `noteHit`,
// `reflectAttack` (src/highlevel/combat.js) и `approachValue`, `groundSlope`,
// `controlsScheme` (src/highlevel/api.js).
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/combat_damage_test.mjs
// ===========================================================================

import { test, eq, near, truthy, falsy, finish } from './_harness.mjs';
import {
    damageReason, hitAllowed, noteHit, reflectAttack, REFUSAL_REASONS,
} from '../../src/highlevel/combat.js';
import { approachValue, groundSlope, controlsScheme } from '../../src/highlevel/api.js';

// --- Причины отказа: каждая фактическая, не выдуманная ----------------------

test('damageReason: цель не найдена', () => {
    eq(damageReason({ targetExists: false, amount: 10 }), 'unknown_target');
});

test('damageReason: цель уничтожена (removed или hp <= 0)', () => {
    eq(damageReason({ targetExists: true, targetRemoved: true, hp: 10, amount: 5 }), 'destroyed_target');
    eq(damageReason({ targetExists: true, hp: 0, amount: 5 }), 'destroyed_target');
});

test('damageReason: окно атаки закрыто', () => {
    eq(damageReason({ targetExists: true, hp: 10, attackActive: false, amount: 5 }), 'inactive_window');
});

test('damageReason: владелец атаки мёртв (правило cancel)', () => {
    eq(damageReason({ targetExists: true, hp: 10, ownerAlive: false, amount: 5 }), 'owner_dead');
});

test('damageReason: своя команда', () => {
    eq(damageReason({ targetExists: true, hp: 10, teamMismatch: true, amount: 5 }), 'team');
});

test('damageReason: повторное попадание', () => {
    eq(damageReason({ targetExists: true, hp: 10, duplicate: true, amount: 5 }), 'duplicate');
});

test('damageReason: неуязвимость', () => {
    eq(damageReason({ targetExists: true, hp: 10, iframes: 1, amount: 5 }), 'immunity');
});

test('damageReason: нулевой урон', () => {
    eq(damageReason({ targetExists: true, hp: 10, amount: 0 }), 'zero_amount');
});

test('damageReason: чистая заявка принимается', () => {
    eq(damageReason({ targetExists: true, hp: 10, amount: 5 }), null);
});

test('порядок причин — контракт (target → окно → владелец → команда → дубль → неуязвимость → ноль)', () => {
    // Мёртвая цель важнее закрытого окна: урон не «применяется», но причина
    // должна называть то, что случилось с целью.
    eq(damageReason({ targetExists: true, hp: 0, attackActive: false, iframes: 1, amount: 5 }),
       'destroyed_target');
    // Своя команда важнее дубля: союзника не бьют даже второй раз.
    eq(damageReason({ targetExists: true, hp: 10, teamMismatch: true, duplicate: true, amount: 5 }),
       'team');
    eq(REFUSAL_REASONS.length, 8);
});

// --- Дедупликация: несколько hurtbox = один удар ---------------------------

function makeAttack(now, spec) {
    const s = spec || {};
    return Object.assign({
        id: 1, owner_id: 7, rehit: 'once', until: now + 1, hit_targets: {},
        hit_cooldown: 0, cancelled: false,
    }, s);
}

test('hitAllowed: цель с несколькими формами попадает один раз (owner = nid)', () => {
    const now = 10;
    const atk = makeAttack(now);
    // Обе формы принадлежат одному владельцу (nid 42): ключ дедупликации —
    // владелец, поэтому вторая форма не даёт второго урона.
    eq(hitAllowed(atk, 42, now).allowed, true);
    noteHit(atk, 42, now);
    eq(hitAllowed(atk, 42, now).allowed, false);
    eq(hitAllowed(atk, 42, now).reason, 'duplicate');
    // Другая цель той же атакой — по-прежнему можно.
    eq(hitAllowed(atk, 43, now).allowed, true);
});

test('hitAllowed: закрытое окно и отменённая атака не бьют', () => {
    const atk = makeAttack(100, { until: 100.5 });
    eq(hitAllowed(atk, 42, 101).reason, 'inactive_window');
    atk.cancelled = true;
    eq(hitAllowed(atk, 42, 100.1).reason, 'inactive_window');
});

test('hitAllowed: policy always — только по cooldown', () => {
    const now = 5;
    const atk = makeAttack(now, { rehit: 'always', hit_cooldown: 200, until: now + 10 });
    eq(hitAllowed(atk, 9, now).allowed, true);
    noteHit(atk, 9, now);
    eq(hitAllowed(atk, 9, now + 0.1).reason, 'duplicate');
    eq(hitAllowed(atk, 9, now + 0.25).allowed, true);
});

test('новая атака по той же цели попадает снова', () => {
    const now = 0;
    const first = makeAttack(now);
    noteHit(first, 3, now);
    const second = makeAttack(now, { id: 2 });
    eq(hitAllowed(second, 3, now).allowed, true);
});

// --- Отражение: новая identity, owner/team по политике ---------------------

test('reflectAttack: новая identity и новые owner/team', () => {
    let next = 10;
    const makeId = () => next++;
    const src = {
        id: 4, source: 1, owner: 1, team: 2, amount: 20, damageType: 'bullet',
        window: 150, rehit: 'once', hit_cooldown: 0, impulse: { x: 5, y: 0 },
    };
    const out = reflectAttack(src, { owner: 9, team: 3, multiplier: 2 }, makeId, 100);
    eq(out.id, 10, 'новый id');
    truthy(out.id !== src.id, 'identity изменилась');
    eq(out.owner, 9, 'новый владелец');
    eq(out.team, 3, 'новая команда');
    eq(out.amount, 40, 'урон по политике (×2)');
    eq(out.reflected, true);
    eq(out.reflectedFrom, 4);
    eq(src.reflectedBy, 10, 'старая атака помечена');
    eq(out.damageType, 'bullet', 'тип урона сохраняется, если не задан');
    near(out.until, 100.15, 1e-9, 'окно отсчитывается от момента отражения');
});

// --- §8: ускорение и угол поверхности --------------------------------------

test('approachValue: приближение не быстрее заданного шага', () => {
    eq(approachValue(0, 100, 300), 100, 'шаг больше разрыва — сразу цель');
    eq(approachValue(0, 100, 30), 30);
    eq(approachValue(100, 0, 30), 70);
    eq(approachValue(50, 50, 30), 50, 'уже на цели');
});

test('groundSlope: ровный пол 0, стеноподобная поверхность π/2', () => {
    near(groundSlope(0, -1), 0, 1e-9, 'нормаль вверх');
    near(groundSlope(0, 1), Math.PI, 1e-9, 'нормаль вниз (потолок) — максимальный угол');
    near(groundSlope(1, 0), Math.PI / 2, 1e-9, 'вертикальная стена');
    near(groundSlope(Math.SQRT1_2, -Math.SQRT1_2), Math.PI / 4, 1e-9, 'склон 45°');
    // Знак наклона не важен: угол от вертикали.
    near(groundSlope(-Math.SQRT1_2, -Math.SQRT1_2), Math.PI / 4, 1e-9);
});

test('controlsScheme: новые поля §8 по умолчанию ничего не меняют', () => {
    const s = controlsScheme('both');
    eq(s.accel, 0, 'мгновенная скорость, как было');
    eq(s.decel, 0);
    eq(s.air_accel, 0);
    eq(s.max_slope, 90, 'любая поверхность — земля');
    const tuned = controlsScheme({ accel: 900, decel: 1400, airAccel: 400, maxSlope: 46 });
    eq(tuned.accel, 900);
    eq(tuned.decel, 1400);
    eq(tuned.air_accel, 400);
    eq(tuned.max_slope, 46);
    eq(controlsScheme({ maxSlope: 120 }).max_slope, 90, 'угол ограничен 90°');
});

finish();
