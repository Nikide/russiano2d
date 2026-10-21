// Флаги: значение true/false/число/строка.
function parseValue(v) { if (v === 'true') return true; if (v === 'false') return false; const n = Number(v); return v !== '' && Number.isFinite(n) ? n : v; }

export default function storyFlag(node, config, $) {
    const handlers = config.rules.map((s) => s.split('=')).filter((p) => p.length >= 2).map(([ev, flag, val]) =>
        [ev.trim(), () => { $.story.set(flag.trim(), parseValue((val ?? 'true').trim())); $.emit('flag', { flag: flag.trim() }); }]);
    for (const [ev, h] of handlers) $.on(ev, h);
    return () => { for (const [ev, h] of handlers) $.off(ev, h); };
}
