// Регенерация: таймер сбрасывается при падении hp, затем heal каждый кадр.
export default function regeneration(node, config, $) {
    let last = node.hp(), quiet = 0, carry = 0;
    return $.updateFor(node, (dt, self) => {
        const hp = self.hp();
        if (hp < last) { quiet = 0; carry = 0; }
        last = hp;
        if (!self.alive()) return;
        quiet += dt * 1000;
        if (quiet < config.delay) return;
        carry += config.rate * dt;
        if (carry >= 1) { const n = Math.floor(carry); carry -= n; self.heal(n); last = self.hp(); }
    });
}
