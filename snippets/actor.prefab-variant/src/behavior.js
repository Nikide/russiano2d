// Вариант prefab: экземпляры в мире у позиции маркера; без такого prefab — событие ошибки.
export default function prefabVariant(node, config, $) {
    if (!config.prefab || !$.prefab.has(config.prefab)) { node.emit('prefab:missing', { prefab: config.prefab }); return () => {}; }
    const p = node.pos();
    $.prefab.instantiate(config.prefab, { count: config.count, x: p.x + config.offset[0], y: p.y + config.offset[1], parent: $.world });
    return () => {};
}
