// Формат: $.i18n.number по текущему языку; ответ — e.data.result (синхронно).
export default function numberTime(node, config, $) {
    const num = (e) => { if (e.data) e.data.result = $.i18n.number(e.data.value); };
    const time = (e) => {
        if (!e.data) return;
        const t = Math.max(0, Math.floor((e.data.ms || 0) / 1000)), h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = t % 60, p = (v) => String(v).padStart(2, '0');
        e.data.result = config.clock === 'h:mm:ss' ? h + ':' + p(m) + ':' + p(s) : p(Math.floor(t / 60)) + ':' + p(s);
    };
    $.on('format:number', num);
    $.on('format:time', time);
    return () => { $.off('format:number', num); $.off('format:time', time); };
}
