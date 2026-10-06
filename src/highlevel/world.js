// ===========================================================================
// Мир: $.world — гравитация, границы, спавн, поиск, лучи, порядок отрисовки.
//
// Мир владеет реестром узлов (ctx.nodes) и синхронизацией с физикой: раз в
// кадр позиции тел из C перекладываются в узлы, а удалённые тела убираются.
// ===========================================================================

import { ctx, Node, wrap, wrapOne, query, TAGS, packColor, resolveSprite, nodeBounds,
         nodesWithFacet } from './core.js';

const state = {
    gravity: { x: 0, y: 2000 },
    bounds: null,          // { x, y, w, h }
    bounds_solid: false,
    time_scale: 1,
    paused: false,
    background: null,      // { sprite, parallax, scale }
    by_body: new Map(),    // id тела → узел
    sort_mode: 'layer',
    sort_fn: null,
    world_paused: false,
};

export function bodyNode(id) { return ctx.byBody.get(id) || null; }

export function installWorld($) {
    const world = {
        // --- Физика мира ---------------------------------------------------
        gravity(x, y) {
            if (x === undefined) return { ...state.gravity };
            state.gravity = { x, y };
            engine.setGravity(x, y);
            return world;
        },

        bounds(x, y, w, h, opts) {
            state.bounds = { x, y, w, h };
            const solid = !opts || opts.solid !== false;
            state.bounds_solid = solid;
            if (solid) {
                // Стены — обычные статические узлы, поэтому их видно в
                // $.world.count() и их можно найти селектором .world-bound.
                const t = (opts && opts.thickness) || 64;
                const made = [
                    { x: x + w / 2, y: y - t / 2, w: w + t * 2, h: t },
                    { x: x + w / 2, y: y + h + t / 2, w: w + t * 2, h: t },
                    { x: x - t / 2, y: y + h / 2, w: t, h: h },
                    { x: x + w + t / 2, y: y + h / 2, w: t, h: h },
                ];
                for (const b of made) {
                    const node = new Node('wall', {
                        x: b.x, y: b.y, w: b.w, h: b.h, body: 'static', visible: false,
                    });
                    node.addClass('world-bound');
                    node.syncBody();
                }
            }
            return world;
        },

        /** Убрать стены, поставленные bounds() — удобно при смене уровня. */
        clearBounds() {
            for (const node of ctx.nodes.slice()) {
                if (node.classes.has('world-bound')) node.destroy();
            }
            state.bounds = null;
            return world;
        },

        // --- Картинка мира -------------------------------------------------
        color(value) {
            const packed = packColor(value);
            engine.setClearColor(
                (packed & 0xff) / 255,
                ((packed >> 8) & 0xff) / 255,
                ((packed >> 16) & 0xff) / 255,
                ((packed >>> 24) & 0xff) / 255,
            );
            return world;
        },

        /** Фон-картинка. parallax: 0 — приклеен к камере, 1 — как обычный слой. */
        background(path, opts) {
            const o = opts || {};
            state.background = {
                sprite: resolveSprite(path),
                parallax: o.parallax === undefined ? 0 : o.parallax,
                scale: o.scale === undefined ? 1 : o.scale,
                y: o.y === undefined ? 0 : o.y,
                color: packColor(o.color),
            };
            return world;
        },

        clearBackground() { state.background = null; return world; },
        getBackground() { return state.background; },

        // --- Гравитация мира -------------------------------------------------
        // pause() — это «мир без гравитации» (для космоса, аркад сверху), а НЕ
        // пауза игры: тела сохраняют скорость и продолжают лететь. Пауза игры
        // живёт в $.time.pause(). Так как выключенная гравитация — состояние
        // глобальное, при смене сцены мир её возвращает (см. clearWorld).
        pause() { state.paused = true; engine.setGravity(0, 0); return world; },
        resume() { state.paused = false; engine.setGravity(state.gravity.x, state.gravity.y); return world; },
        isPaused() { return state.paused; },
        /** Полная остановка всех тел мира, не трогая гравитацию. */
        freeze() {
            for (const node of ctx.nodes) {
                if (node.body >= 0) {
                    engine.setVelocity(node.body, 0, 0);
                    engine.setAngularVelocity(node.body, 0);
                    engine.setAwake(node.body, false);
                }
            }
            return world;
        },
        thaw() {
            for (const node of ctx.nodes) if (node.body >= 0) engine.setAwake(node.body, true);
            return world;
        },

        timeScale(k) { state.time_scale = k; return world; },
        getTimeScale() { return state.time_scale; },

        // --- Узлы -----------------------------------------------------------
        /** spawn('<player>', x, y) или spawn('enemy', x, y). */
        spawn(tag, x, y, attrs) {
            const name = String(tag).replace(/^<|>$/g, '');
            if (!TAGS[name]) ctx.log(`$: неизвестный тег <${name}>`);
            const node = new Node(name, Object.assign({}, attrs, { x, y }));
            return wrapOne(node);
        },

        /** Все узлы (копия). */
        all() { return wrap(ctx.nodes); },

        /**
         * Сколько узлов в мире. Служебные стены bounds() и узлы интерфейса не
         * считаются: агент и игра ожидают здесь число игровых объектов.
         */
        count(sel) {
            if (sel) return query(sel).length;
            return ctx.nodes.filter((n) => !n.attrs.ui && !n.classes.has('world-bound')).length;
        },

        /** Узлы, чьи границы накрывают точку; r — радиус вокруг точки. */
        query(x, y, r) {
            const rr = r || 0;
            const out = [];
            for (const node of ctx.nodes) {
                if (node.attrs.ui) continue;
                const b = nodeBounds(node);
                if (rr > 0) {
                    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
                    const dx = Math.max(b.x0 - x, 0, x - b.x1);
                    const dy = Math.max(b.y0 - y, 0, y - b.y1);
                    if (dx * dx + dy * dy <= rr * rr) out.push(node);
                } else if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) {
                    out.push(node);
                }
            }
            return wrap(out);
        },

        /**
         * Ближайшее физическое препятствие на отрезке.
         *
         * opts.ignore — узел, селектор или обёртка, которые луч не считает
         * препятствием. Раньше при первом попадании в игнорируемое тело луч
         * возвращал null (будто за ним ничего нет); список уходит в движок, и
         * луч ищет следующее настоящее препятствие.
         */
        raycast(from, to, opts) {
            const a = toPoint(from);
            const b = toPoint(to);
            const ignore = (opts && opts.ignore)
                ? query(opts.ignore).map((n) => n.body).filter((id) => id >= 0)
                : [];
            return describeRaycast(engine.raycast(a.x, a.y, b.x, b.y, ignore), a);
        },

        /** Все узлы, которые пересекает отрезок (по их прямоугольникам). */
        raycastAll(from, to, opts) {
            const a = toPoint(from);
            const b = toPoint(to);
            const out = [];
            const dx = b.x - a.x, dy = b.y - a.y;
            for (const node of ctx.nodes) {
                if (node.attrs.ui) continue;
                if (node.body_kind === null && !opts?.all) continue;
                const box = nodeBounds(node);
                const t = rayBox(a.x, a.y, dx, dy, box);
                if (t !== null) out.push({ node, t, point: { x: a.x + dx * t, y: a.y + dy * t }, self: wrapOne(node) });
            }
            out.sort((p, q) => p.t - q.t);
            return out;
        },

        /** Свободен ли отрезок (нет статических препятствий на пути). */
        lineOfSight(from, to, opts) {
            const hit = world.raycast(from, to, Object.assign({ all: true }, opts));
            return hit === null;
        },

        /** Кто под точкой в мире (по физике). */
        bodyAt(x, y) {
            const ids = engine.queryPoint(x, y);
            const out = [];
            for (let i = 0; i < ids.length; i++) {
                const node = ctx.byBody.get(ids[i]);
                if (node) out.push(node);
            }
            return wrap(out);
        },

        /** Все тела в прямоугольнике. */
        bodiesIn(x, y, w, h) {
            const ids = engine.queryBox(x, y, w, h);
            const out = [];
            for (let i = 0; i < ids.length; i++) {
                const node = ctx.byBody.get(ids[i]);
                if (node) out.push(node);
            }
            return wrap(out);
        },

        // --- Контакты и суставы ---------------------------------------------
        /**
         * Сырые события контакта за прошедший шаг: begin/end/hit с нормалью,
         * точкой и скоростью сближения. Узлы получают то же самое событиями
         * 'collide' / 'separate' / 'hit' — этот метод нужен, когда тело не
         * привязано к узлу или когда хочется увидеть всё разом.
         */
        contacts() {
            const list = typeof engine.contacts === 'function' ? engine.contacts() : [];
            return Array.from(list || []);
        },

        /** Сустав между двумя телами — см. метод узла `.joint()`. */
        joint(a, b, opts) {
            const na = typeof a === 'string' ? query(a)[0] : (a instanceof Wrapper ? a.nodes[0] : a);
            const nb = typeof b === 'string' ? query(b)[0] : (b instanceof Wrapper ? b.nodes[0] : b);
            if (!na || !nb || na.body < 0 || nb.body < 0) {
                ctx.log('$.world.joint: нужны два узла с физическими телами');
                return -1;
            }
            const o = opts || {};
            const pa = o.a || [na.x, na.y];
            // Шарнир и сварка крепятся в одну точку; distance — между центрами.
            const pb = o.b || ((o.type === 'distance') ? [nb.x, nb.y] : pa);
            const id = engine.createJoint({
                type: o.type || 'revolute',
                a: na.body, b: nb.body,
                ax: pa[0], ay: pa[1], bx: pb[0], by: pb[1],
                collide: !!o.collide,
                length: o.length || 0,
                limit: !!o.limit, lower: o.lower || 0, upper: o.upper || 0,
                motor: !!o.motor, motorSpeed: o.motorSpeed || 0, maxTorque: o.maxTorque || 0,
            });
            if (id < 0) ctx.log('$: сустав создать не удалось');
            return id;
        },

        destroyJoint(id) {
            if (typeof engine.destroyJoint === 'function') engine.destroyJoint(id);
            return world;
        },

        jointCount() {
            return typeof engine.jointCount === 'function' ? engine.jointCount() : 0;
        },

        jointAlive(id) {
            return typeof engine.jointAlive === 'function' ? engine.jointAlive(id) : false;
        },

        // --- Порядок отрисовки ---------------------------------------------
        /** 'layer' (по умолчанию), 'z' (по depth), 'y' (как в 2.5D). */
        sort(mode) { state.sort_mode = mode; return world; },
        sortWith(fn) { state.sort_fn = fn; return world; },

        // --- Служебное ------------------------------------------------------
        sync(dt) {
            const t = engine.getTransforms();
            // Только узлы с живым телом: срез body держит индекс реестра, и в
            // сцене без физики цикл пуст, хотя раньше проходил весь мир
            // (§5, P2 отчёта).
            const bodies = nodesWithFacet('body');
            for (let i = 0; i < bodies.length; i++) {
                const node = bodies[i];
                if (node.removed) continue;
                if (node.body < 0) continue;   // тело умерло — запись уже мертва
                if (!engine.bodyAlive(node.body)) {
                    node.body = -1;
                    continue;
                }
                node.x = t[node.body * 3];
                node.y = t[node.body * 3 + 1];
                node.angle = t[node.body * 3 + 2];
            }
            worldEvents(dt);
        },

        _state: state,
    };

    ctx.world = world;
    return world;
}

