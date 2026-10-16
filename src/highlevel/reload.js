// ===========================================================================
// §27. Хот-релоад ассетов: граф зависимостей, версии и отложенное освобождение.
//
// Что решает модуль. Ассет (текстура, атлас, данные карты, документ RmlUi) в
// preview-режиме меняется на диске — и его надо применить, не разрушив игру.
// Здесь для этого один конвейер:
//
//   read → validate → prepare → apply
//
// Первые три стадии ничего не публикуют: новая версия сначала читается и
// проверяется. Публикует только `apply`; если он не удался, работает
// last-known-good (старая версия), а результат возвращается как failed с кодом
// `R2D_RELOAD_*` и структурной записью в `$.debug.reportError` (§17).
//
//   $.reload.watch('art/hero.png', { kind: 'texture', texture: () => tex });
//   $.reload.watch('art/hero.json', { kind: 'atlas' });
//   $.reload.watch('maps/1.json', { kind: 'tilemap', target: '#map' });
//   $.reload.watch('ui/hud.rml', { kind: 'rml' });
//   const r = $.reload.poll();            // применить изменившиеся (кнопка F8)
//
// Что важно для игры:
//   * ассет имеет ИМЯ и ВЕРСИЮ (`$.reload.version(name)`) — не native handle;
//   * зависимости (`deps`) применяются раньше зависимых, цикл виден как ошибка;
//   * старые texture handles освобождаются на СЛЕДУЮЩЕМ кадре после замены
//     (`$.reload.retire`, `$.reload.flush`), а не посреди кадра;
//   * устаревшие frame ID не «залипают»: если кадр исчез из новой раскладки,
//     перезагрузка ОТКЛОНЯЕТСЯ (R2D_RELOAD_FRAME_MISSING), иначе кадры
//     перепривязываются по имени (R2D_RELOAD_* — коды ошибок);
//   * три операции различаются явно: reload данных (`reload`), reload поведения
//     (`$.reload.behavior` → перезапуск JS-рантайма) и restart сцены
//     (`$.reload.restartScene` через `$.scene.load(..., { scope: true })`).
//
// Ядро (`createReloadCore`) не знает ни движка, ни `$`: оно принимает окружение
// `env` и адаптеры видов. Поэтому весь конвейер (стадии, откат, версии, циклы,
// отложенное освобождение) проверяется юнит-тестом qjs без сборки движка.
// ===========================================================================

import { engine } from './native.js';
import { ctx, wrapOne } from './core.js';
import { parseAtlas, atlasImagePath } from './atlas.js';

// ---------------------------------------------------------------------------
// Чистые помощники
// ---------------------------------------------------------------------------

/** FNV-1a 32 бита: дешёвая подпись содержимого ассета (для версий и сравнения). */
export function fnv1a(input) {
    let hash = 0x811c9dc5;
    if (typeof input === 'string') {
        for (let i = 0; i < input.length; i++) {
            hash ^= input.charCodeAt(i) & 0xff;
            hash = (hash * 0x01000193) >>> 0;
        }
        return hash >>> 0;
    }
    if (input && typeof input.length === 'number') {
        for (let i = 0; i < input.length; i++) {
            hash ^= input[i] & 0xff;
            hash = (hash * 0x01000193) >>> 0;
        }
        return hash >>> 0;
    }
    return 0;
}

/** Короткая шестнадцатеричная подпись для отчёта. */
export function hashHex(value) {
    return (value >>> 0).toString(16).padStart(8, '0');
}

export function ok(value) { return { ok: true, value: value === undefined ? null : value, error: null, code: null }; }
export function fail(code, error) { return { ok: false, value: null, error: error || code, code: code || 'R2D_RELOAD_FAILED' }; }

/**
 * Топологический порядок: зависимости раньше зависимых. Возвращает
 * `{ order, cycles }`; цикл — это ошибка (§27: граф, а не список).
 */
export function topoOrder(assets, names) {
    const wanted = names && names.length ? names.slice() : [...assets.keys()];
    const order = [];
    const state = new Map();       // 0 — в обработке, 1 — готов
    const cyclic = new Set();      // узлы, попавшие в цикл
    const cycles = [];
    const stack = [];

    function visit(name) {
        if (state.get(name) === 1) return true;
        if (state.get(name) === 0) {
            const at = stack.indexOf(name);
            const ring = stack.slice(at >= 0 ? at : 0).concat(name);
            cycles.push(ring);
            for (const n of ring) cyclic.add(n);
            return false;
        }
        const asset = assets.get(name);
        if (!asset) return true;                  // незарегистрированный dep пропускаем
        state.set(name, 0);
        stack.push(name);
        let okAll = true;
        for (const dep of asset.deps) {
            if (!visit(dep)) okAll = false;
        }
        stack.pop();
        state.set(name, 1);
        if (!cyclic.has(name)) order.push(name);
        return okAll;
    }

    for (const name of wanted) visit(name);
    return { order, cycles, cyclic: [...cyclic] };
}

// ---------------------------------------------------------------------------
// Ядро: реестр ассетов, конвейер, отложенное освобождение
// ---------------------------------------------------------------------------

/**
 * Создать ядро релелоада. `env` (всё необязательное, кроме adapters):
 *   log(msg)                    — человекочитаемая строка;
 *   report({code,message,name}) — структурная ошибка (§17);
 *   frame() → number            — номер кадра для отложенного освобождения;
 *   now() → number              — время для отчёта;
 *   readText(path) / readBytes(path) / exists(path);
 *   nodes() → array             — живые узлы (перепривязка спрайтов);
 *   adapters: Map<kind, adapter>;
 *   valueOf(asset)              — текущее значение ассета (id текстуры и т.п.).
 *
 * Адаптер вида: `{ deps(asset, env), read(asset, env), validate(asset, src, env),
 * prepare(asset, src, env), apply(asset, prep, env) }`. Каждая стадия
 * возвращает `ok()/fail()`.
 */
