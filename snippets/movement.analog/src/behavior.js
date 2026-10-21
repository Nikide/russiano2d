// Стик: радиальная мёртвая зона, нормализация, степень curve.
export default function analog(node, config, $) {
    return $.updateFor(node, (dt, self) => {
        const x = $.input.padAxis('leftx') || 0, y = $.input.padAxis('lefty') || 0;
        const len = Math.hypot(x, y);
        if (len <= config.deadzone) { self.velocity(0, 0); return; }
        const k = Math.pow(Math.min(1, (len - config.deadzone) / (1 - config.deadzone)), config.curve) * config.speed / len;
        self.velocity(x * k, y * k);
    });
}
