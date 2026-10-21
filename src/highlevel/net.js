// ===========================================================================
// $.net: высокоуровневый multiplayer над приватным ENet транспортом.
// По умолчанию рекомендует authoritative host, но поддерживает mesh, relay и
// пользовательские схемы; сетевой код прикрепляется к обычным $-сущностям.
// ===========================================================================

import { engine } from './native.js';
import { ctx, def, wrap, wrapOne } from './core.js';

// ---------------------------------------------------------------------------
// Чистое ядро: сетевые идентификаторы
// ---------------------------------------------------------------------------

/**
 * Стол сетевых id: узел → номер. Один и тот же узел всегда получает один и тот
 * же номер, номера не переиспользуются в пределах сессии — иначе клиент
 * сопоставил бы чужую сущность со своей.
 */
export function createIdTable(prefix) {
    const byNode = new WeakMap();
    const byId = new Map();
    let next = 1;
    const tag = String(prefix || 'e');

    return {
        /** Номер узла (создаёт при первом обращении). */
        idOf(node) {
            if (!node || typeof node !== 'object') return 0;
            const known = byNode.get(node);
            if (known !== undefined) return known;
            const id = next++;
            byNode.set(node, id);
            byId.set(id, node);
            return id;
        },
        /** Узел по номеру (или null). */
        nodeOf(id) {
            return byId.get(Math.floor(Number(id) || 0)) || null;
        },
        /** Освободить номер: сущность удалена, номер больше не выдаётся. */
        remove(node) {
            const id = byNode.get(node);
            if (id === undefined) return 0;
            byNode.delete(node);
            byId.delete(id);
            return id;
        },
        has(id) { return byId.has(Math.floor(Number(id) || 0)); },
        /** Сколько сущностей в столе. */
        size() { return byId.size; },
        ids() { return [...byId.keys()].sort((a, b) => a - b); },
        /** Строковый ключ для снапшота: `e12`. */
        key(id) { return tag + Math.floor(Number(id) || 0); },
        /** Разобрать ключ обратно. */
        parse(text) {
            const s = String(text || '');
            if (s[0] !== tag) return 0;
            const n = Number(s.slice(1));
            return Number.isFinite(n) ? n : 0;
        },
    };
}

// ---------------------------------------------------------------------------
// Чистое ядро: снапшоты и дельта
// ---------------------------------------------------------------------------

/**
 * Дельта от подтверждённого состояния: в снапшот попадают только изменившиеся
 * поля. Пустое значение удаляет сущность (`null`).
 *
 * `base` — предыдущее подтверждённое состояние (может быть null),
 * `now` — текущее. Возвращает `{ tick, full, entities }`.
 */
export function diffSnapshot(base, now, tick) {
    const previous = base && base.entities ? base.entities : {};
    const current = now && now.entities ? now.entities : (now || {});
    const entities = {};
    let changed = 0;
    for (const key of Object.keys(current)) {
        const before = previous[key];
        const after = current[key];
        if (after === null || after === undefined) {
            if (before !== undefined) { entities[key] = null; changed++; }
            continue;
        }
        if (!before) {
            entities[key] = after;
            changed++;
            continue;
        }
        const patch = {};
        let fields = 0;
        for (const field of Object.keys(after)) {
            if (!sameValue(before[field], after[field])) { patch[field] = after[field]; fields++; }
        }
        if (fields > 0) { entities[key] = patch; changed++; }
    }
    // Удалённые сущности: были в прошлом, нет в текущем.
    for (const key of Object.keys(previous)) {
        if (current[key] === undefined && previous[key] !== null) { entities[key] = null; changed++; }
    }
    return { tick: Math.floor(Number(tick) || 0), full: !base, entities, changed };
}

/** Значения равны? Числа сравниваем с допуском: позиции «дрожат». */
export function sameValue(a, b, epsilon) {
    const eps = epsilon === undefined ? 0.0001 : epsilon;
    if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= eps;
    if (a === b) return true;
    if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; ++i) if (!sameValue(a[i], b[i], eps)) return false;
        return true;
    }
    return false;
}

/**
 * Применить снапшот к состоянию: сначала удаления, потом патчи.
 * Возвращает НОВОЕ состояние (вход не меняем — клиент держит прошлое для
 * интерполяции).
 */
export function applySnapshot(state, snapshot) {
    const out = {};
    const entities = (state && state.entities) ? state.entities : {};
    for (const key of Object.keys(entities)) out[key] = Object.assign({}, entities[key]);
    const incoming = (snapshot && snapshot.entities) || {};
    for (const key of Object.keys(incoming)) {
        const patch = incoming[key];
        if (patch === null) { delete out[key]; continue; }
        out[key] = Object.assign({}, out[key] || {}, patch);
    }
    return {
        tick: snapshot && snapshot.tick !== undefined ? snapshot.tick : (state ? state.tick : 0),
        entities: out,
    };
}

/**
 * Интерполяция чужой сущности между двумя подтверждёнными снапшотами:
 * `t` — доля 0…1. Своих игроков не интерполируем — их предсказывает клиент.
 */
