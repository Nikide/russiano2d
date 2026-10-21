// Паспорт объекта в данных узла: читают диалоги, подсказки, HUD.
export default function identity(node, config, $) {
    node.data('identity', { name: config.name, portrait: config.portrait || '', description: config.description });
    return () => {};
}
