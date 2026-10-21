// RPC: хост отбрасывает лишние поля и неверные типы, затем рассылает.
export default function rpcAction(node, config, $) {
    const schema = Object.fromEntries(config.schema.map((s) => s.split('=')).filter((p) => p.length === 2).map(([k, t]) => [k.trim(), t.trim()]));
    const clean = (data) => { const out = {}; for (const [k, t] of Object.entries(schema)) { const v = data && data[k]; if (typeof v === (t === 'bool' ? 'boolean' : t)) out[k] = v; else return null; } return out; };
    const handle = (data, peerId) => { const ok = clean(data); if (!ok) { $.net.send(config.name + ':invalid', {}, { peer: peerId }); return; } $.net.broadcast(config.name, { ...ok, by: peerId }, { delivery: 'reliable' }); $.emit(config.name, { ...ok, by: peerId }); };
    const relay = (data) => { if (!$.net.isAuthority()) $.emit(config.name, data); };
    const ask = (e) => $.net.rpc(config.name, e.data || {});
    $.net.handle(config.name, handle);
    $.net.on(config.name, relay);
    $.on(config.name + ':request', ask);
    return () => { $.net.unhandle(config.name); $.net.off(config.name, relay); $.off(config.name + ':request', ask); };
}
