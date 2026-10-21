
// Способности: ability.base шлёт ability:try { id, ok, … } — пакеты могут
// отказать (ok=false, reason) синхронно; затем ability:cast { id, target }.

export default function abilityBase(node, config, $) {
    return $.updateFor(node, (dt, self) => {
        if (!$.input.pressed(config.key)) return;
        const attempt = { id: config.id, ok: true, reason: '', target: null };
        self.emit('ability:try', attempt);
        if (!attempt.ok) { self.emit('ability:denied', { id: config.id, reason: attempt.reason }); return; }
        self.emit('ability:cast', { id: config.id, target: attempt.target || self.pos() });
    });
}
