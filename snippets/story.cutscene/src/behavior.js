// Шаги: letterbox:доля | camera:x,y,zoom,ms | say:текст | wait:ms | shake:сила,ms | sfx:путь.
function parse(list) {
    return list.map((s) => { const i = s.indexOf(':'); const k = (i < 0 ? s : s.slice(0, i)).trim(), v = i < 0 ? '' : s.slice(i + 1).trim(); const n = v.split(',').map(Number);
        if (k === 'letterbox') return { letterbox: Number(v) || 0 };
        if (k === 'camera') return { camera: { at: [n[0], n[1]], zoom: n[2] || 1, ms: n[3] || 500 } };
        if (k === 'say') return { say: v };
        if (k === 'wait') return { wait: Number(v) || 0 };
        if (k === 'shake') return { shake: n[0] || 4, ms: n[1] || 300 };
        if (k === 'sfx') return { sfx: v };
        return null; }).filter(Boolean);
}

export default function storyCutscene(node, config, $) {
    $.cutscene.define(config.name, [{ take: 'input' }, ...parse(config.steps), { give: 'input' }]);
    const play = () => $.cutscene.play(config.name);
    $.on(config.event, play);
    return () => $.off(config.event, play);
}
