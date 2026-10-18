// ===========================================================================
// GTA-sandbox: generic damage / hitscan / projectile / AoE.
//
// Слой игры `$`, не движка. Ничего не дублирует:
//   * запросы — `$.world.raycastAll` / `$.world.raycast` / `$.world.bodiesIn` /
//     `$.world.bodyAt` (маски и структурные попадания уже есть);
//   * здоровье — `$(узел).hp()/health()/damage()/heal()/kill()` (плоская
//     полоска `node.cur_hp/max_hp`, iframes учитывает сам `.damage()`);
//   * события — узел `damaged`/`death` + глобальный `$.emit('damage')`;
//     `$.signal`/`$.combat`/`$.hits` остаются доступны как есть, но в расчёт
//     урона не втягиваются (`$.hits` — presentation).
//
// Контракт payload урона (`DamagePayload`):
//
//   {
//     amount,          // запрошенный урон (число)
//     type,            // строка: 'bullet'|'explosion'|'melee'|'vehicle'|…
//     source,          // узел-источник или null
//     subject,         // узел-получатель (цель)
//     point,           // {x,y} точка контакта в мире или null
//     impulse,         // {x,y} или null; число трактуется как длина по направлению
//     radius,          // радиус AoE, 0 у hitscan/снаряда
//     sourceNid, subjectNid,   // стабильные логические ID для JSON/трассировки
//     applied, hpBefore, hpAfter, dead, reason  // результат применения (после)
//   }
//
// Событие узла: `$('#target').on('damaged', (e) => e.data)` — payload.
// Глобальное: `$.on('damage', (e) => e.data)` — тот же payload (e.data).
// Смерть: узел `death`. Глобальный `$.on('death', ...)` получает его же:
// `node.emit()` рассылает событие и глобальным подписчикам (правило движка),
// поэтому второй `$.emit('death')` дал бы двойную доставку.
//
// Использование:
//
//   const combat = createCombat($);
//   const res = combat.hitscan({
//       from: { x: 100, y: 200 }, to: { x: 600, y: 200 },
//       source: '#hero', amount: 20, mask: 0x2, wallMask: 0x1,
//   });
//   const boom = combat.aoe({ point: {x, y}, radius: 120, amount: 40 });
//   const shot = combat.projectile({ from: hero, dir: {x: 1, y: 0}, speed: 600,
//                                    amount: 12, lifetime: 2500 });
//   $.update((dt) => { combat.update(dt); });
// ===========================================================================

/** Причина отказа применения урона — стабильные строки для тестов. */
export const DAMAGE_REFUSALS = [
    'missing_target', 'destroyed_target', 'immunity', 'zero_amount', 'blocked',
];

const EPS = 1e-6;

function isNode(value) {
    return !!(value && typeof value === 'object' && typeof value.tag === 'string'
        && typeof value.nid === 'string');
}

function isWrapper(value) {
    return !!(value && typeof value === 'object' && Array.isArray(value.nodes));
}

/** Узел из узла, обёртки, селектора или `null`. */
function nodeOf($, what) {
    if (!what) return null;
    if (isNode(what)) return what;
    if (isWrapper(what)) return what.nodes[0] || null;
    if (typeof what === 'string') return $(what).get(0) || null;
    return null;
}

/** Точка `{x,y}` из `{x,y}`, узла, обёртки или значения по умолчанию. */
function pointOf($, what, fallback) {
    if (what === undefined || what === null) return fallback || null;
    if (isNode(what)) return { x: what.x, y: what.y };
    if (isWrapper(what)) {
        const node = what.nodes[0];
        return node ? { x: node.x, y: node.y } : (fallback || null);
    }
    if (typeof what === 'object'
        && typeof what.x === 'number' && typeof what.y === 'number') {
        return { x: what.x, y: what.y };
    }
    return fallback || null;
}

function num(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
    return value < min ? min : (value > max ? max : value);
}

