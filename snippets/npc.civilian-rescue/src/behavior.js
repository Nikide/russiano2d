// Эвакуация: касание actor — следует за ним; пересечение safe — $.emit('rescued').
export default function civilianRescue(node, config, $) {
    let following = false;
    return $.updateFor(node, (dt, self) => {
        const who = $(config.actor);
        if (!who.length) return;
        if (!following && self.overlaps(who)) { following = true; self.emit('rescue:start', {}); }
        if (!following) return;
        if ($(config.safe).some((i, z) => self.overlaps(z))) {
            following = false;
            $.emit('rescued', { civilian: self.attr('id') });
            if (config.removeOnSafe) self.remove();
            return;
        }
        if (self.distanceTo(who) > 30) self.moveTowards(who, config.speed);
    });
}
