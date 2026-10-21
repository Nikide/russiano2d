// Сцена использует штатный transition; затемнение story — только RmlUi.
export default function sceneTransition(node, config, $) {
    let doc = null, phase = 0, alpha = 0;
    const go = () => {
        if (config.scene) { $.scene.load(config.scene, { transition: 'fade', ms: config.fade }); return; }
        if (!config.script || phase) return;
        if (!doc) doc = $.ui.markup('snippets-transition-' + node.attr('id') + '.rml', '<rml><head><style>body { margin: 0px; width: 100%; height: 100%; } #veil { position: absolute; left: 0px; top: 0px; width: 100%; height: 100%; background-color: #000000; opacity: 0; }</style></head><body><div id="veil"/></body></rml>');
        alpha = 0; phase = 1; doc.show();
    };
    $.on(config.event, go);
    const stop = $.updateFor(node, (dt) => {
        if (!phase) return;
        const step = config.fade ? dt * 1000 / config.fade : 1;
        alpha = phase === 1 ? Math.min(1, alpha + step) : Math.max(0, alpha - step);
        doc.style('veil', 'opacity', String(alpha));
        if (phase === 1 && alpha === 1) { phase = 2; $.story.play(config.script); }
        else if (phase === 2 && alpha === 0) { phase = 0; doc.hide(); }
    });
    return () => { stop(); $.off(config.event, go); if (doc) doc.unload(); };
}