export function createReloadCore(env) {
    const e = env || {};
    const log = typeof e.log === 'function' ? e.log : () => 0;
    const report = typeof e.report === 'function' ? e.report : () => 0;
    const frameOf = typeof e.frame === 'function' ? e.frame : () => 0;
    const nowOf = typeof e.now === 'function' ? e.now : () => 0;
    const adapters = e.adapters instanceof Map ? e.adapters : new Map();

    const assets = new Map();       // name → asset
    const retired = [];             // [{ kind, handle, name, frame, reason }]
    const listeners = new Map();
    const counters = {
        reloads: 0, applied: 0, failed: 0, unchanged: 0, noop: 0,
        retired: 0, deps_applied: 0, last: null,
    };

    // Псевдонимы событий: `applied`/`failed` — канонические, `reload`/`fail`
    // поддержаны как понятные имена (и описаны в docs/highlevel/reload.md).
    const EVENT_ALIAS = { applied: 'reload', failed: 'fail' };

    function emit(event, data) {
        const alias = EVENT_ALIAS[event];
        if (alias) emitOne(alias, data);
        emitOne(event, data);
    }

    function emitOne(event, data) {
        const list = listeners.get(event);
        if (!list || list.length === 0) return;
        for (const fn of list.slice()) {
            try { fn(data); } catch (err) { log(`$.reload: ошибка в обработчике "${event}": ${err}`); }
        }
    }

    function failResult(asset, stage, res) {
        const code = res.code || 'R2D_RELOAD_FAILED';
        const message = res.error || code;
        if (asset) {
            asset.status = 'failed';
            asset.last = {
                ok: false, stage, code, error: message,
                frame: frameOf(), at: nowOf(), version: asset.version,
            };
        }
        counters.failed++;
        counters.last = asset && asset.last;
        report({ code, message, name: asset ? asset.name : null, stage,
                 path: asset ? asset.path : null });
        log(`$.reload: "${asset ? asset.name : '?'}" не применён (${stage}, ${code}): ${message}`);
        emit('failed', { name: asset ? asset.name : null, stage, code, error: message });
        return { ok: false, name: asset ? asset.name : null, stage, code, error: message,
                 version: asset ? asset.version : 0, changed: false, operation: 'asset' };
    }

    /** Зарегистрировать (или обновить описание) ассета. */
    function watch(name, spec) {
        const key = String(name);
        const s = spec || {};
        const adapter = adapters.get(String(s.kind || ''));
        if (!adapter) {
            log(`$.reload.watch("${key}"): неизвестный вид "${s.kind}" — ассет не принят`);
            return null;
        }
        let asset = assets.get(key);
        const fresh = !asset;
        if (fresh) {
            asset = {
                name: key, kind: String(s.kind), path: s.path || null,
                spec: s, deps: [], version: 0, status: 'registered',
                value: null, last: null, last_hash: 0, history: [],
            };
            assets.set(key, asset);
        } else {
            asset.spec = s;
            asset.kind = String(s.kind);
            if (s.path !== undefined) asset.path = s.path;
        }
        // Зависимости: явные (`deps`) плюс те, что видит адаптер (atlas → pages).
        const deps = [];
        if (Array.isArray(s.deps)) for (const d of s.deps) deps.push(String(d));
        if (typeof adapter.deps === 'function') {
            const extra = adapter.deps(asset, e);
            if (Array.isArray(extra)) for (const d of extra) if (d !== key && deps.indexOf(String(d)) < 0) deps.push(String(d));
        }
        asset.deps = deps.filter((d) => d !== key);
        if (fresh && typeof adapter.init === 'function') {
            try { adapter.init(asset, e); } catch (err) { log(`$.reload: init "${key}": ${err}`); }
        }
        return asset;
    }

    function unwatch(name) {
        return assets.delete(String(name));
    }

    function info(name) {
        const asset = assets.get(String(name));
        if (!asset) return null;
        return {
            name: asset.name, kind: asset.kind, path: asset.path,
            version: asset.version, status: asset.status, state: asset.status,
            deps: asset.deps.slice(), last: asset.last ? Object.assign({}, asset.last) : null,
            hash: asset.last_hash ? hashHex(asset.last_hash) : null,
        };
    }

    function list() { return [...assets.keys()].map(info); }

    function versions(name) {
        const asset = assets.get(String(name));
        return asset ? asset.history.slice() : [];
    }

    /** Значение текущей версии (id текстуры, объект атласа, данные карты…). */
    function value(name) {
        const asset = assets.get(String(name));
        if (!asset) return null;
        if (typeof e.resolveValue === 'function') {
            const v = e.resolveValue(asset);
            if (v !== undefined) return v;
        }
        return asset.value;
    }

    function graph() {
        const nodes = [];
        const edges = [];
        for (const asset of assets.values()) {
            nodes.push({ name: asset.name, kind: asset.kind, version: asset.version, status: asset.status });
            for (const dep of asset.deps) edges.push({ from: dep, to: asset.name });
        }
        const { cycles } = topoOrder(assets, []);
        return { nodes, edges, cycles };
    }

    /**
     * Перезагрузить один ассет: read → validate → prepare → apply.
     * `opts.deps` (по умолчанию true) — сначала применить изменившиеся
     * зависимости; `opts.force` — не пропускать совпадение по подписи.
     */
    function reload(name, opts) {
        const key = String(name);
        const o = opts || {};
        const asset = assets.get(key);
        counters.reloads++;
        if (!asset) {
            counters.failed++;
            const res = failResult(null, 'lookup',
                fail('R2D_RELOAD_MISSING_DEP', `ассет "${key}" не зарегистрирован (нужен $.reload.watch)`));
            return res;
        }
        const adapter = adapters.get(asset.kind);
        if (!adapter) return failResult(asset, 'lookup', fail('R2D_RELOAD_ADAPTER', `нет адаптера вида "${asset.kind}"`));

        // 1. Зависимости — раньше зависимых (§27: atlas → pages → clips;
        //    tilemap → collision; rml → styles/fonts/images).
        const dep_results = [];
        if (o.deps !== false) {
            const { order, cycles } = topoOrder(assets, [key]);
            if (cycles.length) {
                return failResult(asset, 'deps',
                    fail('R2D_RELOAD_CYCLE', 'цикл зависимостей: ' + cycles.map((c) => c.join(' → ')).join('; ')));
            }
            for (const dep of order) {
                if (dep === key) continue;
                const r = reload(dep, { deps: false, force: o.force });
                dep_results.push(r);
                if (r.ok && r.changed) counters.deps_applied++;
            }
        }

        // 2. Чтение источника — только чтение, ничего не публикуется.
        let src;
        try {
            src = adapter.read(asset, e);
        } catch (err) {
            src = fail('R2D_RELOAD_READ', `исключение при чтении: ${err && err.message ? err.message : err}`);
        }
        if (!src || !src.ok) return failResult(asset, 'read', src || fail('R2D_RELOAD_READ', 'пустой результат чтения'));

        // 3. Проверка ДО замены (битый JSON, отсутствующая страница, плохой rml).
        let checked;
        try {
            checked = adapter.validate ? adapter.validate(asset, src, e) : ok();
        } catch (err) {
            checked = fail('R2D_RELOAD_VALIDATE', `исключение при проверке: ${err && err.message ? err.message : err}`);
        }
        if (!checked || !checked.ok) return failResult(asset, 'validate', checked || fail('R2D_RELOAD_VALIDATE', 'проверка не прошла'));

        // 4. Подготовка значения без публикации.
        let prep;
        try {
            prep = adapter.prepare ? adapter.prepare(asset, src, e) : ok(null);
        } catch (err) {
            prep = fail('R2D_RELOAD_PREPARE', `исключение при подготовке: ${err && err.message ? err.message : err}`);
        }
        if (!prep || !prep.ok) return failResult(asset, 'prepare', prep || fail('R2D_RELOAD_PREPARE', 'подготовка не удалась'));

        // Совпадение содержимого: данные не изменились — не плодим версии.
        const src_payload = src.value || {};
        const hash = (src_payload.hash === undefined ? 0 : src_payload.hash) >>> 0;
        if (!o.force && hash !== 0 && hash === asset.last_hash && asset.status === 'ok') {
            counters.unchanged++;
            counters.noop++;
            const same = {
                ok: true, name: key, stage: 'unchanged', code: null, error: null,
                version: asset.version, changed: false, deps: dep_results, operation: 'asset',
            };
            asset.last = { ok: true, stage: 'unchanged', code: null, error: null,
                           frame: frameOf(), at: nowOf(), version: asset.version, changed: false };
            counters.last = asset.last;
            emit('applied', same);
            return same;
        }

        // 5. Публикация.
        let applied;
        try {
            applied = adapter.apply ? adapter.apply(asset, prep, e) : ok({ changed: true });
        } catch (err) {
            applied = fail('R2D_RELOAD_APPLY', `исключение при применении: ${err && err.message ? err.message : err}`);
        }
        if (!applied || !applied.ok) return failResult(asset, 'apply', applied || fail('R2D_RELOAD_APPLY', 'применение не удалось'));

        const payload = applied.value || {};
        const value_ = payload.value === undefined ? null : payload.value;
        const changed = payload.changed !== false;
        const retire_list = Array.isArray(payload.retire) ? payload.retire : null;
        asset.status = 'ok';
        if (value_ !== null) asset.value = value_;
        if (changed) {
            asset.last_hash = hash;
            asset.version++;
            asset.history.push({
                version: asset.version, hash: hashHex(hash), frame: frameOf(), at: nowOf(),
                path: asset.path, changed: true,
            });
            if (asset.history.length > 8) asset.history.shift();
            counters.applied++;
        }
        asset.last = {
            ok: true, stage: changed ? 'applied' : 'unchanged', code: null, error: null,
            frame: frameOf(), at: nowOf(), version: asset.version, changed,
        };
        counters.last = asset.last;

        // 6. Отложенное освобождение: старые handle'ы живут до конца кадра.
        if (retire_list) {
            for (const item of retire_list) retire(item);
        }

        const warnings = Array.isArray(payload.warnings) ? payload.warnings : [];
        for (const w of warnings) {
            report({ code: w.code || 'R2D_RELOAD_WARNING', message: w.message || '',
                     name: key, stage: 'apply', path: asset.path });
        }
        const result = {
            ok: true, name: key, stage: 'applied', code: null, error: null,
            version: asset.version, changed, hash: hashHex(hash),
            deps: dep_results, value: value_, operation: 'asset', warnings,
        };
        emit('applied', result);
        return result;
    }

    /** Перезагрузить все зарегистрированные ассеты в порядке зависимостей. */
    function reloadAll(opts) {
        const o = opts || {};
        const { order, cycles } = topoOrder(assets, o.names);
        const results = [];
        if (cycles.length) {
            const first = assets.get(order[0]) || null;
            results.push(failResult(first, 'deps',
                fail('R2D_RELOAD_CYCLE', 'цикл зависимостей: ' + cycles.map((c) => c.join(' → ')).join('; '))));
        }
        for (const name of order) results.push(reload(name, { deps: false, force: o.force }));
        const applied = results.filter((r) => r.ok && r.changed).length;
        const failed = results.filter((r) => !r.ok).length;
        return { ok: failed === 0, total: results.length, applied, failed, results };
    }

    /**
     * Применить только изменившееся на диске (кнопка F8, watcher игры).
     * Сравнение — по подписи содержимого, а не по mtime: mtime врёт при
     * checkout, копировании и на сетевых ФС.
     */
    function poll(opts) {
        const all = reloadAll(Object.assign({}, opts));
        return {
            ok: all.ok, total: all.total, applied: all.applied, failed: all.failed,
            results: all.results.filter((r) => r.changed || !r.ok),
        };
    }

    /**
     * Поставить handle в очередь на освобождение. Освободит `flush()` — на
     * СЛЕДУЮЩЕМ кадре: кадр, который ещё рисуется со старым handle, успевает
     * закончиться (§27).
     */
    function retire(item) {
        if (!item || item.handle === undefined || item.handle === null) return false;
        retired.push({
            kind: String(item.kind || 'handle'),
            handle: item.handle,
            name: item.name === undefined ? null : String(item.name),
            reason: item.reason || 'reload',
            frame: frameOf(),
        });
        return true;
    }

    /** Немедленно освободить вышедшие из употребления handle'ы (зовёт кадр). */
    function flush(frame) {
        const now = frame === undefined ? frameOf() : frame;
        const released = [];
        for (let i = retired.length - 1; i >= 0; i--) {
            const item = retired[i];
            if (item.frame >= now) continue;      // кадр замены ещё не закончился
            retired.splice(i, 1);
            let okRelease = true;
            if (typeof e.release === 'function') {
                try { okRelease = e.release(item) !== false; }
                catch (err) { okRelease = false; log(`$.reload: освобождение ${item.kind} ${item.handle}: ${err}`); }
            }
            counters.retired++;
            released.push(item);
        }
        return released;
    }

    function on(event, fn) {
        if (typeof fn !== 'function') return false;
        if (!listeners.has(event)) listeners.set(event, []);
        listeners.get(event).push(fn);
        return true;
    }

    function off(event, fn) {
        const list = listeners.get(event);
        if (!list) return false;
        if (!fn) { listeners.delete(event); return true; }
        const i = list.indexOf(fn);
        if (i >= 0) list.splice(i, 1);
        return i >= 0;
    }

    /** Состояние для DevTools и тестов: только факты. */
    function stats() {
        let ok_count = 0;
        let failed_count = 0;
        for (const asset of assets.values()) {
            if (asset.status === 'ok') ok_count++;
            else if (asset.status === 'failed') failed_count++;
        }
        return {
            watched: assets.size, ok: ok_count, failed: failed_count,
            pending_release: retired.length,
            reloads: counters.reloads, applied: counters.applied,
            failed_total: counters.failed, failures: counters.failed,
            unchanged: counters.unchanged, deps_applied: counters.deps_applied,
            retired: counters.retired, last: counters.last,
        };
    }

    return {
        watch, unwatch, info, list, versions, value, graph, topoOrder: (names) => topoOrder(assets, names),
        reload, reloadAll, poll, retire, flush, on, off, stats,
        assets, adapters,
        listPending: () => retired.slice(),
        counters,
    };
}

