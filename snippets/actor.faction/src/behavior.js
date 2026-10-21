// Фракция: данные узла и класс faction-<имя> для селекторов.
export default function faction(node, config, $) {
    node.data('faction', config.faction).data('allies', config.allies).data('enemies', config.enemies)
        .addClass('faction-' + config.faction);
    return () => node.removeClass('faction-' + config.faction);
}
