// Прочность — здоровье узла; при 0 — результат и prefab на месте.
export default function breakable(node, config, $) {
    node.health(config.durability).addClass('breakable');
    let done = false;
    return $.updateFor(node, (dt, self) => {
        if (done || self.alive()) return;
        done = true;
        const p = self.pos();
        if (config.drop && $.prefab.has(config.drop)) $.prefab.instantiate(config.drop, { x: p.x, y: p.y, parent: $.world });
        self.emit('broken', {});
        if (config.result === 'fade') self.fadeOut(200).then(() => self.remove()); else self.remove();
    });
}
