// Светофор: цвет узла и data('signal'); на красный агенты в зоне — скорость 0.
const COLORS = { green: '#30d050', yellow: '#e0c030', red: '#e03030' };
export default function trafficSignal(node, config, $) {
    const phases = [['green', config.green], ['yellow', config.yellow], ['red', config.red]].filter(([, ms]) => ms > 0);
    let i = 0, t = phases[0][1];
    const show = () => { node.data('signal', phases[i][0]).color(COLORS[phases[i][0]]); node.emit('signal', { phase: phases[i][0] }); };
    show();
    return $.updateFor(node, (dt, self) => {
        t -= dt * 1000;
        if (t <= 0) { i = (i + 1) % phases.length; t = phases[i][1]; show(); }
        if (phases[i][0] !== 'red') return;
        $(config.agents).each((k, a) => { if (a.distanceTo(self) <= config.zone) a.velocity(0, 0); });
    });
}
