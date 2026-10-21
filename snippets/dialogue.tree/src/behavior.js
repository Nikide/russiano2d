
// Реплики строками «id | говорящий | текст | куда» (куда пусто — конец),
// варианты — «id реплики | текст | куда | флаг-условие».
function parseLines(lines) {
    const nodes = {};
    for (const s of lines) { const [id, speaker, text, to] = s.split('|').map((x) => (x || '').trim()); if (id) nodes[id] = { speaker: speaker || undefined, text: text || '', to: to || null }; }
    return nodes;
}
function addChoices(nodes, list) {
    for (const s of list) {
        const [at, text, to, flag] = s.split('|').map((x) => (x || '').trim());
        if (!nodes[at] || !text) continue;
        (nodes[at].choices || (nodes[at].choices = [])).push(Object.assign({ text, to: to || null, action: text }, flag ? { if: flag } : {}));
    }
}

export default function dialogueTree(node, config, $) {
    const nodes = parseLines(config.lines);
    addChoices(nodes, config.choices);
    if (!Object.keys(nodes).length) return () => {};
    const define = () => $.dialog.define(config.id, { nodes, start: nodes.start ? 'start' : Object.keys(nodes)[0], speed: config.speed });
    define();
    // dialogue.choice других пакетов дополняет варианты событием dialogue:choices.
    const extend = (e) => {
        const d = e.data || {};
        if (d.dialog !== config.id || !nodes[d.line]) return;
        const list = nodes[d.line].choices || (nodes[d.line].choices = []);
        for (const c of d.options || []) if (!list.some((x) => x.text === c.text)) list.push(c);
        define();
    };
    const play = (e) => { if (!e.data || !e.data.id || e.data.id === config.id) $.dialog.play(config.id); };
    $.on('dialogue:choices', extend);
    $.on('dialogue:play', play);
    $.emit('dialogue:defined', { id: config.id });
    return () => { $.off('dialogue:choices', extend); $.off('dialogue:play', play); };
}
