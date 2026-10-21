// Журнал: каждое money:changed → { t, delta, reason, money }.
export default function ledger(node, config, $) {
    const log = node.data('ledger') || [];
    const on = (e) => { log.push({ t: Math.round($.time.now()), ...e.data }); while (log.length > config.keep) log.shift(); node.data('ledger', log); };
    node.on('money:changed', on);
    node.data('ledger', log);
    return () => node.off('money:changed', on);
}