/** Вектор импульса: число = длина по направлению, объект = как есть. */
function impulseOf(value, dir) {
    if (value === undefined || value === null) return null;
    if (typeof value === 'number') {
        if (!Number.isFinite(value) || value === 0) return null;
        const d = dir || { x: 1, y: 0 };
        const len = Math.hypot(d.x, d.y) || 1;
        return { x: d.x / len * value, y: d.y / len * value };
    }
    if (typeof value === 'object'
        && Number.isFinite(Number(value.x)) && Number.isFinite(Number(value.y))) {
        return { x: Number(value.x), y: Number(value.y) };
    }
    return null;
}

function normalizeDir(value, fallback) {
    const d = value || fallback || { x: 1, y: 0 };
    const len = Math.hypot(d.x, d.y);
    if (!len) return { x: 1, y: 0 };
    return { x: d.x / len, y: d.y / len };
}

/** Направление из `dir`/`angle` (0 = +X, как угол узла). */
function directionOf(spec) {
    if (spec.dir) return normalizeDir(spec.dir);
    if (spec.angle !== undefined && spec.angle !== null) {
        const a = num(spec.angle, 0);
        return { x: Math.cos(a), y: Math.sin(a) };
    }
    return { x: 1, y: 0 };
}

/** Список узлов для `ignore`: узел/обёртка/селектор/массив/undefined. */
function ignoreList($, value) {
    const out = [];
    if (value === undefined || value === null) return out;
    if (Array.isArray(value)) {
        for (const item of value) out.push(...ignoreList($, item));
        return out;
    }
    const node = nodeOf($, value);
    if (node) out.push(node);
    return out;
}

/**
 * Дистанция от точки до прямоугольника узла (0 — точка внутри).
 * Для круглых тел это верхняя оценка, поэтому AoE по умолчанию считает по
 * коробке узла — так же, как `$.world.raycastAll` видит цель.
 */
function rectDistance(node, point) {
    const hw = num(node.w, 0) / 2;
    const hh = num(node.h, 0) / 2;
    const dx = Math.max(Math.abs(point.x - node.x) - hw, 0);
    const dy = Math.max(Math.abs(point.y - node.y) - hh, 0);
    return Math.hypot(dx, dy);
}

/**
 * Создать боевой фасад. `opts`:
 *   `amount`/`type`/`mask`/`wallMask` — умолчания для hitscan/снарядов;
 *   `ownership` — если передан, снаряды помечаются temporary и снимаются
 *     при уничтожении (см. lib/ownership.js);
 *   `onDamage` — необязательный hook после применения (`payload`).
 */
