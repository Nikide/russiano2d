
// Сюжетные флаги — $.story.flags (общие со сценками и $.quest).
function flags($) { const f = $.story.flags; return (typeof f === 'function' ? f() : f) || {}; }

export default function sceneExit(node, config, $) {
    // Сущность по селектору: ищется заново, только если прежний узел исчез.
    const cache = {};
    const sel = (s) => { const c = cache[s]; if (c && c.length && !c.get(0).removed) return c; return (cache[s] = $(s)); };
    let fired = false;
    return $.updateFor(node, (dt, self) => {
        const p = sel(config.player);
        if (fired || !p.length || !self.overlaps(p) || !config.scene) return;
        if (config.requireFlag && !flags($)[config.requireFlag]) { self.emit('exit:locked', {}); return; }
        fired = true;
        if (config.spawn) $.store.set('spawn', config.spawn);
        $.scene.load(config.scene);
    });
}
