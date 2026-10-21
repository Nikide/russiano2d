// Глубина: $.layers.parallax для каждого слоя; снятие — null.
export default function parallaxFocus(node, config, $) {
    const rules = config.layers.map((s) => s.split('=')).filter((p) => p.length === 2).map(([sel, f]) => [sel.trim(), Number(f)]).filter(([, f]) => Number.isFinite(f));
    for (const [sel, f] of rules) $.layers.parallax(sel, f);
    return () => { for (const [sel] of rules) $.layers.parallax(sel, null); };
}
