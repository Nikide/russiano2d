// Оружие — дочерний узел (наследует отражение); угол — к мыши в мире.
export default function weaponOverlay(node, config, $) {
    const gun = $('<weapon-sprite>').sprite(config.sprite).appendTo(node);
    gun.localAt ? gun.localAt(config.offset[0], config.offset[1]) : gun.at(node.pos().x + config.offset[0], node.pos().y + config.offset[1]);
    const stop = $.updateFor(node, (dt, self) => {
        if (!config.aim) return;
        const m = $.input.mouseWorld();
        if (m) gun.lookAt(m);
    });
    return () => { stop(); gun.remove(); };
}
