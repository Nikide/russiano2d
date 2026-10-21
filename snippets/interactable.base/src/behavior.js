// Интерактив: рядом — событие подсказки; клавиша — действие, если условие выполнено.
export default function interactable(node, config, $) {
    // Сущность по селектору: ищется заново, только если прежний узел исчез.
    const cache = {};
    const sel = (s) => { const c = cache[s]; if (c && c.length && !c.get(0).removed) return c; return (cache[s] = $(s)); };
    let near = false;
    return $.updateFor(node, (dt, self) => {
        const who = sel(config.actor);
        const now = !!who.length && self.distanceTo(who) <= config.radius;
        const allowed = !config.requires || !!who.data(config.requires);
        if (now !== near) { near = now; $.emit('interact:prompt', { target: self, text: now && allowed ? config.prompt : '' }); }
        if (now && allowed && $.input.pressed(config.key)) $.emit(config.action, { target: self, by: who });
    });
}
