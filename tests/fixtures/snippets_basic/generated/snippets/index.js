// r2d-snippets: generated 07e9f8acb8668846
// editor.snippets → обычный JS
// Не править вручную: Editor («Кирпичики») или r2d snippet. Ручная правка
// будет обнаружена (SNIP120) и не перезапишется молча.
import actor_visual_profile from './packages/actor.visual-profile.js';
import movement_top_down from './packages/movement.top-down.js';

// Привязка поведения к узлу по стабильному id: ставится, когда узел
// появился (сцена, respawn), и снимается disposer'ом, когда узел исчез.
function bind(selector, attach) {
    let bound = null;
    let dispose = null;
    $.update(() => {
        const node = $(selector);
        const raw = node.length ? node.get(0) : null;
        if (raw === bound) return;
        if (dispose) dispose();
        dispose = null;
        bound = raw;
        if (raw) dispose = attach(node) || null;
    });
}

// snippet:hero:movement.top-down — movement.top-down@1.0.0 → object:hero
bind("#hero", (node) => movement_top_down(node, {
    "speed": 180,
    "keys": "wasd"
}, $));

// snippet:hero:actor.visual-profile — actor.visual-profile@1.0.0 → object:hero
bind("#hero", (node) => actor_visual_profile(node, {
    "image": "art/hero.png"
}, $));
