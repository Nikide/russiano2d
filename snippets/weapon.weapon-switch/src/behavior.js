// Смена ствола: $.weapons.give(узел, id) — только описанные в $.weapons стволы.
export default function weaponSwitch(node, config, $) {
    let index = -1;
    const pick = (self, i) => {
        if (i === index || i < 0 || i >= config.weapons.length || !$.weapons.has(config.weapons[i])) return;
        const cur = $.weapons.of(self);
        if (cur) cur.cancelReload();
        index = i;
        $.weapons.give(self, config.weapons[i]);
        self.emit('weapon:switch', { slot: i + 1, weapon: config.weapons[i] });
    };
    return $.updateFor(node, (dt, self) => {
        if (index < 0) { const cur = $.weapons.of(self); index = cur ? Math.max(0, config.weapons.indexOf(cur.id)) : -1; }
        for (let i = 0; i < config.weapons.length && i < 9; i++) if ($.input.pressed(String(i + 1))) pick(self, i);
        if ($.input.pressed(config.next) || $.input.wheel() < 0) pick(self, (index + 1) % config.weapons.length);
        else if ($.input.wheel() > 0) pick(self, (index - 1 + config.weapons.length) % config.weapons.length);
    });
}
