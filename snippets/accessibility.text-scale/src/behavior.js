// Масштаб текста: хранится в $.store; UI-документы пакетов строятся с ним.
export default function textScale(node, config, $) {
    if ($.store.get('textScale') === undefined) $.store.set('textScale', config.scale);
    $.ui.scale($.store.get('textScale', config.scale));
    $.emit('accessibility:text-scale', { scale: $.store.get('textScale') });
    return () => {};
}
