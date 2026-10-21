// r2d-snippets: generated a3cf69d2224dba7c
// movement.topdown@1.0.0 (builtin), источник: src/behavior.js
// Не править вручную: Editor («Кирпичики») или r2d snippet. Ручная правка
// будет обнаружена (SNIP120) и не перезапишется молча.
// Top-down: вектор ввода → скорость узла.
export default function topdown(node, config, $) {
    return $.updateFor(node, (dt, self) => {
        const v = $.input.vec(config.keys);
        self.velocity(v.x * config.speed, v.y * config.speed);
    });
}
