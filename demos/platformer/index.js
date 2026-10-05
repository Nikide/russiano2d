// ===========================================================================
// Демо: платформер от третьего лица.
//
// Показывает связку «физика Box2D + анимация по листам + звук + интерфейс» на
// высокоуровневом API $. Ни одного import: всё, что нужно, живёт на $.
//
// Уровень задан ASCII-картой: один символ = тайл 32x32 пикселя.
//   #  земля (статичное тело)      C  ящик (динамическое тело)
//   =  платформа                   o  монета
//   E  враг                        X  сундук-финиш
//   P  точка появления игрока      .  пусто
//
// Игрок — маскот движка: лист 8x4, кадр 176x176, строки это состояния.
// Враги — лист 8x9, кадр 48x64 (ряд 0 — ходьба).
// ===========================================================================

const TILE = 32;
const COLS = 40;
const ROWS = 22;

const LEVEL = [
    '........................................',
    '........................................',
    '........................................',
    '.....................ooo................',
    '...................=======..............',
    '........................................',
    '..........o.....................o.......',
    '........=====.................=====.....',
    '........................................',
    '........................................',
    '..............C.......C.................',
    '........................................',
    '.....o..................................',
    '...=====................................',
    '........................................',
    '........................................',
    '..P...........E.............E...........',
    '........................................',
    '........................................',
    '........................................',
    '.....................................X..',
    '########################################',
];

// --- Ассеты -----------------------------------------------------------------

const MASCOT = { src: 'demos/assets/art/mascot/russiano_mascot_sheet_a.png',
                 cols: 8, rows: 4, cw: 176, ch: 176 };
// Запасной лист: если маскота на диске нет, игрок остаётся анимированным.
const MASCOT_FALLBACK = { src: 'demos/assets/art/characters/catgirl_green_ak_sprite_sheet.png',
                          cols: 8, rows: 9, cw: 48, ch: 64 };
const ENEMY_SHEET = { src: 'demos/assets/art/characters/enemy_03_zombie_girl_8x9.png',
                      cols: 8, rows: 9, cw: 48, ch: 64 };
const TILESET = { src: 'demos/assets/tiles/platformer_tileset_16x16.png',
                  cols: 16, rows: 9, cw: 16, ch: 16 };
// Монета и звезда-финиш берутся из исходного листа Kenney: в упакованном
// platformer_tileset фон клеток залит непрозрачным голубым, и предметы в нём
// рисовались бы голубыми квадратами.
const KENNEY = 'demos/assets/tiles/kenney_16x16.png';
const COIN_REGION = [96, 160, 16, 16];   // золотая монета
const STAR_REGION = [80, 16, 16, 16];    // звезда — финиш уровня

const BG_FAR = 'demos/assets/tiles/bg_mountains.png';
const BG_NEAR = 'demos/assets/tiles/bg_clouds.png';
const POSTER_LOSE = 'demos/assets/art/posters/menu.png';

// Индексы тайлов в тайлсете (сетка 16x9, клетка 16x16).
const TILE_GRASS = 0;
const TILE_DIRT = 4;
const TILE_STONE = 48;

const SFX = {
    jump: 'demos/assets/audio/sfx/jump_01.ogg',
    step: 'demos/assets/audio/sfx/step_01.ogg',
    pickup: 'demos/assets/audio/sfx/pickup_01.ogg',
    hurt: 'demos/assets/audio/sfx/hurt_01.ogg',
    enemyDie: 'demos/assets/audio/sfx/enemy_die.ogg',
    click: 'demos/assets/audio/sfx/ui_click.ogg',
};
const MUSIC_ACTION = 'demos/assets/audio/music/action.ogg';

// --- Настройки движения и боя ------------------------------------------------

// Тайл 32 px, гравитация 2000 px/с² — как в исходном демо.
const GRAVITY = 2000;
const RUN_SPEED = 300;
const JUMP_SPEED = 640;
const MAX_FALL = 1500;
const AIR_CONTROL = 8;
const ENEMY_SPEED = 90;
const STOMP_BOUNCE = 420;
const HURT_COOLDOWN = 1.2;
const CONTACT_DAMAGE = 34;

