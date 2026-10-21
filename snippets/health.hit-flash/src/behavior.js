// Вспышка: .flash(цвет, мс) при падении hp.
export default function hitFlash(node, config, $) {
    let last = node.hp();
    return $.updateFor(node, (dt, self) => {
        const hp = self.hp();
        if (hp < last) self.flash(config.color, config.duration);
        last = hp;
    });
}
