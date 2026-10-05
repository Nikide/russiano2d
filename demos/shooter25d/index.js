// ===========================================================================
// Демо: 2.5D шутер от первого лица (рейкастинг в стиле Doom).
//
// Обвязка — на высокоуровневом API `$`: сцена, ввод, камера, звук, HUD,
// интерфейс смерти, снимок состояния для агента. Низкоуровневая математика
// осталась как есть — это суть демо, а не недоделка:
//
//   * стены — DDA-обход сетки: на каждую колонку экрана считается точное
//     расстояние до стены и берётся вертикальная полоса текстуры шириной
//     в один тексель;
//   * враги — билборды: проецируются на экран с учётом расстояния и угла,
//     сортируются от дальних к ближним;
//   * оружие — лист от первого лица, ряд 4 — выстрел со вспышкой.
//
// Полосы стен и билборды уходят в GPU одним пакетом (engine.submitSprites):
// пакет — это и есть кадр, а порядок в пакете — порядок отрисовки.
// ===========================================================================

const MAP = [
    '########################',
    '#......................#',
    '#....#........#........#',
    '#....#...E....#....E...#',
    '#....##...####....##...#',
    '#.........#........#...#',
    '#....E....#........#...#',
    '#.........#........#...#',
    '#####......#....E...#..#',
    '#.........#............#',
    '#....######.......######',
    '#.........#............#',
    '#....E....#....#...E...#',
    '#.........#....#.......#',
    '#....######....#..######',
    '#......................#',
    '#....P.................#',
    '#...........E..........#',
    '#......................#',
    '##########....##########',
    '#......................#',
    '#....E.............E...#',
    '#......................#',
    '########################',
];
const MAP_W = 24;
const MAP_H = 24;

// Текстуры стен 64x64 (tools/make_wall_textures.py). Ширина в один тексель
// важна: рейкастер берёт по одной вертикальной полосе на колонку экрана,
// и от разрешения текстуры напрямую зависит детализация стены.
const WALL_TEXTURES = [
    'demos/assets/tiles/wall_brick.png',
    'demos/assets/tiles/wall_stone.png',
    'demos/assets/tiles/wall_metal.png',
];
const TEX_W = 64;                 // столько же вертикальных полос на текстуру
const WALL_KINDS = WALL_TEXTURES.length;

const WEAPON_SHEET = 'demos/assets/art/weapons/ak_first_person_anime_schoolgirl_hands_doom_sheet_8x9.png';
const ENEMY_SHEETS = [
    'demos/assets/art/characters/enemy_03_zombie_girl_8x9.png',
    'demos/assets/art/characters/enemy_06_ninja_assassin_8x9.png',
    'demos/assets/art/characters/enemy_09_sniper_girl_8x9.png',
];

const FOV = Math.PI / 3;          // 60°
const RAY_STEP = 2;               // одна колонка на 2 пикселя экрана
const MOVE_SPEED = 2.6;           // клеток в секунду
const TURN_SPEED = 2.4;           // радиан в секунду (клавишами)
const MOUSE_SENS = 0.0032;        // радиан на пиксель мыши
const PITCH_LIMIT = 0.7;          // насколько можно задрать голову
const ENEMY_SPEED = 0.9;
const ENEMY_MELEE_RANGE = 0.7;
const ENEMY_MELEE_DAMAGE = 12;
const ENEMY_MELEE_COOLDOWN = 0.9;
const MAG_SIZE = 48;

// Билборды рисуются полосами, а не одним квадом. Иначе враг за стеной
// «просвечивает» сквозь неё: в пакетной отрисовке нет z-буфера, и порядок
// задаётся только очерёдностью спрайтов. Разбив врага на вертикальные
// полосы, мы для каждой сравниваем его расстояние с расстоянием стены в
// этой колонке экрана и отбрасываем закрытые — это и есть программный
// z-тест рейкастера.
const STRIPS = 16;                // должно делить ширину клетки листа (48)
const MAX_RAY_COLUMNS = 4096;
const MAX_COMMANDS = MAX_RAY_COLUMNS + 64 * STRIPS + 16;