// ---------------------------------------------------------------------------
// Встроенные адаптеры видов (§27: texture, atlas, tilemap, rml, json)
// ---------------------------------------------------------------------------

/** Текущий id текстуры ассета: `texture: () => id` или `resource: 'имя'`. */
function textureIdOf(asset, env) {
    const s = asset.spec || {};
    if (typeof s.texture === 'function') {
        const v = s.texture();
        return v >= 0 ? v : -1;
    }
    if (typeof s.texture === 'number') return s.texture;
    if (s.resource && env.resource && typeof env.resource.get === 'function') {
        const v = env.resource.get(s.resource);
        return v >= 0 ? v : -1;
    }
    return -1;
}

/**
 * Текстура: перезагрузка НА МЕСТЕ (тот же id). Игра и узлы продолжают
 * ссылаться на прежний handle — старых handle'ов не появляется вовсе.
 * Смена размера отклоняется: спрайты хранят uv-прямоугольник, нормированный
 * по старому размеру, и молча перепривязать их нельзя.
 */
export const textureAdapter = {
    read(asset, env) {
        if (!asset.path) return fail('R2D_RELOAD_READ', 'у текстуры нет path');
        const bytes = env.readBytes ? env.readBytes(asset.path) : null;
        if (!bytes || bytes.length === 0) return fail('R2D_RELOAD_READ', `файл "${asset.path}" не прочитан`);
        return ok({ bytes, hash: fnv1a(bytes) });
    },
    validate(asset, src) {
        if (!src.value || src.value.bytes.length < 8) return fail('R2D_RELOAD_VALIDATE', 'файл пуст или обрезан');
        return ok();
    },
    prepare(asset, src) { return ok({ hash: src.value.hash, size: src.value.bytes.length }); },
    apply(asset, prep, env) {
        const id = textureIdOf(asset, env);
        if (!(id >= 0)) return fail('R2D_RELOAD_APPLY', 'нет живого id текстуры (texture/resource не заданы)');
        if (!env.engine || typeof env.engine.reloadTexture !== 'function') {
            return fail('R2D_RELOAD_UNSUPPORTED', 'сборка без engine.reloadTexture — замена текстуры на месте недоступна');
        }
        const res = env.engine.reloadTexture(id, asset.path);
        if (res && res.ok === true && asset.spec && asset.spec.resource
            && env.resource && typeof env.resource.publish === 'function') {
            // Id не менялся, но содержимое — новое: версия ресурса растёт, и
            // игра, читающая ресурс по имени/версии, видит актуальное значение.
            env.resource.publish(asset.spec.resource, id);
        }
        if (!res || res.ok !== true) {
            const code = res && res.code === 'size' ? 'R2D_RELOAD_TEXTURE_SIZE' : 'R2D_RELOAD_APPLY';
            const reason = res && res.reason ? res.reason
                : (code === 'R2D_RELOAD_TEXTURE_SIZE'
                    ? `размер картинки изменился (${res && res.ow}×${res && res.oh} → ${res && res.nw}×${res && res.nh}); ` +
                      'обновите атлас или сцену — спрайты нормированы по старому размеру'
                    : 'не удалось обновить текстуру');
            return fail(code, reason);
        }
        return ok({ changed: true, value: id, retire: [] });
    },
};

