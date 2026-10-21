// Контраст: .outline у целей, пока режим включён ($.store highContrast).
export default function highContrast(node, config, $) {
    let on = null;
    return $.updateFor(node, () => {
        const want = $.store.get('highContrast', true);
        $(config.targets).each((i, w) => { if (want && !w.data('hcOn')) w.outline(config.color, 2).data('hcOn', true); else if (!want && w.data('hcOn')) w.outline(false).data('hcOn', false); });
        if (want !== on) { on = want; $.emit('accessibility:high-contrast', { on }); }
    });
}
