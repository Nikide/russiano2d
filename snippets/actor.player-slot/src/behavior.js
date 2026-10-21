// Слот игрока: данные и класс player-<n>.
export default function playerSlot(node, config, $) {
    node.data('playerSlot', config.player).addClass('player-' + config.player);
    return () => node.removeClass('player-' + config.player);
}
