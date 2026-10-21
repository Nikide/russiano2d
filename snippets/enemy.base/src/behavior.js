// Противник: класс enemy, команда, здоровье, цель в данных для ai.*.
export default function enemyBase(node, config, $) {
    node.addClass('enemy').team(config.team).health(config.hp).data('target', config.target);
    return () => node.removeClass('enemy');
}
