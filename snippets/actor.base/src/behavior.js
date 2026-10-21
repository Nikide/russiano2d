// Сущность: классы и видимость; снятие возвращает как было.
export default function actorBase(node, config, $) {
    for (const c of config.classes) node.addClass(c);
    if (config.label) node.data('label', config.label);
    if (!config.visible) node.hide();
    return () => { for (const c of config.classes) node.removeClass(c); if (!config.visible) node.show(); };
}