// Звуки — те же свободные CC0-файлы, что и в остальных демо.
const SFX = {
    shoot: 'demos/assets/audio/sfx/shoot_01.ogg',
    reload: 'demos/assets/audio/sfx/reload.ogg',
    hurt: 'demos/assets/audio/sfx/hurt_01.ogg',
    enemyHit: 'demos/assets/audio/sfx/enemy_hit.ogg',
    enemyDie: 'demos/assets/audio/sfx/enemy_die.ogg',
    click: 'demos/assets/audio/sfx/ui_click.ogg',
};

// Сцена, которая сейчас живёт в мире: агентские обёртки читают её поля.
// Сцена одна на модуль, и на уровне одновременно живёт ровно одна — поэтому
// ссылка модульная, а не «на узле».
let active = null;

// Генератор с зерном сцены: у `makeEnemy` нет доступа к `$`, поэтому ГПСЧ
// передаётся в момент создания врага.
let rng = Math.random;

export default function install($) {
    $.scene.add('shooter25d', {
        enter($) { exit(this, $); rng = () => $.random.range(0, 6.28); enter(this, $); active = this; },
        exit() { exit(this, $); if (active === this) active = null; },
        update(dt, $) { update(this, dt, $); },
        render($) { render(this, $); },
    });
}

// ---------------------------------------------------------------------------
// Вход и выход
// ---------------------------------------------------------------------------

