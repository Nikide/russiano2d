// ===========================================================================
// ai.js — скриптовые контроллеры движения/поведения для городской сцены.
//
// Не «CivilianAI/PoliceAI» и не ECS-компонент: это НАБОР ПРИМИТИВОВ, поверх
// которого игра пишет своё поведение. Контроллер — объект с явным `update(dt)`;
// глобального менеджера нет.
//
//   import { createAI } from './lib/ai.js';
//   const ai = createAI($, { roadGraph: graph, nav: true, h: 0 });
//   const ped = ai.controller($('<npc>', { id: 'ped1' }).at(120, 80)
//       .size(18, 36).appendTo($.world), { speed: 70 });
//   ped.patrolTo([{ x: 300, y: 80 }, { x: 300, y: 220 }], { loop: true });
//   // в кадре сцены: ped.update(dt);
//
//   const car = ai.controller(carNode, { speed: 160, vehicle: carController });
//   car.driveTo({ x: 900, y: 400 });          // маршрут по roadgraph
//
//   ped.onStimulus((stimulus) => {            // $.on('stimulus', …)
//       if (stimulus.type === 'gunshot') ped.fleeFrom({ x: stimulus.x, y: stimulus.y });
//   });
//   ai.stimulus({ type: 'gunshot', x: 400, y: 300, radius: 600 });
//
// Движение тел — существующие средства: `node.velocity()` (Box2D) или
// `.at()` для узлов без тела; поиск пути — `$.nav.path` (если задан
// `nav:true`/grid/mesh) либо roadgraph.route; никакого NavMesh здесь нет.
// ===========================================================================

const DEFAULT_SPEED = 80;
const DEFAULT_ACCEL = 900;
const DEFAULT_TURN_RATE = 9;       // рад/с
const DEFAULT_ARRIVE = 6;

function isWrapper(value) {
    return !!(value && typeof value === 'object' && Array.isArray(value.nodes) && typeof value.get === 'function');
}

function nodeOf(value) {
    if (!value) return null;
    if (Array.isArray(value)) return nodeOf(value[0]);
    if (isWrapper(value)) return value.nodes[0] || null;
    return value;
}

function pointOf(value, where = 'точка') {
    const node = nodeOf(value);
    if (node && Number.isFinite(Number(node.x)) && Number.isFinite(Number(node.y))) {
        return { x: Number(node.x), y: Number(node.y) };
    }
    if (Array.isArray(value) && value.length >= 2) {
        const x = Number(value[0]), y = Number(value[1]);
        if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
    }
    if (value && typeof value === 'object' && Number.isFinite(Number(value.x)) && Number.isFinite(Number(value.y))) {
        return { x: Number(value.x), y: Number(value.y) };
    }
    throw new TypeError(`ai: ${where} должна быть точкой, узлом или селектором`);
}

function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

function wrapAngle(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
}

/** Сблизить угол a с b не быстрее maxStep (рад). */
function turnToward(a, b, maxStep) {
    const delta = wrapAngle(b - a);
    if (Math.abs(delta) <= maxStep) return b;
    return a + Math.sign(delta) * maxStep;
}

// ---------------------------------------------------------------------------
// Фабрика
// ---------------------------------------------------------------------------

