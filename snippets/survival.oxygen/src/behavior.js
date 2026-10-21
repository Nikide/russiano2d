// Кислород: data('oxygen'); под водой — расход, без запаса — урон типа drown.
export default function oxygen(node, config, $) {
    let o2 = config.max, carry = 0;
    node.data('oxygen', o2);
    return $.updateFor(node, (dt, self) => {
        const wet = $(config.water).some((i, w) => self.overlaps(w));
        o2 = Math.max(0, Math.min(config.max, o2 + (wet ? -config.drain : config.refill) * dt));
        self.data('oxygen', o2).data('oxygenMax', config.max);
        if (o2 > 0 || !wet) { carry = 0; return; }
        carry += config.damage * dt;
        if (carry >= 1) { const n = Math.floor(carry); carry -= n; self.damage(n, null, 'drown'); }
    });
}
