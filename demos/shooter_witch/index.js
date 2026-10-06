// ===========================================================================
// «Ведьма» — ночной лес, зомби-шутер в духе Vampire Survivors.
//
// Механики:
//   * игрок ходит на WASD, стреляет САМ — по ближайшему врагу в радиусе
//     оружия; игрок только уворачивается и собирает добычу;
//   * зомби лезут волнами, каждые 30 секунд волна злее; забег бесконечный,
//     счёт — по времени и убийствам;
//   * с убитых падают кристаллы опыта: собрал — уровень, игра встаёт на паузу
//     и предлагает три карты апгрейдов (1/2/3 или клик);
//   * иногда падает аптечка.
//
// Что здесь показывает движок:
//   * ночной лес: земля из <tilemap> с АВТОТАЙЛОМ тропы (движок сам
//     подбирает тайлы по соседям), деревья — отдельные спрайты с коллизиями;
//   * свет и тени: полигоны видимости (engine.light.visibility) от фонарей,
//     стволы деревьев их загораживают — видно, как тени расходятся по траве;
//   * акустику: фонари и выстрелы звучат по-разному в чаще и на поляне
//     ($.audio.obstacles + $.audio.zone), плюс реверберация поляны;
//   * VFX: кровь (брызги, лужи, куски), ленты трассеров, молнии, ударные
//     волны, hit-stop, тряска, пост-обработка кадра;
//   * камерные пресеты: базовый «ночной лес», на уроне кадр уходит в
//     «кровавую луну», клавиша F переключает пресеты вручную.
//
// Управление: WASD/стрелки — ходьба, 1/2/3 или мышь — карта апгрейда,
// F — камерный пресет, R — заново после смерти, Esc — выход в меню.
//
// 1 метр = 32 пикселя (шкала физики и акустики).
// ===========================================================================

const TILE = 32;
const COLS = 60;
const ROWS = 40;
const WORLD_W = COLS * TILE;
const WORLD_H = ROWS * TILE;

const ART = 'demos/assets/art';
const FOREST = `${ART}/forest`;
// 8 колонок = 8 направлений, 4 строки = кадры. У зомби строки 0..2 — ходьба,
// строка 3 — труп; у ведьмы строка 0 — стойка, 1..3 — шаг.
const WITCH = { src: `${ART}/characters/witch_shooter.png`, cols: 8, rows: 4, cw: 32, ch: 32 };
const ZOMBIE = { src: `${ART}/characters/zombie_walk.png`, cols: 8, rows: 4, cw: 320, ch: 360 };
const WEAPON_SHEET = { src: `${ART}/characters/witch_weapons_green.png`, cols: 4, rows: 4, cw: 480, ch: 480 };
const TILES = { src: 'demos/assets/tiles/forest_32.png', cols: 20, rows: 1 };
// Лицо для нижней панели в духе DOOM: 4 выражения × 6 состояний здоровья.
// Лист лиц как он есть: 4 кадра анимации × 6 состояний здоровья, фон уже
// прозрачный. Состояние выбирает строку, ситуация — скорость перелистывания.
// Регион берём с отступом от границ ячейки: у самого края в кадр затягивались
// пиксели соседнего кадра и обрезались плечи.
const FACES = { src: 'demos/assets/art/menu/witch_faces.png', cols: 4, rows: 6, cw: 384, ch: 384,
                pad: 10, cut: 40 };

// Маркер тропы в данных карты: террейн заменяет его на тайлы 4..19.
// Обычный bit16-автотайл раскрашивает ВСЕ непустые тайлы, поэтому траву
// трогать нельзя — берём террейн, он перерисовывает только «свои» тайлы.
const PATH_MARK = 3;
const PATH_BASE = 4;

const TREE_ART = ['tree_green', 'tree_orange', 'tree_teal',
                  'tree_small_green', 'tree_small_orange'];
const BUSH_ART = ['bush_green', 'bush_orange', 'bush_teal'];

const SFX = 'demos/assets/audio/sfx/';
const MUSIC = 'demos/assets/audio/music/zombie_plinko.mp3';

const WEAPONS = [
    { id: 'pistol', name: 'Пистолет', icon: [0, 0], sfx: SFX + 'gun_pistol.wav',
      dmg: 11, cooldown: 0.42, range: 430, spread: 0.05, pitch: 1.15, tracer: 3,
      color: '#ffd27f', arc: false, pierce: 0, shots: 1, muzzle: 11 },
    { id: 'shotgun', name: 'Дробовик', icon: [3, 0], sfx: SFX + 'gun_shotgun.wav',
      dmg: 9, cooldown: 1.05, range: 300, spread: 0.16, pitch: 0.85, tracer: 5,
      color: '#ffb066', arc: false, pierce: 1, shots: 3, muzzle: 15 },
    { id: 'tesla', name: 'Тесла', icon: [2, 0], sfx: SFX + 'gun_tesla.wav',
      dmg: 16, cooldown: 0.85, range: 340, spread: 0.02, pitch: 1.0, tracer: 4,
      color: '#9fe8ff', arc: true, pierce: 2, shots: 1, muzzle: 12 },
];

// Камерные пресеты демо: базовый и тот, в который кадр уходит на уроне.
// Камера одна: ночной лес. Перебор пресетов убран — он только путал.
const PRESET_BASE = 'forest_night';
// Свечение держим низким: пост-блум поднимает и без того светлые пятна
// фонарей, и кадр уходит в пересвет.
const PRESET_GLOW = 0.12;

// Кровь: пул эмиттеров, искры догорают дымком (суб-эмиттер on_death).
const BLOOD = {
    // one_shot + rate: 0 — эмиттер бьёт ТОЛЬКО залпом. Без этого он лил
    // частицы непрерывно (58 в секунду на каждый из восьми), и кадр стоил
    // 28 мс ещё до первого выстрела.
    amount: 30, lifetime: 560, speed: [60, 220], spread: 360, gravity: 0,
    damping: 3.0, size: [3, 7], end_size: [1, 2], max_particles: 200,
    one_shot: true, rate: 0, emitting: false,
    color: '#c1123a', end_color: '#4a0a16',
    on_death: { preset: 'dust', amount: 1, lifetime: 420, speed: [4, 18], size: [2, 5], color: '#5a1624' },
};

const UPGRADES = [
    { id: 'dmg',    icon: 'bolt',              title: 'Урон +20%',           hint: 'Каждый выстрел больнее',   apply: (s) => { s.stats.dmg *= 1.2; } },
    { id: 'rate',   icon: 'speed',             title: 'Скорость атаки +15%', hint: 'Реже ждёшь выстрела',      apply: (s) => { s.stats.rate *= 1.15; } },
    { id: 'move',   icon: 'directions_run',    title: 'Скорость бега +10%',  hint: 'Проще уйти из толпы',      apply: (s) => { s.stats.speed *= 1.1; } },
    { id: 'hp',     icon: 'favorite',          title: 'Макс. HP +25',        hint: 'И сразу лечит на 25',      apply: (s) => { s.max_hp += 25; s.hero.maxHp(s.max_hp); s.hero.heal(25); } },
    { id: 'regen',  icon: 'healing',           title: 'Регенерация +0.6/с',  hint: 'Жизнь возвращается сама',  apply: (s) => { s.stats.regen += 0.6; } },
    { id: 'magnet', icon: 'my_location',       title: 'Магнит +60',          hint: 'Опыт летит издалека',      apply: (s) => { s.stats.magnet += 60; } },
    { id: 'pierce', icon: 'trending_up',       title: 'Пробивание +1',       hint: 'Выстрел идёт сквозь врага', apply: (s) => { s.stats.pierce += 1; } },
    { id: 'shotgun', icon: 'sports_martial_arts', title: 'Дробовик',           hint: 'Новое оружие: три дроби',  apply: (s) => grantWeapon(s, 'shotgun') },
    { id: 'tesla',   icon: 'flash_on',          title: 'Тесла',              hint: 'Новое оружие: разряд',     apply: (s) => grantWeapon(s, 'tesla') },
];