// ---------------------------------------------------------------------------
// Вспомогательное
// ---------------------------------------------------------------------------

/** Результат engine.raycast в форме, которую ждёт $.world.raycast. */
function describeRaycast(hit, origin) {
    if (!hit || !hit.hit) return null;
    const node = ctx.byBody.get(hit.body) || null;
    return {
        hit: true,
        point: { x: hit.x, y: hit.y },
        normal: { x: hit.nx, y: hit.ny },
        distance: Math.hypot(hit.x - origin.x, hit.y - origin.y),
        body: hit.body,
        node,
        self: node ? wrapOne(node) : null,
    };
}

function toPoint(v) {
    if (v === null || v === undefined) return { x: 0, y: 0 };
    if (typeof v === 'string') {
        const node = query(v)[0];
        return node ? { x: node.x, y: node.y } : { x: 0, y: 0 };
    }
    // [x, y] — та же форма, что принимает $.sound.playAt и $.gfx.draw.*.
    // Без неё массив молча превращался в (0,0): луч уходил из угла мира.
    if (Array.isArray(v)) return { x: v[0] || 0, y: v[1] || 0 };
    if (typeof v === 'object' && v.nodes) {
        const node = v.nodes[0];
        return node ? { x: node.x, y: node.y } : { x: 0, y: 0 };
    }
    if (typeof v === 'object' && v.self) return toPoint(v.self);
    if (typeof v === 'object') return { x: v.x || 0, y: v.y || 0 };
    return { x: 0, y: 0 };
}

