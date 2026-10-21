// Приседание: высота хитбокса × height (через .size), горизонтальная скорость × speedFactor.
export default function crouch(node, config, $) {
    let base = null;
    const stop = $.updateFor(node, (dt, self) => {
        const held = $.input.down(config.key);
        if (held && !base) { base = { w: self.width(), h: self.height() }; self.size(base.w, base.h * config.height); self.emit('crouch', { on: true }); }
        else if (!held && base) { self.size(base.w, base.h); base = null; self.emit('crouch', { on: false }); }
        if (base) { const v = self.velocity(); self.velocity(v.x * config.speedFactor, v.y); }
    });
    return () => { stop(); if (base) node.size(base.w, base.h); };
}
