// ===========================================================================
// Демо Re2D: 2.5D мир-коробка. Игрок ходит от первого лица, мышь крутит взгляд
// куда угодно, а в комнате стоят три добрых маскота — Руся в трёх костюмах.
//
// Что показывает демо:
//   * Re2D — вид на тот же плоский мир: `$.camera.kind(Re2D)` и `.kind(Re2D)` на
//     узлах; физика остаётся обычной 2D (Box2D), стены останавливают игрока;
//   * `$.re2d.room` — пол, потолок и стены из обычных узлов с текстурами;
//   * маскоты Re2DSprite как билборды: при обходе вокруг них модель плавно
//     поворачивается (не восемь заготовленных ракурсов, как в Doom);
//   * `.controls('wasd')` у Re2D-узла водит «вперёд» туда, куда смотрит камера.
//
// Маскоты ничем не управляются движком — это обычная игровая логика ниже: подошёл
// ближе — маскот поворачивается к игроку, удивляется и улыбается, а рядом
// показывает реплику. Состояние (`state`) лежит в свободном атрибуте, поэтому
// `$.expect('#maid').state('smile')` проверяет его без разбора пикселей.
//
// Запуск:
//   ./build/russiano2d --game demos --scene re2d_world
//   ./build/russiano2d --game demos            # кнопка «Re2D · мир-коробка»
// ===========================================================================

const CHARACTER = 'demos/rotsprite/russi.character.json';
const HUD_DOC = 'demos/ui/re2d-hud.rml';
const CLICK = 'demos/assets/audio/sfx/ui_click.ogg';

const ROOM = {
    x: 0, y: 0, w: 1280, h: 1280, height: 300, tile: 128,
    wall: 'demos/assets/tiles/wall_brick.png',
    floor: 'demos/assets/tiles/wall_stone.png',
    ceiling: 'demos/assets/tiles/wall_metal.png',
};
const SPAWN = { x: 640, y: 1130, yaw: -90 };

// Радиусы реакции маскотов, единицы мира: заметили — подошёл — заговорили.
const NOTICE = 420;
const TALK = 230;

const NPCS = [
    { id: 'maid', costume: 'maid', name: 'Руся · горничная', x: 400, y: 620, home: Math.PI / 2,
      line: 'Добро пожаловать! Чай ещё горячий.' },
    { id: 'swim', costume: 'swim', name: 'Руся · на пляже', x: 920, y: 520, home: Math.PI / 2,
      line: 'Тут так тепло, будто лето не кончается!' },
    { id: 'police', costume: 'police', name: 'Руся · полиция РФ', x: 640, y: 820, home: -Math.PI / 2,
      line: 'Всё спокойно. Проходите, не задерживайтесь.' },
];

/** Кратчайший поворот угла `from` к `to` (радианы), не более `max` за вызов. */
export function turnToward(from, to, max) {
    let d = (to - from) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return from + Math.max(-max, Math.min(max, d));
}

/** Настроение маскота по расстоянию до игрока: имя эмоции Re2DSprite и значение state. */
export function reaction(distance) {
    if (distance < TALK) return { mood: 'happy', state: 'smile' };
    if (distance < NOTICE) return { mood: 'surprised', state: 'notice' };
    return { mood: 'neutral', state: 'idle' };
}

export default function install($) {
    let hud = null;
    let spoken = null;     // чья реплика на экране сейчас

    function leave() {
        // Камера и мышь — общие для всех демо: возвращаем как было, иначе меню
        // и другие сцены остались бы в 2.5D с захваченной мышью.
        $.camera.mouseLook(false).kind(null).unfollow().fog(0).pitch(0).yaw(0).zoom(1);
        $.window.mouseLock(false);
        if (hud) hud.hide();
        hud = null;
        spoken = null;
    }

    // Состояние для агента и тестов: где игрок, куда смотрит камера и что делает
    // каждый маскот (факты, а не пересказ).
    $.agent.expose('re2dWorld', () => {
        const hero = $('#hero').get(0);
        return {
            hero: hero ? { x: Math.round(hero.x * 100) / 100, y: Math.round(hero.y * 100) / 100 } : null,
            camera: $.camera.info(),
            speaking: spoken,
            npcs: NPCS.map((cfg) => {
                const n = $('#' + cfg.id).get(0);
                return n && hero ? {
                    id: cfg.id, state: n.attrs.state, mood: cfg.mood,
                    angle: Math.round(n.angle * 1000) / 1000,
                    distance: Math.round(Math.hypot(hero.x - n.x, hero.y - n.y)),
                } : { id: cfg.id, state: null };
            }),
        };
    });

    $.scene.add('re2d_world', {
        enter($) {
            $.world.gravity(0, 0).color('#0b0e14');
            $.camera.kind(Re2D).eye(52).fov(72).pitch(0).fog(1500, 0.22).zoom(1)
                .mouseLook({ on: true, sensitivity: 0.0026 });

            $.re2d.room(ROOM);

            $('<player>', { id: 'hero' }).at(SPAWN.x, SPAWN.y).size(36, 36).collision(30, 30)
                .speed(240).controls('wasd').kind(Re2D).appendTo($.world);
            $.camera.follow('#hero').yaw(SPAWN.yaw);

            for (const cfg of NPCS) {
                cfg.mood = 'neutral';
                $.re2dSprite.from(CHARACTER, { id: cfg.id })
                    .re2dStyle('pixel').re2dVariant('costume', cfg.costume).re2dMotion('idle')
                    .at(cfg.x, cfg.y).size(150, 150).collision(44, 44).body('static')
                    .attr('state', 'idle').angle(cfg.home).kind(Re2D);
            }

            hud = $.ui.doc(HUD_DOC).show();
            hud.cls('speech', 'hidden', true);
        },

        exit() { leave(); },

        update(dt, $) {
            if ($.input.pressed('escape')) {
                $.sound.play(CLICK, { volume: 0.5 });
                $.scene.load('launcher');
                return;
            }
            const hero = $('#hero').get(0);
            if (!hero) return;

            let nearest = null;
            for (const cfg of NPCS) {
                const npc = $('#' + cfg.id);
                const node = npc.get(0);
                if (!node) continue;
                const d = Math.hypot(hero.x - node.x, hero.y - node.y);
                const r = reaction(d);

                // К игроку поворачиваются, пока он рядом; потом возвращаются в исходную стойку.
                const want = d < NOTICE ? Math.atan2(hero.y - node.y, hero.x - node.x) : cfg.home;
                npc.angle(turnToward(node.angle, want, dt * 4));   // .angle() двигает и тело

                if (r.mood !== cfg.mood) {
                    cfg.mood = r.mood;
                    npc.re2dEmotion(r.mood);
                }
                npc.attr('state', r.state);
                if (r.state === 'smile' && (!nearest || d < nearest.d)) nearest = { cfg, d };
            }

            const who = nearest ? nearest.cfg.id : null;
            if (who !== spoken) {
                spoken = who;
                if (nearest) {
                    hud.text('speech-name', nearest.cfg.name).text('speech-line', nearest.cfg.line);
                    $.sound.play(CLICK, { volume: 0.35 });
                }
                hud.cls('speech', 'hidden', !nearest);
            }
        },
    });
}