function enter(s, $) {
    if (MAP.length !== MAP_H || MAP.some((r) => r.length !== MAP_W)) {
        throw new Error(`MAP должен быть ${MAP_W}x${MAP_H}`);
    }

    $.world.color('#101420');

    s.walls = [];
    s.enemies = [];
    s.spawn = { x: 5.5, y: 16.5, angle: -Math.PI / 2 };

    // Разбор карты: стены и точки появления врагов.
    for (let y = 0; y < MAP_H; y++) {
        s.walls[y] = [];
        for (let x = 0; x < MAP_W; x++) {
            const ch = MAP[y][x];
            s.walls[y][x] = (ch === '#' || ch === '=') ? 1 : 0;
            if (ch === 'P') s.spawn = { x: x + 0.5, y: y + 0.5, angle: -Math.PI / 2 };
            if (ch === 'E') s.enemies.push(makeEnemy(x + 0.5, y + 0.5, s.enemies.length));
        }
    }

    s.player = {
        x: s.spawn.x, y: s.spawn.y,
        angle: s.spawn.angle,
        pitch: 0,
        health: 100, ammo: MAG_SIZE, kills: 0, score: 0,
        bob: 0, hurtTimer: 0, fireAnim: 0, dead: false,
    };

    s.totalEnemies = s.enemies.length;
    s.lastShot = null;

    // Вертикальные полосы текстур стен: по спрайту на тексель.
    s.wallColumns = WALL_TEXTURES.map((path) => {
        const tex = engine.loadTexture(path);
        const columns = [];
        for (let c = 0; c < TEX_W; c++) columns.push(engine.createSprite(tex, c, 0, 1, TEX_W));
        return columns;
    });

    // Лист оружия: ряд 0 — покой, ряд 4 — выстрел со вспышкой.
    const weaponTex = engine.loadTexture(WEAPON_SHEET);
    const weaponRow = (row) => {
        const out = [];
        for (let f = 0; f < 8; f++) out.push(engine.createSprite(weaponTex, f * 48, row * 64, 48, 64));
        return out;
    };
    s.weaponIdle = weaponRow(0);
    s.weaponFire = weaponRow(4);

    // Листы врагов: покой, стрельба, смерть. Кадры сразу режем ещё и на
    // вертикальные полосы — по ним работает z-тест относительно стен.
    s.enemyStrips = ENEMY_SHEETS.map((path) => {
        const tex = engine.loadTexture(path);
        const stripW = 48 / STRIPS;
        const slice = (row) => {
            const out = [];
            for (let f = 0; f < 8; f++) {
                const strips = [];
                for (let i = 0; i < STRIPS; i++) {
                    strips.push(engine.createSprite(tex, f * 48 + i * stripW, row * 64, stripW, 64));
                }
                out.push(strips);
            }
            return out;
        };
        return { idle: slice(0), fire: slice(4), die: slice(8) };
    });

    // Глубина стены по колонкам экрана — заполняется в render().
    s.wallDepth = new Float32Array(MAX_RAY_COLUMNS);
    s.wallColumnsDrawn = 0;
    s.nodeXf = new Float32Array(MAX_COMMANDS * 6);
    s.commands = 0;
    s.crosshairTarget = false;
    s.deathShown = false;

    // Маркеры мира: они дают $.world.count() и видны агенту в снимке —
    // рисует сцену всё равно собственный рейкастер, а этим узлам отрисовка
    // выключена. Игрок — узел-<player>, враги — <enemy>.
    s.playerNode = $('<player>', { id: 'shooter-player', x: 0, y: 0 })
        .size(28, 40).visible(false).appendTo($.world);
    s.enemyNodes = s.enemies.map((e, i) => {
        const node = $('<enemy>', {
            id: 'shooter-enemy-' + i, x: 0, y: 0,
            color: '#8cff9b',
        }).size(24, 36).visible(false).appendTo($.world);
        node.data('enemy', e);
        return node;
    });

    // Ввод: имена действий — чтобы раскладку можно было переопределить
    // в одном месте, а не искать engine.scancode по сцене.
    $.input.bind('forward', ['w', 'up']);
    $.input.bind('back', ['s', 'down']);
    $.input.bind('turnLeft', ['a', 'left']);
    $.input.bind('turnRight', ['d', 'right']);
    $.input.bind('strafeLeft', ['q']);
    $.input.bind('strafeRight', ['e']);
    $.input.bind('fire', ['space', 'left']);
    $.input.bind('reload', ['r']);
    $.input.bind('menu', ['escape']);

    // HUD и экран смерти — документы RmlUi; кнопки обрабатываются по id
    // элемента, потому что $.ui.doc() даёт один слушатель на документ.
    s.hudDoc = $.ui.doc('demos/ui/shooter-hud.rml').show();
    s.deathDoc = $.ui.doc('demos/ui/shooter-death.rml');
    s.deathDoc.on('death-retry', 'click', (element) => {
        if (element === 'death-retry') {
            $.sound.play(SFX.click, { volume: 0.5 });
            $.scene.restart();
        } else if (element === 'death-menu') {
            $.sound.play(SFX.click, { volume: 0.5 });
            $.scene.load('launcher');
        }
    });

    $.sound.music('demos/assets/audio/music/action.ogg', { loop: true, volume: 0.45 });

    // Агент и тесты читают состояние сцены через $.agent.expose(): в снимке
    // появляются поля, по которым проверяются выстрел, поворот и смерть.
    $.agent.expose('shooter', () => shooterState());

    // Отладочная команда И реши для тестов: поставить врага прямо перед
    // игроком. Через неё проверяется выстрел, не бегая по карте.
    $.console.register('spawn_enemy', (args) => {
        const dist = Number(args[0] || 3);
        const p = s.player;
        const x = p.x + Math.cos(p.angle) * dist;
        const y = p.y + Math.sin(p.angle) * dist;
        const e = makeEnemy(x, y, s.enemies.length);
        e.health = 1;
        s.enemies.push(e);
        s.totalEnemies++;
        s.enemyNodes.push($('<enemy>', { id: 'shooter-enemy-' + (s.enemies.length - 1) })
            .size(24, 36).visible(false).appendTo($.world));
        return `${x.toFixed(2)} ${y.toFixed(2)}`;
    }, 'spawn_enemy <расстояние> — враг прямо перед игроком');

    // Телепорт игрока: тестам нужно предсказуемое место, а не пробежка по карте.
    $.console.register('shooter_tp', (args) => {
        const x = Number(args[0]);
        const y = Number(args[1]);
        const angle = args.length > 2 ? Number(args[2]) : s.player.angle;
        if (!walkable(s, x, y)) return 'клетка занята';
        s.player.x = x; s.player.y = y; s.player.angle = angle; s.player.pitch = 0;
        return `${x} ${y} ${angle}`;
    }, 'shooter_tp <x> <y> [угол] — телепорт игрока');

    // Здоровье напрямую: тестам нужен экран смерти без долгого боя.
    $.console.register('shooter_hp', (args) => {
        const hp = Number(args[0]);
        s.player.health = Math.max(0, hp);
        if (s.player.health === 0) killPlayer(s, $);
        return String(s.player.health);
    }, 'shooter_hp <значение> — поставить здоровье игрока');
}

