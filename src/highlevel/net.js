// ===========================================================================
// Сеть — $.net (только авторитарная модель)
//
// Решение проекта: в высокоуровневом API `$` есть ТОЛЬКО авторитарный
// мультиплеер. Один узел — хост-сервер, его симуляция всегда права; клиенты не
// вычисляют игровое состояние, а присылают ввод и рисуют то, что подтвердил
// сервер. Peer-to-peer, детерминированный лок-степ и «у каждого своя правда» в
// API не выставляются: там, где выбор есть, побеждает состояние сервера.
//
//   $.net.host(7777, { maxPlayers: 8 });     // сервер: авторитет
//   $.net.join('127.0.0.1', 7777);           // клиент: только ввод и рендер
//   $.net.on('join',  p => spawnPlayer(p));
//   $.net.send('input', { seq, left, right });      // клиент → сервер
//   $.net.on('input', (p, d) => applyInput(p, d));  // только на сервере
//   $.net.replicate('#hero', { owner: p });          // сервер объявляет
//   $.net.on('snapshot', s => $.net.apply(s));       // клиент применяет правду
//
// Что здесь есть СЕЙЧАС: вся модель, кроме транспорта — идентификаторы, стол
// владельцев, снапшоты с дельтой, ввод по номеру, инвариант «клиент не пишет
// авторитетное». Транспорт подключается снаружи (см. `$.net.attach`) — движок
// даёт каркас, а сокеты ставит игра или следующая версия на SDL3_net.
//
// Почему так: транспорт (сокеты, пересылка, симуляция потерь) не влияет на
// МОДЕЛЬ, а модель — это то, что легко сломать и что нужно проверять тестом.
// Снапшоты и дельту пишем сами: библиотека этого не даёт.
//
// Ядро (installNet и его генераторы) не касается движка напрямую: это числа,
// строки и объекты, поэтому поведение целиком проверяет юнит-тест
// (tests/js/net_test.mjs).
// ===========================================================================

import { ctx } from './core.js';

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
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; ++i) {
        const code = text.charCodeAt(i);
        bytes[i] = code < 256 ? code : 63;   // «?» вместо не-латиницы
    }
    return bytes;
}

