// Hit-stop: $.time.hitStop; reduceMotion — без паузы.
export default function hitPause(node, config, $) {
    const on = (e) => { if (e.data.amount >= config.minDamage && !$.store.get('reduceMotion', false)) $.time.hitStop(config.ms); };
    node.on('damaged', on);
    return () => node.off('damaged', on);
}
