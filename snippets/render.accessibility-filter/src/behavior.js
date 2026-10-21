// Коррекция: настройка в $.store accessibilityFilter; UI и пакеты читают её.
export default function accessibilityFilter(node, config, $) {
    $.store.set('accessibilityFilter', config.mode);
    $.emit('accessibility:filter', { mode: config.mode });
    if (config.mode === 'high-contrast') $.world.color('#000000');
    return () => { $.store.set('accessibilityFilter', 'none'); $.emit('accessibility:filter', { mode: 'none' }); };
}
