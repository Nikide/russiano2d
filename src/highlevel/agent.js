// ===========================================================================
// Агент: $.agent — мост между игрой и программой, которая ей управляет.
//
// Движок даёт агенту низкий уровень (команды eval/state/step по stdin, см.
// docs/AGENT_API.md). Задача $.agent — превратить игровой мир в понятный
// снимок и дать игре возможность самой проверить себя:
//
//   $.agent.expose('score', () => Global.score);   // поле в снимке
//   $.test.check($('.enemy').length === 5, 'врагов пятеро');
//
// Снимок уходит в ответ на команду `state` и содержит всё, что нужно, чтобы
// агент мог играть, не читая исходники игры.
// ===========================================================================

import { ctx, query, wrapOne } from './core.js';
import { windowSnapshot } from './window.js';

const exposed = new Map();
const tests = { total: 0, failed: 0, failures: [] };

const round2 = (v) => Math.round(v * 100) / 100;

function nodeBrief(node) {
    return {
        uid: node.uid,
        id: node.id || null,
        tag: node.tag,
        class: [...node.classes].join(' ') || null,
        x: round2(node.x),
        y: round2(node.y),
        w: round2(node.w),
        h: round2(node.h),
        angle: round2(node.angle),
        hp: round2(node.cur_hp),
        max_hp: round2(node.max_hp),
        team: node.team,
        alive: node.cur_hp > 0 && !node.removed,
        visible: node.visible,
        body: node.body,
        ui: !!node.attrs.ui,
    };
}

export function installAgent($) {
    const agent = {
        /** Запущен ли движок в агентском режиме (--agent). */
        active: !!engine.agent,
        headless: !!engine.headless,
        seed: engine.seed === undefined ? 0 : engine.seed,

        frame() { return engine.frame; },
        time() { return round2(engine.time); },

        /** Краткое описание узла по селектору (или null). */
        node(sel) {
            const node = query(sel)[0];
            return node ? nodeBrief(node) : null;
        },

        /** Список узлов, подходящих под селектор. */
        nodes(sel) {
            return query(sel || '*').map(nodeBrief);
        },

        /** Своё поле в снимке состояния. */
        expose(name, fn) {
            exposed.set(name, fn);
            return agent;
        },

        /** Полный снимок — то, что уходит в ответ на команду `state`. */
        snapshot() {
            const world = ctx.world ? ctx.world._state : null;
            const entities = ctx.nodes.filter((n) => !n.attrs.ui && !n.classes.has('world-bound'));
            const ui_nodes = ctx.nodes.filter((n) => n.attrs.ui);

            const snap = {
                frame: engine.frame,
                time: round2(engine.time),
                dt: round2(engine.dt * 1000) / 1000,
                fps: Math.round(engine.fps * 10) / 10,
                paused: ctx.time ? ctx.time.isPaused() : false,
                scene: ctx.scene ? ctx.scene.current() : null,
                window: windowSnapshot(),
                camera: ctx.camera ? {
                    x: round2(ctx.camera.pos().x),
                    y: round2(ctx.camera.pos().y),
                    zoom: round2(ctx.camera.zoom()),
                    followed: ctx.camera.followed() ? describeTarget(ctx.camera.followed()) : null,
                } : null,
                world: world ? {
                    count: entities.length,
                    gravity: world.gravity,
                    bounds: world.bounds,
                    bodies: engine.bodyCount(),
                } : { count: entities.length, bodies: engine.bodyCount() },
                entities: entities.map(nodeBrief),
                ui: ui_nodes.map(nodeBrief),
                tests: { total: tests.total, failed: tests.failed, failures: tests.failures.slice(0, 20) },
            };

            const player = ctx.nodes.find((n) => n.tag === 'player' || n.classes.has('player'));
            if (player) {
                const vel = player.body >= 0 ? engine.getVelocity(player.body) : [0, 0];
                snap.player = Object.assign(nodeBrief(player), {
                    vx: round2(vel[0]), vy: round2(vel[1]),
                    on_ground: player.attrs.on_ground === true,
                });
            }

            for (const [name, fn] of exposed) {
                try { snap[name] = fn(); }
                catch (e) { snap[name] = `ошибка: ${e}`; }
            }
            return snap;
        },

        /** Регистрирует снимок в движке: он уйдёт в ответе на `state`. */
        install() {
            engine.setSnapshot(() => agent.snapshot());
            return agent;
        },

        /** Строка состояния для логов — удобно в отладочном выводе. */
        describe() {
            const s = agent.snapshot();
            return `кадр ${s.frame} | сцена ${s.scene} | узлов ${s.world.count} | FPS ${s.fps}`;
        },
    };

    // --- $.test --------------------------------------------------------------

    const test = {
        /** Основная проверка. Возвращает результат — удобно для &&. */
        check(condition, message) {
            tests.total++;
            if (condition) {
                ctx.log(`  ok   ${message}`);
                return true;
            }
            tests.failed++;
            tests.failures.push(message);
            ctx.log(`  FAIL ${message}`);
            return false;
        },

        equal(actual, expected, message) {
            const same = JSON.stringify(actual) === JSON.stringify(expected);
            return test.check(same, same ? message : `${message} (получено ${JSON.stringify(actual)}, ожидалось ${JSON.stringify(expected)})`);
        },

        near(actual, expected, eps, message) {
            const ok = Math.abs(actual - expected) <= (eps === undefined ? 0.001 : eps);
            return test.check(ok, ok ? message : `${message} (получено ${actual}, ожидалось ${expected}±${eps})`);
        },

        truthy(value, message) { return test.check(!!value, message); },
        falsy(value, message) { return test.check(!value, message); },

        /** Снимок сбрасывается перед каждым прогоном агентского сценария. */
        reset() {
            tests.total = 0;
            tests.failed = 0;
            tests.failures.length = 0;
            return test;
        },

        results() { return { total: tests.total, failed: tests.failed, failures: tests.failures.slice() }; },

        /** Печатает итог. Возвращает true, если всё зелено. */
        report() {
            const ok = tests.failed === 0;
            ctx.log(ok
                ? `\nВсе проверки пройдены (${tests.total})`
                : `\nПРОВАЛЕНО: ${tests.failed} из ${tests.total}`);
            return ok;
        },
    };

    ctx.agent = agent;
    ctx.test = test;
    agent.install();
    return { agent, test };
}

function describeTarget(wrapper) {
    const node = wrapper.nodes[0];
    return node ? { id: node.id || null, tag: node.tag, uid: node.uid } : null;
}
