// ===========================================================================
// Демо Re2D: тестовая комната для врагов на билбордах (только прогулки).
//
// Задача комнаты — проверить именно билборды врагов в Re2D-виде и ходьбу:
//   * игрок ходит от первого лица (WASD + мышь), оружия нет вообще;
//   * враги — ПЛОСКИЕ КАРТИНКИ (PNG с альфой), стоящие на полу и всегда
//     повёрнутые к камере: тот самый билборд, без моделей и без 3D-ригов;
//   * враги патрулируют комнату (кинематические тела: игрок об них
//     останавливается), на близком расстоянии «замечают» и подходят, но
//     НЕ атакуют — боя, урона и оружия в этой комнате нет;
//   * камера жёстко стоит на теле (smooth 0): в FPS сглаживание камеры
//     читается как «плывущие глаза» — это была одна из полировок.
//
// Что полируется этим демо (Re2D):
//   * плоский PNG как билборд (работает без character.json/атласа v2);
//   * кинематический билборд-враг: ходит, но не продавливается игроком;
//   * билборд не проваливается под пол и не уходит выше потолка комнаты;
//   * HUD — обычные ui-узлы над 3D-кадром (RmlUi тут не обязателен).
//
// Запуск:
//   ./build/russiano2d --game demos --scene re2d_testroom
// ===========================================================================
'use strict';

const ROOM = {
    x: 0, y: 0, w: 1600, h: 1200, height: 320, tile: 128,
    wall: 'demos/assets/tiles/wall_brick.png',
    floor: 'demos/assets/tiles/wall_stone.png',
    ceiling: 'demos/assets/tiles/wall_metal.png',
};
// yaw камеры — ГРАДУСЫ (как в re2d_world: -90 = смотреть на север, -y).
const SPAWN = { x: 800, y: 1080, yaw: -90 };
const ENEMY_ART = 'demos/re2d_testroom/assets/enemy_catgirl.png';
const ENEMY_SIZE = { w: 120, h: 237 };       // 892×1763, сохранён пропорция
const ENEMY_BODY = 44;

// Патрульные маршруты. Точки выбраны в открытых местах, чтобы кинематический
// враг не проходил сквозь внутренние стены (у kinematic нет solver-а).
const ENEMIES = [
    // cat-nw ходит вдоль внутренней стены с СЕВЕРА: если игрок стоит за
    // стеной (юг), враг его не видит и не идёт напролом — см. canSee().
    { id: 'cat-nw', path: [[900, 520], [1040, 520], [1040, 570], [900, 570]], speed: 64 },
    { id: 'cat-ne', path: [[980, 300], [1340, 300], [1340, 560], [980, 560]], speed: 72 },
    { id: 'cat-mid', path: [[380, 700], [560, 700], [560, 940], [380, 940]], speed: 56 },
    { id: 'cat-w', path: [[180, 640], [180, 980], [320, 980], [320, 640]], speed: 48 },
    { id: 'cat-e', path: [[1420, 640], [1420, 980], [1260, 980], [1260, 640]], speed: 52 },
    // Юго-восток: не рядом с точкой спавна, чтобы первый кадр не встречал
    // врага вплотную (нашлось скриншотом: enemy стоял прямо у камеры).
    { id: 'cat-se', path: [[1120, 1060], [1420, 1060], [1420, 1120], [1120, 1120]], speed: 40 },
];

const NOTICE = 380;      // ближе — «заметил» и идёт к игроку
const STOP_AT = 130;     // не подходит вплотную (но и не атакует — оружия нет)