/** Имя атласа в $.atlas: `spec.atlas`, иначе имя ассета. */
function atlasName(asset) {
    const s = asset.spec || {};
    return s.atlas === undefined ? asset.name : String(s.atlas);
}

/** Раскладка атласа: имя кадра → [x, y, w, h]. */
function layoutOf(parsed) {
    const out = {};
    for (const frame of parsed.frames) out[frame.name] = [frame.x, frame.y, frame.w, frame.h];
    return out;
}

function sameLayout(a, b) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (const k of ka) {
        const x = a[k];
        const y = b[k];
        if (!y || x[0] !== y[0] || x[1] !== y[1] || x[2] !== y[2] || x[3] !== y[3]) return false;
    }
    return true;
}

/**
 * Атлас: данные + картинка. Конвейер:
 *   read     — JSON с диска (битый JSON → R2D_RELOAD_PARSE);
 *   validate — есть кадры, есть картинка, нет повёрнутых кадров, все кадры,
 *              используемые в мире, есть в новой раскладке (иначе отклоняем:
 *              устаревший frame ID не должен привязаться к чужим данным);
 *   apply    — картинка обновляется НА МЕСТЕ (если размер тот же), кадры
 *              пересобираются только при смене раскладки, спрайты узлов
 *              перепривязываются по ИМЕНИ кадра.
 */
export const atlasAdapter = {
    read(asset, env) {
        if (!asset.path) return fail('R2D_RELOAD_READ', 'у атласа нет path');
        const text = env.readText ? env.readText(asset.path) : null;
        if (text === null || text === undefined) return fail('R2D_RELOAD_READ', `файл "${asset.path}" не прочитан`);
        let data;
        try { data = JSON.parse(text); }
        catch (err) { return fail('R2D_RELOAD_PARSE', `JSON "${asset.path}" не разобрался: ${err && err.message ? err.message : err}`); }
        return ok({ data, text, hash: fnv1a(text) });
    },
    validate(asset, src, env) {
        const parsed = parseAtlas(src.value.data);
        if (!parsed.frames.length) return fail('R2D_RELOAD_VALIDATE', 'в данных атласа нет кадров (поле frames)');
        for (const frame of parsed.frames) {
            if (frame.rotated) {
                return fail('R2D_RELOAD_VALIDATE', `кадр "${frame.name}" повёрнут в атласе — такие не поддержаны`);
            }
        }
        const image = atlasImagePath(asset.path, src.value.data);
        if (!env.exists || !env.exists(image)) return fail('R2D_RELOAD_VALIDATE', `картинка атласа "${image}" не найдена`);
        // Устаревшие frame ID: если кадр используется в мире и исчез из новой
        // раскладки — перезагрузка отклоняется (last-known-good), а не молчит.
        const sheet = env.atlas && env.atlas.get ? env.atlas.get(atlasName(asset)) : null;
        if (sheet) {
            const mapping = usedSpriteNames(sheet, env);
            for (const name of mapping.names) {
                if (!(name in layoutOf(parsed))) {
                    return fail('R2D_RELOAD_FRAME_MISSING',
                        `кадр "${name}" используется в мире, но исчез из новой раскладки атласа`);
                }
            }
        }
        return ok({ parsed, layout: layoutOf(parsed), image });
    },
    prepare(asset, src, env) {
        const checked = atlasAdapter.validate(asset, src, env);
        if (!checked.ok) return checked;
        return ok({ data: src.value.data, parsed: checked.value.parsed, layout: checked.value.layout,
                    image: checked.value.image, hash: src.value.hash });
    },
    apply(asset, prep, env) {
        const p = prep.value;
        const name = atlasName(asset);
        const sheet = env.atlas && env.atlas.get ? env.atlas.get(name) : null;
        if (!sheet) return fail('R2D_RELOAD_APPLY', `атлас "${name}" не загружен — сначала $.atlas.load`);
        if (!env.engine) return fail('R2D_RELOAD_UNSUPPORTED', 'нет движка');

        const spec = asset.spec || {};
        // `src` передаём ТОЛЬКО если его задала игра: путь страницы атлас
        // выводит сам из meta.image/pages (повторная подстановка каталога
        // JSON дала бы "assets/assets/...")..
        const reload_spec = Object.assign({}, spec.load || {}, { data: p.data });
        if (spec.src !== undefined) reload_spec.src = spec.src;
        if (spec.image !== undefined) reload_spec.image = spec.image;
        const old_names = sheet.frames();
        const old_layout = {};
        for (const name of old_names) {
            const info = sheet.info(name);
            if (info) old_layout[name] = [info.x, info.y, info.w, info.h];
        }
        const layout_same = sameLayout(old_layout, p.layout);

        // 1. Пиксели: пробуем обновить ту же текстуру (handle не меняется).
        let texture = sheet.texture;
        let new_texture = false;
        if (env.engine.reloadTexture) {
            const res = env.engine.reloadTexture(sheet.texture, p.image);
            if (!res || res.ok !== true) {
                if (res && res.code === 'size') new_texture = true;
                else {
                    return fail('R2D_RELOAD_APPLY',
                        `картинка "${p.image}" не обновилась: ${res && res.reason ? res.reason : 'ошибка движка'}`);
                }
            }
        } else {
            new_texture = true;
        }

        const retire = [];
        // 2. Раскладка не менялась и пиксели легли на место — работа сделана:
        //    ни новых спрайтов, ни новых handle'ов (серия reload ничего не растёт).
        if (layout_same && !new_texture) {
            return ok({ changed: true, value: sheet, retire });
        }

        // 3. Нужны новые спрайты: сначала запоминаем старые id по именам кадров,
        //    затем пересобираем атлас (та же или новая текстура).
        const old_id_by_name = {};
        for (const name of old_names) old_id_by_name[name] = sheet.frame(name);
        const registry = env.atlas;
        let next = sheet;
        // Прежняя версия данных: если пересборка после unload не удалась,
        // возвращаем атлас к last-known-good, а не оставляем игру без него.
        const previous_data = asset.last_data || null;
        const reloadAtlas = (data) => {
            registry.unload(name);
            const opts = Object.assign({}, reload_spec, { data });
            const built = registry.load(name, asset.path, opts);
            if (!built && previous_data && previous_data !== data) {
                // Откат: восстанавливаем прежние данные (и прежний вид).
                registry.load(name, asset.path, Object.assign({}, opts, { data: previous_data }));
            }
            return built;
        };
        let old_texture = sheet.texture;
        if (new_texture) {
            // Размер картинки изменился: та же текстура не годится, берём новую.
            next = reloadAtlas(p.data);
            if (!next) return fail('R2D_RELOAD_APPLY', `атлас "${name}" не пересобрался после смены размера`);
            texture = next.texture;
            // Старый handle освобождаем ПОСЛЕ кадра: кадр замены мог ещё
            // рисоваться с ним (§27).
            retire.push({ kind: 'texture', handle: old_texture, name: name, reason: 'atlas size change' });
        } else {
            // Текстура та же, но раскладка другая: пересобираем спрайты,
            // сохраняя объект атласа у игры (делегируем методы новому).
            next = reloadAtlas(p.data);
            if (!next) return fail('R2D_RELOAD_APPLY', `атлас "${name}" не пересобрался после смены раскладки`);
        }
        asset.last_data = p.data;

        // 4. Перепривязка: старый frame ID → новый по ИМЕНИ кадра.
        const old_to_new = new Map();
        let remapped = 0;
        const frame_map = {};
        for (const name of old_names) {
            const old_id = old_id_by_name[name];
            const next_id = next.frame(name);
            if (old_id >= 0 && next_id >= 0 && old_id !== next_id) {
                old_to_new.set(old_id, next_id);
                frame_map[name] = { old: old_id, new: next_id };
            }
        }
        if (old_to_new.size) remapped = env.remapSprites ? env.remapSprites(old_to_new) : 0;

        // 5. Игра держит СТАРЫЙ объект атласа: делегируем его методы новой
        //    версии, чтобы ссылка по имени всегда давала актуальные кадры.
        if (sheet !== next) delegateSheet(sheet, next);

        asset.value = next;
        return ok({ changed: true, value: next, retire, remapped, frame_map,
                    layout_changed: !layout_same, new_texture, texture });
    },
};