// Кадры маскота: индекс = строка * 8 + столбец.
//   ряд 0 — покой, ряд 1 (0..5) — ходьба, ряд 2 (5..7) — бег/прыжок.
const ANIM_MASCOT = {
    idle: { from: 0, to: 3, speed: 5, loop: true },
    walk: { from: 8, to: 13, speed: 13, loop: true },
    air: { from: 21, to: 23, speed: 9, loop: true },
};
// То же для запасного листа 8x9: ряд 0 — покой, ряд 1 — ходьба, ряд 2 — прыжок.
const ANIM_FALLBACK = {
    idle: { from: 0, to: 7, speed: 7, loop: true },
    walk: { from: 8, to: 15, speed: 14, loop: true },
    air: { from: 16, to: 23, speed: 9, loop: true },
};

// Игрок: хитбокс 26x64, картинка крупнее — в клетке листа есть поля.
const HERO_HITBOX = [26, 64];
const HERO_DRAW = 80;
const ENEMY_HITBOX = [26, 56];
const ENEMY_DRAW = [44, 58];

export default function install($) {
    // --- Состояние сцены (сбрасывается в enter) --------------------------
    const s = {
        hero: null,
        enemies: [],
        coins: [],
        crates: [],
        chest: null,
        parallax: [],
        ui: { pause: [], over: [] },
        anim: '',                   // текущее состояние анимации героя
        anims: ANIM_MASCOT,
        score: 0,
        lives: 3,
        coinsLeft: 0,
        paused: false,
        over: false,
        finished: false,
        hurt: 0,                    // остаток неуязвимости после урона, секунды
        airTime: 0,
        commandVy: 0,               // вертикальная скорость, заданная игроку
        entryVy: 0,                 // она же на входе в текущий кадр
        stepTimer: 0,
        spawn: { x: 80, y: 400 },
    };

    // --- Мелкие помощники ------------------------------------------------

    /**
     * Текст интерфейса. Размер шрифта приходится ставить полю узла напрямую:
     * $.attr('size', n) уходит в attrs, а рисуется node.size.
     */
    function text(id, x, y, value, size, color, align) {
        const node = $('<ui.label>', { id, text: value, color: color || '#e8f0ff' })
            .at(x, y).get(0);
        node.size = size || 20;
        node.attrs.align = align || 'left';
        return $(node);
    }

    /** Кнопка интерфейса: click вешается на узел, позиция — центр. */
    function button(id, x, y, w, h, caption) {
        return $('<ui.button>', { id, text: caption, x, y, w, h }).appendTo($.ui);
    }

    function show(group, on) {
        for (const w of group) (on ? w.show() : w.hide());
    }

    function play(name, opts) { $.sound.play(SFX[name], opts); }

    /**
     * Слой параллакса из N одинаковых спрайтов. Позиции пересчитываются
     * каждый кадр: слой «уезжает» медленнее мира в k раз.
     */
    function parallax(src, w, h, k, screenY) {
        const nodes = [];
        const view = $.gfx.size();
        // Тайл занимает на экране w * zoom точек; берём с запасом на зум меньший
        // текущего, чтобы слой не разошёлся при смене масштаба.
        const count = Math.ceil(view.w / w) + 2;
        for (let i = 0; i < count; i++) {
            nodes.push($('<sprite>', { class: 'parallax' })
                .sprite(src).size(w, h).layer(-20 + Math.round(k * 10))
                .appendTo($.world));
        }
        const layer = { nodes, w, h, k, screenY };
        s.parallax.push(layer);
        return layoutParallax(layer);
    }

    /** Раскладывает тайлы слоя так, чтобы они закрывали весь экран. */
    function layoutParallax(layer) {
        const cam = $.camera.pos();
        const zoom = $.camera.zoom();
        const view = $.gfx.size();
        const step = layer.w * zoom;
        const shift = ((cam.x * layer.k * zoom) % step + step) % step;
        const y = cam.y + (layer.screenY - view.h / 2) / zoom;
        for (let i = 0; i < layer.nodes.length; i++) {
            layer.nodes[i].at(cam.x + (i * step - shift - view.w / 2) / zoom, y);
        }
    }

    // --- Построение уровня ------------------------------------------------

    function solidTile(x, y, index) {
        return $('<wall>', { x, y, w: TILE, h: TILE, friction: 0.8 })
            .frames(TILESET).frame(index).layer(0).appendTo($.world);
    }

    function buildLevel() {
        for (let row = 0; row < ROWS; row++) {
            for (let col = 0; col < COLS; col++) {
                const ch = LEVEL[row][col];
                const x = col * TILE + TILE / 2;
                const y = row * TILE + TILE / 2;

                switch (ch) {
                case '#': {
                    const surface = row === 0 || LEVEL[row - 1][col] === '.';
                    solidTile(x, y, surface ? TILE_GRASS : TILE_DIRT);
                    break;
                }
                case '=':
                    solidTile(x, y, TILE_STONE);
                    break;
                case 'C':
                    s.crates.push($('<wall>', {
                        class: 'crate', x, y, w: TILE, h: TILE,
                        density: 0.6, friction: 0.5, restitution: 0.02,
                    }).body('dynamic').frames(TILESET).frame(TILE_STONE)
                        .layer(2).appendTo($.world));
                    break;
                case 'o': {
                    const coin = $('<sprite>', { class: 'coin', src: KENNEY, x, y })
                        .region(COIN_REGION[0], COIN_REGION[1], COIN_REGION[2], COIN_REGION[3])
                        .size(22, 22).layer(1).appendTo($.world);
                    coin.get(0).bob = Math.random() * 6.28;
                    coin.get(0).base_y = y;
                    s.coins.push(coin);
                    break;
                }
                case 'E': {
                    const enemy = $('<enemy>', { class: 'enemy', x, y })
                        .collision(ENEMY_HITBOX[0], ENEMY_HITBOX[1])
                        .size(ENEMY_DRAW[0], ENEMY_DRAW[1])
                        .frames(ENEMY_SHEET).animate({ from: 0, to: 7, speed: 6, loop: true })
                        .hp(1).layer(2).appendTo($.world);
                    const node = enemy.get(0);
                    node.dir = -1;
                    node.min_x = x - 96;
                    node.max_x = x + 96;
                    s.enemies.push(enemy);
                    break;
                }
                case 'X': {
                    const star = $('<sprite>', { id: 'chest', class: 'chest', src: KENNEY, x, y })
                        .region(STAR_REGION[0], STAR_REGION[1], STAR_REGION[2], STAR_REGION[3])
                        .size(40, 40).layer(1).appendTo($.world);
                    s.chest = star;
                    const caption = $('<text>', { id: 'finish-label', text: 'Финиш',
                                                  color: '#ffe9a8', align: 'center',
                                                  x, y: y - 46 }).layer(1);
                    caption.get(0).size = 16;
                    caption.appendTo($.world);
                    break;
                }
                case 'P':
                    s.spawn = { x, y };
                    break;
                default:
                    break;
                }
            }
        }
        s.coinsLeft = s.coins.length;
    }

    function buildHero() {
        const hero = $('<player>', { id: 'hero', class: 'hero' })
            .at(s.spawn.x, s.spawn.y)
            .collision(HERO_HITBOX[0], HERO_HITBOX[1])
            .size(HERO_DRAW, HERO_DRAW)
            .health(100)
            .layer(3);

        hero.frames(MASCOT);
        s.anims = ANIM_MASCOT;
        if (!hero.get(0).frames) {
            // Маскота нет на диске — берём обычный лист персонажа.
            hero.frames(MASCOT_FALLBACK);
            s.anims = ANIM_FALLBACK;
        }
        hero.animate(s.anims.idle).appendTo($.world);
        return hero;
    }

    function buildUI() {
        // --- HUD -------------------------------------------------------
        $('<ui.panel>', { x: 195, y: 92, w: 370, h: 180, color: '#0b1220b0' })
            .appendTo($.ui);
        text('hud-title', 24, 16, 'Платформер · Russiano2D', 15, '#8fa3bf');
        text('hud-hp', 24, 44, 'Здоровье', 15, '#8fa3bf');
        $('<ui.bar>', { id: 'hud-bar' }).at(240, 54).size(240, 16)
            .max(100).value(100).appendTo($.ui);
        text('hud-score', 24, 78, 'Очки: 0', 20);
        text('hud-lives', 24, 106, 'Жизни: 3', 20);
        text('hud-coins', 24, 134, 'Монет: 0', 20);
        text('hud-hint', 24, 690,
             'A/D или ←/→ — идти · Space/W/↑ — прыжок · прыжок сверху убивает врага · ' +
             'P — пауза · Esc — пауза и выход в меню', 15, '#8fa3bf');

        // --- Пауза -----------------------------------------------------
        const pause = [];
        pause.push($('<ui.panel>', { x: 640, y: 350, w: 460, h: 220, color: '#0b1220ee' })
            .appendTo($.ui));
        pause.push(text('pause-title', 640, 280, 'Пауза', 34, '#e8f0ff', 'center'));
        pause.push(text('pause-score', 640, 330, 'Очки: 0', 20, '#8fa3bf', 'center'));
        pause.push(button('pause-resume', 520, 400, 180, 44, 'Продолжить'));
        pause.push(button('pause-menu', 760, 400, 180, 44, 'В меню'));
        pause.push(text('pause-hint', 640, 440, 'P — снять паузу · Esc — в меню',
                        15, '#8fa3bf', 'center'));
        pause[3].on('click', () => { play('click'); setPaused(false); });
        pause[4].on('click', () => { play('click'); $.scene.load('launcher'); });
        show(pause, false);
        s.ui.pause = pause;

        // --- Проигрыш --------------------------------------------------
        const over = [];
        over.push($('<ui.panel>', { x: 640, y: 360, w: 520, h: 400, color: '#160810f0' })
            .appendTo($.ui));
        over.push(text('over-title', 640, 200, 'Игра окончена', 40, '#ff8080', 'center'));
        over.push($('<ui.image>', { x: 640, y: 340, w: 320, h: 180 })
            .sprite(POSTER_LOSE).appendTo($.ui));
        over.push(text('over-score', 640, 460, 'Очки: 0', 24, '#e8f0ff', 'center'));
        over.push(button('over-restart', 520, 520, 180, 44, 'Заново'));
        over.push(button('over-menu', 760, 520, 180, 44, 'В меню'));
        over.push(text('over-hint', 640, 570, 'R — начать заново · Esc — в меню',
                       15, '#8fa3bf', 'center'));
        over[4].on('click', () => { play('click'); $.scene.restart(); });
        over[5].on('click', () => { play('click'); $.scene.load('launcher'); });
        show(over, false);
        s.ui.over = over;
    }

    // --- Логика ------------------------------------------------------------

    function refreshHud() {
        const hp = s.hero ? s.hero.hp() : 0;
        $.ui.bar('#hud-bar', hp, 100);
        $.ui.label('#hud-hp', hp > 0 ? 'Здоровье' : 'Здоровье (0)');
        $.ui.label('#hud-score', 'Очки: ' + s.score);
        $.ui.label('#hud-lives', 'Жизни: ' + s.lives);
        $.ui.label('#hud-coins', 'Монет: ' + s.coinsLeft);
        $.ui.label('#pause-score', 'Очки: ' + s.score);
        $.ui.label('#over-score', 'Очки: ' + s.score);
    }

    function setPaused(on) {
        if (s.over && on) return;
        s.paused = on;
        show(s.ui.pause, on);
        // Мир — на паузу: гравитация выключается, тела замирают.
        if (on) {
            $.world.pause();
            $('.hero, .enemy, .crate').stopAll();
        } else {
            $.world.resume();
        }
        $.sound.pauseMusic(on);
    }

    function loseLife() {
        s.lives--;
        play('hurt', { volume: 1 });
        $.camera.shake(10, 260);
        if (s.lives <= 0) {
            gameOver();
            return;
        }
        s.hero.respawn(s.spawn.x, s.spawn.y);
        s.hero.hp(100);
        s.hurt = HURT_COOLDOWN;
        refreshHud();
    }

    function gameOver() {
        s.over = true;
        setPaused(false);
        $.world.pause();
        $('.hero, .enemy, .crate').stopAll();
        show(s.ui.over, true);
        $.sound.stopMusic(400);
        play('enemyDie', { volume: 0.8 });
    }

    function hurtHero(fromX) {
        if (s.hurt > 0 || s.over) return;
        const hp = s.hero.hp() - CONTACT_DAMAGE;
        s.hurt = HURT_COOLDOWN;
        s.hero.hp(Math.max(0, hp)).invulnerable(HURT_COOLDOWN * 1000);
        play('hurt', { volume: 0.8 });
        $.camera.shake(8, 220);
        // Отбрасываем игрока от источника урона.
        const dir = s.hero.pos().x < fromX ? -1 : 1;
        s.hero.velocity(dir * 240, -260);
        if (hp <= 0) loseLife();
        else refreshHud();
    }

    function updatePlayer(dt) {
        const hero = s.hero;
        if (!hero || !hero.get(0) || hero.get(0).removed) return;

        const p = hero.pos();
        const v = hero.velocity();
        // Скорость входа в этот кадр: физика уже могла погасить падение о
        // врага, поэтому «прыжок сверху» разбирается по ней (см. updateEnemies).
        s.entryVy = s.commandVy;

        // «На земле» — луч вниз, а пока он не сошёлся, страхуемся скоростью:
        // луч начинает чуть ниже хитбокса и на неровном рельефе врёт.
        const ray = hero.onFloor();
        const grounded = ray || (Math.abs(v.y) < 45 && s.airTime > 0.18);
        s.airTime = grounded ? 0 : s.airTime + dt;

        const left = $.input.down('move_left');
        const right = $.input.down('move_right');
        let target = 0;
        if (left) target -= RUN_SPEED;
        if (right) target += RUN_SPEED;

        // В воздухе управление мягче: скорость подтягивается к цели.
        const vx = grounded ? target : v.x + (target - v.x) * Math.min(1, dt * AIR_CONTROL);
        let vy = v.y;

        const jump = $.input.pressed('jump');
        if (jump && grounded) {
            vy = -JUMP_SPEED;
            s.airTime = 0.001;      // сразу после прыжка земли уже нет
            play('jump', { volume: 0.7 });
            hero.emit('jump', { force: JUMP_SPEED });
        }
        if (vy > MAX_FALL) vy = MAX_FALL;
        if (vy >= 0 && grounded && Math.abs(vx) < 1) vy = 0;

        hero.velocity(vx, vy);
        hero.flip(vx < -10, false);
        // Скорость, с которой игрок входит в следующий кадр: к моменту разбора
        // столкновения физика уже погасит падение, а «прыжок сверху» надо
        // отличать по ней.
        s.commandVy = vy;
        // Состояние «на земле» уходит агенту в снимке мира.
        hero.get(0).attrs.on_ground = grounded;

        // Анимация: покой / ходьба / полёт.
        const state = !grounded ? 'air' : (Math.abs(vx) > 20 ? 'walk' : 'idle');
        if (s.anim !== state) {
            s.anim = state;
            hero.animate(s.anims[state]);
        }

        // Шаги: короткий звук с интервалом, пока персонаж бежит по земле.
        if (grounded && Math.abs(vx) > 40) {
            s.stepTimer -= dt;
            if (s.stepTimer <= 0) {
                play('step', { volume: 0.35, pan: vx > 0 ? 0.25 : -0.25 });
                s.stepTimer = 0.28;
            }
        } else {
            s.stepTimer = 0;
        }

        // Падение за пределы уровня стоит жизни.
        if (p.y > ROWS * TILE + 200) loseLife();
    }

    function updateEnemies(dt) {
        const hero = s.hero;
        if (!hero) return;
        const heroPos = hero.pos();

        // Порог контакта — по хитбоксам: тела соприкасаются, когда центры
        // ближе полусуммы размеров.
        const reach_x = (HERO_HITBOX[0] + ENEMY_HITBOX[0]) / 2 + 6;
        const reach_y = (HERO_HITBOX[1] + ENEMY_HITBOX[1]) / 2 + 8;

        for (const e of s.enemies) {
            const node = e.get(0);
            if (!node || node.removed) continue;

            const ex = e.pos().x;
            const ey = e.pos().y;

            // Разворот на границах патруля.
            if (ex < node.min_x) node.dir = 1;
            if (ex > node.max_x) node.dir = -1;
            const v = e.velocity();
            e.velocity(node.dir * ENEMY_SPEED, v.y);
            e.flip(node.dir > 0, false);

            if (Math.abs(ex - heroPos.x) > reach_x || Math.abs(ey - heroPos.y) > reach_y) continue;

            // Прыгнули сверху — враг погибает, игрок отскакивает.
            if (s.entryVy > 60 && heroPos.y < ey - 8) {
                const vx = hero.velocity().x;
                e.remove();
                hero.velocity(vx, -STOMP_BOUNCE);
                s.score += 25;
                play('enemyDie', { volume: 0.9 });
                $.camera.shake(6, 160);
                refreshHud();
            } else {
                hurtHero(ex);
            }
        }
        s.enemies = s.enemies.filter((e) => !e.get(0).removed);
    }

    function updateCoins() {
        const hero = s.hero;
        if (!hero) return;

        for (const c of s.coins) {
            const node = c.get(0);
            if (!node || node.removed) continue;

            // Монета слегка покачивается — чисто визуальный эффект.
            node.y = node.base_y + Math.sin($.time.now() * 3 + node.bob) * 3;

            if (Math.abs(node.x - hero.pos().x) < 32 &&
                Math.abs(node.y - hero.pos().y) < 40) {
                c.remove();
                s.score += 10;
                s.coinsLeft--;
                play('pickup', { volume: 0.8 });
                refreshHud();
            }
        }
        s.coins = s.coins.filter((c) => !c.get(0).removed);
    }

    function updateFinish() {
        const hero = s.hero;
        if (!hero || s.finished || !s.chest) return;
        if (s.chest.get(0).removed) return;
        if (hero.distanceTo('#chest') < 52) {
            s.finished = true;
            s.score += 100;
            play('pickup', { volume: 1 });
            $.ui.label('#hud-hint', 'Уровень пройден! Esc — в меню · R — заново');
            refreshHud();
        }
    }

    // --- Регистрация сцены -------------------------------------------------

    $.scene.add('platformer', {
        enter($) {
            if (LEVEL.length !== ROWS || LEVEL.some((r) => r.length !== COLS)) {
                throw new Error(`LEVEL должен быть ${COLS}x${ROWS}`);
            }

            // Сброс состояния: сцена может войти повторно.
            s.hero = null;
            s.enemies = [];
            s.coins = [];
            s.crates = [];
            s.chest = null;
            s.parallax = [];
            s.score = 0;
            s.lives = 3;
            s.paused = false;
            s.over = false;
            s.finished = false;
            s.hurt = 0;
            s.airTime = 0;
            s.commandVy = 0;
            s.entryVy = 0;
            s.stepTimer = 0;
            s.anim = '';
            s.spawn = { x: 80, y: 400 };

            // Действия ввода: имена 'left'/'right' в $.input.down() заняты
            // кнопками мыши (MOUSE_BUTTONS), поэтому стрелки подключаем
            // именованными действиями — иначе ←/→ не работают.
            $.input.bind('move_left', ['a', 'Left']);
            $.input.bind('move_right', ['d', 'Right']);
            $.input.bind('jump', ['space', 'w', 'Up']);

            // Платформеру нужна «земная» гравитация вниз по экрану. Цвет неба
            // совпадает с фоном картинок параллакса (#5fcde4), поэтому слои
            // не читаются прямоугольниками.
            $.world.gravity(0, GRAVITY).color('#5fcde4');

            buildLevel();
            s.hero = buildHero();

            $.camera.follow('#hero', { smooth: 0.15, offset: [0, -40], zoom: 1.5 })
                .limits(0, 0, COLS * TILE, ROWS * TILE);

            // Фон: два слоя параллакса (дальние горы и облака). Строятся после
            // камеры — раскладка слоя зависит от зума.
            parallax(BG_FAR, 256, 190, 0.15, 630);
            parallax(BG_NEAR, 320, 180, 0.35, 120);

            buildUI();
            refreshHud();
            $.sound.music(MUSIC_ACTION, { loop: true, volume: 0.45 });
        },

        exit() {
            // Документов RmlUi сцена не грузит: интерфейс — узлы <ui.*>,
            // а они уходят вместе с миром при смене сцены. Остаётся вернуть
            // гравитацию (её выключает пауза) и музыку.
            $.world.resume();
            $.sound.stopMusic(300);
        },

        update(dt, $) {
            // --- Клавиши ---------------------------------------------------
            if ($.input.pressed('escape')) {
                // Esc: первый раз — пауза, из паузы (и с экрана проигрыша) —
                // выход в меню. Так Esc и ставит паузу, и возвращает в меню.
                if (s.paused || s.over) $.scene.load('launcher');
                else setPaused(true);
                return;
            }
            if ($.input.pressed('p')) setPaused(!s.paused);
            if (s.over && $.input.pressed('r')) { $.scene.restart(); return; }

            // Камера и фон живут и на паузе — сцена не должна «залипать».
            for (const layer of s.parallax) layoutParallax(layer);

            if (s.paused || s.over) return;

            if (s.hurt > 0) s.hurt -= dt;

            updatePlayer(dt);
            updateEnemies(dt);
            updateCoins();
            updateFinish();
            refreshHud();
        },
    });

    // Поля сцены видны агенту в ответе на `state` — по ним удобно проверять.
    $.agent.expose('platformer_score', () => s.score);
    $.agent.expose('platformer_lives', () => s.lives);
    $.agent.expose('platformer_coins', () => s.coinsLeft);
    $.agent.expose('platformer_paused', () => s.paused);
    $.agent.expose('platformer_over', () => s.over);
    $.agent.expose('platformer_finished', () => s.finished);
}
