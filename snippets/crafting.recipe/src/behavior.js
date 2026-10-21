
// Рецепт: «результат=число: ингредиент=число, …»
function parseRecipe(text) {
    const [out, ins] = String(text).split(':');
    const [id, n] = (out || '').split('=');
    const need = (ins || '').split(',').map((s) => s.split('=')).filter((p) => p[0] && p[0].trim())
        .map(([k, v]) => [k.trim(), Number(v) || 1]);
    return id && id.trim() ? { id: id.trim(), count: Number(n) || 1, need } : null;
}
function canCraft(bag, r) { return r.need.every(([k, v]) => bag.count(k) >= v); }

export default function recipe(node, config, $) {
    const list = config.recipes.map(parseRecipe).filter(Boolean);
    node.data('recipes', (node.data('recipes') || []).concat(list));
    node.emit('recipes', { recipes: list });
    return () => {};
}
