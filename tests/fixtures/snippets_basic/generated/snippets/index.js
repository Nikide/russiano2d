// r2d-snippets: generated d714cb94ec74b7c9
// editor.snippets → обычный JS
// Не править вручную: Editor («Кирпичики») или r2d snippet. Ручная правка
// будет обнаружена (SNIP120) и не перезапишется молча.
import movement_topdown from './packages/movement.topdown.js';
import visual_sprite from './packages/visual.sprite.js';

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

// snippet:hero:movement.topdown — movement.topdown@1.0.0 → object:hero
bind("#hero", (node) => movement_topdown(node, {
    "speed": 180,
    "keys": "wasd"
}, $));

// snippet:hero:visual.sprite — visual.sprite@1.0.0 → object:hero
bind("#hero", (node) => visual_sprite(node, {
    "image": "art/hero.png"
}, $));
