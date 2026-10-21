// Предсказание: шаг движения применяется сразу; подтверждение хоста — reconcile.
export default function predictionProfile(node, config, $) {
    const step = (state, input, dt) => ({ x: state.x + ((input.right ? 1 : 0) - (input.left ? 1 : 0)) * config.speed * dt, y: state.y + ((input.down ? 1 : 0) - (input.up ? 1 : 0)) * config.speed * dt });
    $.net.predict(step);
    const stop = $.updateFor(node, (dt, self) => {
        if (!$.net.online() || $.net.isAuthority()) return;
        const v = $.net.prediction().visual(dt, { smoothing: config.smoothing });
        if (v && Number.isFinite(v.x)) self.at(v.x, v.y);
    });
    return () => stop();
}
