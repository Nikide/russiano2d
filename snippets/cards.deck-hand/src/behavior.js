// Карты: данные { id, cost }; розыгрыш шлёт card:<id> на узле — эффект решают другие пакеты/игра.
export default function deckHand(node, config, $) {
    let draw = config.deck.map((s) => s.split('=')).filter((p) => p[0]).map(([id, c]) => ({ id: id.trim(), cost: Number(c) || 0 }));
    let hand = [], discard = [], energy = 0;
    const sync = () => node.data('cards', { hand: hand.map((c) => c.id), draw: draw.length, discard: discard.length, energy });
    const shuffle = (a) => { if (!config.shuffle) return a; for (let i = a.length - 1; i > 0; i--) { const j = $.random.int(0, i); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    const drawOne = () => { if (!draw.length) { draw = shuffle(discard); discard = []; } if (draw.length) hand.push(draw.shift()); };
    const startTurn = () => { energy = config.energy; while (hand.length < config.hand && (draw.length || discard.length)) drawOne(); sync(); node.emit('cards:turn', {}); };
    const endTurn = () => { discard.push(...hand); hand = []; sync(); };
    const play = (e) => {
        const i = Number(e.data && e.data.index), c = hand[i];
        if (!c || c.cost > energy) { node.emit('cards:denied', { index: i }); return; }
        energy -= c.cost; hand.splice(i, 1); discard.push(c); sync();
        node.emit('card:' + c.id, { target: e.data.target }); node.emit('cards:played', { id: c.id });
    };
    draw = shuffle(draw);
    node.on('turn:start', startTurn); node.on('turn:end', endTurn); node.on('cards:play', play);
    sync();
    return () => { node.off('turn:start', startTurn); node.off('turn:end', endTurn); node.off('cards:play', play); };
}
