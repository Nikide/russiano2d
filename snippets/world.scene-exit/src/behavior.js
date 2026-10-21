
// Сюжетные флаги — $.story.flags (общие со сценками и $.quest).
function flags($) { const f = $.story.flags; return (typeof f === 'function' ? f() : f) || {}; }

export default function sceneExit(node, config, $) {
    let fired = false;
    return $.updateFor(node, (dt, self) => {
        const p = $(config.player);
        if (fired || !p.length || !self.overlaps(p) || !config.scene) return;
        if (config.requireFlag && !flags($)[config.requireFlag]) { self.emit('exit:locked', {}); return; }
        fired = true;
        if (config.spawn) $.store.set('spawn', config.spawn);
        $.scene.load(config.scene);
    });
}
