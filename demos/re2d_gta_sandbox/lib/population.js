// ===========================================================================
// population.js — скриптовый streaming-сэмпл населения для городской сцены.
//
// Это НЕ глобальный PopulationManager и не подсистема движка. Это обычный
// объект, который сцена создаёт, тикает и выкидывает:
//
//   import { createPopulation } from './lib/population.js';
//   const crowd = createPopulation($, {
//       targetCount: 12,
//       spawnDistance: 900,          // спавн только рядом с AOI
//       despawnDistance: 1400,       // уборка далеко от AOI
//       cooldown: 0.4,               // секунд между спавнами
//       seed: 7,                     // детерминизм (тот же seed → тот же набор)
//       graph,                        // roadgraph.js: spawn points + surface tags
//       ownership,                    // lib/ownership.js (DI, не обязателен)
//       focus: () => player.pos(),    // area of interest
//       spawn: (point, rng) => {
//           const ped = $('<npc>', { class: 'ped' }).at(point.x, point.y)
//               .size(18, 36).appendTo($.world);
//           ped.attr('kind', point.kind);
//           return ped;
//       },
//   });
//   $.update(dt => crowd.update(dt));    // или сцена тикает сама
//
// Правила:
//   * точки спавна фильтруются tags (sidewalk/no_spawn/road) и предикатом;
//   * `ownership` внедряется через опции: temporary помечается при спавне,
//     persistent/mission никогда не выгружается sweep'ом этого сэмпла;
//   * без ownership защита работает по `opts.protect(node)` / `protect()`;
//   * никаких синглтонов и глобального состояния — всё в замыкании фабрики.
// ===========================================================================

const DEFAULT_TARGET = 8;
const DEFAULT_SPAWN_DISTANCE = 900;
const DEFAULT_DESPAWN_DISTANCE = 1400;

// Уникальное имя потока на каждый экземпляр: $.random.stream кэширует по
// имени, и два пула с одним seed иначе делили бы одну последовательность.
let instanceCounter = 0;

