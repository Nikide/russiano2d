// Флаг $.store reduceMotion — его читают camera.trauma, render.flash, feedback.*.
export default function reduceMotion(node, config, $) {
    if ($.store.get('reduceMotion') === undefined) $.store.set('reduceMotion', config.on);
    $.emit('accessibility:reduce-motion', { on: $.store.get('reduceMotion') });
    return () => {};
}