function exit(s, $) {
    if (s.hudDoc) s.hudDoc.hide();
    if (s.deathDoc) s.deathDoc.hide();
    $.sound.stopMusic(300);
    s.hudDoc = null;
    s.deathDoc = null;
    s.enemies = [];
}

function shooterState() {
    const s = active;
    if (!s || !s.player) return null;
    const p = s.player;
    return {
        x: round(p.x), y: round(p.y),
        angle: round(p.angle), yaw: round(p.angle), pitch: round(p.pitch),
        health: p.health, hp: p.health, ammo: p.ammo,
        kills: p.kills, score: p.score, dead: p.dead,
        alive: !p.dead,
        total_enemies: s.totalEnemies,
        enemies_alive: s.enemies.filter((e) => e.alive).length,
        last_shot: s.lastShot,
    };
}

function round(v) { return Math.round(v * 1000) / 1000; }

function makeEnemy(x, y, i) {
    return {
        x, y,
        sheet: i % ENEMY_SHEETS.length,
        alive: true,
        dying: 0,
        health: 3,
        meleeTimer: 0,
        phase: rng(),
    };
}

// ---------------------------------------------------------------------------
// Логика
// ---------------------------------------------------------------------------

function update(s, dt, $) {
    const p = s.player;

    if ($.input.pressed('menu')) { $.scene.load('launcher'); return; }
    showDeathScreen(s, $);
    if (p.dead) return;

    // --- Обзор ---
    // Мышь задаёт и поворот, и наклон: dx — влево-вправо, dy — вверх-вниз.
    // Порядок аргументов у engine.mouseDelta — [dx, dy] за кадр.
    const md = engine.mouseDelta();
    p.angle += md[0] * MOUSE_SENS;
    p.pitch = clamp(p.pitch - md[1] * MOUSE_SENS, -PITCH_LIMIT, PITCH_LIMIT);

    // --- Поворот и движение ---
    // Поворот — клавишами A/D и стрелками влево-вправо: axis() принимает
    // имена действий из $.input.bind(), а не физические клавиши.
    const turn = $.input.axis('turnLeft', 'turnRight');
    p.angle += turn * TURN_SPEED * dt;

    // Шаг вперёд-назад и вбок — вектором: vec() собирает стрелки, а боковые
    // клавиши и пробел с ним не пересекаются, поэтому двойного учёта нет.
    const vec = $.input.vec('arrows');
    const forward = -vec.y + (input1($.input, 'forward') - input1($.input, 'back'));
    const strafe = vec.x + (input1($.input, 'strafeRight') - input1($.input, 'strafeLeft'));

    const cos = Math.cos(p.angle);
    const sin = Math.sin(p.angle);
    const speed = MOVE_SPEED * dt;
    const nx = p.x + (cos * forward - sin * strafe) * speed;
    const ny = p.y + (sin * forward + cos * strafe) * speed;
    if (walkable(s, nx, p.y)) p.x = nx;
    if (walkable(s, p.x, ny)) p.y = ny;

    // Покачивание оружия при ходьбе.
    const moving = Math.abs(forward) + Math.abs(strafe) > 0;
    p.bob += dt * (moving ? 8 : 2);
    if (p.hurtTimer > 0) p.hurtTimer -= dt;
    if (p.fireAnim > 0) p.fireAnim -= dt;

    // --- Стрельба и перезарядка ---
    if ($.input.pressed('fire') && p.ammo > 0) fire(s, $);
    if ($.input.pressed('reload')) {
        p.ammo = MAG_SIZE;
        $.sound.play(SFX.reload, { volume: 0.8 });
    }

    updateEnemies(s, dt, $);

    // Камера следует за игроком: узлы сцены живут в мировых координатах, и
    // агентские запросы (.distanceTo, $.camera.pos) должны их видеть.
    $.camera.at(p.x * 32, p.y * 32);

    // Маркеры мира держим на актуальных позициях — так снимок для агента
    // показывает, где кто стоит, хотя рисует сцену рейкастер.
    s.playerNode.at(p.x * 32, p.y * 32);
    for (let i = 0; i < s.enemyNodes.length; i++) {
        const e = s.enemies[i];
        // Маркеры всегда невидимы: рисует их не движок, а полосы рейкастера,
        // и включённый marker дал бы поверх кадра цветной прямоугольник.
        s.enemyNodes[i].hide().at(e.x * 32, e.y * 32);
    }

    updateHud(s, $);
}

