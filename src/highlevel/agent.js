import { engineOf } from './core.js';
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
// failures — строки (совместимость с прежними тестами), details — те же провалы
// структурой: субъект, ожидание, факт. Их забирает агент, чтобы падающий тест
// оставлял разбираемый артефакт, а не только текст в логе.
const tests = { total: 0, failed: 0, failures: [], details: [] };

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
        // Вид узла — только для не-2D: снимок 2D-игры остаётся прежним.
        ...(node.kind && node.kind !== '2d' ? { kind: node.kind } : null),
        // Семантика для ассистивных технологий (role/label/…): она нужна в
        // снимке, чтобы автотест мог проверить доступность интерфейса.
        aria: node.aria || null,
    };
}

export function installAgent($) {
    const agent = {
        /** Запущен ли движок в агентском режиме (--agent). */
        active: !!engineOf().agent,
        headless: !!engineOf().headless,
        seed: engineOf().seed === undefined ? 0 : engineOf().seed,

        frame() { return engineOf().frame; },
        time() { return round2(engineOf().time); },

        /** Краткое описание узла по селектору (или null). */
        node(sel) {
            const node = query(sel)[0];
            return node ? nodeBrief(node) : null;
        },

        /**
         * Список узлов, подходящих под селектор. `limit > 0` обрезает список —
         * так команда `query` агентского протокола не гонит в JSON весь мир.
         */
        nodes(sel, limit) {
            const list = query(sel || '*').map(nodeBrief);
            return limit > 0 && list.length > limit ? list.slice(0, limit) : list;
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
                frame: engineOf().frame,
                time: round2(engineOf().time),
                dt: round2(engineOf().dt * 1000) / 1000,
                fps: Math.round(engineOf().fps * 10) / 10,
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
                    bodies: engineOf().bodyCount(),
                } : { count: entities.length, bodies: engineOf().bodyCount() },
                entities: entities.map(nodeBrief),
                ui: ui_nodes.map(nodeBrief),
                tests: {
                    total: tests.total,
                    failed: tests.failed,
                    failures: tests.failures.slice(0, 20),
                    details: tests.details.slice(0, 20),
                },
            };

            const player = ctx.nodes.find((n) => n.tag === 'player' || n.classes.has('player'));
            if (player) {
                const vel = player.body >= 0 ? engineOf().getVelocity(player.body) : [0, 0];
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

        /**
         * Регистрирует снимок и инспекцию в движке: снимок уйдёт в ответе на
         * `state`, а функция поиска обслужит команды `query`, `inspect` и
         * `profile` (режимы `list`, `one`, `count`).
         *
         * Один и тот же код отдаёт сущности игре, агенту и DevTools — второй
         * реализации поиска быть не должно (docs/DEVTOOLS.md §7).
         */
        install() {
            const eng = engineOf();
            eng.setSnapshot(() => agent.snapshot());
            if (typeof eng.setAgentQuery === 'function') {
                eng.setAgentQuery((sel, mode, limit) => {
                    if (mode === 'count') return query(sel || '*').length;
                    if (mode === 'one') return agent.node(sel);
                    return agent.nodes(sel, limit);
                });
            }
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
        check(condition, message, detail) {
            tests.total++;
            if (condition) {
                ctx.log(`  ok   ${message}`);
                return true;
            }
            tests.failed++;
            tests.failures.push(message);
            if (detail) tests.details.push(Object.assign({ message }, detail));
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
            tests.details.length = 0;
            return test;
        },

        results() {
            return {
                total: tests.total,
                failed: tests.failed,
                failures: tests.failures.slice(),
                details: tests.details.slice(),
            };
        },

        /** Печатает итог. Возвращает true, если всё зелено. */
        report() {
            const ok = tests.failed === 0;
            ctx.log(ok
                ? `\nВсе проверки пройдены (${tests.total})`
                : `\nПРОВАЛЕНО: ${tests.failed} из ${tests.total}`);
            return ok;
        },
    };

    // --- $.expect ------------------------------------------------------------
    //
    // Утверждения в понятиях мира: селектор, а не внутренние структуры.
    //
    //   $.expect('#door').state('open');
    //   $.expect('.enemy').count(5);
    //   $.expect('#hero').hp(100);
    //   $.expect('#hero').positionNear(100, 300, 1);
    //
    // Каждое утверждение идёт через $.test.check, поэтому попадает и в общий
    // счётчик (results/report), и в снимок агента — вместе со структурной
    // деталью провала (subject/expected/actual), чтобы падающий тест оставлял
    // разбираемый артефакт (ROADMAP, фаза 6).

    function subjectLabel(sel) {
        if (typeof sel === 'string') return sel;
        const node = (sel && Array.isArray(sel.nodes)) ? sel.nodes[0] : sel;
        if (node && node.tag) return `#${node.id || node.tag}`;
        return String(sel);
    }

    function subjectNodes(sel) {
        if (typeof sel === 'string') return query(sel);
        if (sel && Array.isArray(sel.nodes)) return sel.nodes;   // обёртка
        if (sel && sel.tag) return [sel];                        // узел
        return [];
    }

    function expect(sel) {
        const label = subjectLabel(sel);
        const nodes = subjectNodes(sel);
        const first = nodes[0];

        const need = () => {
            if (first) return true;
            test.check(false, `${label}: узел не найден`, { subject: label, actual: null });
            return false;
        };

        return {
            /** Сколько узлов нашлось: `$.expect('.enemy').count(5)`. */
            count(n) {
                return test.check(nodes.length === n, `${label}: узлов ${n}`,
                                  { subject: label, expected: n, actual: nodes.length });
            },

            /** Есть ли хоть один узел. */
            exists() {
                return test.check(nodes.length > 0, `${label}: существует`,
                                  { subject: label, expected: '>0', actual: nodes.length });
            },

            /** Ни одного узла. */
            empty() {
                return test.check(nodes.length === 0, `${label}: пусто`,
                                  { subject: label, expected: 0, actual: nodes.length });
            },

            /** Свойство узла (или свободный атрибут): `.prop('speed', 250)`. */
            prop(name, value) {
                if (!need()) return false;
                const actual = first.get(name);
                return test.check(actual === value, `${label}: ${name} = ${JSON.stringify(value)}`,
                                  { subject: label, prop: name, expected: value, actual });
            },

            /** Здоровье узла: `.hp(100)` (то же, что `.prop('hp', 100)`). */
            hp(value) { return this.prop('hp', value); },

            /** Позиция центра с допуском: `.positionNear(x, y, eps)`. */
            positionNear(x, y, eps) {
                if (!need()) return false;
                const p = { x: first.x, y: first.y };
                const tol = eps === undefined ? 0.5 : eps;
                const ok = Math.abs(p.x - x) <= tol && Math.abs(p.y - y) <= tol;
                return test.check(ok, `${label}: позиция (${p.x}, ${p.y}) ≈ (${x}, ${y})±${tol}`,
                                  { subject: label, expected: [x, y], actual: [p.x, p.y], tol });
            },

            /**
             * Игровое состояние: значение СВОБОДНОГО атрибута `state`, которое
             * игра ставит сама (`$('#door').attr('state', 'open')`). Читаем
             * именно атрибут, а не свойство узла: у анимации клипами своё
             * `state`, и путать их нельзя. Движок не выдумывает состояний,
             * которых не знает (правило 9 правил агентов).
             */
            state(value) {
                if (!need()) return false;
                const actual = first.attrs ? first.attrs.state : undefined;
                return test.check(actual === value, `${label}: state = ${JSON.stringify(value)}`,
                                  { subject: label, prop: 'state', expected: value, actual });
            },
        };
    }

    ctx.agent = agent;
    ctx.test = test;
    ctx.expect = expect;
    agent.install();
    return { agent, test, expect };
}

function describeTarget(wrapper) {
    const node = wrapper.nodes[0];
    return node ? { id: node.id || null, tag: node.tag, uid: node.uid } : null;
}