export function createAI($, options = {}) {
    if (typeof $ !== 'function') throw new TypeError('ai: нужен публичный $');
    const aiOpts = options || {};
    let roadGraph = aiOpts.roadGraph || null;
    const navEnabled = aiOpts.nav !== false;
    const grid = aiOpts.grid || null;
    const mesh = aiOpts.mesh || null;
    const world = aiOpts.world || (roadGraph && roadGraph.world) || null;
    const h = aiOpts.h;
    const defaultDetect = aiOpts.zoneDetect || '#player';
    const controllers = [];
    const zones = new Map();
    let disposed = false;

    function ensureAlive() {
        if (disposed) throw new Error('ai: фабрика уже освобождена (dispose) — создайте новую');
    }

    function resolvePoint(target) {
        if (typeof target === 'function') return pointOf(target(), 'цель target()');
        if (typeof target === 'string') {
            const w = $(target);
            const node = nodeOf(w);
            if (!node) return null;
            return { x: Number(node.x) || 0, y: Number(node.y) || 0 };
        }
        const node = nodeOf(target);
        if (node) return { x: Number(node.x) || 0, y: Number(node.y) || 0 };
        return pointOf(target, 'цель');
    }

    // --- контроллер ---------------------------------------------------

    function controller(nodeValue, opts = {}) {
        ensureAlive();
        const node = nodeOf(nodeValue);
        if (!node) throw new TypeError('ai.controller: нужен узел');
        const cfg = {
            speed: Number(opts.speed) > 0 ? Number(opts.speed) : (Number(aiOpts.speed) > 0 ? Number(aiOpts.speed) : DEFAULT_SPEED),
            accel: Number(opts.accel) > 0 ? Number(opts.accel) : (Number(aiOpts.accel) > 0 ? Number(aiOpts.accel) : DEFAULT_ACCEL),
            turnRate: Number(opts.turnRate) > 0 ? Number(opts.turnRate) : DEFAULT_TURN_RATE,
            arrive: Number(opts.arrive) > 0 ? Number(opts.arrive) : DEFAULT_ARRIVE,
            waypoint: Number(opts.waypoint) > 0 ? Number(opts.waypoint) : Math.max(6, cfgArrive(opts)),
            repathInterval: Number(opts.repathInterval) >= 0 ? Number(opts.repathInterval) : 0.5,
            repathTolerance: Number(opts.repathTolerance) >= 0 ? Number(opts.repathTolerance) : 24,
            lookAtMovement: opts.lookAtMovement !== false,
            useNav: opts.useNav === undefined ? (aiEnabledNav()) : !!opts.useNav,
            direct: opts.direct === true,
            vehicle: opts.vehicle || null,
            grid: opts.grid || grid,
            mesh: opts.mesh || mesh,
            maxSpeed: Number(opts.maxSpeed) > 0 ? Number(opts.maxSpeed) : Infinity,
            arriveRadius: Number(opts.arriveRadius) > 0 ? Number(opts.arriveRadius) : null,
            fallbackDirect: opts.fallbackDirect !== false,
        };
        function cfgArrive(o) { return Number(o.arrive) > 0 ? Number(o.arrive) : 6; }
        function aiEnabledNav() { return navEnabled && !!(aiOpts.nav === true || grid || mesh); }

        const handlers = new Map();
        const unsubs = [];
        const c = {
            node,
            mode: 'idle',
            status: 'idle',
            target: null,
            waypoints: [],
            pathIndex: 0,
            route: null,
            wait: 0,
            elapsed: 0,
            repathIn: 0,
            lastTarget: null,
            lastError: null,
            lastBlocked: false,
            lastFacing: null,
            patrol: null,
            stops: 0,
        };

        function emit(name, payload) {
            const list = handlers.get(name);
            if (list) for (const fn of list.slice()) {
                try { fn(payload, c); } catch (e) { /* код игры */ }
            }
            if (opts.emitNodeEvents && typeof node.emit === 'function') {
                try { node.emit('ai:' + name, payload); } catch (e) { /* узел мог умереть */ }
            }
        }

        function currentPoint() {
            return { x: Number(node.x) || 0, y: Number(node.y) || 0 };
        }

        function currentVelocity() {
            if (node.body >= 0) {
                const v = $(node).velocity();
                return { x: Number(v.x) || 0, y: Number(v.y) || 0 };
            }
            const cache = node.velocity_cache;
            return cache ? { x: Number(cache.x) || 0, y: Number(cache.y) || 0 } : { x: 0, y: 0 };
        }

        function applyVelocity(vx, vy, dt) {
            const len = Math.hypot(vx, vy);
            const max = cfg.maxSpeed;
            if (len > max && len > 0) { vx = vx / len * max; vy = vy / len * max; }
            if (node.body >= 0) {
                $(node).velocity(vx, vy);
            } else {
                node.velocity_cache = { x: vx, y: vy };
                const w = $(node);
                w.at((Number(node.x) || 0) + vx * dt, (Number(node.y) || 0) + vy * dt);
            }
        }

        function face(dx, dy, dt, instant = false) {
            if (Math.abs(dx) + Math.abs(dy) < 1e-9) return;
            const want = Math.atan2(dy, dx);
            const now = Number(node.angle) || 0;
            const next = instant ? want : turnToward(now, want, cfg.turnRate * dt);
            c.lastFacing = want;
            if (typeof $(node).angle === 'function') $(node).angle(next);
            else node.angle = next;
        }

        function clearPath() { c.waypoints = []; c.pathIndex = 0; c.route = null; }

        function setArrive(status, payload) {
            c.status = status;
            c.mode = 'idle';
            clearPath();
            applyVelocity(0, 0, 0);
            emit(status, payload || {});
        }

        function addRoutePoints(points) {
            c.waypoints = Array.isArray(points) ? points.map((p) => ({ x: Number(p.x), y: Number(p.y) })) : [];
            c.pathIndex = 0;
            // Первая точка — «отсюда»; если она совпадает с текущей, пропускаем.
            const here = currentPoint();
            while (c.pathIndex < c.waypoints.length && Math.hypot(c.waypoints[c.pathIndex].x - here.x, c.waypoints[c.pathIndex].y - here.y) <= cfg.waypoint * 0.5) {
                c.pathIndex++;
            }
        }

        /** Проложить путь. Возвращает true, если путь есть. */
        function buildPath(from, to) {
            c.lastError = null;
            c.lastBlocked = false;
            if (c.mode === 'drive' && roadGraph) {
                const route = roadGraph.route(from, to, { kind: 'road' });
                if (!route) { c.lastError = 'roadgraph: маршрут не найден'; c.lastBlocked = true; return false; }
                c.route = route;
                addRoutePoints(route.points);
                return true;
            }
            if (!cfg.direct && cfg.useNav) {
                try {
                    let path = null;
                    if (mesh && typeof $.nav.meshPath === 'function') {
                        path = $.nav.meshPath(node, to, { mesh, smooth: true });
                    } else if (typeof $.nav.path === 'function') {
                        path = $.nav.path(node, to, cfg.grid ? { grid: cfg.grid, smooth: true } : { smooth: true });
                    }
                    if (Array.isArray(path) && path.length) { addRoutePoints(path); return true; }
                    c.lastError = 'nav: путь не найден';
                    c.lastBlocked = true;
                } catch (e) {
                    c.lastError = e && e.message ? e.message : String(e);
                    c.lastBlocked = true;
                }
            }
            if (cfg.fallbackDirect || cfg.direct) {
                addRoutePoints([from, to]);
                return true;
            }
            return false;
        }

        function driveStep(dt, toPoint) {
            // Вождение: цель движения — текущая точка маршрута; руль/газ
            // отдаются vehicle-контроллеру (lib/vehicle.js), если он есть.
            const wp = c.waypoints[c.pathIndex] || toPoint;
            const here = currentPoint();
            const dx = wp.x - here.x, dy = wp.y - here.y;
            const dist = Math.hypot(dx, dy);
            const routeSpeed = c.route && c.route.duration > 0 ? c.route.length / c.route.duration : cfg.speed;
            const targetSpeed = Math.min(cfg.speed, routeSpeed);
            const v = currentVelocity();
            const speed = Math.hypot(v.x, v.y);
            if (cfg.vehicle && typeof cfg.vehicle.control === 'function') {
                const facing = Number(node.angle) || 0;
                const want = Math.atan2(dy, dx);
                const steer = clamp(wrapAngle(want - facing) * 1.5, -1, 1);
                const throttle = speed < targetSpeed * 0.95 && dist > cfg.arrive ? 1 : 0;
                const brake = speed > targetSpeed + 8 || dist < cfg.arrive * 2 ? 1 : 0;
                cfg.vehicle.control({ throttle, brake, steer, handbrake: 0 }, dt);
                face(dx, dy, dt);
                return { dist, speed, targetSpeed };
            }
            // Без vehicle-модели: то же steering скорости, что у пешехода.
            const wantSpeed = dist <= cfg.arrive ? 0 : targetSpeed;
            const desired = dist > 1e-6 ? { x: dx / dist * wantSpeed, y: dy / dist * wantSpeed } : { x: 0, y: 0 };
            accelerateToward(desired, dt);
            if (speed > 1) face(v.x, v.y, dt);
            return { dist, speed, targetSpeed };
        }

        function accelerateToward(desired, dt) {
            const v = currentVelocity();
            const dvx = desired.x - v.x, dvy = desired.y - v.y;
            const dv = Math.hypot(dvx, dvy);
            const maxDv = cfg.accel * dt;
            if (dv <= maxDv || dv <= 1e-9) applyVelocity(desired.x, desired.y, dt);
            else applyVelocity(v.x + dvx / dv * maxDv, v.y + dvy / dv * maxDv, dt);
        }

        function stepToward(wp, dt, final) {
            const here = currentPoint();
            const dx = wp.x - here.x, dy = wp.y - here.y;
            const dist = Math.hypot(dx, dy);
            const arrive = final ? cfg.arrive : cfg.waypoint;
            if (dist <= arrive) return { dist, reached: true };
            // Торможение на подходе к последней точке.
            const slow = final ? clamp(dist / Math.max(1, cfg.arrive * 6), 0.15, 1) : 1;
            const speed = cfg.speed * slow;
            accelerateToward({ x: dx / dist * speed, y: dy / dist * speed }, dt);
            if (cfg.lookAtMovement) face(dx, dy, dt);
            return { dist, reached: false };
        }

        function tickMove(dt) {
            const targetPoint = resolvePoint(c.target);
            if (!targetPoint) { c.lastBlocked = true; return; }
            const here = currentPoint();
            if (c.mode === 'follow') {
                const stopDistance = c.followStop ?? cfg.arrive;
                const d = Math.hypot(targetPoint.x - here.x, targetPoint.y - here.y);
                if (d <= stopDistance) { applyVelocity(0, 0, dt); return; }
                // Догоняем цель: скорость ограничена, без маршрута (follow ведёт
                // себя как преследование), но с учётом препятствий через nav.
                const dx = targetPoint.x - here.x, dy = targetPoint.y - here.y;
                const speed = Math.min(cfg.speed, 60 + (d - stopDistance) * 1.5);
                accelerateToward({ x: dx / d * speed, y: dy / d * speed }, dt);
                if (cfg.lookAtMovement) face(dx, dy, dt);
                return;
            }
            if (c.mode === 'flee') {
                const dx = here.x - targetPoint.x, dy = here.y - targetPoint.y;
                const d = Math.hypot(dx, dy);
                if (d >= (c.fleeRadius ?? 260)) { setArrive('arrive', { reason: 'fled', distance: d }); return; }
                const k = d > 1e-6 ? 1 / d : 0;
                accelerateToward({ x: dx * k * cfg.speed, y: dy * k * cfg.speed }, dt);
                if (cfg.lookAtMovement) face(-dx, -dy, dt);   // смотрит на угрозу
                return;
            }
            if (c.mode === 'look') {
                face(targetPoint.x - here.x, targetPoint.y - here.y, dt, false);
                applyVelocity(0, 0, dt);
                return;
            }
            if (c.mode !== 'move' && c.mode !== 'patrol' && c.mode !== 'drive') return;

            if (c.wait > 0) { c.wait = Math.max(0, c.wait - dt); applyVelocity(0, 0, dt); return; }

            // Пересчёт пути: периодически, при смене цели или её сдвиге.
            const moved = !c.lastTarget || Math.hypot(targetPoint.x - c.lastTarget.x, targetPoint.y - c.lastTarget.y) > cfg.repathTolerance;
            if (!c.waypoints.length && (c.mode !== 'drive' || c.lastBlocked)) {
                if (!buildPath(here, targetPoint)) {
                    if (cfg.fallbackDirect) addRoutePoints([here, targetPoint]);
                }
                c.lastTarget = targetPoint;
                c.repathIn = cfg.repathInterval;
            } else if ((c.mode === 'follow' || moved) && c.repathIn <= 0 && c.mode !== 'drive') {
                buildPath(here, targetPoint);
                c.lastTarget = targetPoint;
                c.repathIn = cfg.repathInterval;
            }

            if (c.mode === 'drive' && !c.waypoints.length) {
                if (!buildPath(here, targetPoint)) { setArrive('blocked', { reason: c.lastError }); return; }
            }

            if (!c.waypoints.length) { setArrive('arrive', { reason: 'empty-path' }); return; }

            const wp = c.waypoints[c.pathIndex];
            const final = c.pathIndex >= c.waypoints.length - 1;
            if (c.mode === 'drive') {
                const r = driveStep(dt, targetPoint);
                if (final && r.dist <= cfg.arrive) {
                    // Дошли до конца маршрута: дальше — только если цель
                    // оказалась ближе/дальше самого маршрута (exact-точка).
                    setArrive('arrive', { distance: r.dist });
                } else if (r.dist <= cfg.waypoint) {
                    c.pathIndex++;
                }
                return;
            }

            const r = stepToward(wp, dt, final);
            if (r.reached) {
                if (!final) {
                    c.pathIndex++;
                } else if (c.patrol) {
                    c.stops++;
                    const wait = c.patrol.wait || 0;
                    if (wait > 0) c.wait = wait;
                    if (c.patrol.index + 1 < c.patrol.points.length) {
                        c.patrol.index++;
                    } else if (c.patrol.loop) {
                        c.patrol.index = 0;
                    } else {
                        setArrive('arrive', { route: 'patrol', stops: c.stops });
                        return;
                    }
                    c.target = c.patrol.points[c.patrol.index];
                    clearPath();
                    if (c.wait <= 0) buildPath(currentPoint(), resolvePoint(c.target) || currentPoint());
                } else {
                    setArrive('arrive', { distance: r.dist });
                }
            }
        }

        function update(dt) {
            if (disposed) return;
            const step = Number(dt);
            if (!Number.isFinite(step) || step < 0) throw new RangeError('ai.update: dt должен быть конечным >= 0');
            c.elapsed += step;
            if (c.repathIn > 0) c.repathIn = Math.max(0, c.repathIn - step);
            if (c.mode === 'idle') { applyVelocity(0, 0, step); return; }
            tickMove(step);
        }

        // --- публичные команды ---------------------------------------

        c.update = update;
        c.moveTo = (target, o = {}) => {
            ensureAlive();
            c.mode = 'move'; c.status = 'moving'; c.target = target; c.patrol = null;
            if (o.direct !== undefined) cfg.direct = !!o.direct;
            if (o.speed !== undefined) cfg.speed = Math.max(0, Number(o.speed));
            if (o.arrive !== undefined) cfg.arrive = Math.max(0.1, Number(o.arrive));
            if (o.useNav !== undefined) cfg.useNav = !!o.useNav;
            clearPath(); c.lastTarget = null; c.repathIn = 0; c.wait = 0;
            return c;
        };
        c.patrolTo = (points, o = {}) => {
            ensureAlive();
            if (!Array.isArray(points) || !points.length) throw new TypeError('ai.patrolTo: нужен непустой массив точек');
            c.mode = 'patrol'; c.status = 'moving';
            c.patrol = { points: points.slice(), index: 0, loop: o.loop === true, wait: Math.max(0, Number(o.wait) || 0) };
            c.target = points[0];
            if (o.speed !== undefined) cfg.speed = Math.max(0, Number(o.speed));
            clearPath(); c.lastTarget = null; c.repathIn = 0; c.wait = 0;
            return c;
        };
        c.follow = (target, o = {}) => {
            ensureAlive();
            c.mode = 'follow'; c.status = 'moving'; c.target = target; c.patrol = null;
            c.followStop = o.stopDistance !== undefined ? Math.max(0, Number(o.stopDistance)) : (o.keep !== undefined ? Math.max(0, Number(o.keep)) : cfg.arrive);
            if (o.speed !== undefined) cfg.speed = Math.max(0, Number(o.speed));
            clearPath(); c.lastTarget = null; c.repathIn = 0;
            return c;
        };
        c.fleeFrom = (target, o = {}) => {
            ensureAlive();
            c.mode = 'flee'; c.status = 'moving'; c.target = target; c.patrol = null;
            c.fleeRadius = o.radius !== undefined ? Math.max(1, Number(o.radius)) : 260;
            if (o.speed !== undefined) cfg.speed = Math.max(0, Number(o.speed));
            clearPath(); c.lastTarget = null; c.repathIn = 0;
            return c;
        };
        c.lookAt = (target) => {
            ensureAlive();
            c.mode = 'look'; c.status = 'looking'; c.target = target; c.patrol = null;
            c.lastTarget = null; clearPath();
            return c;
        };
        c.driveTo = (target, o = {}) => {
            ensureAlive();
            if (!roadGraph) throw new Error('ai.driveTo: нужен roadGraph (передайте его в createAI)');
            c.mode = 'drive'; c.status = 'driving'; c.target = target; c.patrol = null;
            cfg.vehicle = o.vehicle || cfg.vehicle;
            if (o.speed !== undefined) cfg.speed = Math.max(0, Number(o.speed));
            clearPath(); c.lastTarget = null; c.repathIn = 0;
            c.route = null;
            c.lastBlocked = false;
            return c;
        };
        c.stop = () => {
            c.mode = 'idle'; c.status = 'stopped'; c.target = null; c.patrol = null;
            clearPath(); c.wait = 0; c.lastTarget = null;
            applyVelocity(0, 0, 0);
            c.stops = 0;
            return c;
        };
        c.isMoving = () => c.mode !== 'idle';
        c.state = () => ({
            mode: c.mode, status: c.status,
            x: Math.round((Number(node.x) || 0) * 1000) / 1000,
            y: Math.round((Number(node.y) || 0) * 1000) / 1000,
            pathPoints: c.waypoints.length, pathIndex: c.pathIndex,
            route: c.route ? { length: Math.round(c.route.length * 1000) / 1000,
                               duration: Math.round(c.route.duration * 1000) / 1000,
                               nodes: c.route.nodes.length } : null,
            blocked: c.lastBlocked, error: c.lastError,
            wait: Math.round(c.wait * 1000) / 1000,
            facing: c.lastFacing,
        });
        c.path = () => c.waypoints.map((p) => ({ x: p.x, y: p.y }));
        c.on = (name, fn) => {
            if (typeof fn !== 'function') throw new TypeError('ai.on: нужен обработчик');
            const key = String(name);
            if (!handlers.has(key)) handlers.set(key, []);
            handlers.get(key).push(fn);
            return c;
        };
        c.off = (name, fn) => {
            const list = handlers.get(String(name));
            if (!list) return c;
            if (!fn) handlers.delete(String(name));
            else handlers.set(String(name), list.filter((h) => h !== fn));
            return c;
        };
        c.onStimulus = (fn) => {
            if (!fn) return c;
            const handler = (e) => {
                const data = (e && e.data !== undefined) ? e.data : e;
                if (data && typeof data === 'object') fn(data, e, c);
            };
            if (typeof $.on === 'function') {
                $.on('stimulus', handler);
                unsubs.push(() => { if (typeof $.off === 'function') $.off('stimulus', handler); });
            }
            if (typeof node.on === 'function') {
                node.on('stimulus', handler);
                unsubs.push(() => { if (typeof node.off === 'function') node.off('stimulus', handler); });
            }
            return c;
        };
        c.dispose = () => {
            try { c.stop(); } catch (e) { /* уже мёртв */ }
            for (const un of unsubs.splice(0)) { try { un(); } catch (e) { /* подписка могла умереть */ } }
            const i = controllers.indexOf(c);
            if (i >= 0) controllers.splice(i, 1);
        };

        controllers.push(c);
        return c;
    }

    // --- зоны (named Area/Zone с enter/leave) -------------------------

    function zone(spec = {}) {
        ensureAlive();
        const name = spec.name === undefined ? `zone:${zones.size}` : String(spec.name);
        if (zones.has(name)) throw new Error(`ai.zone: зона "${name}" уже есть`);
        if (typeof $.triggers?.zone !== 'function') {
            throw new Error('ai.zone: нужен $.triggers.zone (движок без подсистемы зон)');
        }
        const zoneNode = $.triggers.zone({
            x: spec.x, y: spec.y, w: spec.w, h: spec.h,
            id: spec.id, class: spec.class,
            // visible:false в triggers ВЫКЛЮЧАЕТ зону; невидимость — alpha 0.
            visible: true,
            color: spec.color || '#68ff9a', alpha: spec.alpha === undefined ? 0 : spec.alpha,
            detect: spec.detect === undefined ? defaultDetect : spec.detect,
            once: spec.once,
            cooldown: spec.cooldown,
            parent: spec.parent === undefined ? $.world : spec.parent,
            onEnter: (other, self) => {
                if (typeof spec.onEnter === 'function') spec.onEnter(nodeOf(other), nodeOf(self));
                if (typeof spec.signal === 'string') $.signal.emit(spec.signal + ':enter', name);
            },
            onLeave: (other, self) => {
                if (typeof spec.onLeave === 'function') spec.onLeave(nodeOf(other), nodeOf(self));
                if (typeof spec.signal === 'string') $.signal.emit(spec.signal + ':leave', name);
            },
            onStay: (other, self) => {
                if (typeof spec.onStay === 'function') spec.onStay(nodeOf(other), nodeOf(self));
            },
        });
        const handle = {
            name,
            node: zoneNode,
            inside(nodeValue) { return typeof $.triggers.inside === 'function' ? $.triggers.inside(zoneNode, nodeValue) : false; },
            remove() {
                zones.delete(name);
                if (typeof zoneNode.remove === 'function') zoneNode.remove();
            },
        };
        zones.set(name, handle);
        return handle;
    }

    function zoneOf(name) {
        return zones.get(String(name)) || null;
    }

    /** Опубликовать стимул для всех подписчиков $.on('stimulus'). */
    function stimulus(payload = {}) {
        ensureAlive();
        const data = {
            type: payload.type === undefined ? 'noise' : String(payload.type),
            x: Number(payload.x) || 0,
            y: Number(payload.y) || 0,
            radius: Number(payload.radius) || 0,
            strength: payload.strength === undefined ? 1 : Number(payload.strength),
            source: payload.source === undefined ? null : nodeOf(payload.source),
        };
        if (typeof $.emit === 'function') $.emit('stimulus', data);
        return data;
    }

    return {
        controller,
        zone,
        zoneOf,
        zones() { return Array.from(zones.keys()); },
        stimulus,
        controllers() { return controllers.slice(); },
        setRoadGraph(graph) { roadGraph = graph || null; return this; },
        update(dt) { for (const c of controllers.slice()) if (c.mode !== 'idle') c.update(dt); },
        dispose() {
            for (const c of controllers.slice()) c.dispose();
            for (const z of Array.from(zones.values())) z.remove();
            zones.clear();
            disposed = true;
        },
    };
}
