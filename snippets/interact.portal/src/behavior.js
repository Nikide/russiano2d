// Портал: один раз за касание; spawn для следующей сцены — в $.store.
export default function portal(node, config, $) {
    let inside = false;
    return $.updateFor(node, (dt, self) => {
        const who = $(config.actor);
        const now = who.length && self.overlaps(who);
        if (now && !inside && config.scene) {
            if (config.spawn) $.store.set('spawn', config.spawn);
            self.emit('portal', { scene: config.scene });
            $.scene.load(config.scene);
        }
        inside = !!now;
    });
}
