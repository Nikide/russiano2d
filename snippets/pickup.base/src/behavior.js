// Подбор по радиусу: $.emit('pickup', …) — инвентарь/счёт подписываются сами.
export default function pickupBase(node, config, $) {
    return $.updateFor(node, (dt, self) => {
        const who = $(config.collector);
        if (!who.length || self.distanceTo(who) > config.radius) return;
        $.emit('pickup', { item: config.item, count: config.count, by: who });
        self.remove();
    });
}
