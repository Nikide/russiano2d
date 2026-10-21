// Быстрые слоты: цифры выбирают активный предмет; событие quickbar.
export default function quickbar(node, config, $) {
    node.data('quickbar', config.slots.slice());
    return $.updateFor(node, (dt, self) => {
        for (let i = 0; i < config.slots.length && i < 10; i++) {
            if (!$.input.pressed(String((config.first + i) % 10))) continue;
            self.data('activeItem', config.slots[i]).emit('quickbar', { slot: i, item: config.slots[i] });
        }
    });
}
