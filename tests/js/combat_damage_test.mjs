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
    damageReason, hitAllowed, noteHit, reflectAttack, REFUSAL_REASONS, normalizeAttack,
} from '../../src/highlevel/combat.js';
import { approachValue, groundSlope, controlsScheme } from '../../src/highlevel/api.js';
import { isDamageResponse, resolvePoint, resolveNode } from '../../src/highlevel/hits.js';

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

test('reflectAttack: отражённая атака по форме не отличается от обычной', () => {
    let next = 1;
    const out = reflectAttack({ id: 7, amount: 10, window: 100 }, {}, () => next++, 0);
    truthy(Array.isArray(out.hits), 'журнал попаданий создан');
    eq(out.hits.length, 0, 'журнал пуст');
    truthy(out.hit_targets !== undefined && out.hit_targets !== null, 'hit_targets создан');
    truthy(out.cooldown_until !== undefined && out.cooldown_until !== null, 'cooldown_until создан');
    // Дедупликация и запись попадания работают без ручной правки объекта.
    eq(hitAllowed(out, 5, 0.01).allowed, true);
    noteHit(out, 5, 0.01);
    eq(hitAllowed(out, 5, 0.02).reason, 'duplicate');
    eq(out.hits.length, 0, 'noteHit не пишет в hits (пишет applyDamage)');
});

test('normalizeAttack: атака, собранная руками, получает журналы', () => {
    const raw = { id: 1, until: 10, amount: 5 };
    const same = normalizeAttack(raw);
    eq(same, raw, 'мутирует и возвращает ту же атаку');
    truthy(Array.isArray(raw.hits), 'hits создан');
    truthy(raw.hit_targets !== undefined, 'hit_targets создан');
    truthy(raw.cooldown_until !== undefined, 'cooldown_until создан');
    // Повторный вызов не затирает уже накопленный журнал.
    raw.hits.push({ target_id: 1 });
    raw.hit_targets[1] = 0.5;
    normalizeAttack(raw);
    eq(raw.hits.length, 1, 'журнал не пересоздаётся');
    eq(raw.hit_targets[1], 0.5);
    eq(normalizeAttack(null), null, 'null безопасен');
});

// --- §9-ответ как вход presentation -----------------------------------------

test('isDamageResponse: ответ §9 отличается от узла и точки', () => {
    const response = {
        accepted: true, applied: 25, target_id: 'n7', targetNodeId: 'n7',
        attackId: 3, x: 100, y: 200, death: false,
    };
    eq(isDamageResponse(response), true);
    eq(isDamageResponse({ x: 1, y: 2 }), false, 'точка — не ответ');
    eq(isDamageResponse({ nodes: [], x: 1 }), false, 'обёртка — не ответ');
    eq(isDamageResponse(null), false);
});

test('resolvePoint: точку даёт сам ответ §9', () => {
    const response = { accepted: true, applied: 5, target_id: 'n1', x: 120, y: 80 };
    const p = resolvePoint(response);
    eq(p.x, 120);
    eq(p.y, 80);
});

test('resolveNode: цель ответа ищется по nid, а не по ссылке на узел', () => {
    // В юнит-тесте (без движка) реестра узлов нет — функция обязана вернуть
    // null, а не бросить и не принять сам ответ за узел.
    const response = { accepted: true, applied: 5, target_id: 'n1', targetNodeId: 'n1', x: 1, y: 2 };
    eq(resolveNode(response), null, 'нет узла с таким nid — null');
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
