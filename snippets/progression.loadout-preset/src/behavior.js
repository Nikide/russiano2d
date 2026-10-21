// Пресеты: data('skillPresets') = { имя: [навыки] }; загрузка учитывает только открытые.
export default function loadoutPreset(node, config, $) {
    const presets = node.data('skillPresets') || {};
    const save = (e) => {
        const name = e.data && e.data.name;
        if (!name || (Object.keys(presets).length >= config.max && !presets[name])) return node.emit('preset:denied', { name });
        presets[name] = (node.data('activeSkills') || node.data('skills') || []).slice();
        node.data('skillPresets', presets).emit('preset:saved', { name });
    };
    const load = (e) => {
        const p = presets[e.data && e.data.name];
        if (!p) return node.emit('preset:denied', { name: e.data && e.data.name });
        const open = new Set(node.data('skills') || []);
        node.data('activeSkills', p.filter((s) => open.has(s))).emit('preset:loaded', { name: e.data.name });
    };
    node.on('preset:save', save);
    node.on('preset:load', load);
    return () => { node.off('preset:save', save); node.off('preset:load', load); };
}
