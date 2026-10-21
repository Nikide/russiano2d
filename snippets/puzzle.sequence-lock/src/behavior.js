
// Последовательность: события-входы сверяются с решением по одному.
function sequenceChecker($, node, steps, solution, solved, onWrong) {
    let pos = 0, done = false;
    const handlers = steps.map((ev) => [ev, () => {
        if (done) return;
        if (ev === solution[pos]) { pos++; node.emit('puzzle:step', { pos }); if (pos === solution.length) { done = true; $.emit(solved, { puzzle: node.attr('id') }); } }
        else { pos = ev === solution[0] ? 1 : 0; node.emit('puzzle:wrong', {}); if (onWrong) onWrong(); }
    }]);
    for (const [ev, h] of handlers) $.on(ev, h);
    return () => { for (const [ev, h] of handlers) $.off(ev, h); };
}

export default function sequenceLock(node, config, $) {
    return sequenceChecker($, node, [...new Set(config.solution)], config.solution, config.solvedEvent);
}
