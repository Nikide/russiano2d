// Правила: хост → session:rules при подключении; клиенты — $.store.
function value(v) { if (v === 'true') return true; if (v === 'false') return false; const n = Number(v); return Number.isFinite(n) && v !== '' ? n : v; }
export default function sessionSettings(node, config, $) {
    const rules = Object.fromEntries(config.rules.map((s) => s.split('=')).filter((p) => p.length === 2).map(([k, v]) => [k.trim(), value(v.trim())]));
    $.store.set('session', rules);
    const share = (peer) => { if ($.net.isAuthority()) $.net.send('session:rules', rules, { peer: peer.id, delivery: 'reliable' }); };
    const apply = (data) => { $.store.set('session', data || {}); $.emit('session:rules', data || {}); };
    $.net.on('connect', share);
    $.net.on('session:rules', apply);
    return () => { $.net.off('connect', share); $.net.off('session:rules', apply); };
}
