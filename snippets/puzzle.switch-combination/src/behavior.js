
// «id=число» → [[id, число], …]
function counts(list) {
    return list.map((s) => s.split('=')).filter((p) => p.length >= 2 && p[0].trim() && Number.isFinite(Number(p[1])))
        .map((p) => [p[0].trim(), Number(p[1])]);
}

export default function switchCombination(node, config, $) {
    const want = counts(config.switches);
    let solved = false;
    return $.updateFor(node, () => {
        const ok = want.every(([id, v]) => { const s = $('#' + id); return s.length && !!s.data('on') === !!v; });
        if (ok === solved) return;
        solved = ok;
        if (ok) $.emit(config.solvedEvent, { puzzle: node.attr('id') }); else $.emit('puzzle:unsolved', { puzzle: node.attr('id') });
    });
}
