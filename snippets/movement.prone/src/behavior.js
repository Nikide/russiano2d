// Лёжа: переключатель; заметность пишется в данные ('visibility') для ai.line-of-sight и т.п.
export default function prone(node, config, $) {
    let base = null;
    const stop = $.updateFor(node, (dt, self) => {
        if ($.input.pressed(config.key)) {
            if (!base) { base = { w: self.width(), h: self.height() }; self.size(base.w, base.h * config.height).data('visibility', config.visibility); }
            else { self.size(base.w, base.h).data('visibility', 1); base = null; }
            self.emit('prone', { on: !!base });
        }
        if (base) { const v = self.velocity(); self.velocity(v.x * config.speedFactor, v.y * config.speedFactor); }
    });
    return () => { stop(); if (base) node.size(base.w, base.h).data('visibility', 1); };
}
