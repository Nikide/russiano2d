// Цикл: неактивный — скрыт и выключен до события; таймер удаления.
export default function lifecycle(node, config, $) {
    let left = config.removeAfter;
    const on = () => { node.show().active(true); node.emit('lifecycle:active', {}); };
    if (!config.active) node.hide().active(false);
    if (config.activateOn) $.on(config.activateOn, on);
    node.emit('lifecycle:ready', {});
    const stop = left > 0 ? $.updateFor(node, (dt, self) => { left -= dt * 1000; if (left <= 0) self.remove(); }) : () => {};
    return () => { stop(); if (config.activateOn) $.off(config.activateOn, on); };
}