/**
 * Экран смерти показывается ровно один раз — как только игрок погиб.
 * Отдельной функцией, потому что смерть может прийти не из update():
 * консольная команда, тест или скрипт тоже могут обнулить здоровье.
 */
function showDeathScreen(s, $) {
    const p = s.player;
    if (p.health > 0 && !p.dead) return;
    if (s.deathShown) return;
    s.deathShown = true;
    p.dead = true;
    p.health = 0;
    $.sound.stopMusic(400);
    s.deathDoc.text('death-score', p.score);
    s.deathDoc.text('death-kills', `${p.kills} / ${s.totalEnemies}`);
    s.deathDoc.show();
}

/** «Держится ли действие» — с учётом вчерашних привязок и мыши. */
function input1(input, action) { return input.down(action) ? 1 : 0; }

function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

function killPlayer(s, $) {
    const p = s.player;
    if (p.dead) return;
    p.dead = true;
    p.health = 0;
    $.sound.play(SFX.hurt, { volume: 1.0 });
}

function walkable(s, x, y) {
    const mx = Math.floor(x);
    const my = Math.floor(y);
    if (mx < 0 || mx >= MAP_W || my < 0 || my >= MAP_H) return false;
    return s.walls[my][mx] === 0;
}

function fire(s, $) {
    const p = s.player;

    p.ammo--;
    p.fireAnim = 0.16;
    $.camera.shake(5, 90);
    $.sound.play(SFX.shoot, { volume: 0.75 });

    // Хитскан идёт по конусу стрельбы: он повторяет то, что видно в центре
    // экрана, с учётом наклона камеры (Слой 3 — pitch).
    const wallDist = rayDistance(s, p.x, p.y, p.angle);
    let best = null;
    let bestDist = wallDist;

    for (let i = 0; i < s.enemies.length; i++) {
        const e = s.enemies[i];
        if (!e.alive) continue;
        const dx = e.x - p.x;
        const dy = e.y - p.y;
        const dist = Math.hypot(dx, dy);
        if (dist >= bestDist) continue;

        const diff = Math.atan2(dy, dx) - p.angle;
        const wrapped = Math.atan2(Math.sin(diff), Math.cos(diff));
        if (Math.abs(wrapped) > 0.12) continue;
        // Наклон: на дистанции d враг должен быть около центра экрана.
        const need = Math.atan2(-p.pitch, Math.max(dist, 0.0001));
        if (Math.abs(need) > 0.35) continue;

        best = e;
        bestDist = dist;
    }

    s.lastShot = { at: round(engine.time), dist: round(bestDist), target: best ? true : false };

    if (best) {
        best.health--;
        best.hitFlash = 0.14;
        $.sound.play(SFX.enemyHit, { volume: 0.8 });
        if (best.health <= 0) {
            best.alive = false;
            best.dying = 0.9;
            s.player.kills++;
            s.player.score += 100;
            $.sound.play(SFX.enemyDie, { volume: 0.9 });
        } else {
            s.player.score += 10;
        }
    }
}

function updateEnemies(s, dt, $) {
    const p = s.player;

    for (const e of s.enemies) {
        if (e.hitFlash > 0) e.hitFlash -= dt;

        if (!e.alive) {
            if (e.dying > 0) e.dying -= dt;
            continue;
        }

        const dx = p.x - e.x;
        const dy = p.y - e.y;
        const dist = Math.hypot(dx, dy);

        // Простое преследование, пока игрок на виду.
        if (dist < 12 && dist > 0.35 && lineOfSight(s, e.x, e.y, p.x, p.y)) {
            const step = ENEMY_SPEED * dt;
            const mx = e.x + (dx / dist) * step;
            const my = e.y + (dy / dist) * step;
            if (walkable(s, mx, e.y)) e.x = mx;
            if (walkable(s, e.x, my)) e.y = my;
        }

        // Ближний бой.
        e.meleeTimer -= dt;
        if (dist < ENEMY_MELEE_RANGE && e.meleeTimer <= 0 && !p.dead) {
            e.meleeTimer = ENEMY_MELEE_COOLDOWN;
            p.health = Math.max(0, p.health - ENEMY_MELEE_DAMAGE);
            p.hurtTimer = 0.35;
            $.sound.play(SFX.hurt, { volume: 0.9 });
            if (p.health <= 0) killPlayer(s, $);
        }
    }
}

