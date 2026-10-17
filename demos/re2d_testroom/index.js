// ===========================================================================
// Демо Re2D: тестовая комната на НОВОМ Re2D World (`$.re2dWorld` + .re2dmap).
//
// Карта — SDK-исходник `testroom.re2dmap`, скомпилированный в
// `testroom.re2dworld` командой `r2d-sdk world-compile --renderer`:
//   r2d-sdk world-compile demos/re2d_testroom/testroom.re2dmap \
//       --renderer --output demos/re2d_testroom/testroom.re2dworld
// Рантайм читает baked-геометрию (`$.re2dWorld.load`), а не рисует комнату
// руками из `<wall>`+`$.re2d.room`.
//
// Игрок ходит от первого лица (WASD + мышь) по collision-запросам мира
// (`support`/`blocked`), а не через Box2D. Оружие — HUD-спрайты
// maid_fps_weapons (пистолет/дробовик/АК), стрельба/перезарядка только
// визуал и звук: урона и боя нет.
//
// Враги — пиксельный атлас 5 направлений × 8 состояний. Новый World рисует
// только Re2DSprite (rigged), поэтому плоские кадры атласа проецируются в
// экран JS-проекцией той же камеры и рисуются в батч (`$.gfx.push.sprite`)
// ПОВЕРХ мира; стены перекрывают их через `world.ray` (целиком, без
// попиксельного z — это честно записано в ограничениях).
// ===========================================================================
'use strict';

const MAP = 're2d_testroom/testroom.re2dworld';
const MAP_SOURCE = 're2d_testroom/testroom.re2dmap';
const ROOM = { x: 0, y: 0, w: 1600, h: 1200, height: 320 };
// yaw камеры — ГРАДУСЫ (0 = +x; -90 = на север, -y).
const SPAWN = { x: 800, y: 1080, yaw: -90 };
const EYE = 76;                 // глаза над полом: на уровне груди врага,
                                // иначе билборд 170 см «нависает» над камерой
const PLAYER_RADIUS = 14;
const PLAYER_HEIGHT = 56;
const PLAYER_SPEED = 230;

// Кадр, в который рисует мир. 1024×576 — максимум Re2D frame (1..1024) и
// ровно 16:9, как окно демо 1280×720; оверлей масштабируется в окно.
const FRAME_W = 1024;
const FRAME_H = 576;

// Лист врага: 5 направлений × 8 состояний, ячейка 198×198.
// 0..3 — ходьба, 4 — прицел/присед, 5 — выстрел, 6 — падение, 7 — труп.
// В комнате боя нет: играем только ходьбу 0..3.
const ENEMY_ART = 're2d_testroom/assets/enemy_sheet.png';
const ENEMY_SHEET = { cols: 5, rows: 8, cw: 198, ch: 198 };
const ENEMY_WORLD_H = 150;      // рост врага: 170 на близкой дистанции закрывал пол-экрана
const ENEMY_FRAMES = ENEMY_SHEET.cols * ENEMY_SHEET.rows;
const ENEMY_WALK_FPS = 7.5;
const ENEMY_SEE_H = 85;         // высота центра, по которой проверяется видимость
const ENEMY_HP = 100;           // 3 выстрела из пистолета / 5 из АК / 1 дробовик
const WEAPON_DAMAGE = { pistol: 34, shotgun: 100, ak: 20 };
const DEATH_FALL_MS = 350;      // строка 6 (падение) → строка 7 (труп)

// Оружие от первого лица (maid_fps_weapons).
const WEAPON_BASE = 're2d_testroom/assets/weapons/';
const WEAPON_ORDER = ['pistol', 'shotgun', 'ak'];
const WEAPON_KEYS = ['1', '2', '3'];
const WEAPON_SIZE = 512;        // 128×4: целый ретро-масштаб
const WEAPON_FRAME = { cols: 3, rows: 2, cw: 128, ch: 128 };

