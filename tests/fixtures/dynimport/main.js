$.ready(async ($) => {
    try {
        const m = await import('./part.js');
        if (typeof m.default === 'function') m.default($);
        $.store.set('dyn', 'ok');
    } catch (e) {
        $.store.set('dyn', 'ошибка: ' + e);
    }
});
