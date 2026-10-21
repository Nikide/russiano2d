// Контрольная точка → $.save.set('player', { x, y, hp }) и save в слот.
export default function saveCheckpoint(node, config, $) {
    const on = () => {
        const p = $(config.player);
        if (!p.length) return;
        const cp = p.data('checkpoint') || p.pos();
        $.save.set('player', { x: cp.x, y: cp.y, hp: p.hp() });
        $.save.slot(config.saveSlot).save({ meta: { checkpoint: cp.id || null } });
    };
    $.on('checkpoint', on);
    $.on('checkpoint:chain', on);
    return () => { $.off('checkpoint', on); $.off('checkpoint:chain', on); };
}
