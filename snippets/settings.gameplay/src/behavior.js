// Сложность — фильтр урона игрока; текст — $.dialog.speed.
const MUL = { easy: 0.5, normal: 1, hard: 1.5 };
export default function settingsGameplay(node, config, $) {
    const s = () => Object.assign({ difficulty: config.difficulty, textSpeed: config.textSpeed, hints: config.hints }, $.store.get('gameplay', {}));
    $.dialog.speed(s().textSpeed);
    $.store.set('hints', s().hints);
    const p = $(config.player);
    const off = p.length ? p.damageFilter((info) => info.amount * (MUL[s().difficulty] || 1)) : () => {};
    const on = (e) => { const d = e.data || {}; const cur = $.store.get('gameplay', {}); cur[d.key] = d.value; $.store.set('gameplay', cur); $.dialog.speed(s().textSpeed); $.store.set('hints', s().hints); };
    $.on('gameplay:set', on);
    return () => { off(); $.off('gameplay:set', on); };
}
