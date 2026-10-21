// Память: показ (flash), затем ввод мышью; ошибка — повтор показа.
export default function memory(node, config, $) {
    const seq = [];
    let round = 0, showing = 0, i = 0, t = 0, done = false;
    const pads = () => $(config.pads).nodes;
    const grow = () => { while (seq.length < config.start + round) seq.push($.random.int(0, Math.max(0, pads().length - 1))); showing = 1; i = 0; t = 0; };
    return $.updateFor(node, (dt) => {
        const list = pads();
        if (done || !list.length) return;
        if (!seq.length) grow();
        if (showing) {
            t -= dt * 1000;
            if (t > 0) return;
            if (i >= seq.length) { showing = 0; i = 0; return; }
            $(list[seq[i++] % list.length]).flash('#ffffff', config.blink * 0.8);
            t = config.blink;
            return;
        }
        if (!$.input.mousePressed('left')) return;
        const m = $.input.mouseWorld();
        const k = m ? list.findIndex((n) => Math.abs(n.x - m.x) <= n.w / 2 && Math.abs(n.y - m.y) <= n.h / 2) : -1;
        if (k < 0) return;
        if (k === seq[i] % list.length) { i++; if (i === seq.length) { round++; if (round >= config.rounds) { done = true; $.emit(config.solvedEvent, { puzzle: node.attr('id') }); } else grow(); } }
        else { node.emit('puzzle:wrong', {}); showing = 1; i = 0; t = config.blink; }
    });
}
