// Plain 2D-сцена без Re2D World: обычные узлы, Box2D и те же игровые сэмплы
// (машина, персонаж, оружие, сиденья, HUD, ownership). Доказывает, что P0.4-P0.6
// не зависят от Re2D; герой и машина — обычные повёрнутые 2D-спрайты.
'use strict';

import { createVehicle } from './lib/vehicle.js';
import { attachVehicleView } from './lib/vehicle_view.js';
import { createCharacter } from './lib/character.js';
import { createCombat } from './lib/combat.js';
import { createOwnership } from './lib/ownership.js';
import { createSeats } from './lib/seats.js';
import { createHud } from './lib/hud.js';

const ARENA = { x: 0, y: 0, w: 1600, h: 1000 };
let runtime = null;

export default function installPlain($) {
    $.scene.add('re2d_gta_sandbox_plain', {
        enter($) {
            $.gfx.color('#14161b');
            $.world.gravity(0, 0);
            $.camera.follow('#plain-hero', { smooth: 0.2, deadzone: [90, 60] });
            $.camera.limits(ARENA.x - 100, ARENA.y - 100, ARENA.w + 200, ARENA.h + 200);

            const walls = [];
            const wall = (x1, y1, x2, y2) => {
                const node = $('<rect>', { color: '#25272d' })
                    .at((x1 + x2) / 2, (y1 + y2) / 2)
                    .size(Math.max(8, Math.hypot(x2 - x1, y2 - y1)), 10)
                    .angle(Math.atan2(y2 - y1, x2 - x1))
                    .body('static').layerBits(8).layer(8);
                walls.push(node);
                return node;
            };
            wall(ARENA.x, ARENA.y, ARENA.x + ARENA.w, ARENA.y);
            wall(ARENA.x, ARENA.y + ARENA.h, ARENA.x + ARENA.w, ARENA.y + ARENA.h);
            wall(ARENA.x, ARENA.y, ARENA.x, ARENA.y + ARENA.h);
            wall(ARENA.x + ARENA.w, ARENA.y, ARENA.x + ARENA.w, ARENA.y + ARENA.h);
            wall(500, 300, 760, 300);
            wall(1100, 620, 1100, 880);

            const hero = $('<sprite>', { id: 'plain-hero', friction: 0.1 })
                .at(ARENA.x + ARENA.w / 2, ARENA.y + ARENA.h / 2)
                .sprite('assets/hero_plain.png')
                .size(40, 40)
                .collisionCircle(12)
                .body('dynamic')
                .layerBits(1)
                .layer(1)
                .appendTo($.world);
            hero.get(0).max_hp = 100;
            hero.get(0).cur_hp = 100;

            const ownership = createOwnership($);
            ownership.mark(hero, 'persistent');
            const combat = createCombat($, { ownership });
            const seats = createSeats($, { lockName: 'vehicle', ejectOffset: 30 });
            const heroChar = createCharacter($, {
                node: hero, input: 'wasd', speed: 190, runSpeed: 290,
                rotate: true, rows: { idle: 0, walk: 0, run: 0, shoot: 1, hit: 2, stunned: 2, dead: 3 },
            });

            const car = createVehicle($, {
                id: 'plain-car', x: ARENA.x + ARENA.w / 2 + 180, y: ARENA.y + ARENA.h / 2,
                angle: Math.PI, width: 64, height: 34, mass: 1100,
                engineForce: 130000, maxSpeed: 380, layer: 2, mask: 0xffffffff,
            });
            ownership.mark(car.node, 'persistent');
            attachVehicleView($, car, { src: 'assets/car_plain.png', width: 64, height: 34 });
            car.seatsData = [{ x: 0, y: 0, side: 'front' }, { x: -24, y: 0, side: 'rear' }];

            const hud = createHud($, {
                hint: 'PLAIN 2D · WASD пешком · E сесть/выйти · Space ручник · ЛКМ огонь · F1 оверлей',
            });
            hud.update({ hp: 100, weapon: 'PISTOL', ammo: 24, mission: 'PLAIN 2D · проверка транспорта', pedestrians: 0, vehicles: 1 });

            let seated = false;
            const toggleSeat = () => {
                if (!seated) {
                    const result = seats.enter(car, heroChar, { seat: 0 });
                    seated = !!result.ok;
                    if (seated) {
                        hero.hide();
                        $.camera.follow(car.node, { smooth: 0.15 });
                    }
                } else {
                    seats.exit(heroChar, 'manual');
                    seated = false;
                    hero.show();
                    $.camera.follow('#plain-hero', { smooth: 0.2 });
                }
            };
            const fire = () => {
                if (seated) return;
                const p = hero.pos();
                const aim = $.input.mouseWorld();
                const dx = aim.x - p.x, dy = aim.y - p.y;
                const len = Math.hypot(dx, dy) || 1;
                combat.hitscan({
                    from: { x: p.x, y: p.y }, to: { x: p.x + dx / len * 900, y: p.y + dy / len * 900 },
                    mask: 1, wallMask: 0, damage: 18, type: 'pistol', source: hero.get(0),
                });
                heroChar.shoot({ angle: Math.atan2(dy, dx), ms: 120 });
                $.camera.shake(2.5, 90);
            };
            runtime = {
                walls, hero, car, heroChar, seats, combat, ownership, hud,
                update(dt) {
                    if ($.input.pressed('e')) toggleSeat();
                    if (!seated && ($.input.mousePressed(0) || $.input.pressed('f'))) fire();
                    if (seated) {
                        const v = $.input.vec('wasd');
                        car.control({ throttle: -v.y, steer: v.x, brake: 0, handbrake: $.input.down('space') }, dt);
                    } else {
                        heroChar.update(dt);
                    }
                    seats.update(dt);
                    combat.update(dt);
                    const speed = seated ? (car.state().speed || 0) : 0;
                    hud.update({ hp: hero.get(0).cur_hp, weapon: seated ? 'CAR' : 'PISTOL', ammo: 24,
                        speed, mission: seated ? 'PLAIN 2D · за рулём' : 'PLAIN 2D · пешком', vehicles: 1 });
                },
            };
            $.log('sandbox plain: ready');
        },
        update(dt) { if (runtime) runtime.update(dt); },
        exit($) {
            const r = runtime;
            runtime = null;
            if (!r) return;
            r.seats.clear('exit');
            r.combat.clear('exit');
            r.hud.destroy();
            for (const node of r.walls) node.remove();
            $(r.car.node).remove();
            $(r.hero).remove();
        },
    });
}
