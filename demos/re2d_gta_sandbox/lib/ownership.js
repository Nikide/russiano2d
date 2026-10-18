// ===========================================================================
// GTA-sandbox: владение узлами и стабильные handles (P0.6).
//
// Зачем слой: движок удаляет узлы (`node.remove()`), а игровые подсистемы
// (трафик, миссии, HUD) ссылаются на них между кадрами. Прямая ссылка на узел
// после destroy указывает на мёртвый объект, а пул (`$.pool`) переиспользует
// тот же объект — «старый» держатель мог бы управлять новой целью. Здесь:
//
//   * `mark(node, kind)` — политика владения: persistent | temporary | mission;
//   * `handle(node)` — стабильный дескриптор `{id, get(), alive()}`. Внутри
//     хранится `nid` (логический ID движка) и `uid` (номер создания): после
//     destroy или переиспользования пула uid меняется — handle мёртв, `get()`
//     возвращает null, управлять новой целью нельзя;
//   * `sweep({keep, inside})` — удаляет ТОЛЬКО temporary; persistent/mission
//     защищены; `inside` — предикат или область около игрока/камеры.
//
// Движок уже даёт `node.nid` (переживает save/prefab, стабилен в запуске) и
// `node.uid` (номер создания, обновляется пулом при выдаче) — свой счётчик не
// заводим. Видимость узла (`visible`) владением не считается.
//
// save/load и смена сцены: разметка — это JS-состояние и НЕ сохраняется.
// После загрузки сцены узлы новые, старые handles мертвы (uid новый), а `nid`
// переживает save/prefab — им можно сопоставить загруженный узел и позвать
// `mark()` заново. `resolve(nid)` ищет среди заново размеченных узлов.
//
// Использование (внедрением, без второго менеджера):
//
//   const ownership = createOwnership($);
//   ownership.mark('#car-3', 'temporary');
//   const h = ownership.handle('#car-3');
//   h.alive();          // true
//   $('#car-3').remove();
//   h.alive();          // false, h.get() === null
//   ownership.sweep({ inside: (n) => n.x < -2000 });  // уберёт только temporary
// ===========================================================================

/** Допустимые виды владения; temporary — по умолчанию. */
export const KINDS = ['temporary', 'persistent', 'mission'];

function isNode(value) {
    return !!(value && typeof value === 'object' && typeof value.tag === 'string'
        && typeof value.nid === 'string');
}

function isWrapper(value) {
    return !!(value && typeof value === 'object' && Array.isArray(value.nodes));
}

/** Цель handle-проверки: узел, обёртка или строка-селектор. */
function rawNodeOf($, what) {
    if (!what) return null;
    if (isNode(what)) return what;
    if (isWrapper(what)) return what.nodes[0] || null;
    if (typeof what === 'string') return $(what).get(0) || null;
    return null;
}

/** Нормальная область `inside`: предикат или геометрия. */
function insideTest(value, node) {
    if (typeof value === 'function') return !!value(node);
    if (!value || typeof value !== 'object') return true;
    const x = Number(value.x) || 0;
    const y = Number(value.y) || 0;
    if (value.radius !== undefined) {
        return Math.hypot(node.x - x, node.y - y) <= (Number(value.radius) || 0);
    }
    const w = Number(value.w) || 0;
    const h = Number(value.h) || 0;
    return Math.abs(node.x - x) <= w / 2 && Math.abs(node.y - y) <= h / 2;
}

