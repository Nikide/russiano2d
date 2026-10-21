// Выход: room.leave + unreplicate своих сущностей + сцена меню.
export default function roomLeave(node, config, $) {
    const leave = () => {
        for (const e of $.net.entities()) $.net.unreplicate(e.node || e);
        $.net.room.leave();
        $.net.leave();
        $.emit('room:left', {});
        if (config.menuScene) $.scene.load(config.menuScene);
    };
    $.on('room:leave', leave);
    return () => $.off('room:leave', leave);
}