/** Детерминированный mulberry32 (тот же алгоритм, что у ядра/$.random). */
function mulberry32(seed) {
    let state = (Number(seed) >>> 0) || 1;
    return function next() {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function pointOf(value, where) {
    if (Array.isArray(value) && value.length >= 2) {
        const x = Number(value[0]), y = Number(value[1]);
        if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
    } else if (value && typeof value === 'object' && Number.isFinite(Number(value.x)) && Number.isFinite(Number(value.y))) {
        return { x: Number(value.x), y: Number(value.y) };
    }
    throw new TypeError(`population: ${where} должен быть точкой {x,y} или [x,y]`);
}

function isWrapper(value) {
    return !!(value && typeof value === 'object' && Array.isArray(value.nodes) && typeof value.get === 'function');
}

function nodeOf(value) {
    if (!value) return null;
    if (Array.isArray(value)) return nodeOf(value[0]);
    if (isWrapper(value)) return value.nodes[0] || null;
    return value;
}

function nodeAlive($, node) {
    if (!node) return false;
    if (node.removed) return false;
    if (node.alive !== undefined && node.alive === false) return false;   // поле-флаг, не метод
    return true;
}

export function createPopulation($, options = {}) {
    if (typeof $ !== 'function') throw new TypeError('population: нужен публичный $');
    const opts = options || {};
    if (typeof opts.spawn !== 'function') {
        throw new TypeError('population: opts.spawn(point, rng) обязателен — библиотека не знает, кого спавнить');
    }

    const graph = opts.graph || null;
    const world = opts.world || (graph && graph.world) || null;
    const h = opts.h;
    const ownership = opts.ownership || null;
    const name = opts.name ? String(opts.name) : 'population';
    const seedValue = opts.seed === undefined ? 1 : (Number(opts.seed) >>> 0);

    // Свой поток $.random, если он есть (изолирован от gameplay), иначе — свой
    // mulberry32: результат обязан быть одинаковым при одинаковом seed.
    let rng;
    if (opts.rng && typeof opts.rng === 'function') rng = opts.rng;
    else if ($.random && typeof $.random.stream === 'function') {
        const stream = $.random.stream(`population:${name}:${++instanceCounter}`, { seed: seedValue, independent: true });
        rng = () => stream.next();
    } else {
        rng = mulberry32(seedValue);
    }

    const targetValue = () => Math.max(0, Math.trunc(Number(opts.targetCount ?? DEFAULT_TARGET) || 0));
    const spawnDistance = Number(opts.spawnDistance ?? DEFAULT_SPAWN_DISTANCE);
    const despawnDistance = Number(opts.despawnDistance ?? DEFAULT_DESPAWN_DISTANCE);
    const minSpawnDistance = Number(opts.minSpawnDistance ?? 0);
    const cooldownSec = Math.max(0, Number(opts.cooldown ?? 0));
    const maxPerUpdate = Math.max(1, Math.trunc(Number(opts.maxPerUpdate ?? 1) || 1));
    const minSeparation = Math.max(0, Number(opts.minSeparation ?? 0));
    const requiredTags = (opts.tags || []).map(String);
    const excludedTags = (opts.excludeTags || ['no_spawn']).map(String);
    const focusOption = opts.focus || null;
    const filterOption = typeof opts.filter === 'function' ? opts.filter : null;
    const protectOption = typeof opts.protect === 'function' ? opts.protect : null;
    const despawnOption = typeof opts.despawn === 'function' ? opts.despawn : null;
    const tagOption = typeof opts.tagsAt === 'function' ? opts.tagsAt : null;
    // Одна точка спавна = один живой объект (пока объект не убран): иначе
    // population набивает пятерых в одну и ту же точку и AOI-радиус врёт.
    const uniquePoints = opts.uniquePoints !== false;
    const pointKey = (p) => `${Math.round(Number(p.x) * 100) / 100}|${Math.round(Number(p.y) * 100) / 100}`;

    let pointsProvider = opts.points || null;
    let entries = [];
    let seq = 0;
    let cooldown = 0;
    const stats = {
        spawned: 0, despawned: 0, skipped: 0, failed: 0,
        attempts: 0, protectedSkipped: 0, deadPruned: 0,
        lastReason: null, seed: seedValue,
    };

    function resolveFocus() {
        if (typeof focusOption === 'function') return pointOf(focusOption(), 'focus()');
        if (typeof focusOption === 'string') {
            const node = nodeOf($(focusOption));
            if (!node) return null;
            return { x: Number(node.x) || 0, y: Number(node.y) || 0 };
        }
        if (focusOption) {
            const node = nodeOf(focusOption);
            if (node && Number.isFinite(Number(node.x))) return { x: node.x, y: node.y };
            return pointOf(focusOption, 'focus');
        }
        return null;
    }

    function livePoints() {
        const source = typeof pointsProvider === 'function' ? pointsProvider() : pointsProvider;
        return Array.isArray(source) ? source : [];
    }

    function tagsAt(point) {
        const declared = Array.isArray(point.tags) ? point.tags.map(String) : [];
        const live = [];
        const q = tagOption || (world && typeof world.groundAt === 'function'
            ? (x, y) => world.groundAt(x, y, h === undefined ? {} : { h })
            : null);
        if (q) {
            try {
                const ground = q(point.x, point.y);
                if (ground && Array.isArray(ground.tags)) for (const tag of ground.tags) live.push(String(tag));
            } catch (e) {
                // ambiguous multi-storey XY без h и подобное — теги неизвестны;
                // объявленные данные точки остаются, ничего не выдумываем.
            }
        }
        const seen = new Set();
        const tags = [];
        for (const tag of declared.concat(live)) {
            if (!seen.has(tag)) { seen.add(tag); tags.push(tag); }
        }
        return { tags, declared, live };
    }

    function nodePoint(node) {
        return { x: Number(node.x) || 0, y: Number(node.y) || 0 };
    }

    function isProtected(entry) {
        if (entry.protectedKind) return true;
        const node = entry.node;
        if (ownership && typeof ownership.is === 'function') {
            try {
                if (ownership.is(node, 'persistent') || ownership.is(node, 'mission')) return true;
            } catch (e) { /* нет узла — не защищён */ }
        }
        if (protectOption) {
            try { if (protectOption(node, entry)) return true; } catch (e) { /* предикат — код игры */ }
        }
        return false;
    }

    function markTemporary(node) {
        if (!ownership || typeof ownership.mark !== 'function') return;
        try { ownership.mark(node, 'temporary'); } catch (e) { /* ownership может быть не готов */ }
    }

    function destroyNode(node) {
        if (!node) return;
        if (typeof node.destroy === 'function') { node.destroy(); return; }
        const w = $(node);
        if (w && typeof w.remove === 'function') w.remove();
    }

    function pruneDead() {
        const alive = [];
        for (const entry of entries) {
            const node = entry.node;
            let gone = !nodeAlive($, node);
            if (!gone && entry.handle && typeof entry.handle.alive === 'function') {
                try { gone = !entry.handle.alive(); } catch (e) { gone = true; }
            }
            if (gone) {
                if (!isProtected(entry)) {
                    stats.deadPruned++;
                    // Мёртвый/удалённый узел не зовём повторно: это уже не наш объект.
                    entry.dead = true;
                } else continue;   // защищённый мог быть заменён handle'ом — не считаем живым
            }
            alive.push(entry);
        }
        entries = alive;
    }

    function despawnFar(focus) {
        if (!focus) return 0;
        let removed = 0;
        const keep = [];
        for (const entry of entries) {
            if (entry.persistent || entry.dead) { keep.push(entry); continue; }
            const p = nodePoint(entry.node);
            const d = Math.hypot(p.x - focus.x, p.y - focus.y);
            if (d > despawnDistance && !isProtected(entry)) {
                if (despawnOption) {
                    try { despawnOption(entry, 'distance'); } catch (e) { /* код игры */ }
                }
                destroyNode(entry.node);
                stats.despawned++;
                removed++;
            } else {
                keep.push(entry);
            }
        }
        entries = keep;
        return removed;
    }

    function candidateList(focus) {
        const all = livePoints();
        const out = [];
        const near = focus || { x: 0, y: 0 };
        for (const raw of all) {
            if (!raw) continue;
            const p = { x: Number(raw.x), y: Number(raw.y) };
            if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
            if (focus) {
                const d = Math.hypot(p.x - focus.x, p.y - focus.y);
                if (d > spawnDistance || d < minSpawnDistance) continue;
            }
            const tagInfo = tagsAt(raw);
            const tagSet = new Set(tagInfo.tags);
            let ok = true;
            for (const tag of requiredTags) if (!tagSet.has(tag)) { ok = false; break; }
            if (ok) for (const tag of excludedTags) if (tagSet.has(tag)) { ok = false; break; }
            if (!ok) continue;
            if (uniquePoints) {
                const key = pointKey(p);
                let used = false;
                for (const entry of entries) {
                    if (entry.dead || entry.pointKey !== key) continue;
                    used = true; break;
                }
                if (used) continue;
            }
            // Слишком близко к уже живущим — не спавним друг на друга.
            if (minSeparation > 0) {
                let crowded = false;
                for (const entry of entries) {
                    if (entry.dead) continue;
                    const ep = nodePoint(entry.node);
                    if (Math.hypot(ep.x - p.x, ep.y - p.y) < minSeparation) { crowded = true; break; }
                }
                if (crowded) continue;
            }
            if (filterOption) {
                const tags_ = tagInfo.tags;
                let pass = false;
                try { pass = !!filterOption({ ...raw, x: p.x, y: p.y, tags: tags_ }, { rng, focus, population }); }
                catch (e) { pass = false; }
                if (!pass) continue;
            }
            out.push({ ...raw, x: p.x, y: p.y, tags: tagInfo.tags, declaredTags: tagInfo.declared, liveTags: tagInfo.live });
        }
        return out;
    }

    function track(nodeValue, kind = 'persistent') {
        const node = nodeOf(nodeValue);
        if (!node) throw new TypeError('population.track: нужен узел');
        const existing = entries.find((e) => e.node === node);
        if (existing) { existing.protectedKind = kind; return existing; }
        const entry = { seq: seq++, node, kind: String(point.kind || node.tag || 'unknown'),
                        point: nodePoint(node), persistent: true, protectedKind: kind,
                        handle: ownership && typeof ownership.handle === 'function' ? ownership.handle(node) : null };
        entries.push(entry);
        if (ownership && typeof ownership.mark === 'function') {
            try { ownership.mark(node, kind); } catch (e) { /* не блокируем сцену */ }
        }
        return entry;
    }

    function spawnAt(point) {
        stats.attempts++;
        const node = nodeOf(opts.spawn(point, rng, population));
        if (!node) { stats.failed++; stats.lastReason = 'spawn-returned-null'; return null; }
        if (!nodeAlive($, node)) { stats.failed++; stats.lastReason = 'spawn-returned-dead'; return null; }
        markTemporary(node);
        const entry = {
            seq: seq++, node,
            kind: String(point.kind || node.tag || 'unknown'),
            point: { x: point.x, y: point.y },
            pointKey: pointKey(point),
            persistent: false, protectedKind: null,
            handle: ownership && typeof ownership.handle === 'function' ? ownership.handle(node) : null,
            age: 0,
        };
        entries.push(entry);
        stats.spawned++;
        stats.lastReason = 'spawned';
        cooldown = cooldownSec;
        return entry;
    }

    function update(dt) {
        const step = Number(dt);
        if (!Number.isFinite(step) || step < 0) throw new RangeError('population.update: dt должен быть конечным >= 0');
        const focus = resolveFocus();
        const beforeSpawn = stats.spawned;
        const beforeDespawn = stats.despawned;

        pruneDead();
        for (const entry of entries) entry.age = (entry.age || 0) + step;
        despawnFar(focus);
        if (cooldown > 0) cooldown = Math.max(0, cooldown - step);

        let spawnedThisUpdate = 0;
        if (cooldown <= 0 && entries.length < targetValue()) {
            const candidates = candidateList(focus);
            stats.candidates = candidates.length;
            while (spawnedThisUpdate < maxPerUpdate && entries.length < targetValue() && candidates.length) {
                const index = Math.min(candidates.length - 1, Math.floor(rng() * candidates.length));
                const point = candidates.splice(index, 1)[0];
                if (!spawnAt(point)) {
                    stats.skipped++;
                    if (cooldown <= 0) cooldown = 0;   // не залипаем: пробуем следующего
                    break;
                }
                spawnedThisUpdate++;
                if (cooldown > 0) break;
            }
        }
        return {
            spawned: stats.spawned - beforeSpawn,
            despawned: stats.despawned - beforeDespawn,
            count: entries.length,
            target: targetValue(),
            focus,
        };
    }

    function snapshot() {
        const focus = resolveFocus();
        return entries
            .filter((entry) => !entry.dead)
            .map((entry) => {
                const p = nodePoint(entry.node);
                return {
                    seq: entry.seq,
                    id: entry.node.id === undefined ? null : entry.node.id,
                    kind: entry.kind,
                    x: Math.round(p.x * 1000) / 1000,
                    y: Math.round(p.y * 1000) / 1000,
                    persistent: !!(entry.persistent || entry.protectedKind || isProtected(entry)),
                    protectedKind: entry.protectedKind || null,
                    age: Math.round((entry.age || 0) * 1000) / 1000,
                    distance: focus ? Math.round(Math.hypot(p.x - focus.x, p.y - focus.y) * 1000) / 1000 : null,
                };
            })
            .sort((a, b) => a.seq - b.seq);
    }

    const population = {
        name,

        update,

        /** Текущее число управляемых объектов (включая защищённые). */
        count() { return entries.filter((e) => !e.dead).length; },
        target() { return targetValue(); },
        setTarget(n) { opts.targetCount = Math.max(0, Math.trunc(Number(n) || 0)); return population; },
        setPoints(points) { pointsProvider = points; return population; },
        points() { return livePoints().slice(); },
        seed() { return seedValue; },
        focus() { return resolveFocus(); },

        /** Пометить существующий узел защищённым (persistent|mission). */
        protect(node, kind = 'persistent') { return track(node, kind); },
        /** Включить в учёт существующий узел; по умолчанию он persistent. */
        track,
        /** Снять защиту (не удаляет узел). */
        unprotect(nodeValue) {
            const node = nodeOf(nodeValue);
            const entry = entries.find((e) => e.node === node);
            if (!entry) return false;
            entry.persistent = false;
            entry.protectedKind = null;
            return true;
        },

        /** Один принудительный спавн (тесты/сцена); возвращает snapshot-строку. */
        spawnNow(point) {
            if (!point) {
                const focus = resolveFocus();
                const candidates = candidateList(focus);
                if (!candidates.length) return null;
                point = candidates[Math.min(candidates.length - 1, Math.floor(rng() * candidates.length))];
            } else point = pointOf(point, 'spawnNow');
            const entry = spawnAt(point);
            if (!entry) return null;
            const p = nodePoint(entry.node);
            return { seq: entry.seq, id: entry.node.id ?? null, kind: entry.kind, x: p.x, y: p.y };
        },

        /** Убрать управляемые (не защищённые) объекты. */
        clear() {
            let removed = 0;
            const keep = [];
            for (const entry of entries) {
                if (entry.persistent || entry.protectedKind || isProtected(entry)) { keep.push(entry); continue; }
                if (despawnOption) { try { despawnOption(entry, 'clear'); } catch (e) { /* код игры */ } }
                destroyNode(entry.node);
                stats.despawned++;
                removed++;
            }
            entries = keep;
            return removed;
        },

        stats() {
            return {
                ...stats,
                count: population.count(),
                target: targetValue(),
                protected: entries.filter((e) => e.persistent || e.protectedKind || isProtected(e)).length,
                cooldown: Math.round(cooldown * 1000) / 1000,
                spawnDistance, despawnDistance,
                tags: requiredTags.slice(), excludeTags: excludedTags.slice(), uniquePoints,
                hasOwnership: !!ownership, hasSurface: !!(world && typeof world.groundAt === 'function'),
            };
        },

        snapshot,
        entries() { return entries.map((e) => $(e.node)); },
        dispose() {
            population.clear();
            entries = [];
            pointsProvider = null;
        },
    };
    return population;
}