/** Пересечение луча с прямоугольником. Возвращает t в [0,1] или null. */
function rayBox(ox, oy, dx, dy, box) {
    let tmin = 0, tmax = 1;
    const axes = [
        [ox, dx, box.x0, box.x1],
        [oy, dy, box.y0, box.y1],
    ];
    for (const [o, d, lo, hi] of axes) {
        if (Math.abs(d) < 1e-9) {
            if (o < lo || o > hi) return null;
            continue;
        }
        let t1 = (lo - o) / d;
        let t2 = (hi - o) / d;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) return null;
    }
    return tmin;
}

// --- Автоматические события мира -------------------------------------------
// Мир сам рассылает hit/death/spawn: игра не обязана вешать их вручную.
//
// Прошлые hp/visible хранятся в полях самого узла (`_hp_seen`/`_vis_seen`), а
// не в Map по uid. Числовой ключ в Map в QuickJS стоит ~6,2 мкс, и четыре такие
// операции на узел съедали 20 мс кадра из 38 при 1000 узлах
// (docs/HIGH_LEVEL_API_PERF.md §3.1). Карты прошлых значений и их ленивая чистка
// больше не нужны: данные умирают вместе с узлом.

function worldEvents(dt) {
    void dt;
    const nodes = ctx.nodes;
    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        const was = node._hp_seen;
        if (was === undefined) {
            // Узел впервые попадает в обход: запоминаем состояние без событий.
            node._hp_seen = node.cur_hp;
            node._vis_seen = node.visible;
            continue;
        }
        const now_hp = node.cur_hp;
        if (now_hp < was) {
            node.emit('hit', { damage: was - now_hp, hp: now_hp });
        } else if (now_hp > was) {
            node.emit('heal', { amount: now_hp - was, hp: now_hp });
        }
        if (was > 0 && now_hp <= 0) {
            node.emit('death', { killer: null });
            node.emit('dead', { killer: null });
        }
        if (was <= 0 && now_hp > 0) node.emit('respawn', { hp: now_hp });

        const was_visible = node._vis_seen;
        if (was_visible !== node.visible) {
            node._vis_seen = node.visible;
            node.emit(node.visible ? 'show' : 'hide', {});
        }
        node._hp_seen = now_hp;
    }
}
