// Ритм: часы от старта пакета; ноты — данные, никакого выполнения выражений.
export default function rhythmLanes(node, config, $) {
    const notes = config.notes.map((s) => s.split(':').map(Number)).filter(([t, l]) => Number.isFinite(t) && Number.isFinite(l)).map(([t, lane]) => ({ t, lane, done: false }));
    const start = $.time.now();
    if (config.music) $.audio.play(config.music, { bus: 'music' });
    const score = { perfect: 0, good: 0, miss: 0 };
    const judge = (kind, n) => { score[kind]++; if (n) n.done = true; node.data('rhythm', { ...score }).emit('rhythm:' + kind, { lane: n ? n.lane : -1 }); };
    return $.updateFor(node, () => {
        const now = $.time.now() - start;
        for (const n of notes) if (!n.done && now - n.t > config.good) judge('miss', n);
        config.keys.forEach((k, lane) => {
            if (!$.input.pressed(k)) return;
            const n = notes.find((x) => !x.done && x.lane === lane && Math.abs(now - x.t) <= config.good);
            if (!n) { judge('miss', null); return; }
            judge(Math.abs(now - n.t) <= config.perfect ? 'perfect' : 'good', n);
        });
        node.data('rhythmTime', now);
    });
}