const ENEMIES = [
    { id: 'cat-nw', path: [[900, 520], [1040, 520], [1040, 570], [900, 570]], speed: 64 },
    { id: 'cat-ne', path: [[980, 300], [1340, 300], [1340, 560], [980, 560]], speed: 72 },
    { id: 'cat-mid', path: [[380, 700], [560, 700], [560, 940], [380, 940]], speed: 56 },
    { id: 'cat-w', path: [[180, 640], [180, 980], [320, 980], [320, 640]], speed: 48 },
    { id: 'cat-e', path: [[1420, 640], [1420, 980], [1260, 980], [1260, 640]], speed: 52 },
    { id: 'cat-se', path: [[1120, 1060], [1420, 1060], [1420, 1120], [1120, 1120]], speed: 40 },
];

const NOTICE = 380;
const STOP_AT = 180;            // ближе не подходит — иначе билборд закрывает весь экран

export default function install($) {
    let world = null;
    let view = null;
    let labels = null;
    let hud_nodes = [];
    let enemy_frames = null;      // sprite ids кадров атласа
    let enemies = [];
    let enemy_views = [];         // ui.image-узлы: оверлей поверх кадра мира
    let weapons = null;
    let projected = 0;            // сколько врагов реально нарисовано
    let occluded = 0;             // сколько скрыто стеной
    let rays = 0;                 // запросов видимости за кадр
    const gun = {
        name: WEAPON_ORDER[0], state: 'idle', kind: null, seq: null,
        i: 0, t: 0, frame: -1, shots: 0, reloads: 0, sound_ok: 0, kills: 0,
    };

    // --- Геометрия/проекция кадра -----------------------------------------

    function windowScale() {
        const s = $.window && typeof $.window.size === 'function' ? $.window.size() : null;
        const w = s && s.w > 0 ? s.w : 1280;
        const h = s && s.h > 0 ? s.h : 720;
        return { x: w / FRAME_W, w, h };
    }

    /** Мировой point → экран кадра (`FRAME_W×FRAME_H`), как в renderView(). */
    function projectPoint(x, y, h) {
        const yaw = view.yaw * Math.PI / 180;
        const pitch = view.pitch * Math.PI / 180;
        const dx = x - view.x, dy = y - view.y, dh = h - view.h;
        const cp = Math.cos(pitch), sp = Math.sin(pitch);
        const cy = Math.cos(yaw), sy = Math.sin(yaw);
        const zf = dx * cy * cp + dy * sy * cp + dh * sp;
        if (zf < 8) return null;
        const right = -dx * sy + dy * cy;
        const up = -dx * sp * cy - dy * sp * sy + dh * cp;
        const focal = (FRAME_H / 2) / Math.tan(view.fov * Math.PI / 360);
        return {
            x: FRAME_W / 2 + focal * right / zf,
            y: FRAME_H / 2 - focal * up / zf,
            z: zf, k: focal / zf,
        };
    }

    /** Видит ли точка (враг) игрока: луч мира, без урона и без геометрии теней. */
    function worldSees(x, y, h) {
        rays++;
        if (!world || typeof world.ray !== 'function') return true;
        const hit = world.ray({ x: view.x, y: view.y, height: view.h },
                              { x, y, height: h });
        return !hit;
    }

    // --- Враги (данные + выбор кадра; рисуются оверлеем) -------------------

    function spawnEnemies() {
        enemies = ENEMIES.map((cfg) => {
            const facing = Math.atan2(cfg.path[1][1] - cfg.path[0][1],
                                      cfg.path[1][0] - cfg.path[0][0]) * 180 / Math.PI;
            return {
                cfg, x: cfg.path[0][0], y: cfg.path[0][1], at: 0, dwell: 0,
                mode: 'patrol', facing, walk_t: 0, row: 0, col: 0,
                flip: false, frame: 0, seen: false,
                hp: ENEMY_HP, dead: false, death_t: 0, death_col: 0,
                flash_t: 0, aimed: false, aim_z: 0,
            };
        });
    }

    function enemyFrame(e) {
        const rel = ((e.facing - view.yaw + 540) % 360) - 180;
        const col = Math.max(0, Math.min(4, Math.round((180 - Math.abs(rel)) / 45)));
        const row = e.mode === 'patrol' || e.mode === 'notice'
            ? Math.floor(e.walk_t * ENEMY_WALK_FPS / 1000) % 4 : 0;
        e.col = col;
        e.flip = rel < 0;
        e.row = row;
        e.frame = row * ENEMY_SHEET.cols + col;
        return e.frame;
    }

    function updateEnemies(step_ms) {
        for (const e of enemies) {
            if (e.dead) {
                e.death_t += step_ms;
                e.flash_t = Math.max(0, e.flash_t - step_ms);
                continue;
            }
            e.flash_t = Math.max(0, e.flash_t - step_ms);
            const distance = Math.hypot(view.x - e.x, view.y - e.y);
            e.seen = distance < 900 && worldSees(e.x, e.y, ENEMY_SEE_H);
            let moving = false;
            let dir_x = 0, dir_y = 0;

            if (distance < NOTICE && distance > STOP_AT && e.seen) {
                e.mode = 'notice';
                dir_x = view.x - e.x;
                dir_y = view.y - e.y;
                const k = Math.min(1, (e.cfg.speed / distance) * (step_ms / 1000) * 1.15);
                e.x += dir_x * k;
                e.y += dir_y * k;
                moving = true;
            } else if (distance <= STOP_AT) {
                e.mode = 'idle';
            } else {
                e.mode = 'patrol';
                if (e.dwell > 0) e.dwell -= step_ms;
                else {
                    const target = e.cfg.path[e.at];
                    const dx = target[0] - e.x;
                    const dy = target[1] - e.y;
                    const len = Math.hypot(dx, dy);
                    if (len < 4) {
                        e.at = (e.at + 1) % e.cfg.path.length;
                        e.dwell = 500;
                    } else {
                        const v = (e.cfg.speed / 1000) * step_ms;
                        dir_x = dx;
                        dir_y = dy;
                        e.x += dx / len * v;
                        e.y += dy / len * v;
                        moving = true;
                    }
                }
            }
            if (moving) {
                e.facing = Math.atan2(dir_y, dir_x) * 180 / Math.PI;
                e.walk_t += step_ms;
            } else {
                e.walk_t = 0;
                e.frame = enemyFrame(e);
            }
            if (moving) e.frame = enemyFrame(e);
        }
    }

    /**
     * Разложить врагов поверх кадра мира. World рисует только Re2DSprite,
     * поэтому плоские кадры атласа живут в `ui.image` (окно-координаты,
     * рисуются после мира). Стену проверяем `world.ray`: враг за стеной
     * скрывается целиком — попиксельного z-теста у оверлея нет, это
     * осознанное ограничение демо.
     */
    function drawEnemies() {
        projected = 0;
        occluded = 0;
        const ws = windowScale();
        const cx = ws.w / 2;
        const cy = ws.h / 2;
        for (let i = 0; i < enemies.length; i++) {
            const e = enemies[i];
            const view_node = enemy_views[i];
            if (!view_node) continue;
            e.aimed = false;
            if (e.dead && e.death_t >= DEATH_FALL_MS) e.frame = 7 * ENEMY_SHEET.cols + e.death_col;
            else if (e.dead) e.frame = 6 * ENEMY_SHEET.cols + e.death_col;
            const base = projectPoint(e.x, e.y, 0);
            const head = projectPoint(e.x, e.y, ENEMY_WORLD_H);
            if (!base || !head) { view_node.get(0).visible = false; continue; }
            const hpx = base.y - head.y;
            if (!(hpx > 1)) { view_node.get(0).visible = false; continue; }
            if (world && typeof world.ray === 'function') {
                rays++;
                const hit = world.ray({ x: view.x, y: view.y, height: view.h },
                                      { x: e.x, y: e.y, height: ENEMY_SEE_H });
                if (hit) { occluded++; view_node.get(0).visible = false; continue; }
            }
            const sx = base.x * ws.x;
            const sy = base.y * ws.x;
            const w = hpx * ws.x;
            const h = hpx * ws.x;
            if (sx + w / 2 < 0 || sx - w / 2 > ws.w || sy < 0 || sy - h > sy + 1) {
                if (sx < -w || sx > ws.w + w) { view_node.get(0).visible = false; continue; }
            }
            // Прицел — центр окна; попадание считается по тому же прямоугольнику,
            // которым враг нарисован (что видно, в то и стреляем).
            if (!e.dead && sx - w / 2 <= cx && cx <= sx + w / 2
                && sy - h <= cy && cy <= sy) {
                e.aimed = true;
                e.aim_z = base.z;
            }
            view_node.frame(e.frame);
            view_node.at(sx, sy - h / 2).size(w, h);
            view_node.color(e.flash_t > 0 ? '#ffd0d0' : '#ffffff');
            view_node.get(0).visible = true;
            projected++;
        }
    }

    // --- Игрок: движение по collision-запросам мира ------------------------

    function blockedAt(x, y, bottom) {
        if (!world || typeof world.blocked !== 'function') return false;
        return world.blocked(x, y, PLAYER_RADIUS, bottom, bottom + PLAYER_HEIGHT);
    }

    function supportAt(x, y) {
        if (!world || typeof world.support !== 'function') return null;
        return world.support(x, y, view.h - EYE + 0.01, PLAYER_HEIGHT, 9);
    }

    function movePlayer(dx, dy) {
        const support = supportAt(view.x, view.y);
        const bottom = support ? support.height : 0;
        let moved = false;
        if (!blockedAt(view.x + dx, view.y, bottom)) { view.x += dx; moved = true; }
        if (!blockedAt(view.x, view.y + dy, bottom)) { view.y += dy; moved = true; }
        const s = supportAt(view.x, view.y);
        view.h = (s ? s.height : 0) + EYE;
        return moved;
    }

    // --- Оружие от первого лица (как раньше, только HUD) -------------------

    function weaponLoad() {
        if (typeof $.fs === 'undefined' || !$.fs.readJSON) return null;
        const data = $.fs.readJSON(WEAPON_BASE + 'animations.json', null);
        if (!data || !data.weapons) {
            $.log('re2d_testroom: не прочитан animations.json оружия — остаюсь без оружия');
            return null;
        }
        const out = {};
        for (const name of WEAPON_ORDER) {
            const def = data.weapons[name];
            if (!def || !def.atlas) continue;
            const node = $('<ui.image>', {
                id: 'weapon-' + name,
                x: 640, y: 720 - WEAPON_SIZE / 2,
                w: WEAPON_SIZE, h: WEAPON_SIZE,
            })
                .frames({ src: WEAPON_BASE + def.atlas, cols: WEAPON_FRAME.cols,
                          rows: WEAPON_FRAME.rows, cw: WEAPON_FRAME.cw,
                          ch: WEAPON_FRAME.ch })
                .frame(0)
                .appendTo($.ui);
            node.get(0).visible = false;
            out[name] = { def, node, frame: -1 };
        }
        return out;
    }

    /** Попадание: ближайший враг под прицелом (из уже нарисованного кадра). */
    function shootAtCrosshair() {
        let target = null;
        for (const e of enemies) {
            if (!e.aimed || e.dead) continue;
            if (!target || e.aim_z < target.aim_z) target = e;
        }
        if (!target) return;
        const damage = WEAPON_DAMAGE[gun.name] || 20;
        target.hp -= damage;
        target.flash_t = 90;
        if (target.hp <= 0) {
            target.hp = 0;
            target.dead = true;
            target.mode = 'dead';
            target.death_t = 0;
            target.death_col = target.col;
            target.aimed = false;
            gun.kills++;
        }
    }

    function weaponSound(path) {
        if (!path || !$.sound || typeof $.sound.play !== 'function') return;
        const handle = $.sound.play(WEAPON_BASE + path, { volume: 0.5 });
        if (typeof handle === 'number' ? handle >= 0 : !!handle) gun.sound_ok++;
    }

    function weaponApplyFrame(frame) {
        const w = weapons && weapons[gun.name];
        if (!w || gun.frame === frame) return;
        w.node.frame(frame);
        w.frame = frame;
        gun.frame = frame;
        const def = w.def;
        if (gun.kind === 'fire' && frame === 1) {
            const fire = (def.sounds && def.sounds.fire) || [];
            if (fire.length) weaponSound(fire[Math.floor(Math.random() * fire.length)]);
            gun.shots++;
            shootAtCrosshair();
        }
        if (gun.kind === 'reload' && frame === 5 && def.sounds && def.sounds.shell_insert) {
            weaponSound(def.sounds.shell_insert);
        }
    }

    function weaponSet(name) {
        if (!weapons || !weapons[name] || gun.seq) return false;
        for (const other of WEAPON_ORDER) {
            if (weapons[other]) weapons[other].node.get(0).visible = other === name;
        }
        gun.name = name;
        gun.state = 'idle';
        gun.kind = null;
        gun.seq = null;
        gun.i = 0;
        gun.t = 0;
        gun.frame = -1;
        weaponApplyFrame(0);
        return true;
    }

    function weaponStart(kind) {
        if (!weapons || gun.seq) return false;
        const w = weapons[gun.name];
        const seq = w && w.def.animations ? w.def.animations[kind] : null;
        if (!Array.isArray(seq) || seq.length === 0) return false;
        gun.kind = kind;
        gun.state = kind;
        gun.seq = seq;
        gun.i = 0;
        gun.t = 0;
        gun.frame = -1;
        if (kind === 'reload') {
            gun.reloads++;
            weaponSound(w.def.sounds && w.def.sounds.reload);
        }
        weaponApplyFrame(seq[0].frame);
        return true;
    }

    function weaponTick(dt_ms) {
        if (!weapons || !gun.seq) return;
        gun.t += dt_ms;
        while (gun.seq && gun.t >= gun.seq[gun.i].ms) {
            gun.t -= gun.seq[gun.i].ms;
            gun.i++;
            if (gun.i >= gun.seq.length) {
                gun.seq = null;
                gun.state = 'idle';
                gun.kind = null;
                weaponApplyFrame(0);
                break;
            }
            weaponApplyFrame(gun.seq[gun.i].frame);
        }
    }

    function weaponCycle() {
        const i = WEAPON_ORDER.indexOf(gun.name);
        for (let step = 1; step <= WEAPON_ORDER.length; step++) {
            const name = WEAPON_ORDER[(i + step) % WEAPON_ORDER.length];
            if (weapons && weapons[name] && weaponSet(name)) return name;
        }
        return null;
    }

    function nearest() {
        let best = null;
        for (const e of enemies) {
            const d = Math.hypot(view.x - e.x, view.y - e.y);
            if (!best || d < best.distance) best = { id: e.cfg.id, distance: d, mode: e.mode };
        }
        return best;
    }

    // --- Кадр: мир + оверлей врагов ---------------------------------------

    function frame() {
        if (!world || !view) return;
        world.render(view, FRAME_W, FRAME_H);
    }

    function leave() {
        $.window.mouseLock(false);
        for (const node of hud_nodes) node.remove();
        hud_nodes = [];
        if (weapons) for (const name of WEAPON_ORDER) if (weapons[name]) weapons[name].node.remove();
        weapons = null;
        for (const node of enemy_views) node.remove();
        enemy_views = [];
        if (world && typeof world.dispose === 'function') world.dispose();
        world = null;
        view = null;
        labels = null;
        enemies = [];
        gun.seq = null;
        gun.state = 'idle';
        gun.name = WEAPON_ORDER[0];
        enemy_frames = null;
    }

    $.agent.expose('re2dTestroom', () => {
        const info = world && typeof world.info === 'function' ? world.info() : null;
        return {
            map: MAP,
            mapSource: MAP_SOURCE,
            backend: info && info.backend ? info.backend : null,
            world: info ? { cells: info.cells, surfaces: info.surfaces, lights: info.lights } : null,
            hero: view ? { x: Math.round(view.x * 10) / 10, y: Math.round(view.y * 10) / 10,
                           h: Math.round(view.h * 10) / 10, yaw: Math.round(view.yaw * 10) / 10,
                           pitch: Math.round(view.pitch * 10) / 10 } : null,
            room: ROOM,
            weapons: weapons ? WEAPON_ORDER.filter((n) => weapons[n]).length : 0,
            combat: false,
            weapon: {
                name: gun.name, state: gun.state, frame: gun.frame,
                shots: gun.shots, reloads: gun.reloads, sound_ok: gun.sound_ok,
                kills: gun.kills,
                seq_left: gun.seq ? gun.seq.length - gun.i : 0,
            },
            frames: ENEMY_FRAMES,
            drawn: projected,
            occluded: occluded,
            enemies: enemies.map((e) => ({
                id: e.cfg.id, mode: e.mode, seen: e.seen,
                x: Math.round(e.x * 10) / 10, y: Math.round(e.y * 10) / 10,
                distance: view ? Math.round(Math.hypot(view.x - e.x, view.y - e.y)) : null,
                facing: Math.round(e.facing), frame: e.frame, row: e.row, col: e.col,
                flip: e.flip, hp: e.hp, dead: e.dead, aimed: e.aimed,
            })),
            nearest: view ? nearest() : null,
        };
    });

    // Регистрируем кадровый рендер один раз: scene enter/exit только включают
    // и выключают world, обработчик не копится.
    $.render(frame);

    $.scene.add('re2d_testroom', {
        enter($) {
            $.world.gravity(0, 0).color('#0b0e14');
            view = { x: SPAWN.x, y: SPAWN.y, h: EYE, yaw: SPAWN.yaw, pitch: 0, fov: 72, near: 4 };

            world = $.re2dWorld.load(MAP).backend('gpu');
            world.lighting({ mode: 'classic', dynamic: true, shadows: true,
                             distanceScale: 0.001 });
            world.camera(view);

            // Кадры атласа врага нужны как sprite id для батча; сам узел
            // не рисуется (обычный 2D-путь скрыт).
            const sheet = $('<sprite>', { id: 'enemy-sheet' })
                .frames({ src: ENEMY_ART, cols: ENEMY_SHEET.cols, rows: ENEMY_SHEET.rows,
                          cw: ENEMY_SHEET.cw, ch: ENEMY_SHEET.ch })
                .hide()
                .appendTo($.world);
            enemy_frames = sheet.get(0).frames;
            spawnEnemies();
            enemy_views = [];
            for (let i = 0; i < enemies.length; i++) {
                const node = $('<ui.image>', { id: 'enemy-view-' + enemies[i].cfg.id,
                                               x: 0, y: 0, w: 8, h: 8 })
                    .frames({ src: ENEMY_ART, cols: ENEMY_SHEET.cols, rows: ENEMY_SHEET.rows,
                              cw: ENEMY_SHEET.cw, ch: ENEMY_SHEET.ch })
                    .frame(0)
                    .appendTo($.ui);
                node.get(0).visible = false;
                enemy_views.push(node);
            }

            $.window.mouseLock(true);

            hud_nodes = [];
            hud_nodes.push($('<ui.panel>', { id: 'testroom-panel', color: '#05070cd0' })
                .at(640, 40).size(1240, 80).appendTo($.ui));
            hud_nodes.push($('<ui.panel>', { id: 'testroom-cross', color: '#e8f0ffcc' })
                .at(640, 360).size(6, 6).appendTo($.ui));
            labels = {
                title: $('<ui.label>', { id: 'testroom-title', size: 24, color: '#9fe8b0',
                                          align: 'center',
                                          text: 'Re2D World · тестовая карта (.re2dmap) и враги на билбордах' })
                    .at(640, 26).appendTo($.ui),
                hint: $('<ui.label>', { id: 'testroom-hint', size: 15, color: '#9fb3d0',
                                         align: 'center',
                                         text: 'WASD — ходить · мышь — смотреть · 1/2/3 — оружие · ЛКМ/F — огонь · R — перезарядка · Esc — меню' })
                    .at(640, 56).appendTo($.ui),
                status: $('<ui.label>', { id: 'testroom-status', size: 16, color: '#e8f0ff',
                                           align: 'center', text: '' })
                    .at(640, 690).appendTo($.ui),
            };
            hud_nodes.push(labels.title, labels.hint, labels.status);

            weapons = weaponLoad();
            if (weapons) {
                gun.name = WEAPON_ORDER[0];
                gun.state = 'idle';
                gun.kind = null;
                gun.seq = null;
                gun.i = 0;
                gun.t = 0;
                gun.frame = -1;
                gun.shots = 0;
                gun.reloads = 0;
                gun.sound_ok = 0;
                gun.kills = 0;
                weaponSet(gun.name);
            }
        },

        exit() { leave(); },

        update(dt) {
            if (!world || !view) return;
            const step_ms = Math.max(0, Math.min(0.05, Number(dt) || 0)) * 1000;

            // Мышь — взгляд; стрелки тоже, чтобы тест мог смотреть без мыши.
            const mouse = $.input.mouseDelta();
            view.yaw += mouse.x * 0.14;
            view.pitch = Math.max(-80, Math.min(80, view.pitch - mouse.y * 0.14));
            view.yaw += $.input.axis('left', 'right') * (step_ms / 1000) * 90;
            view.pitch = Math.max(-80, Math.min(80,
                        view.pitch + $.input.axis('down', 'up') * (step_ms / 1000) * 70));
            view.yaw = ((view.yaw + 540) % 360) - 180;

            // WASD: вперёд — куда смотрит камера.
            const strafe = $.input.axis('a', 'd');
            const forward = $.input.axis('s', 'w');    // +1 = W
            if (strafe || forward) {
                const yaw = view.yaw * Math.PI / 180;
                const cy = Math.cos(yaw), sy = Math.sin(yaw);
                const length = Math.hypot(strafe, forward) || 1;
                const dx = (cy * forward - sy * strafe) / length;
                const dy = (sy * forward + cy * strafe) / length;
                movePlayer(dx * PLAYER_SPEED * (step_ms / 1000),
                           dy * PLAYER_SPEED * (step_ms / 1000));
            }

            updateEnemies(step_ms);
            drawEnemies();

            if (weapons) {
                for (let k = 0; k < WEAPON_KEYS.length; k++) {
                    if ($.input.pressed(WEAPON_KEYS[k])) weaponSet(WEAPON_ORDER[k]);
                }
                if ($.input.pressed('c')) weaponCycle();
                if ($.input.mousePressed('left') || $.input.pressed('f')) weaponStart('fire');
                if ($.input.pressed('r')) weaponStart('reload');
                weaponTick(step_ms);
            }

            if (labels) {
                const close = nearest();
                const w = weapons
                    ? ` · ${gun.name.toUpperCase()} ${gun.state}`
                      + `${gun.shots ? ` · выстрелов ${gun.shots}` : ''}`
                      + `${gun.kills ? ` · убито ${gun.kills}` : ''}`
                    : ' · оружия нет';
                labels.status.text((close
                    ? `врагов ${enemies.length} · ближайший ${close.id} · ${Math.round(close.distance)} px · режим ${close.mode}`
                    : `врагов ${enemies.length}`) + w);
            }
        },
    });

    $.update(() => {
        if ($.scene.current() !== 're2d_testroom') return;
        if ($.input.pressed('escape')) $.scene.load('launcher', { transition: 'fade', ms: 200 });
    });
}
