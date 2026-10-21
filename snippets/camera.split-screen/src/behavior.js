// Сплитскрин: $.camera.split(2) при расхождении; вторая камера — viewAt('p2').
export default function splitScreen(node, config, $) {
    let split = false;
    const stop = $.updateFor(node, () => {
        const a = $(config.p1), b = $(config.p2);
        if (!a.length || !b.length) return;
        const pa = a.pos(), pb = b.pos(), far = Math.hypot(pa.x - pb.x, pa.y - pb.y) > config.mergeAt;
        if (far !== split) { split = far; $.camera.split(split ? 2 : 1); $.emit('camera:split', { on: split }); }
        if (split) { $.camera.at(pa.x, pa.y); $.camera.viewAt('p2', pb.x, pb.y); }
        else $.camera.at((pa.x + pb.x) / 2, (pa.y + pb.y) / 2);
    });
    return () => { stop(); if (split) $.camera.split(1); };
}
