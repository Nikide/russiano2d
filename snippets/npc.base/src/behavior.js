// NPC: команда узла (.team) и профиль в данных; поведение — отдельными пакетами ai.*.
export default function npcBase(node, config, $) {
    node.addClass('npc').addClass('npc-' + config.profile).team(config.team).data('profile', config.profile);
    return () => node.removeClass('npc').removeClass('npc-' + config.profile);
}
