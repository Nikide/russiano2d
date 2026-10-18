// Sandbox HUD на RmlUi-узлах `$` (ui.panel/ui.label): здоровье, оружие, скорость,
// миссия и счётчики population. Обычные `$`-узлы, без ручного HTML и без второго
// UI-слоя: сцена передаёт снимок состояния, HUD только раскладывает его.
'use strict';

export function createHud($, options = {}) {
    const width = options.width ?? 1280;
    const height = options.height ?? 720;
    const nodes = [];
    const ids = ['hud-health', 'hud-weapon', 'hud-speed', 'hud-mission', 'hud-counts', 'hud-hint'];

    const panel = (id, x, y, w, h, color) => {
        const node = $('<ui.panel>', { id, color }).at(x, y).size(w, h).appendTo($.ui);
        nodes.push(node);
        return node;
    };
    const label = (id, x, y, size, color, align) => {
        const node = $('<ui.label>', { id, size, color, align, text: '' }).at(x, y).appendTo($.ui);
        nodes.push(node);
        return node;
    };

    panel('hud-panel-top', width / 2, 28, 820, 46, '#05070cc0');
    panel('hud-panel-health', 160, height - 80, 240, 48, '#05070cc0');
    panel('hud-panel-weapon', 440, height - 80, 220, 48, '#05070cc0');
    panel('hud-panel-speed', 900, height - 80, 260, 48, '#05070cc0');

    const health = label('hud-health', 160, height - 80, 20, '#9fe8b0', 'center');
    const weapon = label('hud-weapon', 440, height - 80, 18, '#e8f0ff', 'center');
    const speed = label('hud-speed', 900, height - 80, 20, '#ffd479', 'center');
    const mission = label('hud-mission', width / 2, 28, 19, '#e8f0ff', 'center');
    const counts = label('hud-counts', 1052, 28, 14, '#9fb3d0', 'right');
    const hint = label('hud-hint', width / 2, height - 26, 13, '#7f8fa8', 'center');

    hint.text(options.hint
        ?? 'WASD — движение · E — сесть/выйти · Space — ручник · ЛКМ — огонь · F1 — оверлей');

    const set = (node, text) => { node.text(String(text)); };

    return {
        nodes,
        update(state = {}) {
            set(health, `HP ${Math.max(0, Math.round(state.hp ?? 0))}`);
            set(weapon, state.weapon ? `${state.weapon}${state.ammo !== undefined ? ` · ${state.ammo}` : ''}` : 'БЕЗ ОРУЖИЯ');
            set(speed, `${Math.round(Math.abs(state.speed ?? 0) * 3.6)} КМ/Ч`);
            set(mission, state.mission ?? 'Свободная езда');
            set(counts, `ПЕШЕХОДЫ ${state.pedestrians ?? 0} · МАШИНЫ ${state.vehicles ?? 0} · ${state.fps ?? 0} FPS`);
            if (state.hint) set(hint, state.hint);
        },
        destroy() {
            for (const node of nodes) {
                try { node.remove(); } catch (error) { /* сцена уже могла убрать узел */ }
            }
            nodes.length = 0;
        },
        ids,
    };
}
