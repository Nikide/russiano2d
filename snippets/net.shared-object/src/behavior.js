// Общий объект: локальное нажатие → rpc shared:use; хост переключает data on и рассылает.
export default function sharedObject(node, config, $) {
    const id = node.attr('id');
    const toggle = () => { const on = !node.data('on'); node.data('on', on).emit('shared:state', { on }); if ($.net.online()) $.net.broadcast('shared:state', { id, on }, { delivery: 'reliable' }); $.emit('shared:toggled', { id, on }); };
    const handle = (data, peerId) => { const by = $('#player:' + peerId); if (data && data.id === id && by.length && by.distanceTo(node) <= config.radius) toggle(); };
    const sync = (data) => { if (data && data.id === id && !$.net.isAuthority()) node.data('on', data.on).emit('shared:state', { on: data.on }); };
    $.net.handle('shared:use', handle);
    $.net.on('shared:state', sync);
    const stop = $.updateFor(node, () => {
        if (!$.input.pressed(config.key)) return;
        if ($.net.online() && !$.net.isAuthority()) $.net.rpc('shared:use', { id }); else toggle();
    });
    return () => { stop(); $.net.unhandle('shared:use'); $.net.off('shared:state', sync); };
}
