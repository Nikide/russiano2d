// Кошелёк: { coin: 10, gem: 1 }; основная валюта дублируется в data('money') для economy.*.
export default function currency(node, config, $) {
    const wallet = node.data('wallet') || {};
    const sync = () => { node.data('wallet', { ...wallet }); if (config.main) node.data('money', wallet[config.main] || 0); };
    const take = (e) => {
        const d = e.data || {};
        if (!config.currencies.includes(d.item) || (d.by && $(d.by).get(0) !== node.get(0))) return;
        wallet[d.item] = (wallet[d.item] || 0) + (d.count || 1);
        sync();
        node.emit('currency', { item: d.item, total: wallet[d.item] });
    };
    const onMoney = () => { if (config.main) wallet[config.main] = Number(node.data('money')) || 0; node.data('wallet', { ...wallet }); };
    $.on('pickup', take);
    node.on('money:changed', onMoney);
    sync();
    return () => { $.off('pickup', take); node.off('money:changed', onMoney); };
}