/** Байты → сообщение (или null, если разобрать не удалось). */
export function decodeMessage(data) {
    if (!data || data.length === 0) return null;
    let text = '';
    for (let i = 0; i < data.length; ++i) text += String.fromCharCode(data[i]);
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

/** Роли узла в сети. */
export const ROLES = ['offline', 'server', 'client'];

export function installNet($) {
    let role = 'offline';
    let port = 0;
    let host = '';
    let maxPlayers = 8;
    const listeners = new Map();     // событие → [fn]
    const authority = createAuthority();
    const client = createClientState();
    let transport = null;            // ставят снаружи через attach()
    let bound = null;                 // транспорт движка (SDL3_net), если есть
    let lastChannel = '';             // канал последнего принятого сообщения
    const peerByAddress = new Map();  // адрес пира → номер игрока (сервер)
    let tick = 0;
    let droppedInputs = 0;
    // Задержка: клиент шлёт 'ping' с временем, сервер отвечает 'pong' тем же
    // числом — по разнице и считаем RTT.
    let rtt = 0;
    let sim = { loss: 0, delay: 0, jitter: 0, seed: 1 };
    let pingSeq = 0;
    const pingSent = new Map();   // номер → время отправки
    let pings = 0;
    // Лаг-компенсация: история подтверждённых состояний на сервере.
    let history = null;
    let prediction = null;
    const stats = { sent: 0, received: 0, snapshots: 0, inputs: 0 };

    function emit(name, ...args) {
        const list = listeners.get(String(name));
        if (!list) return 0;
        let count = 0;
        for (const fn of list) {
            try { fn(...args); count++; }
            catch (e) { ctx.reportError ? ctx.reportError(`$.net.on('${name}')`, e) : ctx.log(`$.net: ошибка в '${name}': ${e}`); }
        }
        return count;
    }

    const api = {
        /** Роль узла: `offline` | `server` | `client`. */
        role() { return role; },
        isServer() { return role === 'server'; },
        isClient() { return role === 'client'; },
        online() { return role !== 'offline'; },
        port() { return port; },
        host_() { return host; },
        playerCount() { return authority.playerCount(); },

        /** Сервер: мир считает этот узел. */
        host(newPort, opts) {
            if (role !== 'offline') { ctx.log('$.net.host: узел уже в сети — сначала $.net.leave()'); return false; }
            const o = opts || {};
            port = Math.max(0, Math.floor(Number(newPort) || 0));
            maxPlayers = Math.max(1, Math.floor(Number(o.maxPlayers) || 8));
            role = 'server';
            if (transport && typeof transport.listen === 'function') {
                transport.listen(port, { maxPlayers });
            }
            emit('start', { role, port, maxPlayers });
            return true;
        },

        /** Клиент: только ввод и рендер подтверждённого. */
        join(address, newPort, opts) {
            if (role !== 'offline') { ctx.log('$.net.join: узел уже в сети — сначала $.net.leave()'); return false; }
            const o = opts || {};
            host = String(address || '127.0.0.1');
            port = Math.max(0, Math.floor(Number(newPort) || 0));
            role = 'client';
            const player = o.player === undefined ? 0 : Math.floor(Number(o.player) || 0);
            if (player > 0) authority.addPlayer();
            if (transport && typeof transport.connect === 'function') {
                transport.connect(host, port, { player });
            }
            emit('start', { role, host, port, player });
            return true;
        },

        /** Выйти из сети: роль, снапшоты и ввод забываются. */
        leave() {
            if (role === 'offline') return false;
            if (transport) {
                if (typeof transport.close === 'function') transport.close();
            }
            const was = role;
            role = 'offline';
            port = 0;
            host = '';
            client.reset();
            emit('stop', { role: was });
            return true;
        },

        /**
         * Подключить транспорт: `{ listen(port, opts), connect(host, port, opts),
         * close(), send(bytes), poll() }`. Движок зовёт `poll()` раз в кадр.
         */
        attach(value) {
            transport = value || null;
            bound = null;
            return api;
        },
        transport() { return transport; },

        /**
         * Транспорт ДВИЖКА на SDL3_net, если он собран (R2D_ENABLE_NET).
         *
         * Работает бинарными пакетами: $.net сериализует сообщение в байты
         * (JSON), движок возит их датаграммами. Возвращает false, если сети в
         * сборке нет — тогда игра ставит свой транспорт через `attach`.
         */
        bindEngine() {
            if (typeof engine === 'undefined' || !engine
                || typeof engine.netStatus !== 'function') {
                return false;
            }
            const status = engine.netStatus();
            if (!status || !status.available) return false;
            bound = {
                engine: true,
                listen(port) { return !!engine.netHost(port); },
                connect(host, port) { return !!engine.netJoin(host, port); },
                send(message) {
                    return !!engine.netSend(encodeMessage(message), '', 0);
                },
                poll() {
                    const raw = engine.netPoll() || [];
                    const out = [];
                    for (const packet of raw) {
                        const decoded = decodeMessage(packet.data);
                        if (!decoded) continue;
                        // Адрес отправителя нужен серверу, чтобы связать пира с
                        // игроком: клиент не должен называть себя сам.
                        decoded.from = packet.from;
                        decoded.fromPort = packet.fromPort;
                        out.push(decoded);
                    }
                    return out;
                },
                close() { engine.netClose(); },
                status() { return engine.netStatus(); },
                simulate(loss, delay, seed) {
                    if (typeof engine.netSimulate === 'function') {
                        engine.netSimulate(loss, delay, seed);
                    }
                },
            };
            transport = bound;
            return true;
        },

        /** Подключён ли транспорт движка (а не свой через attach). */
        engineBound() { return !!(bound && transport === bound); },

        /** Опрос транспорта: движок зовёт раз в кадр. */
        poll() {
            if (!transport || typeof transport.poll !== 'function') return 0;
            let count = 0;
            try {
                const messages = transport.poll();
                for (const message of messages || []) {
                    api.receive(message);
                    count++;
                }
            } catch (e) {
                ctx.log(`$.net.poll: транспорт упал: ${e}`);
            }
            return count;
        },

        /** Сколько кадров сети прошло (номер тика). */
        tick() { return tick; },

        // --- Задержка (RTT) ---

        /**
         * Отправить «пинг». Сервер отвечает тем же числом, и по разнице
         * считается RTT. Игра зовёт раз в секунду-две, не каждый кадр.
         */
        ping(now) {
            if (role !== 'client') return 0;
            const seq = ++pingSeq;
            pingSent.set(seq, Number(now) || 0);
            api.send('ping', { seq, at: Number(now) || 0 });
            pings++;
            return seq;
        },

        /** Круговая задержка в МИЛЛИСЕКУНДАХ (0 — ещё не измерена). */
        rtt() { return rtt; },
        /** Половина задержки в секундах: столько клиент ждал подтверждения. */
        latency() { return rtt / 2000; },
        /** Сколько пингов отправлено. */
        pings() { return pings; },

        /**
         * Симуляция плохой сети — для тестов и отладки: `$.net.simulate({
         * loss: 10, delay: 150, jitter: 30, seed: 7 })`.
         *
         * Задержка делается ОЧЕРЕДЬЮ отложенных отправок, а не сном: спать в
         * кадре нельзя. Пакет уходит из `poll()`, когда придёт его время.
         *
         * `loss` — процент потерь (`0..100`), `delay` — миллисекунды,
         * `jitter` — случайная добавка `[0, jitter)`, `seed` — для
         * воспроизводимости. Всё нулевое выключает симуляцию.
         */
        simulate(opts) {
            const o = opts || {};
            const pick = (v, fallback) => {
                const n = Number(v);
                return Number.isFinite(n) ? n : fallback;
            };
            const loss = pick(o.loss, 0);
            const delay = pick(o.delay, 0);
            const jitter = pick(o.jitter, 0);
            const seed = pick(o.seed, 1);
            if (transport && typeof transport.simulate === 'function') {
                transport.simulate(loss, delay, seed, jitter);
            }
            sim = { loss, delay, jitter, seed };
            return sim;
        },

        /** Настроенная симуляция сети (или нули). */
        simulation() { return { ...sim }; },

        /** Сколько пакетов ждёт своей задержки — видно, что она РАБОТАЕТ. */
        delayed() {
            if (typeof engine === 'undefined' || !engine
                || typeof engine.netDelayed !== 'function') return 0;
            return engine.netDelayed();
        },

        /** Выключить симуляцию. */
        simulateOff() { return api.simulate({ loss: 0, delay: 0, jitter: 0 }); },

        // --- Лаг-компенсация (только сервер) ---

        /**
         * История подтверждённых состояний: сервер зовёт её в своём кадре.
         * `$.net.record(now)` — запомнить текущее подтверждённое состояние.
         */
        record(now) {
            if (role !== 'server') return 0;
            if (!history) history = createHistory(120, 1);
            const entities = {};
            for (const id of authority.ids.ids()) {
                const node = authority.ids.nodeOf(id);
                if (!node) continue;
                const entry = { owner: authority.ownerOf(node) };
                if (typeof node.pos === 'function') {
                    try { const p = node.pos(); entry.x = p.x; entry.y = p.y; } catch (e) { /* без позиции */ }
                }
                entities[authority.ids.key(id)] = entry;
            }
            history.push(Number(now) || 0, entities);
            return history.size();
        },

        /**
         * Где был узел на момент «сейчас минус задержка» — по этому состоянию
         * сервер проверяет попадание, а не по текущему.
         */
        rewind(what, now, delay) {
            if (role !== 'server' || !history) return null;
            const node = nodeOf(what);
            if (!node) return null;
            const key = authority.ids.key(authority.ids.idOf(node));
            const d = delay === undefined ? api.latency() : Number(delay) || 0;
            return history.rewind(Number(now) || 0, d, key);
        },

        /** История (или null): размер и окно — для интерфейса и тестов. */
        history() {
            if (!history) return null;
            return { size: history.size(), range: history.range() };
        },

        // --- Предсказание клиента ---

        /**
         * Включить предсказание: `$.net.predict(simulate)`.
         * `simulate(state, input)` — чистая функция шага (та же, что на сервере).
         */
        predict(simulate) {
            prediction = createPrediction(simulate);
            return prediction;
        },
        /** Предсказание (или null). */
        prediction() { return prediction; },

        /**
         * Применить свой ввод немедленно: клиент зовёт перед отправкой.
         * Возвращает предсказанное состояние (или null, если не включено).
         */
        applyInput(input) {
            if (!prediction) return null;
            return prediction.apply(input);
        },
        /** Канал последнего принятого сообщения (диагностика). */
        lastChannel() { return lastChannel; },
        /** Адреса пиров, уже привязанные к игрокам (диагностика сервера). */
        peers() { return [...peerByAddress.keys()]; },
        /** Счётчики для интерфейса: отправлено, получено, снапшотов, вводов. */
        stats() { return Object.assign({}, stats, { dropped: droppedInputs }); },

        // --- События ---

        on(name, fn) {
            if (typeof fn !== 'function') return api;
            const key = String(name);
            if (!listeners.has(key)) listeners.set(key, []);
            listeners.get(key).push(fn);
            return api;
        },
        off(name, fn) {
            const list = listeners.get(String(name));
            if (list && fn) {
                const at = list.indexOf(fn);
                if (at >= 0) list.splice(at, 1);
            } else if (!fn) {
                listeners.delete(String(name));
            }
            return api;
        },
        emit,

        // --- Игроки и владение ---

        /** Сервер: новый игрок (обычно из события транспорта). */
        addPlayer() {
            if (role !== 'server') return 0;
            if (authority.playerCount() >= maxPlayers) return 0;
            const player = authority.addPlayer(() => { droppedInputs++; });
            emit('join', player);
            return player;
        },
        /** Сервер: игрок ушёл. */
        removePlayer(player) {
            if (role !== 'server') return false;
            const p = Math.floor(Number(player) || 0);
            if (!authority.inputOf(p)) return false;
            authority.removePlayer(p);
            for (const [address, known] of [...peerByAddress]) {
                if (known === p) peerByAddress.delete(address);
            }
            emit('leave', p);
            return true;
        },

        /** Сервер: объявить узел реплицируемым. */
        replicate(what, opts) {
            const node = nodeOf(what);
            if (!node) { ctx.log('$.net.replicate: узел не найден'); return 0; }
            if (role !== 'server') { ctx.log('$.net.replicate: только сервер объявляет репликацию'); return 0; }
            return authority.replicate(node, opts);
        },
        /** Сервер: узел больше не реплицируется. */
        unreplicate(what) {
            const node = nodeOf(what);
            if (!node) return 0;
            return authority.unreplicate(node);
        },
        /** Чей узел: номер игрока или 0. */
        ownerOf(what) { const node = nodeOf(what); return node ? authority.ownerOf(node) : 0; },
        /** Может ли игрок управлять узлом. */
        owns(player, what) { const node = nodeOf(what); return node ? authority.owns(player, node) : false; },
        /** Узлы игрока. */
        ownedBy(player) { return authority.ownedBy(player); },
        /** Сетевой id узла (0 — нет). */
        idOf(what) { const node = nodeOf(what); return node ? authority.ids.idOf(node) : 0; },
        /** Узел по сетевому id. */
        nodeOfId(id) { return authority.ids.nodeOf(id); },

        /**
         * Ввод: клиент отправляет, сервер принимает.
         * `$.net.send('input', { seq, left, right })`.
         */
        send(channel, data) {
            const name = String(channel);
            stats.sent++;
            // Отправлять может И СЕРВЕР: именно он рассылает снапшоты и
            // события. Раньше здесь стояло `role === 'client'`, и серверный
            // ответ не уходил в транспорт вовсе — обратного пути не было.
            if (transport && typeof transport.send === 'function' && role !== 'offline') {
                const ok = transport.send({ channel: name, data });
                stats.lastSendOk = !!ok;
            }
            if (name === 'input') {
                stats.inputs++;
                // Локально применяем только своё: сервер — источник истины.
                const queue = authority.inputOf(1);
                if (queue && data && data.seq !== undefined) queue.push(data);
            }
            return api;
        },

        /** Пришло сообщение из транспорта. */
        receive(message) {
            if (!message || typeof message !== 'object') return false;
            const channel = String(message.channel || '');
            lastChannel = channel;   // диагностика: видно, что дошло
            stats.received++;
            if (channel === 'snapshot') {
                stats.snapshots++;
                client.apply(message.data);
                // Подтверждение предсказания: сервер присылает номер последнего
                // обработанного ввода, и клиент откатывается к его состоянию.
                if (prediction && message.data) {
                    const entities = message.data.entities || {};
                    let ack = 0;
                    let own = null;
                    for (const key of Object.keys(entities)) {
                        const entry = entities[key];
                        if (!entry || typeof entry.seq !== 'number') continue;
                        if (entry.seq >= ack) { ack = entry.seq; own = entry; }
                    }
                    if (own) prediction.acknowledge(own, ack);
                }
                emit('snapshot', message.data);
                return true;
            }
            if (channel === 'input') {
                // Ввод применяет ТОЛЬКО сервер, и только к своему игроку.
                if (role !== 'server') return false;
                // Игрок определяется АДРЕСОМ пира, а не тем, что он о себе
                // написал: клиент не может назваться чужим номером. Первый
                // пакет с нового адреса заводит игрока.
                let player = Math.floor(Number(message.player) || 0);
                if (player > 0 && authority.inputOf(player)) {
                    // Номер назван и он есть в столе — принимаем.
                } else {
                    const address = String(message.from || '');
                    player = peerByAddress.get(address) || 0;
                    if (!player) {
                        if (authority.playerCount() >= maxPlayers) return false;
                        player = authority.addPlayer();
                        peerByAddress.set(address, player);
                        emit('join', player);
                    }
                }
                const queue = authority.inputOf(player);
                if (!queue) return false;
                queue.push(message.data);
                emit('input', player, message.data);
                return true;
            }
            if (channel === 'ping') {
                // Сервер отвечает тем же числом: по разнице клиент считает RTT.
                if (role !== 'server') return false;
                api.send('pong', message.data);
                return true;
            }
            if (channel === 'pong') {
                if (role !== 'client') return false;
                const data = message.data || {};
                const at = pingSent.get(Math.floor(Number(data.seq) || 0));
                if (at !== undefined) {
                    pingSent.delete(Math.floor(Number(data.seq) || 0));
                    rtt = Math.max(0, (Number(data.at) || 0) - at);
                }
                emit('pong', data);
                return true;
            }
            if (channel === 'join' && role === 'server') {
                const player = api.addPlayer();
                emit('join', player);
                return true;
            }
            emit(channel, message);
            return true;
        },

        /** Сервер: собрать снапшот из описанных узлов. */
        snapshotNow() {
            tick++;
            const entities = {};
            for (const id of authority.ids.ids()) {
                const node = authority.ids.nodeOf(id);
                if (!node) continue;
                const entry = { owner: authority.ownerOf(node) };
                if (typeof node.pos === 'function') {
                    try { const p = node.pos(); entry.x = p.x; entry.y = p.y; } catch (e) { /* без позиции */ }
                }
                if (typeof node.get === 'function') {
                    const hp = node.get('hp');
                    if (hp !== undefined) entry.hp = hp;
                }
                entities[authority.ids.key(id)] = entry;
            }
            return { tick, entities };
        },

        /** Сервер: снапшот с дельтой от предыдущего подтверждённого. */
        deltaFrom(base) { return diffSnapshot(base, api.snapshotNow(), tick); },

        /** Клиент: применить снапшот (то же, что `receive`). */
        apply(snapshot) {
            client.apply(snapshot);
            emit('applied', snapshot);
            return api;
        },

        /** Клиент: подтверждённое состояние. */
        confirmed() { return client.confirmed(); },
        previous() { return client.previous(); },
        /** Клиент: значение из подтверждённого. */
        get(key, field) { return client.get(key, field); },
        /** Клиент: интерполированное (чужое) или подтверждённое (своё). */
        polated(key, own, t) { return client.polated(key, own, t); },
        /** Клиент: следующий номер ввода. */
        nextInput() { return client.nextInput(); },

        /** Строка состояния для отладки. */
        describe() {
            const lag = rtt > 0 ? `, RTT ${rtt.toFixed(0)} мс` : '';
            return `${role}${port ? ` :${port}` : ''} — ${authority.describe()}, `
                 + `снапшотов ${stats.snapshots}, вводов ${stats.inputs}${lag}`;
        },

        /** Сброс всей сети (новый мир, тесты). */
        reset() {
            role = 'offline';
            port = 0;
            host = '';
            listeners.clear();
            client.reset();
            authority.reset();
            peerByAddress.clear();
            stats.sent = 0; stats.received = 0; stats.snapshots = 0; stats.inputs = 0;
            rtt = 0; pingSeq = 0; pings = 0; pingSent.clear();
            history = null;
            if (prediction) prediction.reset();
            droppedInputs = 0;
            tick = 0;
            return api;
        },

        /** Чистые ядра — для тестов и своей реализации транспорта. */
        encodeMessage,
        decodeMessage,
        createIdTable,
        createAuthority,
        createClientState,
        createInputQueue,
        createHistory,
        createPrediction,
        diffSnapshot,
        applySnapshot,
        interpolate,
        sameValue,
    };

    ctx.net = api;
    $.net = api;
    return api;
}

/** Узел по обёртке, узлу или селектору. */
function nodeOf(what) {
    if (!what) return null;
    if (typeof what === 'string') {
        const byId = ctx.byId;
        return byId && byId.get ? (byId.get(String(what).replace(/^#/, '')) || null) : null;
    }
    if (what.nodes) return what.nodes[0] || null;
    return what.tag ? what : null;
}
