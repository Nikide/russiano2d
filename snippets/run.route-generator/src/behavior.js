// Маршрут: $.random.seed → выбор комнат; хранится в $.save run.route; run:next грузит следующую.
export default function routeGenerator(node, config, $) {
    let run = $.save.get('run');
    if (!run || !run.route) {
        if (config.seed) $.random.seed(config.seed);
        const route = [];
        for (let i = 0; i < config.length; i++) route.push($.random.pick(config.rooms));
        if (config.boss) route.push(config.boss);
        run = { seed: config.seed || $.random.seed(), route, index: -1 };
        $.save.set('run', run);
    }
    const next = () => {
        run.index++;
        $.save.set('run', run);
        if (run.index >= run.route.length) { $.emit('run:complete', {}); return; }
        $.emit('run:room', { index: run.index, scene: run.route[run.index] });
        $.scene.load(run.route[run.index]);
    };
    $.on('run:next', next);
    node.data('route', run.route);
    return () => $.off('run:next', next);
}
