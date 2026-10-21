// Зрение: дистанция × заметность цели (data visibility), сектор от взгляда (flip), $.world.lineOfSight.
export default function lineOfSight(node, config, $) {
    let sees = false;
    return $.updateFor(node, (dt, self) => {
        const tg = $(config.target);
        let now = false;
        if (tg.length) {
            const p = self.pos(), q = tg.pos(), dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy);
            const vis = config.useVisibility ? (tg.data('visibility') ?? 1) : 1;
            const face = self.flip().x ? Math.PI : 0;
            const ang = Math.abs(Math.atan2(Math.sin(Math.atan2(dy, dx) - face), Math.cos(Math.atan2(dy, dx) - face))) * 180 / Math.PI;
            now = d <= config.range * vis && (config.fov >= 360 || ang <= config.fov / 2) && $.world.lineOfSight(self, tg, { ignore: [self, tg] });
            if (now) self.data('lastKnown', { x: q.x, y: q.y });
        }
        if (now !== sees) { sees = now; self.data('sees', sees); self.emit(sees ? 'target:seen' : 'target:lost', { target: tg }); }
    });
}
