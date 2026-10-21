// Разрыв: событие disconnect от хоста → документ с кнопками.
export default function disconnectScreen(node, config, $) {
    const doc = $.ui.markup('snippets/net-disconnect.rml', '<rml><head><style>body { width: 100%; height: 100%; } #d { position: absolute; left: 35%; top: 35%; width: 30%; padding: 12px; background-color: #1a1f2a; color: #ffffff; text-align: center; } .b { display: block; padding: 6px; }</style></head><body><div id="d"><div id="why">Соединение потеряно</div><div class="b" data-key="retry">Переподключиться</div><div class="b" data-key="menu">В меню</div></div></body></rml>');
    doc.hide();
    const lost = (peer) => { if ($.net.isAuthority()) return; doc.text('why', 'Соединение потеряно: ' + String((peer && peer.reason) || 'нет связи')); doc.show(); };
    doc.on('d', 'click', (id, ev, key) => { doc.hide(); if (key === 'retry') $.emit('net:reconnect', {}); if (key === 'menu') $.scene.load(config.menuScene); });
    $.net.on('disconnect', lost);
    return () => { $.net.off('disconnect', lost); doc.unload(); };
}
