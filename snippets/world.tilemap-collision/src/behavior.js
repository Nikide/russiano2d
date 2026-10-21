// Столкновения: движок сам строит тела; пакет только задаёт номера.
export default function tilemapCollision(node, config, $) {
    let done = false;
    const apply = () => {
        const raw = node.data('tilemapNode');
        if (!raw || raw.removed) return false;
        $(raw).collisionMerge(config.merge).collisions(config.solid.map(Number));
        node.emit('tilemap:colliders', { result: $(raw).collisionResult() });
        return true;
    };
    done = apply();
    return done ? () => {} : $.updateFor(node, () => { if (!done) done = apply(); });
}
