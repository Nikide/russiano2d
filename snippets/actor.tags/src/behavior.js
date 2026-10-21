// Классы и теги: ставятся при подключении и снимаются при отключении.
export default function actorTags(node, config, $) {
    for (const c of config.classes) node.addClass(c);
    for (const t of config.tags) node.addTag(t);
    return () => { for (const c of config.classes) node.removeClass(c); for (const t of config.tags) node.removeTag(t); };
}