export function interpolate(from, to, t) {
    const a = from || {};
    const b = to || {};
    const k = Math.max(0, Math.min(1, Number(t) || 0));
    const out = Object.assign({}, a, b);
    for (const field of Object.keys(b)) {
        const va = a[field];
        const vb = b[field];
        if (typeof va === 'number' && typeof vb === 'number') out[field] = va + (vb - va) * k;
        else if (Array.isArray(va) && Array.isArray(vb) && va.length === vb.length) {
            out[field] = va.map((v, i) => (typeof v === 'number' && typeof vb[i] === 'number'
                ? v + (vb[i] - v) * k : vb[i]));
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// Чистое ядро: ввод
// ---------------------------------------------------------------------------

/**
 * Очередь ввода клиента: номера по порядку, старые вытесняются. Сервер обязан
 * видеть только свежий ввод, поэтому очередь короткая и с подтверждением.
 */
export function createInputQueue(capacity, onDrop) {
    const limit = Math.max(1, Math.floor(Number(capacity) || 64));
    const items = [];
    let lastSeq = 0;
    return {
        /** Положить ввод: `{ seq, ... }`. Старый номер игнорируем. */
        push(input) {
            if (!input || typeof input !== 'object') return false;
            const seq = Math.floor(Number(input.seq) || 0);
            if (seq <= lastSeq) return false;      // повтор или переупорядочивание
            if (lastSeq > 0 && seq > lastSeq + 1) {
                // Пропуск в номерах: потерянный ввод просто не случился.
                // Догонять его позже нельзя — игрок уже двинулся.
                onDrop && onDrop();
            }
            lastSeq = seq;
            items.push(Object.assign({}, input));
            while (items.length > limit) items.shift();
            return true;
        },
        /** Забрать всё накопленное и очистить. */
        take() { const out = items.slice(); items.length = 0; return out; },
        /** Последний номер (0 — ввода не было). */
        lastSeq() { return lastSeq; },
        /** Последний ввод (или null). */
        last() { return items.length ? items[items.length - 1] : null; },
        size() { return items.length; },
        clear() { items.length = 0; },
    };
}

// ---------------------------------------------------------------------------
// Чистое ядро: авторитетный сервер
// ---------------------------------------------------------------------------

/**
 * Авторитет сервера: таблица владельцев и стол сетевых id.
 *
 * Правило модели: узел принадлежит ИГРОКУ, и только сервер применяет ввод к его
 * телу. Клиент не может сказать «у меня 100 hp» — он присылает ввод, а
 * состояние подтверждает сервер.
 */
export function createAuthority() {
    const ids = createIdTable('e');
    const owners = new Map();      // сетевой id → номер игрока
    const inputs = new Map();      // номер игрока → очередь ввода
    let nextPlayer = 1;

    return {
        ids,
        /** Новый игрок: номер и его очередь ввода. */
        addPlayer(onDrop) {
            const id = nextPlayer++;
            inputs.set(id, createInputQueue(64, onDrop));
            return id;
        },
        removePlayer(player) {
            const p = Math.floor(Number(player) || 0);
            inputs.delete(p);
            for (const [key, owner] of [...owners]) if (owner === p) owners.delete(key);
            return p;
        },
        players() { return [...inputs.keys()].sort((a, b) => a - b); },
        playerCount() { return inputs.size; },

        /** Объявить узел реплицируемым: `replicate('#hero', { owner: p })`. */
        replicate(node, opts) {
            const o = opts || {};
            const id = ids.idOf(node);
            if (o.owner !== undefined && o.owner !== null) owners.set(id, Math.floor(Number(o.owner)));
            return id;
        },
        /** Снять с репликации (узел удаляется). */
        unreplicate(node) {
            const id = ids.remove(node);
            owners.delete(id);
            return id;
        },
        /** Чей это узел: номер игрока или 0 (ничей). */
        ownerOf(node) {
            const id = ids.idOf(node);
            return owners.get(id) || 0;
        },
        /** Может ли этот игрок управлять узлом. */
        owns(player, node) {
            return this.ownerOf(node) === Math.floor(Number(player) || 0);
        },
        /** Узлы игрока. */
        ownedBy(player) {
            const p = Math.floor(Number(player) || 0);
            const out = [];
            for (const [id, owner] of owners) if (owner === p) out.push(ids.nodeOf(id));
            return out.filter(Boolean);
        },
        /** Очередь ввода игрока (или null). */
        inputOf(player) { return inputs.get(Math.floor(Number(player) || 0)) || null; },

        /** Полный сброс: новый мир, тесты. Номера игроков начинаются заново. */
        reset() {
            owners.clear();
            inputs.clear();
            nextPlayer = 1;
            return this;
        },

        /** Строка состояния для интерфейса и отладки. */
        describe() {
            return `игроков ${inputs.size}, сущностей ${ids.size()}, владельцев ${owners.size}`;
        },
    };
}

// ---------------------------------------------------------------------------
// Чистое ядро: клиентская сторона
// ---------------------------------------------------------------------------

/**
 * Подтверждённое состояние клиента. Клиент НЕ считает мир: он держит последний
 * снапшот сервера (и предыдущий — для интерполяции) и своё локальное
 * предсказание, которое сбрасывается первым же подтверждением.
 */
export function createClientState() {
    let confirmed = { tick: 0, entities: {} };
    let previous = { tick: 0, entities: {} };
    let lastSeq = 0;

    return {
        /** Подтверждённое состояние (только чтение). */
        confirmed() { return { tick: confirmed.tick, entities: Object.assign({}, confirmed.entities) }; },
        /** Предыдущее подтверждённое — для интерполяции чужих. */
        previous() { return { tick: previous.tick, entities: Object.assign({}, previous.entities) }; },

        /** Применить снапшот: старый становится предыдущим. */
        apply(snapshot) {
            previous = confirmed;
            confirmed = applySnapshot(confirmed, snapshot);
            return confirmed;
        },

        /** Следующий номер ввода для отправки. */
        nextInput() { return ++lastSeq; },
        lastSeq() { return lastSeq; },

        /** Значение поля сущности из подтверждённого (или undefined). */
        get(key, field) {
            const e = confirmed.entities[String(key)];
            if (!e) return undefined;
            return field === undefined ? e : e[field];
        },

        /**
         * Положение сущности с интерполяцией: своё — подтверждённое, чужое —
         * между предыдущим и текущим снапшотами.
         */
        polated(key, own, t) {
            const k = String(key);
            const to = confirmed.entities[k];
            if (!to) return null;
            if (own) return Object.assign({}, to);
            const from = previous.entities[k];
            if (!from) return Object.assign({}, to);
            return interpolate(from, to, t);
        },

        reset() {
            confirmed = { tick: 0, entities: {} };
            previous = { tick: 0, entities: {} };
            lastSeq = 0;
        },
    };
}

/**
 * Сообщение → байты. Обычный JSON в UTF-8-подобной записи: снапшоты и ввод
 * небольшие, а разбирать их в C незачем — модель живёт в JS.
 */
export function encodeMessage(message) {
    const text = JSON.stringify(message || {});
    const bytes = [];
    for (let i = 0; i < text.length; ++i) {
        let code = text.charCodeAt(i);
        if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
            const low = text.charCodeAt(i + 1);
            if (low >= 0xdc00 && low <= 0xdfff) {
                code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
                i++;
            }
        }
        if (code < 0x80) bytes.push(code);
        else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
        else if (code < 0x10000) bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
        else bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
    return new Uint8Array(bytes);
}

export function decodeMessage(data) {
    if (!data || data.length === 0) return null;
    let text = '';
    for (let i = 0; i < data.length;) {
        const a = data[i++] & 0xff;
        let code;
        if (a < 0x80) code = a;
        else if ((a & 0xe0) === 0xc0 && i < data.length) code = ((a & 0x1f) << 6) | (data[i++] & 0x3f);
        else if ((a & 0xf0) === 0xe0 && i + 1 < data.length) code = ((a & 0x0f) << 12) | ((data[i++] & 0x3f) << 6) | (data[i++] & 0x3f);
        else if ((a & 0xf8) === 0xf0 && i + 2 < data.length) {
            code = ((a & 7) << 18) | ((data[i++] & 0x3f) << 12) | ((data[i++] & 0x3f) << 6) | (data[i++] & 0x3f);
            code -= 0x10000;
            text += String.fromCharCode(0xd800 + (code >> 10), 0xdc00 + (code & 0x3ff));
            continue;
        } else return null;
        text += String.fromCharCode(code);
    }
    try {
        const parsed = JSON.parse(text);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (e) {
        return null;
    }
}

/**
 * История подтверждённых состояний — основа лаг-компенсации.
 *
 * Сервер хранит, где кто был в прошлом, и на выстрел проверяет попадание по
 * состоянию с задержкой клиента, а не по «сейчас». Иначе по движущейся цели не
 * попасть никогда: клиент стреляет по тому, кого ВИДЕЛ.
 *
 * Ядро чистое: времена и сущности, никаких сокетов.
 */
export function createHistory(capacity, seconds) {
    const limit = Math.max(1, Math.floor(Number(capacity) || 120));
    const window = Math.max(0.1, Number(seconds) || 1);
    let frames = [];              // [{ time, entities }] от старых к новым

    const history = {
        /** Запомнить состояние на момент времени. */
        push(time, entities) {
            const t = Number(time) || 0;
            frames.push({ time: t, entities: Object.assign({}, entities || {}) });
            // Вытесняем по количеству и по времени — держим только окно.
            while (frames.length > limit) frames.shift();
            while (frames.length > 1 && t - frames[0].time > window) frames.shift();
            return history;
        },

        /** Сколько записей. */
        size() { return frames.length; },
        /** Границы окна: `{ from, to }` (или null, если пусто). */
        range() {
            if (!frames.length) return null;
            return { from: frames[0].time, to: frames[frames.length - 1].time };
        },

        /**
         * Сущность на момент времени: берём ближайший кадр НЕ ПОЗЖЕ `time`
         * (то, что сервер уже знал), и отдаём его состояние.
         */
        at(time, key) {
            const t = Number(time) || 0;
            let found = null;
            // Сравнение с ДОПУСКОМ: время копится сложением кадров, и
            // 0.1 + 0.1 + 0.1 в двоичных дробях больше 0.3 — без допуска
            // перемотка «на 0.2 назад» находила предыдущий кадр (нашлось тестом).
            const eps = 1e-6;
            for (const frame of frames) {
                if (frame.time <= t + eps) found = frame;
                else break;
            }
            if (!found) found = frames[0] || null;
            if (!found) return null;
            if (key === undefined) return Object.assign({}, found.entities);
            const e = found.entities[String(key)];
            return e ? Object.assign({}, e) : null;
        },

        /**
         * Перемотка: позиция сущности на момент «сейчас минус задержка».
         * `delay` — половина RTT, то есть столько, сколько клиент ждал.
         */
        rewind(now, delay, key) {
            return history.at((Number(now) || 0) - (Number(delay) || 0), key);
        },

        clear() { frames = []; return history; },
        /** Снимок для сейва и тестов. */
        frames() { return frames.map((f) => ({ time: f.time, entities: Object.assign({}, f.entities) })); },
    };
    return history;
}

/**
 * Предсказание локального игрока: клиент применяет свой ввод сразу, а когда
 * приходит подтверждение от сервера — откатывается к нему и ПОВТОРЯЕТ
 * неподтверждённые вводы. Так отклик мгновенный, но правда всегда серверная.
 *
 * `simulate(state, input)` — чистая функция шага: она же используется сервером.
 */
/**
 * Плавно подтянуть `visual` к `target` — сглаживание откатов.
 *
 * ЗАЧЕМ. Клиент откатывается к серверному состоянию и повторяет ввод; если
 * рисовать `predicted` напрямую, при каждой коррекции картинка ДЁРГАЕТСЯ.
 * Сглаживание держит отдельное «визуальное» состояние и подтягивает его к
 * симуляционному — игрок видит плавное движение, а не телепорт.
 *
 * Сглаживаются только ЧИСЛОВЫЕ поля; остальные (`pose`, флаги) берутся как
 * есть: интерполировать позу бессмысленно, а флаг — невозможно.
 *
 * `opts`:
 *   * `rate` — скорость догона, 1/с (по умолчанию 12): доля пути за секунду;
 *   * `snap` — расхождение, с которого сглаживание сдаётся и ставит значение
 *     сразу (по умолчанию 0 — никогда). Нужно для настоящих телепортов:
 *     игрока перенесло — тянуть его через полкарты нельзя;
 *   * `fields` — какие поля сглаживать (по умолчанию все числовые).
 *
 * Возвращает НОВЫЙ объект: `visual` не мутируется, поэтому вызывающий может
 * хранить его сам.
 */
export function smoothState(visual, target, dt, opts) {
    const o = opts || {};
    const rate = Number.isFinite(Number(o.rate)) ? Math.max(0, Number(o.rate)) : 12;
    const snap = Number.isFinite(Number(o.snap)) ? Math.max(0, Number(o.snap)) : 0;
    const only = Array.isArray(o.fields) ? o.fields : null;
    const src = target && typeof target === 'object' ? target : {};
    const prev = visual && typeof visual === 'object' ? visual : null;
    const out = {};

    // Доля пути за кадр: экспонента, а не rate*dt — иначе при большом dt
    // (просадка) значение перескакивало бы цель.
    const step = dt > 0 ? 1 - Math.exp(-rate * dt) : 1;

    for (const key of Object.keys(src)) {
        const value = src[key];
        if (typeof value !== 'number' || !Number.isFinite(value)
            || (only && !only.includes(key)) || !prev) {
            out[key] = value;
            continue;
        }
        const from = Number(prev[key]);
        if (!Number.isFinite(from)) { out[key] = value; continue; }
        const gap = value - from;
        // Слишком далеко — это телепорт, а не коррекция: ставим сразу.
        if (snap > 0 && Math.abs(gap) > snap) { out[key] = value; continue; }
        out[key] = from + gap * step;
    }
    // Поля, которых нет в цели, но были в визуале, НЕ переносим: цель — истина.
    return out;
}

export function createPrediction(simulate) {
    // Шаг по умолчанию — «состояние плюс ввод»: чистое тождество по состоянию
    // отбрасывало ввод, и предсказание возвращало пустой объект (нашлось тестом).
    const step = typeof simulate === 'function'
        ? simulate
        : (state, input) => Object.assign({}, state || {}, input || {});
    let predicted = null;         // наше состояние (уже с локальным вводом)
    let acknowledged = 0;         // до какого номера сервер подтвердил
    let pending = [];             // вводы, ещё не подтверждённые
    let corrections = 0;          // сколько раз пришлось откатываться
    let lastError = 0;            // насколько предсказание разошлось с правдой

    const prediction = {
        /** Запомнить подтверждённое сервером состояние (до номера `seq`). */
        acknowledge(state, seq) {
            acknowledged = Math.floor(Number(seq) || 0);
            acknowledged_state = state;
            // Неподтверждённые вводы: всё, что новее подтверждённого номера.
            const keep = pending.filter((item) => item.seq > acknowledged);
            predicted = Object.assign({}, state);
            for (const item of keep) predicted = step(predicted, item.input);
            // Коррекция: сравниваем, где мы оказались и где правда.
            const before = predicted;
            lastError = 0;
            if (acknowledged_state && before) {
                const a = Number(acknowledged_state.x);
                const b = Number(before.x);
                if (Number.isFinite(a) && Number.isFinite(b)) lastError = Math.abs(a - b);
            }
            if (keep.length !== pending.length) corrections++;
            pending = keep;
            return predicted;
        },

        /** Применить свой ввод немедленно (и запомнить для повтора). */
        apply(input) {
            pending.push({ seq: input && input.seq ? input.seq : pending.length + 1, input });
            // Очередь неподтверждённых короткая: если связь пропала совсем,
            // копить бесконечно нельзя.
            while (pending.length > 128) pending.shift();
            predicted = step(predicted || {}, input);
            return predicted;
        },

        /** Наше состояние (с учётом локального ввода). */
        state() { return predicted ? Object.assign({}, predicted) : null; },

        /**
         * Визуальное состояние: плавно догоняет `state()`.
         *
         * ```js
         * const view = $.net.prediction().visual(dt, { rate: 14, snap: 200 });
         * hero.at(view.x, view.y);
         * ```
         *
         * Сглаживание нужно ПОСЛЕ отката: без него каждая коррекция дёргает
         * картинку. `snap` — расхождение, с которого сглаживание сдаётся
         * (настоящий телепорт).
         */
        visual(dt, opts) {
            visual_state = smoothState(visual_state, predicted, dt === undefined ? 1 / 60 : dt, opts);
            return visual_state ? Object.assign({}, visual_state) : null;
        },

        /** Насколько визуал отстал от симуляции — для отладки дёрганости. */
        visualError() {
            if (!visual_state || !predicted) return 0;
            let worst = 0;
            for (const key of Object.keys(predicted)) {
                if (typeof predicted[key] !== 'number') continue;
                const d = Math.abs(Number(visual_state[key]) - Number(predicted[key]));
                if (Number.isFinite(d) && d > worst) worst = d;
            }
            return worst;
        },

        /** Сбросить визуал (например, при переходе между сценами). */
        resetVisual() { visual_state = null; return prediction; },
        /** Сколько вводов ещё не подтверждено. */
        pending() { return pending.length; },
        /** До какого номера сервер подтвердил. */
        acknowledged() { return acknowledged; },
        /** Сколько раз откатывались (диагностика «дёрганости»). */
        corrections() { return corrections; },
        /** Последняя разница между предсказанием и правдой. */
        error() { return lastError; },

        reset() {
            predicted = null; acknowledged = 0; pending = []; corrections = 0; lastError = 0;
            acknowledged_state = null;
            visual_state = null;
            return prediction;
        },
    };

    let acknowledged_state = null;
    let visual_state = null;
    return prediction;
}

// ---------------------------------------------------------------------------
// Подсистема
// ---------------------------------------------------------------------------

/** Поддерживаемые сетевые схемы. Authoritative — рекомендуемый вариант. */
export const TOPOLOGIES = ['authoritative', 'mesh', 'relay', 'custom'];
const DELIVERY = { reliable: 0, state: 1, input: 2, bulk: 3 };
const CHANNEL_DELIVERY = ['reliable', 'state', 'input', 'bulk'];
const DEFAULT_ENTITY_FIELDS = ['x', 'y', 'angle', 'hp'];

export function installNet($) {
    let topology = 'authoritative';
    let authority = 'host';
    let active = false;
    let listening = false;
    let localPort = 0;
    let syncInterval = 50;
    let syncElapsed = 0;
    let interpolationDelay = 100;
    let localPeer = 'p' + Math.floor(Math.random() * 0x7fffffff).toString(36);
    let roomState = null;
    let relayEnabled = false;
    let tickNumber = 0;
    let messageSequence = 0;
    let prediction = null;
    let simulation = { loss: 0, delay: 0, jitter: 0, seed: 1 };
    let randomState = 1;
    const listeners = new Map();
    const peers = new Map();
    const entities = new Map();
    const samples = new Map();
    const rpcHandlers = new Map();
    const delayed = [];
    const stats = { sent: 0, received: 0, dropped: 0, snapshots: 0, inputs: 0, bytesSent: 0, bytesReceived: 0 };

    function emit(name, ...args) {
        const list = listeners.get(String(name));
        if (!list) return 0;
        let count = 0;
        for (const fn of list) {
            try { fn(...args); count++; }
            catch (e) { ctx.reportError ? ctx.reportError('$.net.on(' + name + ')', e) : ctx.log('$.net: ' + e); }
        }
        return count;
    }

    function nativeStatus() {
        if (!engine || typeof engine.netStatus !== 'function') return { available: false, open: false };
        try { return engine.netStatus() || { available: false, open: false }; }
        catch (e) { return { available: false, open: false, error: String(e) }; }
    }

    function open(port, maxPeers) {
        const status = nativeStatus();
        if (!status.available || !engine || typeof engine.netOpen !== 'function') return false;
        if (status.open) { active = true; return true; }
        const ok = !!engine.netOpen(Math.max(0, Math.floor(Number(port) || 0)),
                                   Math.max(1, Math.floor(Number(maxPeers) || 16)));
        if (ok) {
            active = true;
            localPort = Math.max(0, Math.floor(Number(port) || 0));
        }
        return ok;
    }

    function channelFor(delivery) {
        const key = String(delivery || 'reliable');
        return Object.prototype.hasOwnProperty.call(DELIVERY, key) ? DELIVERY[key] : DELIVERY.reliable;
    }

    function random01() {
        let x = randomState || 1;
        x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
        randomState = x >>> 0;
        return randomState / 0x100000000;
    }

    function nativeSend(peerId, message, delivery) {
        if (!engine || typeof engine.netSend !== 'function') return false;
        const bytes = encodeMessage(message);
        const channel = channelFor(delivery);
        const reliable = channel !== DELIVERY.state;
        const ok = !!engine.netSend(peerId || 0, channel, reliable, bytes);
        if (ok) {
            stats.sent++;
            stats.bytesSent += bytes.length;
        }
        return ok;
    }

    function sendEnvelope(peerId, message, delivery) {
        if (!active) return false;
        if (simulation.loss > 0 && random01() * 100 < simulation.loss) {
            stats.dropped++;
            return true;
        }
        const extra = simulation.delay > 0 || simulation.jitter > 0
            ? simulation.delay + Math.floor(random01() * Math.max(1, simulation.jitter + 1)) : 0;
        if (extra > 0) {
            delayed.push({ due: Date.now() + extra, peerId: peerId || 0, message, delivery });
            return true;
        }
        return nativeSend(peerId, message, delivery);
    }

    function envelope(type, data, peer) {
        return { v: 1, type: String(type), data: data === undefined ? null : data,
                 from: localPeer, seq: ++messageSequence, at: Date.now(), peer: peer || 0 };
    }

    function peersExcept(except) {
        const out = [];
        for (const peer of peers.values()) if (peer.id !== except) out.push(peer.id);
        return out;
    }

    function fanout(type, data, except, delivery) {
        const message = envelope(type, data, except);
        const ids = peersExcept(except);
        let sent = 0;
        for (const id of ids) if (sendEnvelope(id, message, delivery)) sent++;
        return sent;
    }

    function targetId(node, options) {
        const explicit = options && (options.id || options.netId);
        return String(explicit || node.netId || node.nid || node.id || ('u' + node.uid));
    }

    function readEntity(entry) {
        const node = entry.node;
        if (!node || node.removed) return null;
        const wrapper = wrapOne(node);
        const state = { id: entry.id, owner: entry.owner };
        for (const field of entry.fields) {
            if (field === 'x' || field === 'y') state[field] = Number(node[field]) || 0;
            else if (field === 'angle') state.angle = Number(node.angle) || 0;
            else if (typeof node.get === 'function') {
                const value = node.get(field);
                if (value !== undefined && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null)) state[field] = value;
            } else if (node[field] !== undefined) state[field] = node[field];
        }
        state.x = Number.isFinite(state.x) ? state.x : wrapper.x;
        state.y = Number.isFinite(state.y) ? state.y : wrapper.y;
        return state;
    }

    function writeEntity(entry, state) {
        const node = entry && entry.node;
        if (!node || node.removed || !state) return;
        const wrapper = wrapOne(node);
        if (Number.isFinite(Number(state.x)) && Number.isFinite(Number(state.y))) wrapper.at(Number(state.x), Number(state.y));
        if (Number.isFinite(Number(state.angle))) wrapper.angle(Number(state.angle));
        for (const field of entry.fields) {
            if (field === 'x' || field === 'y' || field === 'angle' || state[field] === undefined) continue;
            if (typeof node.set === 'function') node.set(field, state[field]);
            else node[field] = state[field];
        }
    }

    function registerNode(node, options) {
        if (!node || node.removed) return;
        const o = options || {};
        const id = targetId(node, o);
        const fields = Array.isArray(o.fields) ? o.fields.map(String) : DEFAULT_ENTITY_FIELDS.slice();
        if (!fields.includes('x')) fields.push('x');
        if (!fields.includes('y')) fields.push('y');
        if (!fields.includes('angle')) fields.push('angle');
        const owner = String(o.owner || (topology === 'mesh' ? 'remote' : 'host'));
        const entry = { id, node, owner, fields, interpolation: o.interpolation !== false };
        entities.set(id, entry);
        node.netId = id;
        return entry;
    }

    function selected(what) {
        if (typeof what === 'string') return $(what);
        if (what && typeof what.eachNode === 'function') return what;
        if (what && typeof what === 'object') return wrapOne(what);
        return wrap([]);
    }

    function register(what, options) {
        const collection = selected(what);
        if (!collection || typeof collection.eachNode !== 'function') return 0;
        let count = 0;
        collection.eachNode((_, node) => { if (registerNode(node, options)) count++; });
        return count;
    }

    function applyRemoteSnapshot(data, peerId) {
        if (!data || !Array.isArray(data.entities)) return false;
        const receivedAt = Date.now();
        for (const state of data.entities) {
            if (!state || state.id === undefined) continue;
            const id = String(state.id);
            const entry = entities.get(id);
            if (!entry || entry.owner === 'local') continue;
            let track = samples.get(id);
            if (!track) samples.set(id, track = []);
            track.push({ time: receivedAt, state });
            while (track.length > 3) track.shift();
            if (topology === 'authoritative' && authority === 'host' && entry.owner === 'client')
                fanout('entity', state, peerId, 'state');
        }
        stats.snapshots++;
        emit('snapshot', data);
        return true;
    }

    function processMessage(event) {
        const message = decodeMessage(event.data);
        if (!message || message.v !== 1 || typeof message.type !== 'string') return;
        stats.received++;
        const peerId = event.peerId;
        const peer = peers.get(peerId);
        if (peer) peer.rtt = event.rtt || peer.rtt;
        if (relayEnabled && !message.relayed && message.type !== 'relay'
            && message.type.indexOf('room:') !== 0) {
            const relayed = Object.assign({}, message, { relayed: true, relayPeer: peerId });
            for (const target of peersExcept(peerId)) sendEnvelope(target, relayed, CHANNEL_DELIVERY[event.channel] || 'reliable');
        }
        if (message.type === 'entity') { applyRemoteSnapshot({ entities: [message.data] }, peerId); return; }
        if (message.type === 'entities') { applyRemoteSnapshot(message.data, peerId); return; }
        if (message.type === 'rpc') {
            const payload = message.data || {};
            const handler = rpcHandlers.get(String(payload.name));
            if (handler) {
                try { handler(payload.data, peerId); } catch (e) { ctx.reportError ? ctx.reportError('$.net.rpc(' + payload.name + ')', e) : ctx.log(String(e)); }
            }
            emit('rpc', payload.name, payload.data, peerId);
            emit('rpc:' + payload.name, payload.data, peerId);
            return;
        }
        if (message.type === 'input') {
            stats.inputs++;
            emit('input', message.data, peerId);
            if (authority === 'host' && topology === 'authoritative') fanout('input', message.data, peerId, 'input');
            return;
        }
        if (message.type === 'ack') {
            if (prediction) prediction.acknowledge(message.data && message.data.state, message.data && message.data.seq);
            emit('ack', message.data, peerId);
            return;
        }
        if (message.type === 'room:join') {
            if (!roomState) roomState = { id: String(message.data && message.data.id || 'default'), name: '', peers: [] };
            if (!roomState.peers.includes(peerId)) roomState.peers.push(peerId);
            sendEnvelope(peerId, envelope('room:joined', { id: roomState.id, peers: peersExcept(peerId) }), 'reliable');
            fanout('room:peer-joined', { peerId }, peerId, 'reliable');
            emit('room:join', peerId, roomState);
            return;
        }
        if (message.type === 'room:leave') {
            if (roomState) roomState.peers = roomState.peers.filter((id) => id !== peerId);
            fanout('room:peer-left', { peerId }, peerId, 'reliable');
            emit('room:leave', peerId, roomState);
            return;
        }
        if (message.type === 'room:joined') {
            roomState = Object.assign({}, message.data, { peers: message.data.peers || [] });
            emit('room:joined', roomState);
            return;
        }
        if (message.type === 'room:peer-joined' || message.type === 'room:peer-left') {
            emit(message.type, message.data);
            return;
        }
        if (message.type === 'relay') { emit('relay', message.data, peerId); return; }
        emit(message.type, message.data, peerId, message);
    }

    function applyInterpolated(now) {
        const renderTime = now - interpolationDelay;
        for (const [id, track] of samples) {
            const entry = entities.get(id);
            if (!entry || !entry.interpolation || !track.length) continue;
            if (track.length === 1) { writeEntity(entry, track[0].state); continue; }
            let from = track[0], to = track[track.length - 1];
            for (let i = 1; i < track.length; ++i) {
                if (track[i].time >= renderTime) { from = track[i - 1]; to = track[i]; break; }
            }
            const span = Math.max(1, to.time - from.time);
            const t = Math.max(0, Math.min(1, (renderTime - from.time) / span));
            writeEntity(entry, interpolate(from.state, to.state, t));
        }
    }

    function sendEntitySnapshot() {
        const batch = [];
        for (const entry of entities.values()) {
            const ownedHere = entry.owner === 'local';
            const hostState = topology === 'authoritative' && authority === 'host' && entry.owner !== 'client';
            if (ownedHere || hostState) {
                const state = readEntity(entry);
                if (state) batch.push(state);
            }
        }
        if (!batch.length) return 0;
        if (topology === 'mesh') {
            let sent = 0;
            for (const state of batch) sent += fanout('entity', state, 0, 'state');
            return sent;
        }
        return fanout('entities', { tick: tickNumber, entities: batch }, 0, 'state');
    }

    function step(dt) {
        if (!active) return 0;
        tickNumber++;
        let work = 0;
        try {
            const events = engine.netPoll ? engine.netPoll() || [] : [];
            for (const event of events) {
                work++;
                if (event.type === 'connect') {
                    const peer = { id: event.peerId, rtt: event.rtt || 0, connectedAt: Date.now() };
                    peers.set(peer.id, peer);
                    emit('connect', Object.assign({}, peer));
                    if (roomState && roomState.joining) sendEnvelope(peer.id, envelope('room:join', { id: roomState.id }), 'reliable');
                } else if (event.type === 'disconnect') {
                    const peer = peers.get(event.peerId);
                    peers.delete(event.peerId);
                    if (roomState) roomState.peers = roomState.peers.filter((id) => id !== event.peerId);
                    emit('disconnect', peer ? Object.assign({}, peer) : { id: event.peerId });
                } else if (event.type === 'receive') processMessage(event);
            }
        } catch (e) { ctx.log('$.net: ENet poll: ' + e); }
        const now = Date.now();
        for (let i = 0; i < delayed.length;) {
            if (delayed[i].due > now) { i++; continue; }
            const item = delayed.splice(i, 1)[0];
            nativeSend(item.peerId, item.message, item.delivery);
        }
        syncElapsed += Math.max(0, Number(dt) || 0) * 1000;
        if (syncElapsed >= syncInterval) {
            syncElapsed %= syncInterval;
            work += sendEntitySnapshot();
        }
        applyInterpolated(now);
        return work;
    }

    const room = {
        create(name, options) {
            const o = options || {};
            if (o.port !== undefined && !api.host(o.port, o)) return false;
            const roomId = String(o.id || name || ('room-' + localPeer));
            roomState = { id: roomId, name: String(name || roomId), peers: [], joining: false };
            emit('room:create', Object.assign({}, roomState));
            return Object.assign({}, roomState);
        },
        join(address, port, name, options) {
            const o = options || {};
            roomState = { id: String(o.id || name || 'default'), name: String(name || ''), peers: [], joining: true };
            if (!api.connect(address, port, o)) { roomState = null; return false; }
            emit('room:connecting', Object.assign({}, roomState));
            return true;
        },
        leave() {
            if (!roomState) return false;
            if (active) sendEnvelope(0, envelope('room:leave', { id: roomState.id }), 'reliable');
            const previous = roomState;
            roomState = null;
            emit('room:exit', previous);
            return true;
        },
        current() { return roomState ? Object.assign({}, roomState, { peers: roomState.peers.slice() }) : null; },
        peers() { return roomState ? roomState.peers.slice() : []; },
    };

    const relay = {
        enable(options) {
            topology = 'relay';
            if (options && options.listen !== undefined) {
                authority = 'host';
                const started = api.listen(options.listen, options);
                relayEnabled = !!started;
                if (started) emit('relay:start', api.status());
                return started;
            }
            relayEnabled = true;
            emit('relay:start', api.status());
            return true;
        },
        disable() { relayEnabled = false; emit('relay:stop'); return api; },
        enabled() { return relayEnabled; },
        forward(type, data, except) { return fanout(String(type), data, Number(except) || 0, 'reliable'); },
        broadcast(type, data) { return fanout(String(type), data, 0, 'reliable'); },
    };

    const api = {
        topology(value) {
            if (value === undefined) return topology;
            const key = String(value);
            if (!TOPOLOGIES.includes(key)) throw new TypeError('$.net.topology: ' + TOPOLOGIES.join(', '));
            topology = key;
            return api;
        },
        authority(value) {
            if (value === undefined) return authority;
            authority = String(value);
            return api;
        },
        isAuthority() { return authority === 'host' || authority === 'local'; },
        online() { return active; },
        available() { return !!nativeStatus().available; },
        status() { return Object.assign({}, nativeStatus(), { active, listening, topology, authority, room: room.current() }); },
        port() { return localPort || Number(nativeStatus().port) || 0; },
        peers() { return [...peers.values()].map((peer) => Object.assign({}, peer)); },
        peer(id) { const peer = peers.get(Number(id)); return peer ? Object.assign({}, peer) : null; },
        playerCount() { return peers.size + 1; },
        tick() { return tickNumber; },
        room,
        relay,

        host(port, options) {
            const o = options || {};
            topology = String(o.topology || 'authoritative');
            authority = 'host';
            relayEnabled = topology === 'relay';
            if (!open(port, o.maxPeers)) return false;
            listening = true;
            localPort = Number(port) || 0;
            emit('start', { topology, authority, port: localPort });
            return true;
        },
        start(options) {
            const o = options || {};
            const nextTopology = String(o.topology || 'authoritative');
            if (!TOPOLOGIES.includes(nextTopology)) throw new TypeError('$.net.start: неизвестная topology ' + nextTopology);
            topology = nextTopology;
            authority = String(o.authority || (topology === 'authoritative' && o.listen !== undefined ? 'host' : 'local'));
            relayEnabled = topology === 'relay';
            const listenPort = Math.max(0, Math.floor(Number(o.listen) || 0));
            if (!open(listenPort, o.maxPeers)) return false;
            listening = listenPort > 0;
            localPort = listenPort;
            for (const endpoint of (Array.isArray(o.connect) ? o.connect : [])) {
                if (!endpoint || !api.connect(endpoint.host || endpoint.address, endpoint.port, { topology, authority })) return false;
            }
            emit('start', { topology, authority, port: localPort, peers: peers.size });
            return true;
        },
        listen(port, options) {
            const o = options || {};
            if (!open(port, o.maxPeers)) return false;
            listening = true;
            localPort = Number(port) || 0;
            if (o.topology) api.topology(o.topology);
            emit('listen', { port: localPort, topology });
            return true;
        },
        connect(address, port, options) {
            const o = options || {};
            if (o.topology) api.topology(o.topology);
            if (!open(0, o.maxPeers)) return false;
            if (!engine || typeof engine.netConnect !== 'function' || !engine.netConnect(String(address || '127.0.0.1'), Number(port) || 0)) {
                const status = nativeStatus();
                emit('error', status.error || 'Не удалось начать подключение');
                return false;
            }
            if (o.authority) authority = String(o.authority);
            else if (topology === 'authoritative') authority = 'client';
            emit('connecting', { address: String(address || '127.0.0.1'), port: Number(port) || 0, topology });
            return true;
        },
        join(address, port, options) {
            const o = Object.assign({ topology: 'authoritative', authority: 'client' }, options || {});
            return api.connect(address, port, o);
        },
        disconnect(peerId) { return !!(engine && engine.netDisconnect && engine.netDisconnect(Number(peerId) || 0)); },
        leave() {
            if (!active) return false;
            if (roomState) room.leave();
            if (engine && typeof engine.netClose === 'function') engine.netClose();
            active = false; listening = false; localPort = 0; relayEnabled = false;
            peers.clear(); samples.clear(); delayed.length = 0;
            emit('stop');
            return true;
        },
        send(type, data, options) {
            const o = options || {};
            const peerId = Number(o.peer || o.peerId) || 0;
            return sendEnvelope(peerId, envelope(type, data, peerId), o.delivery || 'reliable');
        },
        broadcast(type, data, options) {
            const o = options || {};
            const message = envelope(type, data, 0);
            let sent = 0;
            for (const peerId of peers.keys()) if (sendEnvelope(peerId, message, o.delivery || 'reliable')) sent++;
            return sent;
        },
        rpc(name, data, options) { return api.send('rpc', { name: String(name), data }, options); },
        handle(name, fn) {
            if (typeof fn === 'function') rpcHandlers.set(String(name), fn);
            return api;
        },
        unhandle(name) { rpcHandlers.delete(String(name)); return api; },
        input(data, options) {
            stats.inputs++;
            const payload = Object.assign({ seq: ++messageSequence, tick: tickNumber }, data && typeof data === 'object' ? data : { value: data });
            return api.send('input', payload, Object.assign({ delivery: 'input' }, options || {}));
        },
        predict(step) {
            prediction = createPrediction(step);
            return prediction;
        },
        prediction() { return prediction; },
        applyInput(input, applyLocal) {
            if (!prediction) prediction = createPrediction();
            const payload = Object.assign({ seq: ++messageSequence, tick: tickNumber }, input && typeof input === 'object' ? input : { value: input });
            const state = prediction.apply(payload);
            if (typeof applyLocal === 'function') applyLocal(state, input);
            api.send('input', payload, { delivery: 'input' });
            return state;
        },
        acknowledge(state, sequence) {
            if (!prediction) return null;
            return prediction.acknowledge(state, sequence);
        },
        simulate(options) {
            const o = options || {};
            simulation = {
                loss: Math.max(0, Math.min(100, Number(o.loss) || 0)),
                delay: Math.max(0, Number(o.delay) || 0),
                jitter: Math.max(0, Number(o.jitter) || 0),
                seed: Math.floor(Number(o.seed) || 1),
            };
            randomState = simulation.seed >>> 0 || 1;
            return Object.assign({}, simulation);
        },
        simulation() { return Object.assign({}, simulation); },
        delayed() { return delayed.length; },
        syncRate(hz) {
            if (hz === undefined) return 1000 / syncInterval;
            const rate = Math.max(1, Math.min(120, Number(hz) || 20));
            syncInterval = 1000 / rate;
            return api;
        },
        interpolationDelay(ms) {
            if (ms === undefined) return interpolationDelay;
            interpolationDelay = Math.max(0, Math.min(1000, Number(ms) || 0));
            return api;
        },
        replicate(what, options) { return register(what, options); },
        unreplicate(what) {
            const collection = selected(what);
            if (collection && collection.eachNode) collection.eachNode((_, node) => entities.delete(String(node.netId || node.nid || node.id || ('u' + node.uid))));
            return api;
        },
        entities() { return [...entities.keys()]; },
        stats() { return Object.assign({}, stats, { peers: peers.size, delayed: delayed.length, rtt: peers.size ? Math.round([...peers.values()].reduce((sum, p) => sum + (p.rtt || 0), 0) / peers.size) : 0 }); },
        on(name, fn) {
            if (typeof fn !== 'function') return api;
            const key = String(name); if (!listeners.has(key)) listeners.set(key, []);
            listeners.get(key).push(fn); return api;
        },
        off(name, fn) {
            const key = String(name), list = listeners.get(key);
            if (!list) return api;
            if (!fn) listeners.delete(key);
            else { const index = list.indexOf(fn); if (index >= 0) list.splice(index, 1); }
            return api;
        },
        reset() {
            if (active && engine && engine.netClose) engine.netClose();
            active = false; listening = false; localPort = 0; authority = 'host'; topology = 'authoritative';
            peers.clear(); entities.clear(); samples.clear(); delayed.length = 0; rpcHandlers.clear();
            listeners.clear(); roomState = null; relayEnabled = false; syncElapsed = 0; tickNumber = 0;
            messageSequence = 0; prediction = null;
            for (const key of Object.keys(stats)) stats[key] = 0;
            return api;
        },
        describe() {
            return topology + (localPort ? ' :' + localPort : '') + ' — ' + peers.size + ' peer(s), ' + entities.size + ' synced entities';
        },
    };

    def('net', function (options) {
        this.eachNode((_, node) => registerNode(node, options));
        return this;
    });

    ctx.net = api;
    ctx._netStep = step;
    $.net = api;
    return api;
}
