// Известные рецепты — data('knownRecipes'); станция с requireDiscovery пускает только их.
export default function discover(node, config, $) {
    const rules = config.rules.map((s) => s.split('=')).filter((p) => p.length === 2).map(([a, b]) => [a.trim(), b.trim()]);
    const known = new Set(node.data('knownRecipes') || []);
    const learn = (recipe) => { if (known.has(recipe)) return; known.add(recipe); node.data('knownRecipes', [...known]).emit('recipe:discovered', { recipe }); };
    const onPick = (e) => { const d = e.data || {}; for (const [t, r] of rules) if (t === d.item) learn(r); };
    const handlers = rules.map(([t, r]) => [t, () => learn(r)]);
    $.on('pickup', onPick);
    for (const [t, h] of handlers) $.on(t, h);
    node.data('knownRecipes', [...known]);
    return () => { $.off('pickup', onPick); for (const [t, h] of handlers) $.off(t, h); };
}
