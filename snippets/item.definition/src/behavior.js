// Описание предмета — данные $.items; runtime-логики нет.
export default function itemDefinition(node, config, $) {
    $.items.define({ id: config.id, title: config.title, kind: config.kind, size: config.size, mass: config.mass,
        value: config.value, stack: config.stack, heal: config.heal, icon: config.icon || '' });
    return () => {};
}
