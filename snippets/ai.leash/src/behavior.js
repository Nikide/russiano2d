// Поводок: старт запоминается при подключении; за радиусом — возврат.
export default function leash(node, config, $) {
    const home = node.pos();
    let returning = false;
    return $.updateFor(node, (dt, self) => {
        const p = self.pos();
        const d = Math.hypot(p.x - home.x, p.y - home.y);
        if (d > config.radius) returning = true;
        if (!returning) return;
        if (d < 4) { returning = false; self.emit('leash:home', {}); return; }
        self.moveTowards(home, config.speed);
    });
}