/**
 * Выдать оружие по id. Живёт на уровне модуля, потому что список апгрейдов
 * тоже модульный: фабричная функция была ему не видна, и выбор «Дробовик» или
 * «Тесла» падал с ReferenceError — оружие просто не появлялось.
 */
function grantWeapon(s, id) {
    if (s.weapons.some((w) => w.def.id === id)) { s.stats.dmg *= 1.15; return; }
    s.weapons.push({ def: WEAPONS.find((w) => w.id === id), next: 0.5 });
}

let menu_state = null;

export default function installWitchShooter($) {
    let state = null;

    // Меню — отдельная сцена: так видно, что смена сцены меняет и музыку,
    // и весь мир. Переход делает менеджер сцен ($.scene).
    $.scene.add('witch_menu', {
        enter() { menu_state = createMenuScene($); },
        update(dt) { if (menu_state) tickMenuScene(menu_state, dt); },
    });

    $.scene.add('shooter_witch', {
        enter() { state = createGame($); },
        update(dt) { if (state) tickGame(state, dt); },
    });

    // Трассеры рисуются в фазе отрисовки: батч живёт только внутри неё.
    // Трассеры есть только у игровой сцены: в меню state — другой объект.
    $.render(() => { if (state && state.tracers) renderTracers(state); });

    // -----------------------------------------------------------------------
    // Создание сцены
    // -----------------------------------------------------------------------

    function createGame($) {
        const grid = buildGround();
        const trees = scatterTrees(grid);

        $.world.gravity(0, 0).color('#05070a').bounds(0, 0, WORLD_W, WORLD_H);

        // Земля: трава с вариациями и тропа, размеченная маркером. Автотайл
        // сам выбирает тайлы тропы по соседям (base 4 + маска).
        const rows = grid.map((row) => row.join(''));
        const ground = $.tilemap.fromASCII(rows, { '.': 1, ',': 2, 'p': PATH_MARK }, {
            src: TILES.src, tile: TILE, cols: TILES.cols, rows: TILES.rows, solid: false,
            terrains: {
                path: { mode: 'bit16', base: PATH_BASE, solid: [PATH_MARK], border: false },
            },
        }).at(WORLD_W / 2, WORLD_H / 2).appendTo($.world);
        // Ночь: земля нарисована сильно затемнённой, а свет фонарей
        // добавляется поверх — так и получается «видно только у фонаря».
        ground.color('#4a5570');
        ground.autotile({ mode: 'terrain', terrain: 'path' });

        // Деревья: спрайт + коллизия. Крона рисуется выше ствола, поэтому
        // узел ставим так, чтобы основание ствола было в точке роста.
        for (const tree of trees) {
            const art = TREE_ART[tree.art];
            const h = tree.big ? 123 : 99;
            const w = tree.big ? 64 : 51;
            $('<sprite>', { class: 'tree' })
                .at(tree.x, tree.y - h * 0.5)
                .size(w, h)
                .sprite(`${FOREST}/${art}.png`)
                .color('#3f4a60')
                .collision(w * 0.42, h * 0.3)
                .depth(tree.y / 1000)
                .appendTo($.world);
        }

        // Кусты — только украшение, без коллизии.
        for (const bush of trees.filter((t) => !t.big).slice(0, 60)) {
            if (Math.random() < 0.5) continue;
            const art = BUSH_ART[Math.floor(Math.random() * BUSH_ART.length)];
            $('<sprite>').at(bush.x, bush.y + 6).size(51, 43)
                .sprite(`${FOREST}/${art}.png`).color('#3f4a60')
                .depth(bush.y / 1000 - 0.001).appendTo($.world);
        }

        // Фонари вдоль тропы — единственный свет в лесу. Свет — мягкое пятно
        // <light>: кольца с падающей альфой, копейки по цене и никаких
        // артефактов при движении камеры. Полигоны видимости с тенями
        // остались в демо light — здесь они стоили 7 FPS и выглядели рвано.
        const lamps = lampSpots(grid);
        for (const lamp of lamps) {
            $('<sprite>', { class: 'lamp' }).at(lamp.x, lamp.y - 21).size(22, 42)
                .sprite(`${FOREST}/lamp.png`).color('#6b7690')
                .depth(lamp.y / 1000).appendTo($.world);
            // Свет — узел <light>: движок рисует мягкое свечение (pushGlow),
            // доп. геометрии в демо нет. Аддитивное смешивание даёт «фонарь»,
            // а не залитый круг.
            $('<light>', { radius: 235, intensity: 1, color: '#ffbe73', falloff: 2.2 })
                .at(lamp.x, lamp.y - 36).blend('add').alpha(0.34).appendTo($.world);
        }

        const spawn = { x: WORLD_W / 2, y: WORLD_H / 2 };
        const hero = $('<player>', { id: 'hero' })
            .at(spawn.x, spawn.y)
            .size(34, 38)
            .frames(WITCH)
            .frame(0)
            .health(140)
            .attr('speed', 200)
            .collision(24, 28)
            .depth(spawn.y / 1000)
            .appendTo($.world);

        // Свеча игрока: слабый узел света, который просто едет за героем.
        const candle = $('<light>', { radius: 150, intensity: 0.9, color: '#ffd9a6', falloff: 2.4 })
            .at(spawn.x, spawn.y).blend('add').alpha(0.34).appendTo($.world);

        $.audio.listener('#hero');
        // Чаща глушит звук: деревья — препятствия для звуковых лучей.
        $.audio.obstacles(trees.map((t) => ({ x: t.x, y: t.y })));
        $.audio.damping({ radius: 34, strength: 0.2, max: 0.85, cutoff_clear: 18000, cutoff_dense: 620 });
        $.audio.zone('polyana', { rect: [0, 0, WORLD_W, WORLD_H], height: 8, material: 'grass' });

        $.camera.follow('#hero', { smooth: 0.12 }).limits(0, 0, WORLD_W, WORLD_H).zoom(1.7);

        // Интерфейс: одна компактная строка сверху (здоровье, опыт, счёт,
        // оружие) плюс крупное лицо снизу слева. Лицо создаётся ПОСЛЕДНИМ:
        // UI рисуется в порядке создания, значит оно ложится поверх всего.
        $('<ui.panel>', { color: '#0a0d14cc', anchorLeft: 0, anchorRight: 0, anchorTop: 0, anchorBottom: 0,
                          offsetLeft: 0, offsetRight: 560, offsetTop: 0, offsetBottom: 48 }).appendTo($.ui);

        const hpnum = $('<ui.label>', { id: 'hpnum', size: 20, color: '#ffd27f', text: '100%',
                          anchorLeft: 0, anchorTop: 0, offsetLeft: 14, offsetTop: 8 }).appendTo($.ui);
        const hpbar = $('<ui.bar>', { id: 'hp', value: 140, max: 140, fillColor: '#c1123a',
                        anchorLeft: 0, anchorTop: 0, anchorBottom: 0,
                        offsetLeft: 78, offsetRight: 250, offsetTop: 7, offsetBottom: 23 }).appendTo($.ui);
        const xpbar = $('<ui.bar>', { id: 'xp', value: 0, max: 5, fillColor: '#5ce1e6',
                        anchorLeft: 0, anchorTop: 0, anchorBottom: 0,
                        offsetLeft: 262, offsetRight: 470, offsetTop: 7, offsetBottom: 23 }).appendTo($.ui);


        // Счёт справа: две строки, ничего не накладывается.
        const stats_lbl = $('<ui.label>', { id: 'stats', size: 16, color: '#e8f0ff', text: '', align: 'right',
                          anchorLeft: 1, anchorTop: 0, offsetLeft: -14, offsetTop: 4 }).appendTo($.ui);
        const zone_lbl = $('<ui.label>', { id: 'zone', size: 13, color: '#8fb0d8', text: '', align: 'right',
                          anchorLeft: 1, anchorTop: 0, offsetLeft: -14, offsetTop: 24 }).appendTo($.ui);
        // Лес и кадр — второй строкой слева, под полосами.
        const sound_lbl = $('<ui.label>', { id: 'sound', size: 11, color: '#9ad0b0', text: '',
                          anchorLeft: 0, anchorTop: 0, offsetLeft: 14, offsetTop: 32 }).appendTo($.ui);
        const fps_lbl = $('<ui.label>', { id: 'fps', size: 12, color: '#7f8fb0', text: '', align: 'right',
                          anchorLeft: 0, anchorTop: 0, offsetLeft: 540, offsetTop: 33 }).appendTo($.ui);

        // Лицо: 128 px, прижато к левому низу, поверх остального интерфейса.
        const face = $('<ui.image>', { id: 'face', anchorLeft: 0, anchorTop: 1, anchorBottom: 1,
                                       offsetLeft: 8, offsetRight: 136, offsetTop: -129, offsetBottom: -8 })
            .sprite(FACES.src)
            .region(FACES.pad, FACES.pad, FACES.cw - FACES.pad * 2, FACES.ch - FACES.cut)
            .appendTo($.ui);

        // Пулы: брызги крови, лужи и куски. Узлы создаются один раз.
        const blood = [];
        for (let i = 0; i < 8; i++) {
            blood.push($('<particles>', Object.assign({}, BLOOD)).at(-9999, -9999).appendTo($.world));
        }
        const decals = [];
        for (let i = 0; i < 160; i++) {
            decals.push($('<sprite>').at(-9999, -9999).size(16, 16)
                .color('#5c0a18').depth(-1000).alpha(0).appendTo($.world));
        }
        // Трассеры живут в отдельном списке и рисуются спрайтом в фазе
        // отрисовки ДО узлов сцены — поэтому луч уходит под спрайт героя.
        const tracers = [];
        const gibs = [];
        for (let i = 0; i < 64; i++) {
            gibs.push({ node: $('<sprite>').at(-9999, -9999).size(7, 7)
                .color('#8c0f22').depth(-999).alpha(0).appendTo($.world), life: 0, vx: 0, vy: 0 });
        }

        $.gfx.postPreset(PRESET_BASE);
        $.sound.music(MUSIC, { loop: true, volume: 0.22 });

        const game = {
            hero, trees, candle, blood, bloodIndex: 0, decals, decalIndex: 0, tracers, gibs, gibIndex: 0,
            run: 0, kills: 0, level: 1, xp: 0, xp_next: 5,
            paused: false, over: false, cards: null, ui_nodes: [],
            zombies: [], gems: [], medkits: [],
            spawn_acc: 0, hp_drop: 45, regen_acc: 0,
            weapons: [makeWeapon('pistol')],
            stats: { dmg: 1, rate: 1, speed: 1, regen: 0, magnet: 95, pierce: 0 },
            dir_index: 0, walk_row: 0, walk_acc: 0, flash: 0,
            preset: PRESET_BASE,
            face_node: face, face_frame: -1,
            hud: { hp: hpbar, hpnum, xp: xpbar, stats: stats_lbl, zone: zone_lbl,
                   sound: sound_lbl, fps: fps_lbl },
            hurt_t: 0, kill_t: 0, max_hp: 140, fire_t: 0, blink: 2.5, blink_t: 0,
            screen: 'game', menu_nodes: [], music_vol: 0.3, menu_sel: 0,
        };
        startRunMusic();
        // Мир готов — экран загрузки больше не нужен.
        $.loading.progress(1, 'готово');
        $.loading.hide();
        return game;
    }

    /** Сцена меню: арт, три пункта, музыка меню. */
    function createMenuScene($) {
        const win = $.window.size();
        const cx = win.w / 2;
        const cy = win.h / 2;
        $.sound.music('demos/assets/audio/music/menu_whimsy.mp3', { loop: true, volume: 0.35 });

        $('<ui.image>', { id: 'menu_art' }).at(cx, cy).size(win.w, win.h)
            .sprite('demos/assets/art/menu/witch_menu.png').alpha(0.95).appendTo($.ui);
        $('<ui.label>', { text: 'Типичная ночь в Мытищинском лесу', size: 44, color: '#b6f7c6',
                           align: 'center' }).at(cx, cy - 186).appendTo($.ui);
        $('<ui.label>', { text: 'выживание волнами · опыт · апгрейды', size: 20, color: '#cfe0ff',
                           align: 'center' }).at(cx, cy - 132).appendTo($.ui);

        const menu = { screen: 'menu', nodes: [], sel: 0, music_vol: 0.35 };
        menu.items = [
            {
                text: 'Играть',
                icon: 'play_arrow',
                act: () => {
                    // Экран загрузки: сцена строит целый лес, и это видно.
                    $.loading.show({ title: 'Типичная ночь в Мытищинском лесу',
                                     hint: 'готовим лес, тропу и фонари' });
                    $.loading.progress(0.15, 'мир');
                    $.scene.load('shooter_witch');
                },
            },
            { text: 'Настройки', icon: 'settings', act: () => menuSettings(menu) },
            { text: 'Выход', icon: 'logout', act: () => $.quit() },
        ];
        // Кнопка: иконка отдельной меткой на общей оси, текст — по центру
        // остатка. Раньше глиф клеился к тексту, и строка «ездила».
        menu.items.forEach((item, i) => {
            const y = cy - 40 + i * 64;
            const btn = $('<ui.button>', { id: `menu${i}`, text: item.text, size: 24 })
                .at(cx, y).size(340, 54).appendTo($.ui);
            btn.on('click', item.act);
            menu.nodes.push(btn);
            menu.nodes.push($('<ui.label>', { id: `menuicon${i}`, size: 26, color: '#e8f0ff',
                                             align: 'center' })
                .at(cx - 112, y).appendTo($.ui));
            if ($.ui.hasIcon(item.icon)) $.ui.setIcon(`#menuicon${i}`, item.icon);
        });
        menu.hint = $('<ui.label>', { size: 14, color: '#7d8fa8', align: 'center' })
            .at(cx, cy + 130).appendTo($.ui);
        menu.hint.nodes[0].text = '↑ / ↓ — выбор · Enter — подтвердить · мышь тоже работает';
        menu.nodes.push(menu.hint);
        menu.items.forEach((item, i) => { item.y = cy - 40 + i * 64; });
        return menu;
    }

    /** Играть: убираем меню, включаем трек забега. */
    /** Трек забега включается при входе в игровую сцену. */
    function startRunMusic() {
        $.sound.music(MUSIC, { loop: true, volume: 0.3 });
    }

    function makeWeapon(id) {
        const def = WEAPONS.find((w) => w.id === id);
        return { def, next: 0.5 };
    }

    // -----------------------------------------------------------------------
    // Лес: земля, тропа, деревья, фонари
    // -----------------------------------------------------------------------

    /** Земля: трава с вариациями и две вьющиеся тропы, помеченные 'p'. */
    function buildGround() {
        const grid = [];
        for (let r = 0; r < ROWS; r++) grid.push(new Array(COLS).fill('.'));

        // Вариант травы выбираем хешем, а не формулой по сетке: иначе на
        // земле виден регулярный узор.
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                let h = (c * 73856093) ^ (r * 19349663);
                h = (h ^ (h >>> 13)) >>> 0;
                if (h % 5 === 0) grid[r][c] = ',';
            }
        }

        const carve = (c, r) => {
            for (let y = r - 1; y <= r + 1; y++) {
                for (let x = c - 1; x <= c + 1; x++) {
                    if (x > 0 && y > 0 && x < COLS - 1 && y < ROWS - 1) grid[y][x] = 'p';
                }
            }
        };

        for (let c = 2; c < COLS - 2; c++) carve(c, 20 + Math.round(6 * Math.sin(c / 9)));
        for (let r = 3; r < ROWS - 3; r++) carve(30 + Math.round(5 * Math.sin(r / 7)), r);
        return grid;
    }

    function isPath(grid, c, r) {
        return c >= 0 && r >= 0 && c < COLS && r < ROWS && grid[r][c] === 'p';
    }

    /** Деревья: детерминированная раскладка, не на тропе и не вплотную. */
    function scatterTrees(grid) {
        let seed = 20261006;
        const rnd = () => {
            seed = (seed * 1664525 + 1013904223) >>> 0;
            return seed / 4294967296;
        };
        const trees = [];
        for (let attempt = 0; attempt < 3000 && trees.length < 320; attempt++) {
            const c = 1 + rnd() * (COLS - 2);
            const r = 1 + rnd() * (ROWS - 2);
            const x = c * TILE;
            const y = r * TILE;

            // Тропа и её обочина должны остаться проходимыми.
            let onPath = false;
            for (let dy = -1; dy <= 1 && !onPath; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (isPath(grid, Math.round(c) + dx, Math.round(r) + dy)) { onPath = true; break; }
                }
            }
            if (onPath) continue;

            let tooClose = false;
            for (const t of trees) {
                if (Math.abs(t.x - x) < 58 && Math.abs(t.y - y) < 58) { tooClose = true; break; }
            }
            if (tooClose) continue;

            trees.push({
                x, y, big: rnd() < 0.55,
                art: Math.floor(rnd() * TREE_ART.length),
            });
        }
        return trees;
    }

    /** Точки вдоль троп — под фонари: свет идёт по дороге, а не по лесу. */
    function lampSpots(grid) {
        const spots = [];
        const seen = new Set();
        const push = (c, r) => {
            if (c < 1 || r < 1 || c > COLS - 2 || r > ROWS - 2) return;
            if (!isPath(grid, c, r)) return;
            const key = `${c}:${r}`;
            if (seen.has(key)) return;
            for (const s of spots) if (Math.abs(s.c - c) < 7 && Math.abs(s.r - r) < 7) return;
            seen.add(key);
            spots.push({ c, r, x: c * TILE + TILE / 2, y: r * TILE + TILE / 2 });
        };

        for (let c = 4; c < COLS - 4; c += 9) push(c, 20 + Math.round(6 * Math.sin(c / 9)));
        for (let r = 6; r < ROWS - 6; r += 9) push(30 + Math.round(5 * Math.sin(r / 7)), r);
        return spots;
    }

    // -----------------------------------------------------------------------
    // Свет
    // -----------------------------------------------------------------------

    // -----------------------------------------------------------------------
    // Трассеры
    // -----------------------------------------------------------------------

    /**
     * Трассеры выстрелов. Рисуем растянутым спрайтом в фазе отрисовки — до
     * того, как соберётся батч узлов, поэтому луч лежит под спрайтом героя.
     */
    function renderTracers(s) {
        // $.gfx.push.sprite принимает ЭКРАННЫЕ координаты (как particles.js):
        // мировая точка переводится через камеру, иначе она применяется дважды
        // и луч улетает в угол экрана.
        const zoom = $.camera.zoom ? $.camera.zoom() : 1;
        for (const tr of s.tracers) {
            const alpha = Math.max(0, tr.life / tr.ms);
            const len = tr.len * zoom;
            const mid = $.camera.worldToScreen({
                x: tr.x + Math.cos(tr.angle) * tr.len * 0.5,
                y: tr.y + Math.sin(tr.angle) * tr.len * 0.5,
            });
            // Аддитивно: трассер светится поверх тёмного леса, а не тонет в нём.
            $.gfx.push.sprite(engine.whiteSprite, mid.x, mid.y, len, tr.width * zoom,
                              tr.angle, $.gfx.rgba(tr.r, tr.g, tr.b, Math.round(255 * alpha)),
                              'add');
        }
    }

    // -----------------------------------------------------------------------
    // Кадр
    // -----------------------------------------------------------------------

    function tickGame(s, dt) {
        const prof = $.debug.profiler;
        prof.start('демо: всего');
        tickGameBody(s, dt);
        prof.end('демо: всего');
    }

    function tickGameBody(s, dt) {
        const prof = $.debug.profiler;
        prof.start('демо: голова');
        // Esc или P — назад в меню: это отдельная сцена, переход ведёт $.scene.
        if ($.input.pressed(['escape', 'esc', 'p'])) { $.scene.load('witch_menu'); return; }

        if (!s.paused && !s.over) s.run += dt;
        s.flash = Math.max(0, s.flash - dt * 3.5);
        tickPresets(s, dt);
        tickFullscreen(s);
        prof.end('демо: голова');

        if (s.over) {
            if ($.input.pressed('r')) $.scene.restart();
            return;
        }
        if (s.paused) {
            for (let i = 0; i < 3; i++) if ($.input.pressed(String(i + 1))) chooseUpgrade(i);
            return;
        }

        // Замеры частей кадра: $.debug.profiler.report() показывает, что
        // именно в логике демо стоит дорого.
        prof.start('демо: герой');   moveHero(s, dt);     prof.end('демо: герой');
        prof.start('демо: оружие');  tickWeapons(s, dt);  prof.end('демо: оружие');
        prof.start('демо: зомби');   tickZombies(s, dt);  prof.end('демо: зомби');
        prof.start('демо: добыча');  tickPickups(s, dt);  prof.end('демо: добыча');
        prof.start('демо: кровь');   tickGore(s, dt);     prof.end('демо: кровь');
        prof.start('демо: волны');   tickSpawning(s, dt); prof.end('демо: волны');
        prof.start('демо: реген'); tickRegen(s, dt); prof.end('демо: реген');
        // Свет: свеча едет за героем, фонари мерцают — ни одного пересчёта
        // геометрии в кадре.
        prof.start('демо: свеча');
        const p = s.hero.pos();
        s.candle.at(p.x, p.y);
        prof.end('демо: свеча');
        prof.start('демо: HUD'); tickHud(s); prof.end('демо: HUD');
        prof.start('демо: камера'); applyPost(s); prof.end('демо: камера');
    }

    /** Камера одна — ночной лес; поверх неё живёт только вспышка выстрела. */
    function tickPresets(s, dt) {
        if (s.flash > 0.01) $.gfx.post({ glow: PRESET_GLOW + s.flash * 0.8 });
    }

    /** F — полный экран (движок меняет режим окна, буфер пересоздаётся). */
    function tickFullscreen(s) {
        if (!$.input.pressed('f')) return;
        const on = !$.window.fullscreen();
        $.window.fullscreen(on);
        s.window_hint = on ? 'полный экран (F — выйти)' : 'оконный режим';
        s.window_hint_t = 1.6;
    }

    /** Удар: короткая красная пелена, пресет не трогаем. */
    function damageFrame(s) {
        s.hurt_t = 0.5;
    }

    /**
     * Пост-обработка поверх камерного пресета: вигнетка по здоровью и красная
     * пелена, когда совсем плохо. Свечение вспышки добавляет tickPresets.
     */
    function applyPost(s) {
        const hurt = 1 - Math.max(0, s.hero.hp()) / Math.max(1, s.max_hp);
        $.gfx.post({
            vignette: 0.3 + hurt * 0.45,
            blood: hurt > 0.6 ? (hurt - 0.6) * 0.5 : 0,
        });
    }

    // --- Игрок ---------------------------------------------------------------

    function moveHero(s, dt) {
        const v = $.input.vec('both');   // WASD и стрелки
        const speed = s.hero.attr('speed') * s.stats.speed;
        s.hero.velocity(v.x * speed, v.y * speed);

        const target = nearestZombie(s, s.hero.pos(), 900);
        const aim = target ? angleTo(s.hero.pos(), target.node.pos())
                           : ((v.x || v.y) ? Math.atan2(v.y, v.x) : null);
        if (aim !== null) s.dir_index = dirIndex(aim);

        // Кадры листа — это стойка (строка 0) и выстрел (строки 1..3), цикла
        // ходьбы в листе нет. Поэтому: идёт — стойка, выстрелила — проигрываем
        // стрельбу в ту сторону, куда ушёл выстрел.
        s.fire_t = Math.max(0, s.fire_t - dt);
        const row = s.fire_t > 0 ? 1 + (Math.floor((0.22 - s.fire_t) * 22) % 3) : 0;
        s.hero.frame(frameIndex(WITCH, row, s.dir_index));
        s.hero.depth(s.hero.pos().y / 1000);
    }

    function tickWeapons(s, dt) {
        const hero = s.hero.pos();
        for (const w of s.weapons) {
            w.next -= dt;
            if (w.next > 0) continue;
            const target = nearestZombie(s, hero, w.def.range);
            if (!target) { w.next = 0.05; continue; }

            w.next = w.def.cooldown / s.stats.rate;
            const aim = angleTo(hero, target.node.pos());
            s.dir_index = dirIndex(aim);
            s.fire_t = 0.22;
            for (let i = 0; i < w.def.shots; i++) {
                const spread = (i - (w.def.shots - 1) / 2) * w.def.spread;
                fireRay(s, w, hero, aim + spread);
            }
        }
    }

    function fireRay(s, w, from, angle) {
        const def = w.def;
        const dir = { x: Math.cos(angle), y: Math.sin(angle) };
        // Дуло: у каждого оружия своя длина ствола. Именно оттуда летит
        // трассер, а не из центра спрайта.
        const reach = def.muzzle === undefined ? 12 : def.muzzle;
        const muzzle = { x: from.x + dir.x * reach, y: from.y + dir.y * reach };
        const end = { x: from.x + dir.x * def.range, y: from.y + dir.y * def.range };

        const hit = $.world.raycast(muzzle, end, { ignore: '#hero' });
        const stop = hit ? hit.point : end;
        const hitNode = hit && hit.self;
        const hitZombie = !!(hitNode && (hitNode.tag === 'enemy'
            || (typeof hitNode.hasClass === 'function' && hitNode.hasClass('zombie'))));
        const wallDist = hit && !hitZombie ? hit.distance : def.range;

        const rgb = hexRgb(def.color);
        // Лента поверх сцены: спрайт уходит под героя, а лента светится
        // аддитивно и видна в любом случае.
        $.fx.ribbon([muzzle, stop], { ms: def.arc ? 150 : 110, width: def.tracer,
                                      color: def.color, blend: 'add' });
        s.tracers.push({
            x: muzzle.x, y: muzzle.y, angle,
            len: Math.max(6, Math.hypot(stop.x - muzzle.x, stop.y - muzzle.y)),
            width: def.tracer, life: def.arc ? 190 : 140, ms: def.arc ? 190 : 140,
            r: rgb.r, g: rgb.g, b: rgb.b,
        });
        if (s.tracers.length > 40) s.tracers.shift();
        if (def.arc) {
            $.fx.lightning([from.x, from.y], [stop.x, stop.y],
                           { life: 130, jitter: 12, color: def.color, branches: 2 });
        }
        $.fx.pulse(muzzle.x, muzzle.y, { radius: def.id === 'shotgun' ? 38 : 26, ms: 90, color: '#ffd9a0' });

        const hits = [];
        for (const z of s.zombies) {
            if (z.dead) continue;
            const p = z.node.pos();
            const rel = { x: p.x - from.x, y: p.y - from.y };
            const along = rel.x * dir.x + rel.y * dir.y;
            if (along < 0 || along > wallDist + 8) continue;
            const perp = Math.abs(rel.x * -dir.y + rel.y * dir.x);
            if (perp > z.size * 0.5 + 10) continue;
            hits.push({ z, along });
        }
        hits.sort((a, b) => a.along - b.along);
        const limit = 1 + s.stats.pierce + (def.pierce || 0);
        for (let i = 0; i < Math.min(limit, hits.length); i++) {
            damageZombie(s, hits[i].z, def.dmg * s.stats.dmg, dir);
        }
        if (hits.length) {
            const hp = hits[0].z.node.pos();
            $.fx.shockwave(hp.x, hp.y, { radius: 34, ms: 160, color: def.color, width: 4 });
        }

        $.sound.playAt(def.sfx, [from.x, from.y], { volume: 0.5, pitch: def.pitch, max: 900 });
        s.flash = Math.min(1, s.flash + (def.arc ? 0.45 : 0.28));
        $.camera.shake(def.id === 'shotgun' ? 4.5 : 1.6, 110);
    }

    // --- Зомби ---------------------------------------------------------------

    function spawnZombie(s) {
        if (s.zombies.length >= 90) return null;
        const tier = Math.floor(s.run / 30);
        const hp = 24 + tier * 11;
        // Приходят из темноты: с края карты, подальше от игрока.
        const edge = Math.floor(Math.random() * 4);
        const m = 60;
        let x = 0, y = 0;
        if (edge === 0) { x = m + Math.random() * (WORLD_W - 2 * m); y = m; }
        else if (edge === 1) { x = WORLD_W - m; y = m + Math.random() * (WORLD_H - 2 * m); }
        else if (edge === 2) { x = m + Math.random() * (WORLD_W - 2 * m); y = WORLD_H - m; }
        else { x = m; y = m + Math.random() * (WORLD_H - 2 * m); }

        const size = 42;
        const node = $('<enemy>', { class: 'zombie' })
            .at(x, y).size(size, size + 6)
            .frames(ZOMBIE).frame(0)
            .health(hp)
            .attr('speed', 32 + tier * 4 + Math.random() * 12)
            .collision(24, 28)
            .depth(y / 1000)
            .appendTo($.world);
        const z = { node, hp, size, dead: false, hurt: 0, bite: 0, dir: 0, row: 0, walk: Math.random() * 3, fade: 0 };
        s.zombies.push(z);
        return z;
    }

    function tickZombies(s, dt) {
        const hero = s.hero.pos();
        for (let i = s.zombies.length - 1; i >= 0; i--) {
            const z = s.zombies[i];

            if (z.dead) {
                z.fade -= dt;
                z.node.alpha(Math.max(0, z.fade / 0.9));
                if (z.fade <= 0) { z.node.remove(); s.zombies.splice(i, 1); }
                continue;
            }

            const p = z.node.pos();
            const angle = angleTo(p, hero);
            z.dir = dirIndex(angle);
            const speed = z.node.attr('speed');
            z.node.velocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
            z.node.depth(p.y / 1000);
            z.walk += dt * 5;
            z.row = Math.floor(z.walk) % 3;
            z.node.frame(frameIndex(ZOMBIE, z.row, z.dir));

            if (z.hurt > 0) { z.hurt -= dt; z.node.flash('#ff5566', 70); }

            z.bite -= dt;
            if (Math.hypot(p.x - hero.x, p.y - hero.y) < 30 && z.bite <= 0) {
                z.bite = 0.9;
                s.hero.damage(7 + Math.floor(s.run / 60));
                s.hurt_t = 0.5;
                damageFrame(s);
                $.sound.playAt(SFX + 'hurt_01.ogg', p, { volume: 0.55, pitch: 1.0, max: 600 });
                $.camera.shake(5, 140);
                $.fx.shockwave(hero.x, hero.y, { radius: 60, ms: 200, color: '#ff4d6a', width: 4 });
                if (s.hero.hp() <= 0) { gameOver(s); return; }
            }
        }
    }

    function damageZombie(s, z, amount, dir) {
        if (z.dead) return;
        z.hp -= amount;
        z.hurt = 0.12;
        z.node.hp(Math.max(0, z.hp));
        const p = z.node.pos();
        sprayBlood(s, p, dir, 6);
        $.sound.playAt(SFX + 'enemy_hit.ogg', p, { volume: 0.3, pitch: 1.15, max: 700 });
        if (dir) z.node.velocity(dir.x * 150, dir.y * 150);
        if (z.hp <= 0) killZombie(s, z);
    }

    function killZombie(s, z) {
        const p = z.node.pos();
        z.dead = true;
        z.fade = 0.9;
        z.node.velocity(0, 0);
        z.node.body(null);
        z.node.frame(frameIndex(ZOMBIE, 3, z.dir));
        s.kills++;

        // Смерть: брызги в стороны, куски, лужа и ударная волна.
        sprayBlood(s, p, null, 16);
        sprayBlood(s, p, null, 10);
        for (let i = 0; i < 5; i++) throwGib(s, p);
        addDecal(s, p.x, p.y, 26 + Math.random() * 22, '#5c0a18');
        for (let i = 0; i < 3; i++) {
            addDecal(s, p.x + (Math.random() - 0.5) * 60, p.y + (Math.random() - 0.5) * 60,
                     10 + Math.random() * 16, '#4a0a16');
        }
        $.fx.shockwave(p.x, p.y, { radius: 70, ms: 260, color: '#ff6a7a', width: 5 });
        $.fx.hitStop(0.05);
        $.camera.shake(3.5, 120);
        $.sound.playAt(SFX + 'enemy_die.ogg', p, { volume: 0.5, pitch: 0.95, max: 800 });
        dropGem(s, p.x, p.y, 1 + Math.floor(s.run / 45));
    }

    function nearestZombie(s, from, range) {
        let best = null;
        let bestD = range;
        for (const z of s.zombies) {
            if (z.dead) continue;
            const p = z.node.pos();
            const d = Math.hypot(p.x - from.x, p.y - from.y);
            if (d < bestD) { bestD = d; best = z; }
        }
        return best;
    }

    // --- Кровь и куски -------------------------------------------------------

    function sprayBlood(s, p, dir, count) {
        const e = s.blood[s.bloodIndex % s.blood.length];
        s.bloodIndex++;
        e.at(p.x, p.y).burst(count);
        if (dir) {
            // Направленный фонтан: второй эмиттер бьёт вдоль выстрела.
            const e2 = s.blood[s.bloodIndex % s.blood.length];
            s.bloodIndex++;
            e2.at(p.x + dir.x * 6, p.y + dir.y * 6).burst(Math.max(2, Math.round(count / 2)));
        }
    }

    function addDecal(s, x, y, size, color) {
        const node = s.decals[s.decalIndex % s.decals.length];
        s.decalIndex++;
        node.at(x, y).size(size, size * (0.6 + Math.random() * 0.5))
            .angle(Math.random() * Math.PI).color(color).alpha(0.85);
    }

    function throwGib(s, p) {
        const gib = s.gibs[s.gibIndex % s.gibs.length];
        s.gibIndex++;
        const a = Math.random() * Math.PI * 2;
        const speed = 120 + Math.random() * 260;
        gib.vx = Math.cos(a) * speed;
        gib.vy = Math.sin(a) * speed;
        gib.life = 0.9 + Math.random() * 0.8;
        gib.node.at(p.x, p.y).size(5 + Math.random() * 5, 5 + Math.random() * 5)
            .color(Math.random() < 0.5 ? '#8c0f22' : '#b01830').alpha(0.95);
    }

    function tickGore(s, dt) {
        for (let i = s.tracers.length - 1; i >= 0; i--) {
            s.tracers[i].life -= dt * 1000;
            if (s.tracers[i].life <= 0) s.tracers.splice(i, 1);
        }

        for (const gib of s.gibs) {
            if (gib.life <= 0) continue;
            gib.life -= dt;
            const n = gib.node;
            const p = n.pos();
            gib.vy += 1400 * dt;                    // гравитация вниз, «кровь стекает»
            const nx = p.x + gib.vx * dt;
            const ny = p.y + gib.vy * dt;
            n.at(nx, ny).angle((n.angle() || 0) + dt * 6);
            gib.vx *= 1 - 3 * dt;
            if (gib.life <= 0) {
                // Упало — остаётся лужей.
                n.alpha(0).at(-9999, -9999);
                addDecal(s, nx, ny, 12 + Math.random() * 14, '#4a0a16');
            }
        }
    }

    // --- Добыча --------------------------------------------------------------

    function dropGem(s, x, y, value) {
        s.gems.push({
            node: $('<sprite>').at(x, y).size(12, 12).color('#5ce1e6').depth(-500).appendTo($.world),
            xp: value,
        });
    }

    function tickPickups(s, dt) {
        const hero = s.hero.pos();
        const radius = s.stats.magnet;

        for (let i = s.gems.length - 1; i >= 0; i--) {
            const gem = s.gems[i];
            const p = gem.node.pos();
            const dx = hero.x - p.x, dy = hero.y - p.y;
            const d = Math.hypot(dx, dy) || 1;
            if (d < radius) {
                const k = (90 + 260 * (1 - d / radius)) * dt;
                gem.node.move(dx / d * k, dy / d * k);
            }
            if (d < 16) {
                s.xp += gem.xp;
                gem.node.remove();
                s.gems.splice(i, 1);
                $.sound.play(SFX + 'pickup_01.ogg', { volume: 0.22, pitch: 1.35 });
                if (s.xp >= s.xp_next) levelUp(s);
            }
        }

        for (let i = s.medkits.length - 1; i >= 0; i--) {
            const m = s.medkits[i];
            const p = m.node.pos();
            if (Math.hypot(hero.x - p.x, hero.y - p.y) < 22 && s.hero.hp() < s.hero.maxHp()) {
                s.hero.heal(30);
                m.node.remove();
                s.medkits.splice(i, 1);
                $.sound.play(SFX + 'pickup_01.ogg', { volume: 0.5, pitch: 0.9 });
                $.fx.pulse(p.x, p.y, { radius: 40, ms: 200, color: '#ff8fa3' });
            }
        }
    }

    // --- Сложность -----------------------------------------------------------

    function tickSpawning(s, dt) {
        const tier = Math.floor(s.run / 30);
        const interval = Math.max(0.22, 1.15 - tier * 0.1);
        s.spawn_acc += dt;
        while (s.spawn_acc >= interval) {
            s.spawn_acc -= interval;
            spawnZombie(s);
            if (tier >= 3 && Math.random() < 0.35) spawnZombie(s);
        }

        s.hp_drop -= dt;
        if (s.hp_drop <= 0) {
            s.hp_drop = 42;
            const p = s.hero.pos();
            const a = Math.random() * Math.PI * 2;
            const d = 90 + Math.random() * 160;
            s.medkits.push({
                node: $('<sprite>').at(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d)
                    .size(18, 18).color('#ff5a7a').depth(-500).appendTo($.world),
            });
        }
    }

    function tickRegen(s, dt) {
        if (s.stats.regen <= 0 || s.hero.hp() >= s.max_hp) return;
        s.regen_acc += s.stats.regen * dt;
        const whole = Math.floor(s.regen_acc);
        if (whole > 0) { s.regen_acc -= whole; s.hero.heal(whole); }
    }

    function tickHud(s) {
        const p = s.hero.pos();
        const mm = Math.floor(s.run / 60);
        const ss = Math.floor(s.run % 60);
        const near = $.audio.densityAt ? $.audio.densityAt(p.x, p.y, 150) : 0;
        const damp = $.audio.damping ? $.audio.damping() : { strength: 0.2, max: 0.85 };
        const muffled = Math.min(damp.max, near * damp.strength);

        // Лицо в духе DOOM — анимированное: строка задаёт состояние здоровья,
        // а кадры внутри строки листаются со своей скоростью для каждой
        // ситуации (спокойствие — медленно, удар — быстро, смерть — тягуче).
        s.hurt_t = Math.max(0, s.hurt_t - 0.016);
        s.kill_t = Math.max(0, s.kill_t - 0.016);
        const hp_ratio = Math.max(0, s.hero.hp()) / Math.max(1, s.max_hp);
        const row = hp_ratio > 0.85 ? 0 : hp_ratio > 0.65 ? 1 : hp_ratio > 0.45 ? 2
                  : hp_ratio > 0.25 ? 3 : hp_ratio > 0.02 ? 4 : 5;

        let face_fps = 2.2;                 // спокойствие: редкое мигание
        if (s.hurt_t > 0) face_fps = 12;    // получила удар: лицо дёргается
        else if (s.kill_t > 0) face_fps = 7; // убила: довольно щурится
        else if (row >= 4) face_fps = 1.6;  // при смерти: медленно
        else if (row === 0) face_fps = 1.1; // цела: почти статична
        const col = Math.floor(engine.time * face_fps) % FACES.cols;
        const frame = row * FACES.cols + col;
        if (frame !== s.face_frame) {
            s.face_frame = frame;
            s.face_node.region(col * FACES.cw + FACES.pad, row * FACES.ch + FACES.pad,
                               FACES.cw - FACES.pad * 2, FACES.ch - FACES.cut);
        }

        const hud = s.hud;
        hud.hp.nodes[0].value = Math.max(0, s.hero.hp());
        hud.hp.nodes[0].max_value = s.max_hp;
        hud.hpnum.nodes[0].text = `${Math.max(0, Math.round(hp_ratio * 100))}%`;
        hud.xp.nodes[0].value = Math.min(s.xp, s.xp_next);
        hud.xp.nodes[0].max_value = s.xp_next;
        hud.stats.nodes[0].text = `${mm}:${String(ss).padStart(2, '0')}   ур. ${s.level}   убито ${s.kills}`;
        hud.zone.nodes[0].text = `врагов ${s.zombies.length} · камера ${s.preset}`;
        hud.sound.nodes[0].text = `деревьев рядом ${near} · глухо ${(muffled * 100).toFixed(0)}%`;
        // Счётчик кадра: сколько стоит сцена (свет считается каждый кадр).
        // Сводку по кадру считаем не каждый кадр: $.debug.stats() обходит все
        // узлы, а в HUD это видно и по 4 обновлениям в секунду.
        // Частота кадра: считаем не каждый кадр, $.debug.stats() обходит узлы.
        hud.perf_acc = (hud.perf_acc || 0) + 1;
        if (hud.perf_acc >= 12) {
            hud.perf_acc = 0;
            const perf = $.debug.stats();
            hud.fps.nodes[0].text = `${perf.fps.toFixed(0)} FPS · ${perf.frame_ms.toFixed(1)} мс`;
        }

    }

    // --- Уровни и апгрейды ---------------------------------------------------

    function levelUp(s) {
        s.level++;
        s.xp -= s.xp_next;
        s.xp_next = Math.round(s.xp_next * 1.45 + 3);
        showCards(s);
    }

    function showCards(s) {
        s.paused = true;
        $.world.freeze();
        $.time.pause();

        // На первом уровне всегда показываем оба новых оружия: иначе дробовик
        // с теслой можно так и не увидеть за весь забег (случайные 3 из 9).
        let picked;
        if (s.weapons.length === 1) {
            const shotgun = UPGRADES.find((u) => u.id === 'shotgun');
            const tesla = UPGRADES.find((u) => u.id === 'tesla');
            const stat = UPGRADES.filter((u) => u.id !== 'shotgun' && u.id !== 'tesla')
                                 .sort(() => Math.random() - 0.5)[0];
            picked = [shotgun, tesla, stat];
        } else {
            picked = UPGRADES.slice().sort(() => Math.random() - 0.5).slice(0, 3);
        }
        s.cards = picked;

        // Всё считаем от центра окна: с абсолютными пикселями экран уезжал
        // при любом размере окна, кроме 1280×720.
        const win = $.window.size();
        const cx = win.w / 2;
        const cy = win.h / 2;
        const card_w = Math.min(250, Math.floor(win.w / 3.6));
        const step = card_w + 30;

        s.ui_nodes.push($('<ui.panel>', { color: '#0b0f16ee' })
            .at(cx, cy).size(Math.min(win.w - 40, card_w * 3 + 90), 320).appendTo($.ui));
        s.ui_nodes.push($('<ui.label>', { text: `Уровень ${s.level} — выбери улучшение`, size: 26, color: '#e8f0ff' })
            .at(cx, cy - 118).appendTo($.ui));

        picked.forEach((u, i) => {
            const x = cx + (i - 1) * step;
            const card = $('<ui.panel>', { id: `card${i}`, color: '#1b2436', hoverColor: '#2b3a55' })
                .at(x, cy + 10).size(card_w, 190).appendTo($.ui);
            s.card_rects = s.card_rects || [];
            s.card_rects[i] = { x, y: cy + 10, w: card_w, h: 190 };
            card.on('click', () => chooseUpgrade(i));
            s.ui_nodes.push(card);

            // Иконка из встроенного набора Material, заголовок и подсказка —
            // всё по центру карточки, поэтому ничего не «едет».
            const glyph = $.ui.hasIcon(u.icon) ? $.ui.icon(u.icon) : '';
            s.ui_nodes.push($('<ui.label>', { text: glyph, size: 40, color: '#8fd8ff', align: 'center' })
                .at(x, cy - 48).appendTo($.ui));
            s.ui_nodes.push($('<ui.label>', { text: `${i + 1}. ${u.title}`, size: 19, color: '#ffd27f',
                                             align: 'center' })
                .at(x, cy - 4).appendTo($.ui));
            s.ui_nodes.push($('<ui.label>', { text: u.hint, size: 14, color: '#9fb3d0', align: 'center' })
                .at(x, cy + 36).appendTo($.ui));
        });
        s.ui_nodes.push($('<ui.label>', { text: '1 / 2 / 3 или клик мышью', size: 15, color: '#7d8fa8' })
            .at(cx, cy + 128).appendTo($.ui));
    }

    function chooseUpgrade(index) {
        const s = state;
        if (!s || !s.paused || !s.cards || !s.cards[index]) return;
        s.cards[index].apply(s);
        for (const node of s.ui_nodes) node.remove();
        s.ui_nodes = [];
        s.cards = null;
        s.paused = false;
        $.time.resume();
        $.world.thaw();
        $.sound.play(SFX + 'ui_click.ogg', { volume: 0.6, pitch: 1.1 });
        const p = s.hero.pos();
        $.fx.pulse(p.x, p.y, { radius: 90, ms: 320, color: '#8fd8ff' });
    }

    function gameOver(s) {
        s.over = true;
        $.world.freeze();
        s.hero.kill();
        $.gfx.postPreset('horror', { ms: 700 });
        $.sound.playAt(SFX + 'explosion_01.ogg', s.hero.pos(), { volume: 0.8, pitch: 0.75, max: 1200 });
        $.camera.shake(12, 500);

        const win = $.window.size();
        const cx = win.w / 2;
        const cy = win.h / 2;
        s.ui_nodes.push($('<ui.panel>', { color: '#140a10dd' }).at(cx, cy).size(Math.min(win.w - 60, 760), 280).appendTo($.ui));
        s.ui_nodes.push($('<ui.label>', { text: 'Ты не выжила', size: 34, color: '#ff8fa3' }).at(cx, cy - 80).appendTo($.ui));
        const mm = Math.floor(s.run / 60);
        const ss = Math.floor(s.run % 60);
        s.ui_nodes.push($('<ui.label>', {
            text: `Продержалась ${mm}:${String(ss).padStart(2, '0')} · уровень ${s.level} · убито ${s.kills}`,
            size: 20, color: '#e8f0ff',
        }).at(cx, cy - 15).appendTo($.ui));
        s.ui_nodes.push($('<ui.label>', { text: 'R — заново, Esc — в меню', size: 18, color: '#9fb3d0' })
            .at(cx, cy + 35).appendTo($.ui));
    }

    // -----------------------------------------------------------------------
    // Отладка
    // -----------------------------------------------------------------------

    // Доступ к забегу из консоли и тестов: не нужно ждать естественного
    // уровня, чтобы посмотреть экран апгрейдов.
    globalThis.witch = {
        state: () => state,
        play: () => { $.scene.load('shooter_witch'); },
        scene: () => (state && state.items ? 'witch_menu' : 'shooter_witch'),
        levelUp: () => { if (state && !state.over) levelUp(state); },
        spawn: (n) => { for (let i = 0; i < (n || 1); i++) spawnZombie(state); },
        kill: () => {
            const z = state && state.zombies.find((item) => !item.dead);
            if (z) killZombie(state, z);
        },
    };

    // -----------------------------------------------------------------------
    // Меню: Играть / Настройки / Выход
    // -----------------------------------------------------------------------

    /** Курсор: где бы ни лежал метод — в $.input, $.mouse или в движке. */
    function setCursor(shape) {
        if ($.input && typeof $.input.cursor === 'function') return $.input.cursor(shape);
        if ($.mouse && typeof $.mouse.cursor === 'function') return $.mouse.cursor(shape);
        if (typeof engine.setCursor === 'function') return engine.setCursor(shape);
        return 'arrow';
    }

    /**
     * Сцена меню: арт из присланной картинки фоном и три пункта. Здесь играет
     * menu.ogg, а в бою — трек забега: смена сцены слышна сразу.
     */
    function menuSettings(menu, $) {
        menu.screen = 'settings';
        for (const n of menu.nodes) n.alpha(0.15);
        const win = $.window.size();
        const cx = win.w / 2;
        const cy = win.h / 2;
        const panel = $('<ui.panel>', { color: '#080b12ee' }).at(cx, cy).size(520, 300).appendTo($.ui);
        for (const n of menu.nodes) n.alpha(0.15);
        const title = $('<ui.label>', { text: 'Настройки', size: 34, color: '#e8f0ff', align: 'center' })
            .at(cx, cy - 100).appendTo($.ui);
        const music = $('<ui.label>', { size: 18, color: '#cfe0ff', align: 'center' }).at(cx, cy - 40).appendTo($.ui);
        const fs = $('<ui.label>', { size: 18, color: '#cfe0ff', align: 'center' }).at(cx, cy + 4).appendTo($.ui);
        const hint = $('<ui.label>', { text: '← / → — громкость · F — полный экран · Esc — назад', size: 13,
                                       color: '#63758d', align: 'center' }).at(cx, cy + 56).appendTo($.ui);
        const back = $('<ui.button>', { text: 'Назад', size: 20 }).at(cx, cy + 108).size(200, 46).appendTo($.ui);
        back.on('click', () => menuBack(menu));
        menu.settings_nodes = [panel, title, music, fs, hint, back];
        menu.set_music = music;
        menu.set_fs = fs;
    }

    function menuBack(menu) {
        for (const n of menu.settings_nodes || []) n.remove();
        menu.settings_nodes = [];
        menu.screen = 'menu';
        for (const n of menu.nodes) n.alpha(1);
    }

    function menuSettings_refresh(menu) {
        if (!menu.set_music) return;
        menu.set_music.nodes[0].text = `Музыка: ${Math.round(menu.music_vol * 100)}%`;
        menu.set_fs.nodes[0].text = `Полный экран (F): ${$.window.fullscreen() ? 'вкл' : 'выкл'}`;
    }

    /** Кадр сцены меню: стрелки вверх/вниз, Enter, настройки. */
    function tickMenuScene(menu, dt) {
        const setCursor = (shape) => {
            if ($.input && typeof $.input.cursor === 'function') $.input.cursor(shape);
            else if (typeof engine.setCursor === 'function') engine.setCursor(shape);
        };
        setCursor('hand');

        if ($.input.pressed('f')) $.window.fullscreen(!$.window.fullscreen());

        if (menu.screen === 'settings') {
            if ($.input.pressed('left') && menu.music_vol > 0.05) {
                menu.music_vol = Math.max(0, menu.music_vol - 0.1);
                $.sound.musicVolume(menu.music_vol);
            }
            if ($.input.pressed('right') && menu.music_vol < 1) {
                menu.music_vol = Math.min(1, menu.music_vol + 0.1);
                $.sound.musicVolume(menu.music_vol);
            }
            if ($.input.pressed(['escape', 'esc'])) menuBack(menu);
            menuSettings_refresh(menu);
            return;
        }

        // Навигация стрелками: подсвечиваем выбранный пункт шириной панели.
        if ($.input.pressed('up')) menu.sel = (menu.sel + menu.items.length - 1) % menu.items.length;
        if ($.input.pressed('down')) menu.sel = (menu.sel + 1) % menu.items.length;
        menu.nodes.forEach((node, i) => node.alpha(i === menu.sel ? 1 : 0.6));

        // Enter в разных раскладках зовётся по-разному — принимаем все имена.
        if ($.input.pressed(['enter', 'return', 'space'])) menu.items[menu.sel].act();
        else if ($.input.pressed(['escape', 'esc'])) $.quit();
    }

    // -----------------------------------------------------------------------
    // Мелочи
    // -----------------------------------------------------------------------

    /** Колонка листа по углу: 0 — вниз, 2 — вправо, 4 — вверх, 6 — влево. */
    function dirIndex(angle) {
        const deg = angle * 180 / Math.PI;
        // Колонки листа: 0 — вверх, 2 — вправо, 4 — вниз, 6 — влево (сверено
        // с увеличенной строкой листа). Формула была зеркальной — героиня
        // смотрела в противоположную от выстрела сторону.
        let i = Math.round((deg + 90) / 45) % 8;
        if (i < 0) i += 8;
        return i;
    }

    function frameIndex(sheet, row, dir) {
        return (row % sheet.rows) * sheet.cols + (dir % sheet.cols);
    }

    function angleTo(a, b) {
        return Math.atan2(b.y - a.y, b.x - a.x);
    }

    /** '#rrggbb' → компоненты 0..255 для упакованного цвета спрайта. */
    function hexRgb(hex) {
        const v = parseInt(String(hex).replace('#', ''), 16);
        return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
    }
}
