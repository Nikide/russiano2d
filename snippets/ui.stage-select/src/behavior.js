// Выбор: открыт первый и все, у кого есть результат предыдущего ($.save results).
export default function stageSelect(node, config, $) {
    const list = config.stages.map((s) => s.split('=')).filter((p) => p[0]).map(([sc, t]) => ({ scene: sc.trim(), title: (t || sc).trim() }));
    const doc = $.ui.markup('snippets/stage-select.rml', '<rml><head><style>body { width: 100%; height: 100%; } #s { position: absolute; left: 30%; top: 15%; width: 40%; padding: 10px; background-color: #10141c; color: #ffffff; } .st { display: block; padding: 6px; } .st.locked { color: #606878; }</style></head><body><div id="s"></div></body></rml>');
    doc.hide();
    const render = () => {
        const res = $.save.get('results') || {};
        doc.html('s', list.map((st, i) => { const open = i === 0 || !!res[list[i - 1].scene]; const r = res[st.scene];
            return '<div class="st' + (open ? '' : ' locked') + '" data-key="' + (open ? st.scene : '') + '">' + st.title + (r ? ' — ' + (r.time / 1000).toFixed(1) + ' с' : '') + '</div>'; }).join(''));
    };
    const open = () => { render(); doc.show(); };
    doc.on('s', 'click', (id, ev, key) => { if (key) { doc.hide(); $.scene.load(key); } });
    $.on(config.openEvent, open);
    return () => { $.off(config.openEvent, open); doc.unload(); };
}
