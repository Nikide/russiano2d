// Задачи: очередь; занятость — data('task') у жителя; итог — colony:done { type }.
export default function taskBoard(node, config, $) {
    const queue = config.tasks.map((s) => s.split('=')).filter((p) => p.length >= 2).map(([type, xy, ms]) => { const [x, y] = xy.split(',').map(Number); return { type: type.trim(), x, y, ms: Number(ms) || 2000 }; }).filter((t) => Number.isFinite(t.x));
    const add = (e) => { const d = e.data || {}; if (d.type && Number.isFinite(d.x)) queue.push({ type: d.type, x: d.x, y: d.y, ms: d.ms || 2000 }); };
    $.on('colony:task', add);
    const stop = $.updateFor(node, (dt) => {
        $(config.workers).each((i, w) => {
            let t = w.data('task');
            if (!t) { if (!queue.length) return; t = { ...queue.shift(), left: 0 }; w.data('task', t); }
            const p = w.pos();
            if (Math.hypot(t.x - p.x, t.y - p.y) > 6) { w.moveTowards(t, config.speed); return; }
            t.left += dt * 1000;
            if (t.left >= t.ms) { w.data('task', null); $.emit('colony:done', { type: t.type, by: w.attr('id') }); }
        });
        node.data('colonyQueue', queue.length);
    });
    return () => { stop(); $.off('colony:task', add); };
}
