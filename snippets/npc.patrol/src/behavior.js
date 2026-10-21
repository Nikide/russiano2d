// Патруль платформера: разворот у стены.
export default function patrol(node, config, $) {
    let dir = config.startDir === 'left' ? -1 : 1;
    return $.updateFor(node, (dt, self) => {
        if (self.onWall()) dir = -dir;
        self.velocity(dir * config.speed, self.velocity().y);
    });
}