function lineOfSight(s, x0, y0, x1, y1) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.001) return true;
    return rayDistance(s, x0, y0, Math.atan2(dy, dx)) >= dist;
}

// ---------------------------------------------------------------------------
// Рейкастинг (низкий уровень: DDA по сетке)
// ---------------------------------------------------------------------------

/** DDA-обход сетки: расстояние до стены и данные попадания. */
function castRay(s, px, py, angle) {
    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);

    let mapX = Math.floor(px);
    let mapY = Math.floor(py);

    const deltaX = dirX === 0 ? 1e30 : Math.abs(1 / dirX);
    const deltaY = dirY === 0 ? 1e30 : Math.abs(1 / dirY);

    let stepX, stepY, sideDistX, sideDistY;
    if (dirX < 0) { stepX = -1; sideDistX = (px - mapX) * deltaX; }
    else { stepX = 1; sideDistX = (mapX + 1 - px) * deltaX; }
    if (dirY < 0) { stepY = -1; sideDistY = (py - mapY) * deltaY; }
    else { stepY = 1; sideDistY = (mapY + 1 - py) * deltaY; }

    let side = 0;
    let tile = 0;

    for (let guard = 0; guard < 256; guard++) {
        if (sideDistX < sideDistY) {
            sideDistX += deltaX;
            mapX += stepX;
            side = 0;
        } else {
            sideDistY += deltaY;
            mapY += stepY;
            side = 1;
        }

        if (mapX < 0 || mapX >= MAP_W || mapY < 0 || mapY >= MAP_H) break;
        if (s.walls[mapY][mapX]) {
            // Разные типы стен — чтобы коридоры не выглядели однотонно.
            tile = (mapX * 7 + mapY * 13) % WALL_KINDS;
            break;
        }
    }

    // Перпендикулярное расстояние — избавляет от эффекта «рыбьего глаза».
    const dist = side === 0 ? sideDistX - deltaX : sideDistY - deltaY;

    // Координата текселя вдоль стены.
    let wallX = side === 0 ? py + dist * dirY : px + dist * dirX;
    wallX -= Math.floor(wallX);
    let texX = Math.floor(wallX * TEX_W);
    if ((side === 0 && dirX > 0) || (side === 1 && dirY < 0)) texX = TEX_W - texX - 1;

    return { dist: Math.max(dist, 0.0001), side, texX, tile };
}

/** Только расстояние — для проверки видимости и хитскана. */
function rayDistance(s, px, py, angle) {
    return castRay(s, px, py, angle).dist;
}

// ---------------------------------------------------------------------------
// Отрисовка
// ---------------------------------------------------------------------------

function push(s, sprite, x, y, w, h, angle, color) {
    if (s.commands >= MAX_COMMANDS) return;
    const o = s.commands * 6;
    const t = s.nodeXf;
    t[o] = sprite; t[o + 1] = x; t[o + 2] = y;
    t[o + 3] = w; t[o + 4] = h; t[o + 5] = angle;
    s.nodeColors[s.commands] = color;
    s.commands++;
}

function flush(s) {
    if (s.commands > 0) {
        // Цвета пакует C: он ждёт 0xRRGGBBAA, а engine.rgba отдаёт знаковое
        // 32-битное — маска возвращает то же число в беззнаковом виде.
        const colors = s.colorU32;
        for (let i = 0; i < s.commands; i++) colors[i] = s.nodeColors[i] >>> 0;
        engine.submitSprites(s.nodeXf.subarray(0, s.commands * 6), colors, s.commands);
    }
    s.commands = 0;
}

