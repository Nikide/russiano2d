// Смешивание: среднее RGB касающихся сосуда красителей; совпадение в допуске.
function rgb(h) { const n = parseInt(String(h).replace('#', '').slice(0, 6), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }

export default function colorCode(node, config, $) {
    const goal = rgb(config.target);
    let solved = false;
    return $.updateFor(node, (dt, self) => {
        const inside = $(config.dyes).nodes.map((n) => $(n)).filter((d) => self.overlaps(d) && d.data('color'));
        if (!inside.length) return;
        const mix = [0, 1, 2].map((k) => inside.reduce((s, d) => s + rgb(d.data('color'))[k], 0) / inside.length);
        self.data('mix', mix);
        const ok = mix.every((v, k) => Math.abs(v - goal[k]) <= config.tolerance);
        if (ok && !solved) { solved = true; $.emit(config.solvedEvent, { puzzle: self.attr('id') }); }
        if (!ok) solved = false;
    });
}
