
// Инвентарь узла — контейнер $.inv в data('inv') (создаёт inventory.grid).
function bagOf(w) { const b = w && w.length ? w.data('inv') : null; return b && b.add ? b : null; }

export default function attachments(node, config, $) {
    const on = (e) => {
        const mod = e.data && e.data.mod, gun = $.weapons.of(node), bag = bagOf(node);
        if (!gun || !mod || !$.weapons.mod(mod)) { node.emit('attach:denied', { mod, reason: 'unknown' }); return; }
        if (config.consume && bag && $.items.has(mod) && !bag.has(mod)) { node.emit('attach:denied', { mod, reason: 'missing' }); return; }
        const prev = gun.attach(mod);
        if (prev === false || prev === null && !gun.mods().includes(mod)) { node.emit('attach:denied', { mod, reason: 'slot' }); return; }
        if (config.consume && bag && $.items.has(mod)) bag.remove(mod, 1);
        node.emit('attached', { mod, replaced: prev || null });
    };
    node.on('attach', on);
    return () => node.off('attach', on);
}