function render(s, $) {
    if (!s.player) return;
    const p = s.player;
    const w = engine.width;
    const h = engine.height;

    if (!s.nodeColors) {
        s.nodeColors = new Int32Array(MAX_COMMANDS);
        s.colorU32 = new Uint32Array(MAX_COMMANDS);
    }
    s.commands = 0;

    const halfH = h / 2;
    // Наклон камеры сдвигает горизонт — так же, как он сдвигал бы вертикаль
    // в настоящем 3D: y = h/2 + tan(pitch) * фокус.
    const planeScale = Math.tan(FOV / 2);
    const focal = (w / 2) / planeScale;
    const horizon = halfH + Math.tan(p.pitch) * focal;

    // Небо и пол: два прямоугольника во всю ширину.
    push(s, engine.whiteSprite, w / 2, horizon / 2, w, horizon, 0, $.gfx.rgba(32, 38, 54));
    push(s, engine.whiteSprite, w / 2, horizon + (h - horizon) / 2, w, h - horizon, 0,
         $.gfx.rgba(20, 18, 22));

    // --- Стены ---
    // Заодно запоминаем расстояние до стены в каждой колонке: по нему
    // ниже отсекаются закрытые стенами полосы врагов.
    let column = 0;
    for (let sx = 0; sx < w && column < MAX_RAY_COLUMNS; sx += RAY_STEP, column++) {
        const camera = (2 * (sx + RAY_STEP / 2) / w - 1) * planeScale;
        const angle = p.angle + Math.atan(camera);
        const hit = castRay(s, p.x, p.y, angle);

        const lineH = Math.min(h * 4, h / hit.dist);

        // Затемнение боковых стен — простейшее подобие освещения.
        const shade = hit.side === 1 ? 0.62 : 1.0;
        const c = $.gfx.rgba(255 * shade, 255 * shade, 255 * shade);

        push(s, s.wallColumns[hit.tile][hit.texX], sx + RAY_STEP / 2, horizon,
             RAY_STEP, lineH, 0, c);

        s.wallDepth[column] = hit.dist;
    }
    s.wallColumnsDrawn = column;

    // --- Враги-билборды ---
    const visible = [];
    for (const e of s.enemies) {
        if (!e.alive && e.dying <= 0) continue;
        const dx = e.x - p.x;
        const dy = e.y - p.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 0.25) continue;

        const rel = Math.atan2(dy, dx) - p.angle;
        const wrapped = Math.atan2(Math.sin(rel), Math.cos(rel));
        if (Math.abs(wrapped) > FOV * 0.85) continue;

        visible.push({ e, dist, wrapped });
    }
    visible.sort((a, b) => b.dist - a.dist);

    for (const v of visible) {
        const screenX = w / 2 + (Math.tan(v.wrapped) / planeScale) * (w / 2);
        const size = h / v.dist;
        const sheet = s.enemyStrips[v.e.sheet];

        let frames;
        let frame;
        if (!v.e.alive) {
            frames = sheet.die;
            frame = 7 - Math.min(7, Math.floor((1 - Math.max(0, v.e.dying) / 0.9) * 8));
        } else if (v.dist < 4) {
            frames = sheet.fire;   // вблизи враг «стреляет» — ряд со вспышкой
            frame = Math.floor(engine.time * 12 + v.e.phase) % 8;
        } else {
            frames = sheet.idle;
            frame = Math.floor(engine.time * 6 + v.e.phase) % 8;
        }

        const stripSprites = frames[frame];
        const shade = Math.min(1, 1.6 / (1 + v.dist * 0.25));
        let c = $.gfx.rgba(255 * shade, 255 * shade, 255 * shade);

        // Подсветка попадания: короткая белая вспышка по врагу.
        if (v.e.hitFlash > 0) c = $.gfx.rgba(255, 240, 220);

        const bh = size * 0.85;
        const bw = bh * 0.75;
        const left = screenX - bw / 2;
        const stripW = bw / STRIPS;
        // Враг стоит на полу: его «ноги» лежат на линии пола, которая для
        // проекции h/dist уходит от горизонта на половину высоты билборда.
        const baseY = horizon + bh / 2;

        // Полоса рисуется только если враг в её колонке ближе стены.
        for (let i = 0; i < STRIPS; i++) {
            const stripLeft = left + i * stripW;
            const centerCol = Math.floor((stripLeft + stripW / 2) / RAY_STEP);

            if (centerCol < 0 || centerCol >= s.wallColumnsDrawn) continue;
            if (v.dist >= s.wallDepth[centerCol]) continue;   // за стеной

            push(s, stripSprites[i], stripLeft + stripW / 2, baseY,
                 stripW + 0.5, bh, 0, c);
        }
    }

    // --- Оружие от первого лица ---
    // Ряд 4 играет 0.16 с после выстрела (p.fireAnim), потом возвращается покой.
    const firing = p.fireAnim > 0;
    const weaponFrame = firing
        ? Math.min(7, Math.floor((1 - p.fireAnim / 0.16) * 8))
        : Math.floor(engine.time * 6) % 8;
    const weaponSprite = firing ? s.weaponFire[weaponFrame] : s.weaponIdle[weaponFrame];

    const bobX = Math.sin(p.bob) * 10;
    const bobY = Math.abs(Math.cos(p.bob)) * 8;
    const weaponH = h * 1.05;
    const weaponW = weaponH * 0.75;
    const tint = p.hurtTimer > 0 ? $.gfx.rgba(255, 130, 130) : engine.WHITE;

    push(s, weaponSprite, w / 2 + bobX, h - weaponH / 2 + weaponH * 0.22 + bobY,
         weaponW, weaponH, 0, tint);

    // Красная вспышка при уроне.
    if (p.hurtTimer > 0) push(s, engine.whiteSprite, w / 2, h / 2, w, h, 0, $.gfx.rgba(190, 30, 30, 90));

    flush(s);

    // --- HUD поверх кадра: прицел и экран смерти ---
    drawCrosshair(s, $);

    if (p.dead) {
        $.gfx.draw.rect(w / 2 - 220, h / 2 - 60, 440, 120, 'rgba(10,12,18,0.82)');
        $.gfx.text('ВЫ ПОГИБЛИ', w / 2, h / 2 - 24, { size: 34, color: '#ff7a7a', align: 'center' });
        $.gfx.text('Esc — меню, кнопка «Заново» — новый заход', w / 2, h / 2 + 14,
                   { size: 18, color: '#c9d6ea', align: 'center' });
    }
}

