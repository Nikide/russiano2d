// Re2D-город: surface tags, top-down камера, машины, пешеходы, урон, миссия.
// Вся логика — публичный `$` и сэмплы из ./lib; Re2D World используется как
// геометрия/теги/визуал, Box2D — как плоская физика (как требует roadmap).
'use strict';

import { buildCity } from './lib/citymap.js';
import { createRoadGraph } from './lib/roadgraph.js';
import { createVehicle } from './lib/vehicle.js';
import { createCharacter } from './lib/character.js';
import { createCombat } from './lib/combat.js';
import { createOwnership } from './lib/ownership.js';
import { createSeats } from './lib/seats.js';
import { createPopulation } from './lib/population.js';
import { createAI } from './lib/ai.js';
import { createMissions, deliveryMission } from './lib/missions.js';
import { createHud } from './lib/hud.js';

const PED_ATLAS = 'assets/ped_sheet.png';
const CAR_ATLAS = 'assets/car_sheet.png';
let runtime = null;

export default function installCity($) {
    $.scene.add('re2d_gta_sandbox_city', {
        enter($) {
            $.gfx.color('#0c0f14');
            $.world.gravity(0, 0);
            const city = buildCity();
            const world = $.re2dWorld.fromJSON(JSON.stringify(city.map)).backend('gpu');
            world.sky({ color: '#86a9cc' });
            world.atmosphere({ heightDensity: 0, hazeStrength: 0 });
            world.camera({ mode: 'topdown', x: city.playerStart.x, y: city.playerStart.y, h: 520, orthoHeight: 1150, near: 2 });

            world.material('asphalt', { albedo: 'assets/road.png', uScale: 1 / 96, vScale: 1 / 96 });
            world.material('pavement', { albedo: 'assets/sidewalk.png', uScale: 1 / 64, vScale: 1 / 64 });
            world.material('grass', { albedo: 'assets/grass.png', uScale: 1 / 64, vScale: 1 / 64 });
            world.material('roof', { albedo: 'assets/roof.png', uScale: 1 / 64, vScale: 1 / 64 });
            world.material('wallTex', { albedo: 'assets/wall.png', uScale: 1 / 64, vScale: 1 / 64 });
            const info = world.info();
            for (let i = 0; i < info.surfaces; i++) {
                const surface = world.surface(i);
                if (!surface) continue;
                if (surface.kind === 0) surface.material('wallTex');
                else if (surface.kind === 2 && surface.hasTag('sky')) surface.sky(true);
                else if (surface.hasTag('roof')) surface.material('roof');
                else if (surface.hasTag('interior')) surface.material('wallTex');
                else if (surface.hasTag('road')) surface.material('asphalt');
                else if (surface.hasTag('sidewalk')) surface.material('pavement');
                else if (surface.hasTag('grass') || surface.hasTag('park')) surface.material('grass');
            }

            // Roof fade (P2): крыши зданий плавно проявляют интерьер, когда
            // игрок/машина под ними. Это per-surface alpha из движка, не
            // материал: alpha 1 возвращает ровно исходный кадр.
            const roofs = [];
            for (let i = 0; i < info.surfaces; i++) {
                const surface = world.surface(i);
                if (!surface || surface.kind !== 2 || !surface.hasTag('roof')) continue;
                const cell = city.map.cells[surface.cell];
                if (!cell) continue;
                roofs.push({ index: i, x: cell.x + cell.w / 2, y: cell.y + cell.h / 2, applied: 1 });
            }

            // Плоские статические коллайдеры из authored-стен (Box2D), Re2D
            // отвечает за геометрию/видимость и surface tags.
            const colliders = [];
            for (const w of city.wallColliders) {
                const len = Math.hypot(w.to[0] - w.from[0], w.to[1] - w.from[1]);
                if (len < 1) continue;
                const node = $('<rect>', { color: '#00000000' })
                    .at((w.from[0] + w.to[0]) / 2, (w.from[1] + w.to[1]) / 2)
                    .size(len, 12)
                    .angle(Math.atan2(w.to[1] - w.from[1], w.to[0] - w.from[0]))
                    .body('static').hide().layerBits(8).layer(8).appendTo($.world);
                colliders.push(node);
            }

            const graph = createRoadGraph({
                roads: city.roads, walk: city.walk, spawns: city.spawns, parking: city.parking,
            });
            graph.setWorld(world, { h: 0 });
            const ownership = createOwnership($);
            const combat = createCombat($, { ownership });
            const seats = createSeats($, { lockName: 'vehicle', ejectOffset: 34 });
            const ai = createAI($, { roadGraph: graph, nav: false });

            const pedSprite = (node) => world.sprite(node, {
                atlas: PED_ATLAS, columns: 16, rows: 15, directions: 16, mirror: false,
                cell: { w: 64, h: 64 }, pivot: 'feet', width: 40, height: 40, blend: 'masked',
            });

            const player = $('<sprite>', { id: 'player', friction: 0.1 })
                .at(city.playerStart.x, city.playerStart.y)
                .size(40, 40).collisionCircle(12).body('dynamic').layerBits(1).layer(1).hide().appendTo($.world);
            player.get(0).max_hp = 100;
            player.get(0).cur_hp = 100;
            pedSprite(player);
            ownership.mark(player, 'persistent');
            const hero = createCharacter($, {
                node: player, input: 'wasd', speed: 180, runSpeed: 280, rotate: false,
                sprite: { columns: 16, fps: 9, frames: { walk: [1, 2, 3, 4], run: [5, 6, 7, 8] } },
                rows: { idle: 0, walk: 1, run: 2, shoot: 3, hit: 4, stunned: 4, dead: 5 },
            });

            const car = createVehicle($, {
                id: 'city-car', x: city.playerCar.x, y: city.playerCar.y, angle: city.playerCar.angle,
                width: 56, height: 30, mass: 1050, visible: false,
                engineForce: 105000, brakeForce: 210000, maxSpeed: 360, reverseMaxSpeed: 130,
                wheelbase: 62, steerRate: 2.6, layer: 1, mask: 0xffffffff,
                world, groundHeight: 0,
            });
            ownership.mark(car.node, 'persistent');
            car.seatsData = [{ x: 0, y: 0, side: 'front' }, { x: -24, y: 0, side: 'rear' }];
            const carView = $('<sprite>', { id: 'city-car-view' })
                .at(city.playerCar.x, city.playerCar.y).size(64, 34).hide().appendTo($.world);
            world.sprite(carView, {
                atlas: CAR_ATLAS, columns: 16, rows: 1, directions: 16, mirror: false,
                cell: { w: 64, h: 64 }, pivot: 'feet', width: 64, height: 34, blend: 'masked',
            });
            carView.get(0).sprite_col = 0;

            // Парковка: статические машины + тот же атлас.
            for (const spot of city.parking.slice(0, 6)) {
                $('<rect>', { color: '#00000000' }).at(spot.x, spot.y).size(52, 28)
                    .angle(spot.angle).body('static').hide().layerBits(8).layer(8).appendTo($.world);
                const view = $('<sprite>', { id: 'parked-' + spot.x + '-' + spot.y })
                    .at(spot.x, spot.y).size(64, 34).hide().appendTo($.world);
                world.sprite(view, {
                    atlas: CAR_ATLAS, columns: 16, rows: 1, directions: 16, mirror: false,
                    cell: { w: 64, h: 64 }, pivot: 'feet', width: 64, height: 34, blend: 'masked',
                });
                view.get(0).sprite_col = Math.round(((-spot.angle) * 16) / (Math.PI * 2)) % 16;
            }

            const pedCleanup = new Map();
            const cleanupPed = (node, removeNode = true) => {
                const entry = pedCleanup.get(node);
                if (!entry) return;
                pedCleanup.delete(node);
                try { entry.ai.dispose(); } catch (error) { /* уже мёртв */ }
                try { world.remove(node); } catch (error) { /* уже снят */ }
                if (removeNode && !node.removed) $(node).remove();
            };
            const spawnPed = (point) => {
                const node = $('<sprite>', { friction: 0.05 })
                    .at(point.x, point.y).size(40, 40).collisionCircle(10)
                    .body('dynamic').layerBits(2).layer(2).hide().appendTo($.world);
                node.get(0).max_hp = 60;
                node.get(0).cur_hp = 60;
                pedSprite(node);
                ownership.mark(node, 'temporary');
                const walk = city.walk[(Math.abs(Math.round(point.x + point.y)) >> 4) % city.walk.length];
                const a = { x: walk.points[0][0], y: walk.points[0][1] };
                const b = { x: walk.points[1][0], y: walk.points[1][1] };
                const controller = ai.controller(node, { speed: 58 + ((point.x + point.y) % 30) });
                controller.patrolTo([a, b], { loop: true });
                pedCleanup.set(node.get(0), { ai: controller });
                return node;
            };
            const population = createPopulation($, {
                name: 'city-peds', targetCount: 8, seed: 11,
                spawn: (point) => spawnPed(point),
                points: () => graph.spawnPoints({ kind: 'ped', tags: ['sidewalk'], limit: 64 }),
                focus: () => ({ x: player.get(0).x, y: player.get(0).y }),
                spawnDistance: 900, despawnDistance: 1500, cooldown: 0.25,
                ownership, uniquePoints: true,
                despawn: (entry) => cleanupPed(entry.node, false),
            });

            const missions = createMissions($, { player: '#player', saveKey: 'gta.sandbox.missions' });
            missions.define(deliveryMission({
                id: 'delivery', title: 'Доставка посылки',
                pickup: { x: city.playerStart.x - 40, y: city.playerStart.y - 40, w: 80, h: 80 },
                dropoff: { x: 9 * city.cell, y: 8 * city.cell + 20, w: 100, h: 100 },
                timeLimit: 120, cargo: 'parcel',
                onPickup: () => { $.signal.emit('hud:mission', { text: 'Посылка взята — везите в точку на юго-востоке' }); },
                onComplete: () => { $.signal.emit('hud:mission', { text: 'Доставлено! Миссия выполнена' }); $.camera.shake(3, 180); },
            }));
            missions.accept('delivery');

            const hud = createHud($, { hint: 'CITY · WASD пешком · E сесть/выйти · Space ручник · ЛКМ огонь · F1 оверлей' });
            let missionText = 'Доставка посылки: заберите посылку';
            $.on('hud:mission', (event) => { if (event && event.data && event.data.text) missionText = event.data.text; });

            // Мышь в мировые координаты: top-down ортокамера, screen-up = +Y.
            const aimAtMouse = () => {
                const m = $.input.mouse();
                const size = $.window.size(), w = size.w, h = size.h;
                return { x: (m.x - w / 2), y: -(m.y - h / 2) };
            };
            $.on('damage', (event) => {
                const payload = event && event.data ? event.data : event;
                if (!payload || !payload.dead) return;
                const node = payload.subject;
                if (node && pedCleanup.has(node)) cleanupPed(node, true);
            });
            let seated = false;
            let camX = player.get(0).x, camY = player.get(0).y;
            const fire = () => {
                if (seated) return;
                const p = player.get(0);
                const aim = aimAtMouse();
                const len = Math.hypot(aim.x, aim.y) || 1;
                const dir = { x: aim.x / len, y: aim.y / len };
                const result = combat.hitscan({
                    from: { x: p.x, y: p.y }, to: { x: p.x + dir.x * 760, y: p.y + dir.y * 760 },
                    mask: 2, wallMask: 8, damage: 22, type: 'pistol', source: p,
                });
                hero.shoot({ angle: Math.atan2(dir.y, dir.x), ms: 140 });
                $.camera.shake(2, 80);
                $.emit('stimulus', { type: 'gunshot', x: p.x, y: p.y, radius: 500 });
                if (result.hit && result.hits.length) $.camera.shake(3, 120);
            };

            const syncCar = () => {
                const n = car.node;
                const view = carView.get(0);
                view.x = n.x; view.y = n.y;
                const col = Math.round((-n.angle * 16) / (Math.PI * 2)) % 16;
                view.sprite_col = (col + 16) % 16;
                view.sprite_row = 0;
            };
            const toggleSeat = () => {
                if (!seated) {
                    const near = Math.hypot(player.get(0).x - car.node.x, player.get(0).y - car.node.y);
                    if (near > 140) { missionText = 'Слишком далеко от машины'; return; }
                    const result = seats.enter(car, hero, { seat: 0 });
                    if (result.ok) seated = true;
                } else {
                    seats.exit(hero, 'manual');
                    seated = false;
                    const n = car.node;
                    const p = player.get(0);
                    p.x = n.x + Math.cos(n.angle + Math.PI / 2) * 40;
                    p.y = n.y + Math.sin(n.angle + Math.PI / 2) * 40;
                    $(player).velocity(0, 0);
                }
            };

            runtime = {
                world, city, graph, ownership, combat, seats, ai, population, missions, hud, roofs,
                player, hero, car, carView, colliders, pedCleanup, cleanupPed, syncCar, spawnPed,
                update(dt) {
                    if ($.input.pressed('e')) toggleSeat();
                    if (!seated && ($.input.mousePressed(0) || $.input.pressed('f'))) fire();
                    if (seated) {
                        const v = $.input.vec('wasd');
                        car.control({ throttle: -v.y, steer: v.x, brake: 0, handbrake: $.input.down('space') }, dt);
                        syncCar();
                    } else {
                        hero.update(dt);
                        syncCar();
                    }
                    seats.update(dt);
                    ai.update(dt);
                    population.update(dt);
                    combat.update(dt);
                    missions.update(dt);
                    for (const [node, entry] of pedCleanup) {
                        entry.ai.update(dt);
                        if (node.removed || (node.cur_hp !== undefined && node.cur_hp <= 0)) cleanupPed(node, true);
                    }
                    const target = seated ? car.node : player.get(0);
                    for (const roof of roofs) {
                        const d = Math.hypot(target.x - roof.x, target.y - roof.y);
                        const want = Math.max(0.12, Math.min(1, (d - 70) / 170));
                        const next = roof.applied + (want - roof.applied) * Math.min(1, dt * 6);
                        if (Math.abs(next - roof.applied) > 0.01) {
                            roof.applied = next;
                            world.surface(roof.index).fade(next);
                        }
                    }
                    camX += (target.x - camX) * Math.min(1, dt * 7);
                    camY += (target.y - camY) * Math.min(1, dt * 7);
                    world.camera({ mode: 'topdown', x: camX, y: camY, h: 520, orthoHeight: 1150, near: 2 });
                    const m = missions.state('delivery');
                    const speed = seated ? (car.state().speed || 0) : 0;
                    hud.update({
                        hp: player.get(0).cur_hp, weapon: seated ? 'CAR' : 'PISTOL · 24',
                        speed, mission: missionText + (m && m.status === 'done' ? ' · ВЫПОЛНЕНО' : ''),
                        vehicles: 2 + city.parking.length, pedestrians: population.count(),
                    });
                },
            };
            globalThis.SANDBOX = runtime;
            $.log('sandbox city: ready');
        },
        update(dt) { if (runtime) runtime.update(dt); },
        render() { if (runtime) runtime.world.render(null, 1024, 576); },
        exit($) {
            const r = runtime;
            runtime = null;
            if (!r) return;
            for (const [node] of r.pedCleanup) r.cleanupPed(node);
            r.population.clear();
            r.ai.dispose();
            r.missions.dispose();
            r.hud.destroy();
            for (const node of r.colliders) $(node).remove();
            r.car.node.destroy();
            r.carView.remove();
            r.world.dispose();
        },
    });
}