/**
 * Имена кадров, используемые в мире: по спрайтам узлов и их наборам кадров.
 * Нужно, чтобы отклонить новую раскладку, в которой пропал используемый кадр
 * (§27: устаревшие frame ID не должны молча привязаться к новым данным).
 */
export function usedSpriteNames(sheet, env) {
    env = env || { nodes: () => (ctx.nodes || []) };
    const id_to_name = new Map();
    for (const name of sheet.frames()) {
        const id = sheet.frame(name);
        if (id >= 0) id_to_name.set(id, name);
    }
    const names = new Set();
    const nodes = env.nodes ? env.nodes() : [];
    for (const node of nodes) {
        if (!node || node.removed) continue;
        if (typeof node.sprite === 'number' && id_to_name.has(node.sprite)) names.add(id_to_name.get(node.sprite));
        if (Array.isArray(node.frames)) {
            for (const id of node.frames) if (id_to_name.has(id)) names.add(id_to_name.get(id));
        }
    }
    return { names, id_to_name };
}

/** Старый объект атласа начинает читать новую версию (та же ссылка у игры). */
function delegateSheet(old_sheet, next) {
    const methods = ['frame', 'frames', 'info', 'tag', 'tags', 'tagSprites', 'tagInterval',
                     'slice', 'sliceNames', 'sliceCount', 'size'];
    for (const name of methods) {
        if (typeof next[name] !== 'function') continue;
        old_sheet[name] = function (...args) { return next[name](...args); };
    }
    old_sheet.texture = next.texture;
    old_sheet.version = (old_sheet.version || 0) + 1;
    old_sheet.next = next;
    return old_sheet;
}

/**
 * Карта: данные клеток и коллизия. Данные применяются через публичное
 * `.setTile()` (карта сама пересобирает визуал, коллизию и occluders одним
 * проходом в своём tick — между кадрами половинчатого состояния нет).
 */
