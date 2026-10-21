
function nearPress($, self, config) {
    const who = $(config.actor);
    return who.length && self.distanceTo(who) <= config.radius && $.input.pressed(config.key) ? who : null;
}

function bagOf(w) { const b = w && w.length ? w.data('inv') : null; return b && b.add ? b : null; }

export default function crop(node, config, $) {
    let state = 'empty', grown = 0, watered = false;
    node.addClass('interactive').data('prompt', 'Посадить');
    const set = (s) => { state = s; node.data('crop', s).data('prompt', s === 'empty' ? 'Посадить' : s === 'ripe' ? 'Собрать' : 'Полить'); node.emit('crop:' + s, {}); };
    const water = () => { if (state === 'growing') { watered = true; node.emit('crop:watered', {}); } };
    node.on('water', water);
    const stop = $.updateFor(node, (dt, self) => {
        if (state === 'growing' && (watered || !config.needsWater)) {
            grown += dt * 1000;
            self.data('stage', Math.min(config.stages, 1 + Math.floor(grown / config.growMs * config.stages)));
            if (grown >= config.growMs) set('ripe');
        }
        const who = nearPress($, self, config);
        if (!who) return;
        const bag = bagOf(who);
        if (state === 'empty') { if (!bag || !bag.has(config.seed)) { self.emit('crop:no-seed', {}); return; } bag.remove(config.seed, 1); grown = 0; watered = false; set('growing'); }
        else if (state === 'growing') water();
        else if (state === 'ripe') { if (bag && $.items.has(config.harvest)) bag.add(config.harvest, config.yield); else $.emit('pickup', { item: config.harvest, count: config.yield, by: who }); set('empty'); }
    });
    return () => { stop(); node.off('water', water); };
}