/** `keep` → предикат «не удалять даже temporary». */
function keepTest($, value) {
    if (value === undefined || value === null) return () => false;
    if (typeof value === 'function') return (node) => !!value(node);
    const list = Array.isArray(value) ? value : [value];
    const nodes = [];
    const ids = new Set();
    for (const item of list) {
        if (isNode(item)) nodes.push(item);
        else if (isWrapper(item) && item.nodes[0]) nodes.push(item.nodes[0]);
        else if (item && typeof item === 'object' && typeof item.get === 'function') {
            const node = item.get();
            if (node) nodes.push(node);
        } else if (typeof item === 'string') {
            // Строка — селектор ИЛИ nid/id. '#t3' и 't3' должны работать оба.
            const resolved = item.charAt(0) === '#' || /[.[:>\s]/.test(item)
                ? $(item).get(0) : null;
            if (resolved) nodes.push(resolved);
            else ids.add(item);
        }
    }
    return (node) => nodes.indexOf(node) >= 0
        || ids.has(node.nid) || ids.has(String(node.id));
}

export function createOwnership($, opts) {
    const config = opts || {};
    /** node → kind */
    const marks = new Map();
    /** nid → node (для resolve; чистится лениво) */
    const byNid = new Map();

    function kindOf(value) {
        const kind = value === undefined || value === null ? 'temporary' : String(value);
        if (KINDS.indexOf(kind) < 0) {
            throw new RangeError(`ownership: неизвестный вид владения "${kind}" (есть ${KINDS.join(', ')})`);
        }
        return kind;
    }

    function prune() {
        for (const [node] of marks) {
            if (!node || node.removed) {
                marks.delete(node);
                if (node && byNid.get(node.nid) === node) byNid.delete(node.nid);
            }
        }
        return marks.size;
    }

    /** kind строкой или null. */
    function kind(node) {
        const raw = rawNodeOf($, node);
        if (!raw || raw.removed) return null;
        return marks.get(raw) || null;
    }

    /** Разметить узел; возвращает узел (для цепочки) или null. */
    function mark(node, kindName) {
        const raw = rawNodeOf($, node);
        if (!raw) {
            if (typeof $ !== 'undefined' && $.log) $.log('ownership.mark: узел не найден — пропускаю');
            return null;
        }
        const wanted = kindName === undefined ? config.defaultKind : kindName;
        const name = kindOf(wanted);
        marks.set(raw, name);
        byNid.set(raw.nid, raw);
        return raw;
    }

    function unmark(node) {
        const raw = rawNodeOf($, node);
        if (!raw) return false;
        if (byNid.get(raw.nid) === raw) byNid.delete(raw.nid);
        return marks.delete(raw);
    }

    /**
     * `is(node)` → размечен ли; `is(node, kind)` → совпадает ли вид.
     */
    function is(node, kindName) {
        const current = kind(node);
        if (!current) return false;
        if (kindName === undefined || kindName === null) return true;
        // Запрос, а не мутация: неизвестный вид — просто false (mark() же
        // бросает RangeError, чтобы опечатка не создала «почти» разметку).
        const wanted = String(kindName);
        if (KINDS.indexOf(wanted) < 0) return false;
        return current === wanted;
    }

    /**
     * Стабильный handle. `{id, nid, uid, get(), alive(), kind()}`.
     * `id` = nid движка (стабилен в запуске и переживает save/prefab);
     * `uid` фиксируется на момент выдачи — по нему ловится переиспользование.
     */
    function handle(node) {
        const raw = rawNodeOf($, node);
        if (!raw) return null;
        const uid = raw.uid;
        const nid = raw.nid;
        const descriptor = {
            id: nid,
            nid,
            uid,
            /** Живой узел или null; мёртвый/переиспользованный — null. */
            get() {
                if (!raw || raw.removed || raw.uid !== uid) return null;
                return raw;
            },
            /** Жив ли узел той же генерации. */
            alive() {
                return !raw || raw.removed || raw.uid !== uid ? false : true;
            },
            /** Вид владения (или null, если узел не размечен). */
            kind() { return marks.get(raw) || null; },
        };
        return descriptor;
    }

    /**
     * Удалить только temporary-узлы. `opts`:
     *   `keep`   — узел/массив/handle/функция/nid: не удалять;
     *   `inside` — предикат `(node)=>bool` или `{x,y,w,h}`/`{x,y,radius}`;
     *   `destroy(node)` — своё удаление (по умолчанию `$(node).remove()`);
     *   `kind`   — какой вид убирать (по умолчанию 'temporary'; чтобы убрать
     *              и mission, передайте его явно — persistent не трогается).
     * Возвращает `{scanned, destroyed, kept, protected, stale, remaining}`.
     */
    function sweep(spec) {
        const s = spec || {};
        const removable = kindOf(s.kind === undefined ? 'temporary' : s.kind);
        if (removable === 'persistent') {
            throw new RangeError('ownership.sweep: persistent не удаляется sweep-ом');
        }
        const keep = keepTest($, s.keep);
        const test = s.inside === undefined ? () => true : (node) => insideTest(s.inside, node);
        const destroy = typeof s.destroy === 'function'
            ? s.destroy
            : (node) => { $(node).remove(); };
        const out = { scanned: 0, destroyed: 0, kept: 0, protected: 0, stale: 0,
                      remaining: marks.size };
        for (const [node, kindName] of Array.from(marks.entries())) {
            out.scanned++;
            if (!node || node.removed) {
                marks.delete(node);
                if (node && byNid.get(node.nid) === node) byNid.delete(node.nid);
                out.stale++;
                continue;
            }
            if (kindName !== removable) {
                out.protected++;
                continue;
            }
            if (keep(node) || !test(node)) {
                out.kept++;
                continue;
            }
            marks.delete(node);
            if (byNid.get(node.nid) === node) byNid.delete(node.nid);
            if (!node.removed) destroy(node);
            out.destroyed++;
        }
        out.remaining = marks.size;
        return out;
    }

    /** Handle по nid среди размеченных узлов (после save/load или смены сцены). */
    function resolve(nid) {
        const key = String(nid);
        const node = byNid.get(key);
        if (!node || node.removed || !marks.has(node)) {
            byNid.delete(key);
            return null;
        }
        return handle(node);
    }

    /** Сводка для отладки: `{total, temporary, persistent, mission, stale}`. */
    function stats() {
        const out = { total: 0, temporary: 0, persistent: 0, mission: 0, stale: 0 };
        for (const [node, kindName] of Array.from(marks.entries())) {
            if (!node || node.removed) {
                marks.delete(node);
                if (node && byNid.get(node.nid) === node) byNid.delete(node.nid);
                out.stale++;
                continue;
            }
            out.total++;
            out[kindName] = (out[kindName] || 0) + 1;
        }
        return out;
    }

    /**
     * Снять всю разметку. `opts.destroy: true` — заодно удалить temporary
     * (persistent/mission остаются, если не передать `all: true`).
     */
    function clear(spec) {
        const s = spec || {};
        let destroyed = 0;
        if (s.destroy === true) {
            destroyed = sweep({ kind: 'temporary', destroy: s.destroyNode }).destroyed;
        }
        if (s.all === true) {
            marks.clear();
            byNid.clear();
        }
        return { destroyed, remaining: marks.size };
    }

    const ownership = {
        mark,
        unmark,
        kind,
        is,
        handle,
        resolve,
        sweep,
        prune,
        stats,
        clear,
        kinds() { return KINDS.slice(); },
    };
    // Разметка по умолчанию для чужих подсистем: `ownership.mark(node)`.
    ownership.defaultKind = config.defaultKind === undefined
        ? 'temporary' : kindOf(config.defaultKind);
    return ownership;
}

export default createOwnership;