export const tilemapAdapter = {
    read(asset, env) {
        if (!asset.path) return fail('R2D_RELOAD_READ', 'у карты нет path');
        const text = env.readText ? env.readText(asset.path) : null;
        if (text === null || text === undefined) return fail('R2D_RELOAD_READ', `файл "${asset.path}" не прочитан`);
        let data;
        try { data = JSON.parse(text); }
        catch (err) { return fail('R2D_RELOAD_PARSE', `JSON "${asset.path}" не разобрался: ${err && err.message ? err.message : err}`); }
        return ok({ data, text, hash: fnv1a(text) });
    },
    validate(asset, src) {
        const d = src.value.data;
        if (!d || typeof d !== 'object') return fail('R2D_RELOAD_VALIDATE', 'данные карты — не объект');
        const layers = Array.isArray(d.layers) ? d.layers : (Array.isArray(d.data) ? [d] : null);
        if (!layers) return fail('R2D_RELOAD_VALIDATE', 'в данных карты нет ни layers[], ни data[]');
        for (let i = 0; i < layers.length; i++) {
            const layer = layers[i] || {};
            const cells = layer.data;
            if (!Array.isArray(cells)) return fail('R2D_RELOAD_VALIDATE', `слой ${i}: нет массива data`);
            const w = Number(layer.cols !== undefined ? layer.cols : d.cols);
            const h = Number(layer.rows !== undefined ? layer.rows : d.rows);
            if (w > 0 && h > 0 && cells.length !== w * h) {
                return fail('R2D_RELOAD_VALIDATE',
                    `слой ${i}: клеток ${cells.length}, ожидалось ${w}×${h} = ${w * h}`);
            }
            for (let k = 0; k < cells.length; k++) {
                const v = cells[k];
                if (typeof v !== 'number' || !isFinite(v) || v < 0) {
                    return fail('R2D_RELOAD_VALIDATE', `слой ${i}, клетка ${k}: недопустимый id ${v}`);
                }
            }
        }
        return ok({ layers });
    },
    prepare(asset, src, env) {
        const checked = tilemapAdapter.validate(asset, src);
        if (!checked.ok) return checked;
        const node = targetNode(asset, env);
        if (!node) return fail('R2D_RELOAD_APPLY', `узел карты "${targetText(asset)}" не найден`);
        return ok({ layers: checked.value.layers, node, hash: src.value.hash, data: src.value.data });
    },
    apply(asset, prep, env) {
        const p = prep.value;
        const node = p.node || targetNode(asset, env);
        if (!node) return fail('R2D_RELOAD_APPLY', 'узел карты не найден');
        // `.setTile()/.tilesData()/.rebuild()` — методы ОБЁРТКИ: у сырого узла
        // их нет. Обёртка нужна и потому, что карта сама помечает себя грязной.
        const api = env.wrap ? env.wrap(node) : node;
        if (!api || typeof api.setTile !== 'function') {
            return fail('R2D_RELOAD_APPLY', 'у узла карты нет .setTile (не tilemap?)');
        }
        let changed = 0;
        let total = 0;
        const layers = p.layers || [];
        const attrs = node.attrs || {};
        for (let li = 0; li < layers.length; li++) {
            const cells = layers[li].data || [];
            const cols = Number(layers[li].cols !== undefined ? layers[li].cols : attrs.cols) || 1;
            const current = typeof api.tilesData === 'function' ? api.tilesData(li) : [];
            for (let k = 0; k < cells.length; k++) {
                total++;
                if (current[k] === cells[k]) continue;
                api.setTile(k % cols, Math.floor(k / cols), cells[k], li);
                changed++;
            }
        }
        // Карта пересобирает визуал/коллизию/occlusion одним проходом в tick,
        // но при явном reload просим пересборку сразу — тест и preview видят
        // согласованное состояние на следующем кадре, а не «когда-нибудь».
        if (typeof api.rebuild === 'function') api.rebuild();
        return ok({ changed: changed > 0, value: node, retire: [],
                    cells_changed: changed, cells_total: total });
    },
};

function targetNode(asset, env) {
    const s = asset.spec || {};
    if (s.node && typeof s.node === 'object') return s.node;
    const sel = s.target === undefined ? '#map' : s.target;
    if (typeof env.query === 'function') {
        const found = env.query(sel);
        return found && found.length ? found[0] : null;
    }
    return null;
}

function targetText(asset) {
    const s = asset.spec || {};
    return s.target === undefined ? '#map' : String(s.target);
}

/**
 * Структурная проверка разметки RmlUi: сбалансированность тегов.
 *
 * RmlUi разбирает XML терпимо: незакрытый тег он принимает и создаёт
 * документ без части содержимого. Для хот-релоада это худший исход — «плохой
 * rml» молча меняет интерфейс. Поэтому разметка проверяется ДО подмены, а
 * RmlUi-проверка на временном документе идёт следом.
 *
 * Возвращает null (всё хорошо) или строку-причину.
 */
export function checkRmlMarkup(text) {
    if (typeof text !== 'string' || text.trim() === '') return 'разметка пуста';
    if (text.indexOf('<rml') < 0) return 'в разметке нет корня <rml>';
    const src = text
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '')
        .replace(/<\?[\s\S]*?\?>/g, '');
    const stack = [];
    const tag_re = /<\s*(\/?)\s*([a-zA-Z][\w:.-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)\s*>/g;
    let match = tag_re.exec(src);
    let saw_root = false;
    while (match) {
        const closing = match[1] === '/';
        const name = match[2].toLowerCase();
        const self_closing = match[4] === '/';
        if (!closing && name === 'rml') saw_root = true;
        if (closing) {
            if (stack.length === 0) return `закрывающий тег </${name}> без открывающего`;
            const open = stack.pop();
            if (open !== name) return `</${name}> закрывает <${open}>`;
        } else if (!self_closing) {
            if (name === 'style' || name === 'script') {
                // Содержимое <style>/<script> — не разметка: пропускаем до
                // закрывающего тега, иначе '<' внутри CSS ломает проверку.
                const close = src.toLowerCase().indexOf(`</${name}>`, tag_re.lastIndex);
                if (close < 0) return `нет закрывающего </${name}>`;
                tag_re.lastIndex = close + name.length + 3;
            } else {
                stack.push(name);
            }
        }
        match = tag_re.exec(src);
    }
    if (!saw_root) return 'нет корня <rml>';
    if (stack.length) return `не закрыт <${stack[stack.length - 1]}>`;
    if (src.toLowerCase().indexOf('</rml>') < 0) return 'нет закрывающего </rml>';
    return null;
}

/** Связанные таблицы стилей документа: `<link ... href="...">`. */
export function linkedStyles(text) {
    const out = [];
    const re = /<link\b[^>]*href\s*=\s*("([^"]*)"|'([^']*)')[^>]*>/gi;
    let m = re.exec(text);
    while (m) {
        const href = m[2] !== undefined ? m[2] : m[3];
        if (href && /\.rcss($|\?)/i.test(href)) out.push(href);
        m = re.exec(text);
    }
    return out;
}

/**
 * Документ RmlUi: проверка разметки на ВРЕМЕННОМ документе (живой не трогаем),
 * применение — unload старого + загрузка нового. Ссылка на документ у игры
 * меняется: результат применения отдаёт `value` — новый handle.
 */
