// Слот игрока: данные и класс player-<n>.
export default function playerSlot(node, config, $) {
    node.data('playerSlot', config.slot).addClass('player-' + config.slot);
    return () => node.removeClass('player-' + config.slot);
}
