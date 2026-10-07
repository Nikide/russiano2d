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
            return `${role}${port ? ` :${port}` : ''} — ${authority.describe()}, `
                 + `снапшотов ${stats.snapshots}, вводов ${stats.inputs}`;
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
