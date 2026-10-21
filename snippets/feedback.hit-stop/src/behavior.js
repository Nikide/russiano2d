// Hit-stop по глобальному событию; reduceMotion — выкл.
export default function hitStop(node, config, $) {
    const go = () => { if (!$.store.get('reduceMotion', false)) $.time.hitStop(config.ms); };
    $.on(config.event, go);
    return () => $.off(config.event, go);
}
