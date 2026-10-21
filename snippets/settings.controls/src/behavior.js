// Раскладка: $.input.bind; пользовательская — $.input.saveBindings/loadBindings.
export default function settingsControls(node, config, $) {
    for (const s of config.bindings) { const [a, keys] = s.split('='); if (a && keys) $.input.bind(a.trim(), keys.split('+').map((k) => k.trim())); }
    $.input.markDefaults();
    $.input.loadBindings();
    const on = (e) => { const d = e.data || {}; if (d.action && d.key) { $.input.rebind(d.action, d.key); $.input.saveBindings(); $.emit('bindings:changed', { bindings: $.input.bindings() }); } };
    $.on('rebind', on);
    return () => $.off('rebind', on);
}
