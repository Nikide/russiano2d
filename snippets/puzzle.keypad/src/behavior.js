// Панель: набранное — data('entered'); Enter — проверка.
export default function keypad(node, config, $) {
    let entered = '', left = config.attempts, done = false;
    return $.updateFor(node, (dt, self) => {
        const who = $(config.actor);
        if (done || !who.length || self.distanceTo(who) > config.radius) return;
        for (let d = 0; d <= 9; d++) if ($.input.pressed(String(d)) && entered.length < config.code.length) entered += d;
        if ($.input.pressed('backspace')) entered = entered.slice(0, -1);
        self.data('entered', entered);
        if (!$.input.pressed('return') && entered.length < config.code.length) return;
        if (entered === config.code) { done = true; $.emit(config.solvedEvent, { puzzle: self.attr('id') }); self.emit('keypad:ok', {}); }
        else { entered = ''; if (config.attempts) left--; self.emit('keypad:wrong', { left }); if (config.attempts && left <= 0) { done = true; self.emit('keypad:locked', {}); } }
    });
}
