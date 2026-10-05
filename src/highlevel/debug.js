// ===========================================================================
// Отладка: $.debug и $.console.
//
//   $.debug.on();                        // показать оверлей движка (F1)
//   $.debug.draw.rect(10, 10, 40, 40, 'red');
//   $.debug.watch('hp', () => $('#hero').hp());
//   $.console.register('spawn', (args) => $('<enemy>').at(args[0], args[1]));
//   $.console.run('spawn 100 200');
// ===========================================================================

import { ctx, query, wrap } from './core.js';
import { collectCounters } from './pool.js';

const watches = [];
const timers = new Map();
const commands = new Map();

export function installDebug($) {
    const debug = {
        overlay: false,

        /** Показать/скрыть отладочный оверлей движка (то же, что F1). */
        on() { debug.overlay = true; engine.setOverlay(true); return debug; },
        off() { debug.overlay = false; engine.setOverlay(false); return debug; },
        toggle() {
            debug.overlay = !debug.overlay;
            engine.setOverlay(debug.overlay);
            return debug;
        },
        isOn() { return debug.overlay; },

        /** Сводка по кадру: FPS, спрайты, узлы, тела, звук. */
        stats() {
            const gfx = ctx.gfx ? ctx.gfx.stats() : { sprites: 0, triangles: 0, texts: 0 };
            return {
                fps: Math.round(engine.fps * 10) / 10,
                frame_ms: Math.round(engine.dt * 10000) / 10,
                sprites: gfx.sprites,
                triangles: gfx.triangles,
                texts: gfx.texts,
                nodes: ctx.nodes.length,
                ui_nodes: ctx.nodes.filter((n) => n.attrs.ui).length,
                bodies: engine.bodyCount(),
                tweens: ctx.tweens_active ? ctx.tweens_active() : 0,
                sounds: ctx.sound ? ctx.sound.activeChannels() : 0,
                frame: engine.frame,
                counters: debug.counters(),
            };
        },

        /**
         * Счётчики подсистем: узлы, тела, частицы, активные твины, зоны и
         * объекты пулов. Обновляются в tickPool(), но при запросе считаются
         * заново — так значение верно и до первого кадра.
         */
        counters() { return collectCounters(); },

        /**
         * Примитивы поверх кадра. Принимают точки, узлы и селекторы:
         *   $.debug.draw.line('#hero', '#exit', 'yellow');
         */
        draw: {
            line(a, b, color, width) {
                const p = point(a), q = point(b);
                ctx.gfx.draw.line(p.x, p.y, q.x, q.y, color, width);
            },
            rect(a, b, color) {
                const p = point(a), q = point(b);
                ctx.gfx.draw.rect(Math.min(p.x, q.x), Math.min(p.y, q.y),
                                  Math.abs(q.x - p.x), Math.abs(q.y - p.y), color);
            },
            circle(a, r, color) {
                const p = point(a);
                ctx.gfx.draw.circle(p.x, p.y, r, color);
            },
            ring(a, r, color, width) {
                const p = point(a);
                ctx.gfx.draw.ring(p.x, p.y, r, color, width);
            },
            text(text, a, color, size) {
                const p = point(a);
                ctx.gfx.draw.text(text, p.x, p.y, color, size);
            },
            arrow(a, b, color) {
                const p = point(a), q = point(b);
                ctx.gfx.draw.arrow(p.x, p.y, q.x, q.y, color);
            },
        },

        /**
         * Значение на экране. Принимает функцию или готовое число.
         *   $.debug.watch('hp', () => $('#hero').hp());
         */
        watch(name, value) {
            watches.push({ name, value });
            return debug;
        },
        unwatch(name) {
            const i = watches.findIndex((w) => w.name === name);
            if (i >= 0) watches.splice(i, 1);
            return debug;
        },
        watches() { return watches.map((w) => ({ name: w.name, value: evalWatch(w) })); },

        /** Профайлер по кадрам: меряет время между start и end. */
        profiler: {
            start(name) {
                // Раньше запись создавалась заново на каждом start(), а start()
                // зовут каждый кадр — total/calls/max обнулялись, и report()
                // показывал только последний кадр. Теперь статистика копится,
                // а сбрасывает её только reset().
                const existing = timers.get(name);
                if (existing) {
                    existing.at = engine.time;
                    return;
                }
                timers.set(name, { at: engine.time, total: 0, calls: 0, max: 0 });
            },
            end(name) {
                const t = timers.get(name);
                if (!t) return;
                const dt = (engine.time - t.at) * 1000;
                t.total += dt;
                t.calls++;
                t.max = Math.max(t.max, dt);
            },
            report() {
                const out = {};
                for (const [name, t] of timers) {
                    out[name] = {
                        calls: t.calls,
                        avg_ms: t.calls ? Math.round((t.total / t.calls) * 100) / 100 : 0,
                        max_ms: Math.round(t.max * 100) / 100,
                    };
                }
                return out;
            },
            reset() { timers.clear(); return debug; },
        },

        /** Внутреннее: рисует список watch поверх кадра. */
        _render() {
            if (watches.length === 0) return;
            if (!debug.overlay) return;
            let y = 90;
            ctx.gfx.text('— наблюдение ($.debug.watch) —', 12, y - 22, { size: 15, color: '#8fd1ff' });
            for (const w of watches) {
                ctx.gfx.text(`${w.name}: ${evalWatch(w)}`, 12, y, { size: 15, color: '#d8e2ee' });
                y += 18;
            }
        },
    };

    // --- Консоль -------------------------------------------------------------

    const console_api = {
        /** register('spawn', (args) => ...) — args всегда массив строк. */
        register(name, fn, help) {
            commands.set(name, { fn, help: help || '' });
            return console_api;
        },
        unregister(name) { commands.delete(name); return console_api; },
        list() { return [...commands.keys()].sort(); },
        help(name) {
            const c = commands.get(name);
            return c ? c.help : null;
        },

        /** Выполнить строку: 'spawn 100 200'. Числа приводятся к number. */
        run(line) {
            const parts = String(line).trim().split(/\s+/);
            const name = parts.shift();
            const cmd = commands.get(name);
            if (!cmd) { ctx.log(`$: неизвестная команда консоли "${name}"`); return false; }
            const args = parts.map((p) => (/^-?\d+(\.\d+)?$/.test(p) ? parseFloat(p) : p));
            try { cmd.fn(args); return true; }
            catch (e) { ctx.log(`$: ошибка в команде "${name}": ${e}`); return false; }
        },

        /** Показать/скрыть отладочный оверлей (там же журнал и консоль движка). */
        toggle() { return debug.toggle(); },
    };

    ctx.debug = debug;
    ctx.console = console_api;
    return { debug, console: console_api };
}

function evalWatch(w) {
    try { return typeof w.value === 'function' ? w.value() : w.value; }
    catch (e) { return `ошибка: ${e}`; }
}

function point(what) {
    if (typeof what === 'string') {
        const n = query(what)[0];
        return n ? { x: n.x, y: n.y } : { x: 0, y: 0 };
    }
    if (typeof what === 'object' && what && what.tag) return { x: what.x, y: what.y };
    if (typeof what === 'object' && what && what.nodes) {
        const n = what.nodes[0];
        return n ? { x: n.x, y: n.y } : { x: 0, y: 0 };
    }
    if (Array.isArray(what)) return { x: what[0], y: what[1] };
    return { x: (what && what.x) || 0, y: (what && what.y) || 0 };
}