/**
 * Прицел: линии — примитивы $.gfx.draw (рисуются поверх сцены), подпись —
 * узел <text> в координатах окна, поэтому она видна агенту в снимке
 * ($.agent.snapshot().ui) и на скриншоте.
 */
function drawCrosshair(s, $) {
    const p = s.player;
    const cx = engine.width / 2;
    const cy = engine.height / 2;
    const hot = !p.dead && s.enemies.some((e) => e.alive && crosshairHits(s, e));
    s.crosshairTarget = hot;

    const color = hot ? '#ff6d6d' : '#e8f0ff';
    $.gfx.draw.line(cx - 12, cy, cx - 4, cy, color, 2);
    $.gfx.draw.line(cx + 4, cy, cx + 12, cy, color, 2);
    $.gfx.draw.line(cx, cy - 12, cx, cy - 4, color, 2);
    $.gfx.draw.line(cx, cy + 4, cx, cy + 12, color, 2);

    if (!s.crosshairNode) {
        s.crosshairNode = $('<text>', { id: 'hud-crosshair', text: '·', size: 14 })
            .at(cx, cy - 28).size(160, 20).layer(900).appendTo($.ui);
    }
    s.crosshairNode.at(cx, cy - 28).color(color).text(hot ? '· цель ·' : '·');
}

function crosshairHits(s, e) {
    const p = s.player;
    const dx = e.x - p.x;
    const dy = e.y - p.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.0001) return false;
    const diff = Math.atan2(dy, dx) - p.angle;
    const wrapped = Math.atan2(Math.sin(diff), Math.cos(diff));
    if (Math.abs(wrapped) > 0.08) return false;
    return dist < rayDistance(s, p.x, p.y, p.angle);
}

function updateHud(s, $) {
    if (!s.hudDoc) return;
    const p = s.player;
    s.hudDoc.text('hud-health', Math.max(0, Math.round(p.health)));
    s.hudDoc.text('hud-ammo', p.ammo);
    s.hudDoc.text('hud-score', p.score);
    s.hudDoc.text('hud-kills', `${p.kills} / ${s.totalEnemies}`);
    s.hudDoc.style('hud-health', 'color',
                   p.health > 50 ? '#8ef0b0' : (p.health > 25 ? '#ffd873' : '#ff7a7a'));
}