export default function install($) {
    let labels = null;
    let hud_nodes = [];   // всё, что создали в UI: снести в exit, а не половину
    const enemies = [];   // { cfg, node, at, dwell, mode }

    function leave() {
        $.camera.mouseLook(false).kind(null).unfollow().fog(0).pitch(0).yaw(0).zoom(1);
        $.window.mouseLock(false);
        for (const node of hud_nodes) node.remove();
        hud_nodes = [];
        labels = null;
    }

    /**
     * Видит ли враг игрока: 2D-луч по телам комнаты. Кинематический билборд
     * не умеет «обойти» стену, поэтому без проверки он шёл бы к игроку сквозь
     * внутреннюю стену. Луч 2D (XY): стены комнаты — обычные тела.
     */
    function canSee(hero, n) {
        if (typeof $.world.raycast !== 'function') return true;
        try {
            const hit = $.world.raycast({ x: n.x, y: n.y }, { x: hero.x, y: hero.y },
                                        { ignore: [hero, n] });
            return !hit;
        } catch (e) {
            return true;
        }
    }

    /** Ближайший враг и его дистанция — для HUD и тестов. */
    function nearest(hero) {
        let best = null;
        for (const e of enemies) {
            const n = e.node.get(0);
            if (!n) continue;
            const d = Math.hypot(hero.x - n.x, hero.y - n.y);
            if (!best || d < best.distance) best = { id: e.cfg.id, distance: d };
        }
        return best;
    }

    $.agent.expose('re2dTestroom', () => {
        const hero = $('#hero').get(0);
        const info = $.camera.info();
        return {
            hero: hero ? { x: Math.round(hero.x * 10) / 10, y: Math.round(hero.y * 10) / 10 } : null,
            camera: { kind: info.kind, x: Math.round(info.x * 10) / 10, y: Math.round(info.y * 10) / 10 },
            room: { x: ROOM.x, y: ROOM.y, w: ROOM.w, h: ROOM.h, height: ROOM.height },
            weapons: 0,                                     // оружия нет вообще
            enemies: enemies.map((e) => {
                const n = e.node.get(0);
                return n ? {
                    id: e.cfg.id, mode: e.mode,
                    seen: hero ? canSee(hero, n) : false,
                    x: Math.round(n.x * 10) / 10, y: Math.round(n.y * 10) / 10,
                    distance: hero ? Math.round(Math.hypot(hero.x - n.x, hero.y - n.y)) : null,
                } : { id: e.cfg.id, x: null, y: null };
            }),
            nearest: hero ? nearest(hero) : null,
        };
    });

    $.scene.add('re2d_testroom', {
        enter($) {
            $.world.gravity(0, 0).color('#0b0e14');
            $.camera.kind(Re2D).eye(52).fov(72).pitch(0).fog(1500, 0.22).zoom(1)
                .mouseLook({ on: true, sensitivity: 0.0026 });

            $.re2d.room(ROOM);

            // Внутренние стены: коридор из двух плит — видно, что кинематика
            // стен останавливает игрока, а билборд-враг стоит на полу.
            $('<wall>', { top: ROOM.height, tile: 128 })
                .sprite(ROOM.wall).size(560, 36).at(800, 600)
                .body('static').kind(Re2D).appendTo($.world);
            $('<wall>', { top: ROOM.height, tile: 128 })
                .sprite(ROOM.wall).size(36, 280).at(500, 460)
                .body('static').kind(Re2D).appendTo($.world);

            $('<player>', { id: 'hero' }).at(SPAWN.x, SPAWN.y).size(36, 36)
                .collision(30, 30).speed(260).controls('wasd').kind(Re2D)
                .appendTo($.world);
            // Жёсткое следование: глаза не отстают от тела ни на кадр.
            $.camera.follow('#hero', { smooth: 0 }).yaw(SPAWN.yaw);
            $.window.mouseLock(true);

            enemies.length = 0;
            for (const cfg of ENEMIES) {
                const node = $('<enemy>', { id: cfg.id })
                    .sprite(ENEMY_ART)
                    .at(cfg.path[0][0], cfg.path[0][1])
                    .size(ENEMY_SIZE.w, ENEMY_SIZE.h)
                    .collision(ENEMY_BODY, ENEMY_BODY)
                    .body('kinematic')
                    .kind(Re2D)
                    .appendTo($.world);
                enemies.push({ cfg, node, at: 0, dwell: 0, mode: 'patrol' });
            }

            hud_nodes = [];
            hud_nodes.push($('<ui.panel>', { id: 'testroom-panel', color: '#05070cd0' })
                .at(640, 40).size(1240, 80).appendTo($.ui));
            // Прицел: в FPS нужно, куда смотреть. Это обычный ui-узел над 3D.
            hud_nodes.push($('<ui.panel>', { id: 'testroom-cross', color: '#e8f0ffcc' })
                .at(640, 360).size(6, 6).appendTo($.ui));
            labels = {
                title: $('<ui.label>', { id: 'testroom-title', size: 24, color: '#9fe8b0',
                                          align: 'center',
                                          text: 'Re2D · тестовая комната врагов на билбордах' })
                    .at(640, 26).appendTo($.ui),
                hint: $('<ui.label>', { id: 'testroom-hint', size: 15, color: '#9fb3d0',
                                         align: 'center',
                                         text: 'WASD — ходить · мышь — смотреть · Esc — в меню · оружия нет' })
                    .at(640, 56).appendTo($.ui),
                status: $('<ui.label>', { id: 'testroom-status', size: 16, color: '#e8f0ff',
                                           align: 'center', text: '' })
                    .at(640, 690).appendTo($.ui),
            };
            hud_nodes.push(labels.title, labels.hint, labels.status);
        },

        exit() { leave(); },

        update(dt) {
            const hero = $('#hero').get(0);
            if (!hero) return;
            const step_ms = Math.max(0, Math.min(0.05, Number(dt) || 0)) * 1000;

            for (const e of enemies) {
                const n = e.node.get(0);
                if (!n) continue;
                const distance = Math.hypot(hero.x - n.x, hero.y - n.y);

                if (distance < NOTICE && distance > STOP_AT && canSee(hero, n)) {
                    e.mode = 'notice';
                    // Враг идёт к игроку, но не атакует: оружия в комнате нет.
                    const k = Math.min(1, (e.cfg.speed / distance) * (step_ms / 1000) * 1.15);
                    e.node.at(n.x + (hero.x - n.x) * k, n.y + (hero.y - n.y) * k);
                    continue;
                }
                if (distance <= STOP_AT) { e.mode = 'idle'; continue; }

                e.mode = 'patrol';
                if (e.dwell > 0) { e.dwell -= step_ms; continue; }
                const target = e.cfg.path[e.at];
                const dx = target[0] - n.x;
                const dy = target[1] - n.y;
                const len = Math.hypot(dx, dy);
                if (len < 4) {
                    e.at = (e.at + 1) % e.cfg.path.length;
                    e.dwell = 500;
                    continue;
                }
                const v = (e.cfg.speed / 1000) * step_ms;
                e.node.at(n.x + dx / len * v, n.y + dy / len * v);
            }

            if (labels) {
                const close = nearest(hero);
                labels.status.text(close
                    ? `врагов ${enemies.length} · ближайший ${close.id} · ${Math.round(close.distance)} px · режим ${(enemies.find((x) => x.cfg.id === close.id) || {}).mode || ''}`
                    : `врагов ${enemies.length}`);
            }
        },
    });

    // Esc — назад в меню: камера и мышь возвращаются в обычный 2D.
    $.update(() => {
        if ($.scene.current() !== 're2d_testroom') return;
        if ($.input.pressed('escape')) $.scene.load('launcher', { transition: 'fade', ms: 200 });
    });
}