export const rmlAdapter = {
    /** Отпечатки связанных .rcss — сразу при регистрации, чтобы первая же
     *  правка стиля после старта была видна и объяснена. */
    init(asset, env) {
        const text = env.readText ? env.readText(asset.path) : null;
        if (text === null || text === undefined) return;
        asset.styles = asset.styles || {};
        const dir = String(asset.path || '').replace(/[^/]*$/, '');
        for (const href of linkedStyles(text)) {
            const full = href.charAt(0) === '/' ? href : dir + href;
            const css = env.readText ? env.readText(full) : null;
            asset.styles[href] = css === null || css === undefined ? 0 : fnv1a(css);
        }
    },
    read(asset, env) {
        if (!asset.path) return fail('R2D_RELOAD_READ', 'у документа нет path');
        const text = env.readText ? env.readText(asset.path) : null;
        if (text === null || text === undefined) return fail('R2D_RELOAD_READ', `файл "${asset.path}" не прочитан`);
        return ok({ text, hash: fnv1a(text) });
    },
    validate(asset, src, env) {
        const text = src.value.text;
        const structure = checkRmlMarkup(text);
        if (structure) return fail('R2D_RELOAD_RML', structure);
        // Внешние таблицы стилей RmlUi кэширует по URL: правку .rcss документ
        // сам не подхватит. Отпечатки считаем здесь, чтобы результат честно
        // сказал об этом (R2D_RELOAD_STYLE_CACHED), а не молчал.
        const styles = linkedStyles(text);
        const hashes = [];
        const changed_styles = [];
        if (asset.styles === undefined) asset.styles = {};
        for (const href of styles) {
            const dir = String(asset.path || '').replace(/[^/]*$/, '');
            const full = href.charAt(0) === '/' ? href : dir + href;
            const css = env.readText ? env.readText(full) : null;
            const hash = css === null || css === undefined ? 0 : fnv1a(css);
            hashes.push({ href, full, hash });
            if (asset.styles[href] !== undefined && asset.styles[href] !== hash) changed_styles.push(href);
            asset.styles[href] = hash;
        }
        asset.style_changed = changed_styles;
        if (env.engine && env.engine.ui && typeof env.engine.ui.loadMarkup === 'function') {
            const staging = `reload_check_${String(asset.name).replace(/[^a-zA-Z0-9_]/g, '_')}`;
            const id = env.engine.ui.loadMarkup(staging, text);
            if (!(id >= 0)) return fail('R2D_RELOAD_RML', 'RmlUi не принял разметку (ошибка в документе или стилях)');
            env.engine.ui.unload(id);
        }
        return ok();
    },
    prepare(asset, src) { return ok({ text: src.value.text, hash: src.value.hash }); },
    apply(asset, prep, env) {
        const ui = env.ui;
        if (!ui || typeof ui.doc !== 'function') return fail('R2D_RELOAD_UNSUPPORTED', 'нет $.ui — RmlUi не поставлен');
        const old = ui.doc(asset.path);
        if (!old || old.id < 0) return fail('R2D_RELOAD_APPLY', `документ "${asset.path}" не открыт (сначала $.ui.doc)`);
        const old_id = old.id;
        old.unload();                                   // снимает документ и кэш по пути
        const next = ui.doc(asset.path);                // грузит файл заново
        if (!next || next.id < 0) {
            // Разметка проверена до подмены, но файл мог измениться между
            // проверкой и загрузкой: честно помечаем failed, а не делаем вид.
            return fail('R2D_RELOAD_RML', `документ "${asset.path}" не загрузился после замены`);
        }
        const warnings = [];
        if (asset.style_changed && asset.style_changed.length) {
            warnings.push({
                code: 'R2D_RELOAD_STYLE_CACHED',
                message: `документ "${asset.path}" перезагружен, но связанные стили `
                    + `${asset.style_changed.join(', ')} RmlUi кэширует по URL: `
                    + 'внесите стиль в сам .rml (<style>) или перезапустите процесс',
            });
            asset.style_changed = [];
        }
        return ok({ changed: true, value: next, retire: [], old_doc: old_id, doc: next, warnings });
    },
};

/** Произвольные данные (room/prefab/params): разбор JSON + проверка схемой. */
export const jsonAdapter = {
    read(asset, env) {
        if (!asset.path) return fail('R2D_RELOAD_READ', 'у данных нет path');
        const text = env.readText ? env.readText(asset.path) : null;
        if (text === null || text === undefined) return fail('R2D_RELOAD_READ', `файл "${asset.path}" не прочитан`);
        return ok({ text, hash: fnv1a(text) });
    },
    validate(asset, src, env) {
        let data;
        try { data = JSON.parse(src.value.text); }
        catch (err) { return fail('R2D_RELOAD_PARSE', `JSON "${asset.path}" не разобрался: ${err && err.message ? err.message : err}`); }
        const validate = asset.spec && asset.spec.validate;
        if (typeof validate === 'function') {
            const res = validate(data, asset);
            if (res === false) return fail('R2D_RELOAD_VALIDATE', 'validate() вернул false');
            if (typeof res === 'string') return fail('R2D_RELOAD_VALIDATE', res);
            if (res && res.ok === false) return fail('R2D_RELOAD_VALIDATE', res.error || 'validate() вернул ok:false');
        }
        return ok({ data });
    },
    prepare(asset, src, env) {
        const checked = jsonAdapter.validate(asset, src, env);
        if (!checked.ok) return checked;
        return ok({ data: checked.value.data, hash: src.value.hash });
    },
    apply(asset, prep, env) {
        const p = prep.value;
        const onApply = asset.spec && asset.spec.apply;
        if (typeof onApply === 'function') {
            const res = onApply(p.data, asset, env);
            if (res === false) return fail('R2D_RELOAD_APPLY', 'apply() вернул false');
        }
        return ok({ changed: true, value: p.data, retire: [] });
    },
};

/** Все встроенные виды — их дополняет `$.reload.registerKind`. */
export function builtinAdapters() {
    const map = new Map();
    map.set('texture', textureAdapter);
    map.set('atlas', atlasAdapter);
    map.set('tilemap', tilemapAdapter);
    map.set('rml', rmlAdapter);
    map.set('json', jsonAdapter);
    return map;
}

// ---------------------------------------------------------------------------
// Установка: $.reload
// ---------------------------------------------------------------------------

/** Перепривязать спрайты узлов по карте «старый id → новый id». */
export function remapNodeSprites(nodes, old_to_new) {
    let remapped = 0;
    for (const node of nodes) {
        if (!node || node.removed) continue;
        if (typeof node.sprite === 'number' && old_to_new.has(node.sprite)) {
            node.sprite = old_to_new.get(node.sprite);
            remapped++;
        }
        if (Array.isArray(node.frames)) {
            for (let i = 0; i < node.frames.length; i++) {
                const next = old_to_new.get(node.frames[i]);
                if (next !== undefined) node.frames[i] = next;
            }
        }
    }
    return remapped;
}

