// RotSprite v1: один общий PNG персонажа → синтез головы в обычном 2D-батче.
import { TAGS, def, withAlpha } from './core.js';
import { registerNodeRenderer } from './render.js';

export function normalizeRotPose(yaw = 0, pitch = 0) {
    if (typeof yaw !== 'number' || typeof pitch !== 'number' ||
        !Number.isFinite(yaw) || !Number.isFinite(pitch)) {
        throw new RangeError('$.rotSprite: yaw/pitch должны быть конечными числами');
    }
    const y = ((yaw % 360) + 540) % 360 - 180;
    return { yaw: y === 0 ? 0 : y, pitch: Math.max(-75, Math.min(75, pitch)) };
}

export function rotPixelRect(t) {
    const scale = Math.max(1, Math.round(Math.min(Math.abs(t.w), Math.abs(t.h)) / 64));
    const size = 64 * scale;
    const left = Math.round(t.x - size / 2), top = Math.round(t.y - size / 2);
    return { x: left + size / 2, y: top + size / 2, w: size, h: size, scale };
}

function release(node) {
    if (node.rot_sprite) engine.rotSpriteDispose(node.rot_sprite.handle);
    node.rot_sprite = null;
}

export function installRotSprite($) {
    TAGS.rotsprite = { w: 64, h: 64, body: null };
    def('rotSpriteAtlas', function (path) { return this.eachNode((i,node) => {
        if (node.tag !== 'rotsprite') throw new TypeError('rotSpriteAtlas: нужен узел <rotsprite>');
        if (typeof path !== 'string' || !path) throw new TypeError('rotSpriteAtlas: нужен путь к общему PNG');
        // Не теряем действующий ресурс, если новый PNG не прошёл проверку.
        const handle = engine.rotSpriteLoad(path);
        const info = engine.rotSpriteInfo(handle);
        release(node);
        node.rot_sprite = { handle, path, sprite: info.sprite };
        if (!node.rot_cleanup) {
            node.rot_cleanup = true;
            node.on('remove', () => release(node));
        }
    }); });
    def('rotPose', function (yaw, pitch = 0) { return this.eachNode((i,node) => {
        const p = normalizeRotPose(yaw,pitch);
        if (!node.rot_sprite) throw new TypeError('rotPose: сначала вызовите .rotSpriteAtlas(path)');
        node.rot_sprite.sprite = engine.rotSpritePose(node.rot_sprite.handle,p.yaw,p.pitch);
    }); });
    $.rotSprite = {
        create(path, opts = {}) { return $('<rotsprite>',opts).rotSpriteAtlas(path); },
        pose(target, yaw, pitch = 0) { return $(target).rotPose(yaw,pitch); },
        info(target) {
            const node = $(target).get(0);
            return node && node.rot_sprite ? { ...engine.rotSpriteInfo(node.rot_sprite.handle),
                path: node.rot_sprite.path, version: 1, milestone: 'head' } : null;
        },
        dispose(target) { $(target).eachNode((i,node) => release(node)); },
    };
    registerNodeRenderer('rotsprite', (node,t,cam) => {
        if (!node.rot_sprite) return;
        const p = rotPixelRect(t);
        if (p.x + p.w/2 < 0 || p.y + p.h/2 < 0 ||
            p.x - p.w/2 > cam.w || p.y - p.h/2 > cam.h) return;
        $.gfx.push.sprite(node.rot_sprite.sprite,p.x,p.y,p.w,p.h,0,
            withAlpha(node.color,node.alpha),node.blend_mode);
    });
}
