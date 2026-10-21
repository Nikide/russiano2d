// Преследование: moveTowards в радиусе. Цель ищется по селектору только когда
// прежняя исчезла — поиск по id на каждый кадр стоил больше самой логики
// (замер tools/bench_snippets.py, docs/benchmarks/snippets.md).
export default function chase(node, config, $) {
    // Сущность по селектору: ищется заново, только если прежний узел исчез.
    const cache = {};
    const sel = (s) => { const c = cache[s]; if (c && c.length && !c.get(0).removed) return c; return (cache[s] = $(s)); };
    let target = null;
    return $.updateFor(node, (dt, self) => {
        if (!target || !target.length || target.get(0).removed) target = sel(config.target);
        if (!target.length) return;
        if (self.distanceTo(target) < config.radius) self.moveTowards(target, config.speed);
    });
}
