// Прыжок от стены: направление «от стены» — против нажатой стрелки (или против взгляда).
export default function wallJump(node, config, $) {
    return $.updateFor(node, (dt, self) => {
        if (self.onFloor() || !self.onWall() || !$.input.pressed(config.jumpKey)) return;
        const x = $.input.vec('wasd').x || $.input.vec('arrows').x || (self.flip().x ? -1 : 1);
        const away = x > 0 ? -1 : 1;
        self.velocity(away * config.force[0], -config.force[1]);
        self.emit('walljump', { dir: away });
    });
}
