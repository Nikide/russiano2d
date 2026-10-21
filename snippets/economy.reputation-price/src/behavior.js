// Скидка: buyer.data('reputation')[faction] → buyer.data('priceMulFor:<id лавки>').
export default function reputationPrice(node, config, $) {
    return $.updateFor(node, (dt, self) => {
        const b = $(config.buyer);
        if (!b.length) return;
        const rep = (b.data('reputation') || {})[config.faction] || 0;
        const mul = 1 - Math.max(-config.maxDiscount, Math.min(config.maxDiscount, rep * config.perPoint));
        b.data('priceMulFor:' + self.attr('id'), mul);
    });
}
