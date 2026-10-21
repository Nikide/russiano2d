// Позиции: прогресс = круг×N + ворота − доля дистанции; сортировка каждый кадр.
export default function racePositions(node, config, $) {
    return $.updateFor(node, () => {
        const gates = $(config.gates).nodes.slice().sort((a, b) => (Number($(a).data('order')) || 0) - (Number($(b).data('order')) || 0));
        if (!gates.length) return;
        const rows = $(config.racers).nodes.map((n) => {
            const w = $(n), lap = Number(w.data('lap')) || 0, g = Number(w.data('gate')) || 0, nxt = $(gates[g % gates.length]);
            return { w, score: lap * gates.length + g - Math.min(1, w.distanceTo(nxt) / 10000) };
        }).sort((a, b) => b.score - a.score);
        rows.forEach((r, i) => r.w.data('place', i + 1));
        $.store.set('racePlaces', rows.map((r) => r.w.attr('id')));
    });
}
