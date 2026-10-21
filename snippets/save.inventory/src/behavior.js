
// Данные в сейве — только сериализуемое: числа, строки, массивы, объекты.

function bagOf(w) { const b = w && w.length ? w.data('inv') : null; return b && b.add ? b : null; }

export default function saveInventory(node, config, $) {
    // Сущность по селектору: ищется заново, только если прежний узел исчез.
    const cache = {};
    const sel = (s) => { const c = cache[s]; if (c && c.length && !c.get(0).removed) return c; return (cache[s] = $(s)); };
    const write = () => { const p = sel(config.player), bag = bagOf(p); if (bag) $.save.set('inventory', { bag: bag.save(), money: Number(p.data('money')) || 0 }); };
    const read = () => { const p = sel(config.player), d = $.save.get('inventory'); if (!d || !p.length) return; const bag = bagOf(p); if (bag && d.bag) bag.load(d.bag); p.data('money', d.money || 0); p.emit('inv:changed', {}); };
    $.on('save:before', write);
    $.on('saved', write);
    $.on('loaded', read);
    return () => { $.off('save:before', write); $.off('saved', write); $.off('loaded', read); };
}