export function installReload($) {
    const dbg = $ && $.debug;

    function report(entry) {
        if (dbg && typeof dbg.reportError === 'function') {
            dbg.reportError('$.reload', new Error(entry.message), {
                fatal: false,
                code: entry.code,
                assetPath: entry.path === undefined ? null : entry.path,
            });
        }
        ctx.log(`$.reload: [${entry.code}] ${entry.message}` +
                (entry.name ? ` (ассет "${entry.name}")` : ''));
    }

    const core = createReloadCore({
        log: (m) => ctx.log(m),
        report,
        frame: () => (typeof engine.frame === 'number' ? engine.frame : 0),
        now: () => (typeof engine.now === 'function' ? engine.now() : 0),
        readText: (path) => {
            const fs = $ && $.fs ? $.fs : null;
            if (!fs || typeof fs.readText !== 'function') return null;
            return fs.readText(path);
        },
        readBytes: (path) => (typeof engine.readBytes === 'function' ? engine.readBytes(path) : null),
        exists: (path) => ($ && $.fs && typeof $.fs.exists === 'function' ? $.fs.exists(path) : true),
        nodes: () => ctx.nodes,
        query: (sel) => ($(sel) && typeof $(sel).toArray === 'function' ? $(sel).toArray() : []),
        wrap: (node) => wrapOne(node),
        engine,
        atlas: $ ? $.atlas : null,
        resource: $ ? $.resource : null,
        ui: $ ? $.ui : null,
        adapters: builtinAdapters(),
        remapSprites: (map) => remapNodeSprites(ctx.nodes, map),
        resolveValue: (asset) => {
            const s = asset.spec || {};
            if (typeof s.value === 'function') return s.value(asset);
            if (asset.kind === 'atlas' && $ && $.atlas) return $.atlas.get(asset.name);
            if (asset.kind === 'rml' && $ && $.ui) {
                const doc = $.ui.doc(asset.path);
                return doc && doc.id >= 0 ? doc : null;
            }
            if (asset.value !== null && asset.value !== undefined) return asset.value;
            return undefined;
        },
        release: (item) => {
            if (item.kind === 'texture') {
                return typeof engine.freeTexture === 'function' ? engine.freeTexture(item.handle) !== false : false;
            }
            if (item.kind === 'ui-doc') {
                if (engine.ui && typeof engine.ui.unload === 'function') { engine.ui.unload(item.handle); return true; }
                return false;
            }
            if (item.kind === 'resource' && $ && $.resource) {
                return $.resource.remove(item.name !== null ? item.name : item.handle) !== false;
            }
            if (item.kind === 'node' && item.handle && typeof item.handle.destroy === 'function') {
                item.handle.destroy();
                return true;
            }
            return false;
        },
    });

    const reload = {
        // --- Реестр и граф ---------------------------------------------------
        watch(name, spec) { return core.watch(name, spec); },
        unwatch(name) { return core.unwatch(name); },
        get(name) { return core.info(name); },
        list() { return core.list(); },
        value(name) { return core.value(name); },
        version(name) { const i = core.info(name); return i ? i.version : 0; },
        versions(name) { return core.versions(name); },
        graph() { return core.graph(); },
        order(names) { return core.topoOrder(names); },

        // --- Перезагрузка ----------------------------------------------------
        reload(name, opts) { return core.reload(name, opts); },
        reloadAll(opts) { return core.reloadAll(opts); },
        poll(opts) { return core.poll(opts); },
        stats() { return core.stats(); },
        pending() { return core.listPending(); },

        // --- Отложенное освобождение -----------------------------------------
        retire(item) { return core.retire(item); },
        flush(frame) { return core.flush(frame); },

        // --- События ---------------------------------------------------------
        on(event, fn) { return core.on(event, fn); },
        off(event, fn) { return core.off(event, fn); },

        // --- Три РАЗНЫЕ операции (§27) ---------------------------------------
        /**
         * Перезагрузить ПОВЕДЕНИЕ: перезапуск JS-рантайма на границе кадра.
         * Произвольные замыкания не сохраняются — это не обещание движка;
         * для сохранения логического состояния используйте $.reload.restartScene
         * или $.save.
         */
        behavior(reason) {
            const request = $ && $.script ? $.script.request(reason === undefined ? 'reload поведения' : reason) : false;
            return { ok: !!request, operation: 'behavior', request,
                     note: 'перезапуск рантайма: замыкания не сохраняются' };
        },

        /**
         * Scoped restart сцены: `$.scene.load(name, { scope: true })` даёт новую
         * область владения (узлы/подписки/таймеры прежней закрываются), а
         * поддерживаемое логическое состояние переносится через
         * `capture()` → `restore(state)` на следующем кадре.
         */
        restartScene(name, opts) {
            const o = opts || {};
            if (!$ || !$.scene || typeof $.scene.load !== 'function') {
                return { ok: false, operation: 'scene', code: 'R2D_RELOAD_UNSUPPORTED', error: 'нет $.scene' };
            }
            let state = null;
            if (typeof o.capture === 'function') {
                try { state = o.capture(); }
                catch (err) {
                    return { ok: false, operation: 'scene', code: 'R2D_RELOAD_CAPTURE',
                             error: `capture() упал: ${err && err.message ? err.message : err}` };
                }
            }
            if (!o.state && !o.scope) o.scope = true;      // restart не копит узлы
            $.scene.load(name, o);
            if (typeof o.restore === 'function') {
                restore_queue.push({ scene: String(name), state, restore: o.restore, frame: frameOf() });
            }
            return { ok: true, operation: 'scene', scene: String(name), state_captured: state !== null,
                     restore_pending: typeof o.restore === 'function' };
        },

        /** Дополнительный вид ассета (расширяемость): адаптер из §27-конвейера. */
        registerKind(kind, adapter) {
            if (!adapter) return false;
            // Простой вид: `{ load(path, env), validate(value), apply?(value) }`.
            // Полный адаптер конвейера (read/validate/prepare/apply) принимается
            // как есть — так свои виды не обязаны знать внутренние стадии.
            let full = adapter;
            if (typeof adapter.apply !== 'function' && typeof adapter.load === 'function') {
                full = {
                    read(asset, env) {
                        try { return ok({ value: adapter.load(asset.path, env), hash: 0 }); }
                        catch (err) { return fail('R2D_RELOAD_READ', String(err && err.message ? err.message : err)); }
                    },
                    validate(asset, src, env) {
                        if (typeof adapter.validate !== 'function') return ok();
                        const res = adapter.validate(src.value.value, asset, env);
                        if (res === false) return fail('R2D_RELOAD_VALIDATE', 'validate() вернул false');
                        if (typeof res === 'string') return fail('R2D_RELOAD_VALIDATE', res);
                        if (res && res.ok === false) return fail('R2D_RELOAD_VALIDATE', res.error || 'validate() вернул ok:false');
                        return ok();
                    },
                    prepare(asset, src) { return ok({ value: src.value.value }); },
                    apply(asset, prep, env) {
                        if (typeof adapter.apply === 'function') {
                            const res = adapter.apply(prep.value.value, asset, env);
                            if (res === false) return fail('R2D_RELOAD_APPLY', 'apply() вернул false');
                        }
                        return ok({ changed: true, value: prep.value.value });
                    },
                };
            }
            if (typeof full.apply !== 'function') return false;
            core.adapters.set(String(kind), full);
            return true;
        },
        kinds() { return [...core.adapters.keys()]; },

        /** Состояние для DevTools: последний результат, счётчики, индикатор. */
        indicator() {
            const s = core.stats();
            const last = s.last || null;
            return {
                watched: s.watched,
                failed: s.failed,
                pending_release: s.pending_release,
                last_ok: last ? last.ok === true : null,
                last_code: last ? last.code : null,
                last_version: last ? last.version : 0,
                last_frame: last ? last.frame : 0,
                reloads: s.reloads,
                applied: s.applied,
                failed_total: s.failed_total,
            };
        },
    };

    // Операции restart: восстановление состояния — на следующем кадре, после
    // того как новая сцена действительно вошла.
    const restore_queue = [];
    function frameOf() { return typeof engine.frame === 'number' ? engine.frame : 0; }

    ctx.reload = reload;
    $.reload = reload;

    // Кадровый ход: освободить handle'ы, пережившие кадр замены, и применить
    // отложенное восстановление после scoped restart. Регистрируется через
    // публичный $.update — кадровый цикл api.js не правится.
    if (typeof $.update === 'function') {
        $.update(() => {
            core.flush(frameOf());
            if (restore_queue.length) {
                for (let i = restore_queue.length - 1; i >= 0; i--) {
                    const item = restore_queue[i];
                    if (item.frame >= frameOf()) continue;
                    restore_queue.splice(i, 1);
                    try { item.restore(item.state); }
                    catch (err) { ctx.log(`$.reload: restore после restart сцены упал: ${err}`); }
                }
            }
        });
    }

    return reload;
}
