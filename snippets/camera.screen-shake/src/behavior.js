// Тряска: сравнение здоровья между кадрами — урон из любого источника.
export default function screenShake(node, config, $) {
    let last = node.hp();
    return $.updateFor(node, (dt, self) => {
        const hp = self.hp();
        if (hp < last) $.camera.shake(config.strength, config.duration);
        last = hp;
    });
}