export function createCombat($, opts) {
    const base = opts || {};
    const projectiles = [];

    /** Цель по умолчанию: живой узел с положительным потолком здоровья. */
    function defaultTargetable(node) {
        return !!node && !node.removed
            && num(node.max_hp, 0) > 0 && num(node.cur_hp, 0) > 0;
    }

    function targetableOf(spec, node) {
        if (typeof spec.targetable === 'function') return !!spec.targetable(node);
        return defaultTargetable(node);
    }

    /**
     * Собрать препятствия и цели на отрезке и остановиться на первом.
     *
     * Слой `mask` — цели, `wallMask` — препятствия (0 = все слои). Узел без
     * маски в списке целей не блокирует; узел из списка препятствий блокирует,
     * если он не цель. Не-узловая геометрия (например статические коллайдеры
     * тайлмапов) ловится `$.world.raycast`.
     */
    function sweep(spec, from, to) {
        const mask = spec.mask === undefined ? 0 : (spec.mask >>> 0);
        const wallMask = spec.wallMask === undefined ? 0 : (spec.wallMask >>> 0);
        const ignored = ignoreList($, spec.ignore).concat(ignoreList($, spec.source));
        const isIgnored = (node) => ignored.indexOf(node) >= 0;

        const targets = $.world.raycastAll(from, to, { mask });
        const blockers = wallMask === mask ? targets : $.world.raycastAll(from, to, { mask: wallMask });
        const targetSet = new Set(targets.map((item) => item.node));
        const seen = new Map();
        for (const item of targets) {
            const node = item.node;
            if (!node || isIgnored(node)) continue;
            const prior = seen.get(node);
            const row = prior || { node, t: item.t, point: item.point, canHit: false, canBlock: false };
            row.t = Math.min(row.t, item.t);
            if (!prior && item.t <= row.t + EPS) row.point = item.point;
            seen.set(node, row);
        }
        for (const item of blockers) {
            const node = item.node;
            if (!node || isIgnored(node)) continue;
            let row = seen.get(node);
            if (!row) {
                row = { node, t: item.t, point: item.point, canHit: false, canBlock: false };
                seen.set(node, row);
            }
            row.canBlock = true;
            if (item.t < row.t - EPS) {
                row.t = item.t;
                row.point = item.point;
            }
        }
        const ordered = Array.from(seen.values()).sort((a, b) => {
            if (Math.abs(a.t - b.t) > EPS) return a.t - b.t;
            return String(a.node.nid) < String(b.node.nid) ? -1 : 1;
        });
        for (const row of ordered) {
            row.canHit = targetSet.has(row.node) && targetableOf(spec, row.node);
        }

        // Не-узловая геометрия: физический луч видит её, raycastAll — нет.
        // Если попал УЗЕЛ, его обработает список выше (иначе двойной учёт).
        let geometry = null;
        if (spec.stopAtWall !== false) {
            const hit = $.world.raycast(from, to, { mask: wallMask, ignore: ignored });
            if (hit && !hit.node) geometry = hit;
        }
        const limitT = geometry ? Math.min(1, geometry.fraction) : 1;

        return { ordered, limitT, geometry, ignored };
    }

    /** Один payload урона по спецификации. */
    function payload(spec) {
        const subject = nodeOf($, spec.subject !== undefined ? spec.subject : spec.target);
        const source = nodeOf($, spec.source);
        const point = pointOf($, spec.point, null);
        const radius = Math.max(0, num(spec.radius, 0));
        const amount = spec.amount !== undefined ? spec.amount : spec.damage;
        return {
            amount: Math.max(0, num(amount, 0)),
            type: spec.type === undefined ? 'generic' : String(spec.type),
            source,
            subject,
            point,
            impulse: impulseOf(spec.impulse, spec.dir),
            radius,
            sourceNid: source ? source.nid : null,
            subjectNid: subject ? subject.nid : null,
        };
    }

    /**
     * Применить готовый payload. Единственный путь урона в этой библиотеке.
     * Возвращает тот же payload с полями результата и статусом `accepted`.
     */
    function applyDamage(data) {
        const target = data.subject;
        if (!target || !isNode(target) || target.removed) {
            data.accepted = false;
            data.reason = 'missing_target';
            return data;
        }
        const wrapper = $(target);
        const before = num(wrapper.hp(), 0);
        if (before <= 0) {
            data.accepted = false;
            data.reason = 'destroyed_target';
            return data;
        }
        const amount = Math.max(0, num(data.amount, 0));
        if (amount <= 0) {
            data.accepted = false;
            data.reason = 'zero_amount';
            return data;
        }
        // iframes — контракт `.damage()`: пробуем и смотрим фактическую разницу.
        wrapper.damage(amount, data.source);
        const after = num(wrapper.hp(), 0);
        const applied = Math.max(0, before - after);
        if (applied <= 0) {
            data.accepted = false;
            data.reason = 'immunity';
            return data;
        }
        data.accepted = true;
        data.reason = null;
        data.applied = applied;
        data.hpBefore = before;
        data.hpAfter = after;
        data.dead = after <= 0;
        if (data.impulse && !target.removed) {
            wrapper.applyImpulse(data.impulse.x, data.impulse.y);
        }
        if (typeof base.onDamage === 'function') base.onDamage(data);
        // Узел: `damaged`; глобально: `$.emit('damage', payload)`.
        wrapper.emit('damaged', data);
        $.emit('damage', data);
        if (data.dead) {
            // Узел 'death' доходит и до `$.on('death')` через dispatchGlobal
            // внутри node.emit() — отдельный `$.emit('death')` был бы вторым.
            wrapper.emit('death', data);
        }
        return data;
    }

    /**
     * Hitscan. Возвращает `{ hit, hits, wall, from, to, missed }`.
     * `hits[i]` — `{ node, point, distance, fraction, payload }`.
     * `wall` — `{ node, point, distance, fraction }` для узла-препятствия или
     * не-узловой геометрии. При `pierce`/`maxHits` цель попадает не больше
     * одного раза за выстрел.
     */
    function hitscan(spec) {
        const s = spec || {};
        const from = pointOf($, s.from, null);
        const to = pointOf($, s.to, null);
        const result = { hit: false, hits: [], wall: null, from, to, missed: true };
        if (!from || !to) {
            result.reason = 'missing_endpoint';
            return result;
        }
        const sweepData = sweep(s, from, to);
        const maxHits = Math.max(1, s.pierce
            ? num(s.maxHits, Number.MAX_SAFE_INTEGER)
            : num(s.maxHits, 1));
        const hitNodes = new Set();
        let wall = null;
        for (const row of sweepData.ordered) {
            if (row.t > sweepData.limitT + EPS) break;
            if (!row.canHit) {
                if (row.canBlock) {
                    wall = { node: row.node, point: row.point, distance: row.t * distance(from, to), fraction: row.t };
                    break;
                }
                continue;
            }
            if (hitNodes.has(row.node.nid)) continue;
            hitNodes.add(row.node.nid);
            const payload = buildPayload(s, row.node, row.point);
            applyDamage(payload);
            result.hits.push({
                node: row.node,
                point: row.point,
                distance: row.t * distance(from, to),
                fraction: row.t,
                payload,
            });
            if (result.hits.length >= maxHits) break;
        }
        if (!wall && sweepData.geometry && result.hits.length === 0) {
            wall = {
                node: null,
                point: sweepData.geometry.point,
                distance: sweepData.geometry.distance,
                fraction: sweepData.geometry.fraction,
            };
        }
        // Геометрия ближе первого попадания тоже останавливает луч.
        if (sweepData.geometry) {
            const hitT = result.hits.length ? result.hits[0].fraction : Infinity;
            if (sweepData.geometry.fraction < hitT - EPS) {
                const wallT = sweepData.geometry.fraction;
                result.hits = [];
                wall = {
                    node: null,
                    point: sweepData.geometry.point,
                    distance: sweepData.geometry.distance,
                    fraction: wallT,
                };
            }
        }
        result.hit = result.hits.length > 0;
        result.wall = wall;
        result.missed = !result.hit;
        if (!result.hits.length && !wall) result.reason = 'miss';
        return result;
    }

    function buildPayload(spec, node, point) {
        const data = payload({
            amount: spec.amount !== undefined ? spec.amount
                : (spec.damage !== undefined ? spec.damage : base.amount),
            type: spec.type !== undefined ? spec.type : base.type,
            source: spec.source,
            subject: node,
            point,
            impulse: spec.impulse,
            dir: spec.dir,
        });
        return data;
    }

    function distance(a, b) {
        return Math.hypot(b.x - a.x, b.y - a.y);
    }

    /**
     * AoE: тела в квадрате радиуса, расстояние до прямоугольника узла,
     * линейный спад. `falloff: 'none'` — полный урон всем в радиусе.
     * Каждая цель — один раз. Порядок hits детерминирован: дистанция, nid.
     */
    function aoe(spec) {
        const s = spec || {};
        const point = pointOf($, s.point !== undefined ? s.point
            : (s.at !== undefined ? s.at : s.from), null);
        const radius = Math.max(0, num(s.radius, 0));
        const out = { hits: [], point, radius, hit: false };
        if (!point) {
            out.reason = 'missing_point';
            return out;
        }
        const mask = s.mask === undefined ? 0 : (s.mask >>> 0);
        const ignored = ignoreList($, s.ignore).concat(ignoreList($, s.source));
        let bodies;
        if (radius <= 0) {
            bodies = $.world.bodyAt(point.x, point.y, { mask }).nodes.slice();
        } else {
            // ВАЖНО: `$.world.bodiesIn(x, y, w, h)` — это прямоугольник с
            // ЦЕНТРОМ (x, y) (обёртка над engine.queryBox; см.
            // docs/internal/NATIVE.md §queryBox). Поэтому центр и полный
            // размер, а не левый верхний угол.
            bodies = $.world.bodiesIn(point.x, point.y,
                radius * 2, radius * 2, { mask }).nodes.slice();
        }
        const seen = new Set();
        const candidates = [];
        for (const node of bodies) {
            if (!node || node.removed || ignored.indexOf(node) >= 0) continue;
            if (seen.has(node.nid)) continue;
            seen.add(node.nid);
            if (!targetableOf(s, node)) continue;
            const dist = rectDistance(node, point);
            if (dist > radius + EPS) continue;
            const factor = s.falloff === 'none' || radius <= 0
                ? 1 : clamp(1 - dist / radius, 0, 1);
            candidates.push({ node, distance: dist, factor });
        }
        candidates.sort((a, b) => {
            if (Math.abs(a.distance - b.distance) > EPS) return a.distance - b.distance;
            return String(a.node.nid) < String(b.node.nid) ? -1 : 1;
        });
        for (const item of candidates) {
            const requested = s.amount !== undefined ? s.amount : s.damage;
            const amount = s.falloff === 'none'
                ? Math.max(0, num(requested, 0))
                : Math.max(1, Math.round(num(requested, 0) * item.factor));
            const data = payload({
                amount,
                type: s.type !== undefined ? s.type : 'explosion',
                source: s.source,
                subject: item.node,
                point,
                impulse: s.impulse,
                radius,
                dir: { x: item.node.x - point.x, y: item.node.y - point.y },
            });
            const hit = { node: item.node, distance: item.distance,
                          factor: item.factor, payload: data };
            // Импульс AoE — от центра к цели, а не общий вектор.
            data.impulse = impulseOf(s.impulse,
                { x: item.node.x - point.x, y: item.node.y - point.y });
            applyDamage(data);
            out.hits.push(hit);
        }
        out.hit = out.hits.length > 0;
        if (!out.hit) out.reason = 'miss';
        return out;
    }

    /**
     * Снаряд: узел `<bullet>` + пошаговый raycast/каст.
     *
     * `opts`: `{from, dir|angle, speed=480, amount, type='bullet', mask,
     * wallMask, radius=0, lifetime=3000, maxDistance=1200, source, impulse,
     * ignore, targetable, id, ownership}`.
     * Возвращает дескриптор `{ node, update(dt), remove(reason), alive(),
     * hit, dead, reason }`. Шаг задаёт игра через `combat.update(dt)` или
     * `дескриптор.update(dt)`.
     */
    function projectile(spec) {
        const s = spec || {};
        const from = pointOf($, s.from, { x: 0, y: 0 });
        const dir = directionOf(s);
        const speed = Math.max(1, num(s.speed, 480));
        const radius = Math.max(0, num(s.radius, 0));
        const owner = s.ownership || base.ownership;
        const node = (s.id === undefined ? $('<bullet>') : $('<bullet>', { id: s.id }))
            .at(from.x, from.y)
            .size(num(s.w, 6), num(s.h, 6));
        if (s.color !== undefined) node.color(s.color);
        node.bullet(true).appendTo(s.parent === undefined ? $.world : s.parent);
        if (owner) owner.mark(node, 'temporary');

        const shot = {
            node,
            direction: dir,
            speed,
            traveled: 0,
            lifetime: Math.max(0, num(s.lifetime, 3000)),
            maxDistance: Math.max(0, num(s.maxDistance, 1200)),
            hit: null,
            wall: null,
            dead: false,
            reason: null,
            alive() {
                if (shot.dead) return false;
                const raw = node.get(0);
                return !!raw && !raw.removed;
            },
            remove(reason) {
                if (shot.dead) return false;
                shot.dead = true;
                shot.reason = reason || 'removed';
                if (owner && typeof owner.unmark === 'function') owner.unmark(node);
                const raw = node.get(0);
                if (raw && !raw.removed) node.remove();
                return true;
            },
            update(dt) {
                if (shot.dead) return false;
                const raw = node.get(0);
                if (!raw || raw.removed) {
                    shot.dead = true;
                    shot.reason = 'destroyed';
                    return false;
                }
                const step = Math.max(0, num(dt, 0));
                shot.lifetime -= step * 1000;
                if (shot.lifetime <= 0) {
                    shot.remove('lifetime');
                    return false;
                }
                const travel = Math.min(speed * step, shot.maxDistance - shot.traveled);
                if (travel <= 0) {
                    shot.remove('range');
                    return false;
                }
                let start = { x: raw.x, y: raw.y };
                let end = { x: start.x + dir.x * travel, y: start.y + dir.y * travel };
                const ignore = ignoreList($, s.ignore)
                    .concat(ignoreList($, s.source)).concat([raw]);
                if (radius > 0) {
                    // Свип объёма: тонкие углы и толстые тела ловятся честнее.
                    const sweepHit = $.world.castShape(start, end, {
                        radius, mask: s.wallMask === undefined ? 0 : (s.wallMask >>> 0),
                        ignore,
                    });
                    if (sweepHit) {
                        end = {
                            x: start.x + (end.x - start.x) * sweepHit.fraction,
                            y: start.y + (end.y - start.y) * sweepHit.fraction,
                        };
                    }
                }
                const result = hitscan({
                    from: start, to: end,
                    mask: s.mask, wallMask: s.wallMask,
                    amount: s.amount !== undefined ? s.amount
                        : (s.damage !== undefined ? s.damage : base.amount),
                    type: s.type !== undefined ? s.type : (base.type || 'bullet'),
                    source: s.source,
                    impulse: s.impulse,
                    ignore,
                    targetable: s.targetable,
                    stopAtWall: s.stopAtWall,
                });
                shot.traveled += travel;
                if (result.hit) {
                    shot.hit = result.hits[0];
                    if (s.persistOnHit === true) {
                        node.at(result.hits[0].point.x, result.hits[0].point.y);
                    } else {
                        shot.remove('hit');
                    }
                    return false;
                }
                if (result.wall) {
                    shot.wall = result.wall;
                    node.at(result.wall.point.x, result.wall.point.y);
                    shot.remove('wall');
                    return false;
                }
                node.at(end.x, end.y);
                if (shot.maxDistance > 0 && shot.traveled >= shot.maxDistance) {
                    shot.remove('range');
                    return false;
                }
                return true;
            },
        };
        projectiles.push(shot);
        return shot;
    }

    /** Шаг всех снарядов; удалённые выбывают из списка. */
    function update(dt) {
        for (let i = projectiles.length - 1; i >= 0; --i) {
            const shot = projectiles[i];
            if (!shot.alive()) {
                projectiles.splice(i, 1);
                continue;
            }
            shot.update(dt);
            if (!shot.alive()) projectiles.splice(i, 1);
        }
        return projectiles.length;
    }

    const combat = {
        /** Применить payload/спеку к одной цели. */
        apply(spec) {
            return applyDamage(payload(spec));
        },
        /** Готовый payload без применения (для своих целей/событий). */
        payload,
        hitscan,
        aoe,
        projectile,
        update,
        /** Живые снаряды (копия). */
        projectiles() { return projectiles.slice(); },
        /** Убрать все снаряды: `reason` попадает в их дескрипторы. */
        clear(reason) {
            let count = 0;
            for (const shot of projectiles.slice()) if (shot.remove(reason || 'clear')) count++;
            projectiles.length = 0;
            return count;
        },
        /** Цель по умолчанию — для проверок и переопределения. */
        targetable: defaultTargetable,
        refusals() { return DAMAGE_REFUSALS.slice(); },
    };
    return combat;
}

export default createCombat;
