// Зона: признак attrs.trigger + detect ($.triggers); события пересылаются в $.emit.
export default function triggerBase(node, config, $) {
    node.attr('trigger', true);
    if (config.detect) node.attr('detect', config.detect);
    let fired = false;
    const id = node.attr('id');
    const onEnter = (e) => {
        if (config.once && fired) return;
        fired = true;
        if (config.enterEvent) $.emit(config.enterEvent, { zone: id, other: e.data.other });
    };
    const onLeave = (e) => { if (config.leaveEvent) $.emit(config.leaveEvent, { zone: id, other: e.data.other }); };
    node.on('enter', onEnter);
    node.on('leave', onLeave);
    return () => { node.off('enter', onEnter); node.off('leave', onLeave); };
}
