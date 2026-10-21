// Загадка: вопрос в data; ответ сравнивается после trim и нижнего регистра.
export default function riddle(node, config, $) {
    let left = config.attempts, done = false;
    const ok = config.answers.map((a) => a.trim().toLowerCase());
    node.data('question', config.question).addClass('interactive').data('prompt', config.question);
    const on = (e) => {
        if (done) return;
        const a = String(e.data && e.data.text || '').trim().toLowerCase();
        if (ok.includes(a)) { done = true; node.emit('riddle:right', {}); $.emit(config.solvedEvent, { puzzle: node.attr('id') }); return; }
        if (config.attempts) left--;
        node.emit('riddle:wrong', { left });
        if (config.attempts && left <= 0) { done = true; node.emit('riddle:failed', {}); }
    };
    node.on('riddle:answer', on);
    return () => node.off('riddle:answer', on);
}
