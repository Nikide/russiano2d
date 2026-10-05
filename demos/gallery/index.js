// ===========================================================================
// Галерея анимаций.
//
// Показывает все анимационные листы персонажей из
// demos/assets/art/manifest.json: слева — прокручиваемая сетка живых
// миниатюр, в центре — крупный выбранный лист, справа — панель управления.
//
// Лист — это сетка 8x9, клетка 48x64. Строки — состояния:
//   ряд 0 — покой, ряд 1 — прицел, ряд 4 — выстрел со вспышкой, ряд 8 — смерть.
//
// Всё на высокоуровневом API $: камера прижата к центру окна, поэтому мировые
// координаты совпадают с экранными, а интерфейс собран из узлов <ui.*>.
// ===========================================================================

const MANIFEST = 'demos/assets/art/manifest.json';
const CHARS_DIR = 'demos/assets/art/characters';
const SHEET_BASE = 'demos/assets/art/';

// Сетка листа по умолчанию — если в манифесте не оказалось записи.
const SHEET_COLS = 8;
const SHEET_ROWS = 9;
const CELL_W = 48;
const CELL_H = 64;
const BASE_FPS = 12;             // кадров в секунду при скорости x1

// Состояния, доступные по клавишам 1..4.
const STATES = [
    { row: 0, label: '1 Покой' },
    { row: 1, label: '2 Прицел' },
    { row: 4, label: '3 Выстрел' },
    { row: 8, label: '4 Смерть' },
];

const SPEEDS = [0.25, 0.5, 1.0, 1.5, 2.0];

// Русские подписи к листам; ключ — имя файла без расширения (manifest.name).
const LABELS = {
    ak12_anime_girl_hands_sprite_sheet: 'AK-12 · руки аниме-девушки',
    anime_girl_ak_doom_sprite_sheet_8x9: 'Аниме-девушка с АК (Doom)',
    catgirl_green_ak_sprite_sheet: 'Кошкодевочка · зелёная, АК',
    catgirl_lilac_pistol_sprite_sheet: 'Кошкодевочка · сиреневая, пистолет',
    catgirl_small_minigun_sprite_sheet: 'Кошкодевочка · миниган',
    catgirl_white_scout_shotgun_sprite_sheet: 'Кошкодевочка · белая, дробовик',
    enemy_01_armored_soldier_8x9: 'Враг 01 · бронированный солдат',
    enemy_02_catgirl_scout_8x9: 'Враг 02 · кошкодевочка-разведчик',
    enemy_03_zombie_girl_8x9: 'Враг 03 · зомби-девушка',
    enemy_04_heavy_machinegunner_8x9: 'Враг 04 · пулемётчица',
    enemy_05_fire_demoness_8x9: 'Враг 05 · огненная демоница',
    enemy_06_ninja_assassin_8x9: 'Враг 06 · ниндзя-ассасин',
    enemy_07_combat_medic_8x9: 'Враг 07 · боевой медик',
    enemy_08_shield_lancer_8x9: 'Враг 08 · копейщица со щитом',
    enemy_09_sniper_girl_8x9: 'Враг 09 · снайпер',
    enemy_10_cyber_mage_8x9: 'Враг 10 · кибер-маг',
    green_hair_red_glasses_doom_hud_portrait_sheet: 'Портрет HUD · рыжие очки',
    mio_kuro_saki_neon_homeroom_sprite_sheet: 'Мио Куросаки · неоновая комната',
};

// Раскладка: сетка миниатюр слева, панель управления справа.
const GRID_X = 16;
const GRID_Y = 84;
const GRID_COLS = 2;
const GRID_CELL_W = 170;
const GRID_CELL_H = 160;
const GRID_STRIDE_X = 176;
const GRID_STRIDE_Y = 166;
const THUMB_SCALE = 2.0;         // 48x64 → 96x128 у миниатюры
const SIDE_W = 330;              // ширина панели управления

const CLICK = 'demos/assets/audio/sfx/ui_click.ogg';
const MUSIC_MENU = 'demos/assets/audio/music/menu.ogg';

export default function install($) {
    const s = {
        list: [],            // [{ name, label, path, cols, rows, cw, ch }]
        cards: [],           // [{ bg, thumb }]
        preview: null,
        preview_bg: null,
        preview_scale: 1,
        grid_bg: null,
        index: 0,
        row: 0,
        speed: 1,
        paused: false,
        phase: 0,            // позиция в цикле анимации, в кадрах
        scrollRow: 0,
        rowsVisible: 3,
        maxRow: 0,
        ui: {},
    };

    // --- Помощники ---------------------------------------------------------

    /**
     * Текст интерфейса. Размер шрифта ставится полю узла напрямую: атрибут
     * size уходит в attrs, а рисуется node.size.
     */
    function text(id, x, y, value, size, color, align) {
        const node = $('<ui.label>', { id, text: value, color: color || '#e8f0ff' })
            .at(x, y).get(0);
        node.size = size || 18;
        node.attrs.align = align || 'left';
        return $(node);
    }

    function button(id, x, y, w, h, caption, onClick) {
        const b = $('<ui.button>', { id, text: caption, x, y, w, h }).appendTo($.ui);
        b.on('click', () => { play(CLICK); onClick(); });
        return b;
    }

    function play(path) { $.sound.play(path, { volume: 0.7 }); }

    /** Подсветка кнопки: активная светлее, неактивная темнее. */
    function mark(wrapper, on) {
        if (wrapper) wrapper.color(on ? '#4b3a72' : '#1b2436');
    }

    /**
     * Список листов: источник — манифест (имена, сетки, размеры), запасной
     * вариант — каталог с файлами, нарезанными сеткой 8x9.
     */
    function readSheets() {
        const out = [];
        const manifest = $.fs.readJSON(MANIFEST, null);
        if (manifest && Array.isArray(manifest.characters)) {
            for (const c of manifest.characters) {
                if (!c.file) continue;
                const grid = c.grid || {};
                const cols = grid.cols || SHEET_COLS;
                const rows = grid.rows || SHEET_ROWS;
                out.push({
                    name: c.name || c.file,
                    label: labelOf(c.name || c.file),
                    path: SHEET_BASE + c.file,
                    cols, rows,
                    cw: grid.cell_w || Math.round((c.width || 384) / cols),
                    ch: grid.cell_h || Math.round((c.height || 576) / rows),
                });
            }
        }
        if (!out.length) {
            for (const file of ($.fs.list(CHARS_DIR) || [])) {
                if (file.slice(-4).toLowerCase() !== '.png') continue;
                const name = file.split('/').pop().replace(/\.png$/, '');
                out.push({ name, label: labelOf(name),
                           path: SHEET_BASE + 'characters/' + name + '.png',
                           cols: SHEET_COLS, rows: SHEET_ROWS, cw: CELL_W, ch: CELL_H });
            }
        }
        return out;
    }

    function labelOf(name) {
        const key = String(name).replace(/\.png$/, '');
        return LABELS[key] || key.replace(/_/g, ' ');
    }

    const sheetSpec = (e) => ({ src: e.path, cols: e.cols, rows: e.rows, cw: e.cw, ch: e.ch });

    // --- Построение сцены ---------------------------------------------------

    function buildGrid(size) {
        s.grid_bg = $('<rect>', { color: '#121622ee' })
            .at(GRID_X + (GRID_COLS * GRID_STRIDE_X) / 2, GRID_Y + (size.h - GRID_Y - 16) / 2)
            .size(GRID_COLS * GRID_STRIDE_X + 12, size.h - GRID_Y - 16)
            .layer(-10).appendTo($.world);

        s.cards = s.list.map((entry) => {
            const bg = $('<rect>', { class: 'card', color: '#1a1e2cff' })
                .size(GRID_CELL_W, GRID_CELL_H).layer(0).appendTo($.world);
            const thumb = $('<sprite>', { class: 'thumb' })
                .frames(sheetSpec(entry))
                .size(entry.cw * THUMB_SCALE, entry.ch * THUMB_SCALE)
                .layer(1).appendTo($.world);
            return { bg, thumb };
        });
    }

    function buildPreview(size) {
        const left = GRID_X + GRID_COLS * GRID_STRIDE_X + 24;
        const right = Math.max(left + 64, size.w - SIDE_W);
        const cx = (left + right) / 2;
        const cy = size.h / 2 - 20;

        const entry = s.list[s.index];
        const cw = entry ? entry.cw : CELL_W;
        const ch = entry ? entry.ch : CELL_H;

        // Крупный кадр: вписываем клетку листа в отведённую область.
        let scale = Math.min((right - left) / cw, (size.h - 140) / ch);
        s.preview_scale = Math.max(1, Math.min(scale, 7));

        const dw = cw * s.preview_scale;
        const dh = ch * s.preview_scale;

        s.preview_bg = $('<rect>', { color: '#10131ef0' })
            .at(cx, cy).size(dw + 28, dh + 28).layer(0).appendTo($.world);
        s.preview = $('<sprite>', { id: 'preview' })
            .frames(sheetSpec(entry)).at(cx, cy).size(dw, dh).layer(1).appendTo($.world);
    }

    function buildPanel(size) {
        const x = size.w - SIDE_W + 20;
        const u = s.ui;

        text('g-title', x, 16, 'ГАЛЕРЕЯ', 28, '#c9a6ff');
        u.name = text('g-name', x, 58, 'нет листов', 17);
        u.counter = text('g-counter', x, 82, '0 / 0', 15, '#8fa3bf');

        u.prev = button('g-prev', x + 70, 124, 140, 40, 'Пред', () => step(-1));
        u.next = button('g-next', x + 220, 124, 140, 40, 'След', () => step(+1));

        text('g-cap-state', x, 156, 'Состояние (клавиши 1-4)', 15, '#8fa3bf');
        u.states = STATES.map((st, i) => button(
            'g-state-' + i, x + 70 + (i % 2) * 150, 188 + Math.floor(i / 2) * 42,
            140, 36, st.label, () => setRow(st.row)));

        text('g-cap-row', x, 266, 'Ряд листа', 15, '#8fa3bf');
        u.row_prev = button('g-row-prev', x + 40, 298, 60, 32, '−', () => setRow(s.row - 1));
        u.row_next = button('g-row-next', x + 250, 298, 60, 32, '+', () => setRow(s.row + 1));
        u.row = text('g-row', x + 148, 292, 'ряд 0', 16, '#e8f0ff', 'center');

        text('g-cap-speed', x, 324, 'Скорость', 15, '#8fa3bf');
        u.speeds = SPEEDS.map((sp, i) => button(
            'g-spd-' + i, x + 32 + i * 62, 356, 58, 32, 'x' + sp, () => setSpeed(sp)));
        u.speed = text('g-speed', x, 382, 'x1.00 · 12 кадр/с', 15, '#8fa3bf');

        u.pause = button('g-pause', x + 70, 428, 140, 40, 'Пауза', togglePause);
        u.step = button('g-step', x + 220, 428, 140, 40, 'Шаг', () => stepFrame());

        text('g-hint1', x, 484, 'A/D или ←/→ — лист · 1-4 — состояние', 14, '#63758d');
        text('g-hint2', x, 506, 'Space — пауза · N — шаг на кадр', 14, '#63758d');
        text('g-hint3', x, 528, 'W/S или колесо — прокрутка сетки', 14, '#63758d');
        text('g-hint4', x, 550, 'Esc — в меню', 14, '#63758d');
    }

    // --- Состояние ----------------------------------------------------------

    function setRow(row) {
        s.row = Math.max(0, Math.min(SHEET_ROWS - 1, row));
        refresh();
    }

    function setSpeed(value) {
        s.speed = value;
        refresh();
    }

    function togglePause() {
        s.paused = !s.paused;
        refresh();
    }

    /** Шаг на один кадр вперёд — работает и на паузе. */
    function stepFrame() {
        s.phase = Math.floor(s.phase) + 1;
        refresh();
    }

    function step(delta) {
        const n = s.list.length;
        if (!n) return;
        s.index = (s.index + delta + n) % n;
        ensureVisible();
        rebuildPreview();
        refresh();
    }

    /** Держит строку выбранного листа в видимой части сетки. */
    function ensureVisible() {
        const row = Math.floor(s.index / GRID_COLS);
        if (row < s.scrollRow) s.scrollRow = row;
        else if (row >= s.scrollRow + s.rowsVisible) s.scrollRow = row - s.rowsVisible + 1;
        s.scrollRow = Math.max(0, Math.min(s.scrollRow, s.maxRow));
    }

    /** Выбран другой лист — у крупного спрайта меняется набор кадров. */
    function rebuildPreview() {
        const entry = s.list[s.index];
        if (!entry || !s.preview) return;
        s.preview.frames(sheetSpec(entry));
        s.preview_bg.size(entry.cw * s.preview_scale + 28, entry.ch * s.preview_scale + 28);
    }

    function refresh() {
        const entry = s.list[s.index];
        const u = s.ui;
        if (u.name) u.name.text(entry ? entry.label : 'нет листов');
        if (u.counter) u.counter.text((s.list.length ? s.index + 1 : 0) + ' / ' + s.list.length);
        if (u.row) u.row.text('ряд ' + s.row);
        if (u.speed) u.speed.text('x' + s.speed.toFixed(2) + ' · '
                                  + Math.round(BASE_FPS * s.speed) + ' кадр/с');
        if (u.pause) u.pause.text(s.paused ? 'Пуск' : 'Пауза');

        STATES.forEach((st, i) => mark(u.states[i], s.row === st.row));
        SPEEDS.forEach((sp, i) => mark(u.speeds[i], Math.abs(s.speed - sp) < 1e-6));
        mark(u.pause, s.paused);

        s.cards.forEach((card, i) => mark(card.bg, i === s.index));
    }

    // --- Кадр ---------------------------------------------------------------

    /** Раскладка сетки: миниатюры видимыми строками, выделение — рамкой. */
    function layoutGrid(size) {
        const totalRows = Math.max(1, Math.ceil(s.list.length / GRID_COLS));
        s.rowsVisible = Math.max(1, Math.floor((size.h - GRID_Y - 16) / GRID_STRIDE_Y));
        s.maxRow = Math.max(0, totalRows - s.rowsVisible);
        s.scrollRow = Math.max(0, Math.min(s.scrollRow, s.maxRow));

        for (let i = 0; i < s.cards.length; i++) {
            const col = i % GRID_COLS;
            const row = Math.floor(i / GRID_COLS);
            const visible = row >= s.scrollRow && row < s.scrollRow + s.rowsVisible;
            const x = GRID_X + col * GRID_STRIDE_X + GRID_CELL_W / 2;
            const y = GRID_Y + (row - s.scrollRow) * GRID_STRIDE_Y + GRID_CELL_H / 2;
            s.cards[i].bg.at(x, y).size(GRID_CELL_W, GRID_CELL_H).visible(visible);
            s.cards[i].thumb.at(x, y + 4).visible(visible);
        }
    }

    /** Анимация: миниатюры идут по ряду 0, крупный кадр — по выбранному ряду. */
    function tickAnim(dt) {
        if (!s.paused) s.phase += dt * BASE_FPS * s.speed;
        const col = ((Math.floor(s.phase) % SHEET_COLS) + SHEET_COLS) % SHEET_COLS;

        for (const card of s.cards) card.thumb.frame(col);
        if (s.preview) s.preview.frame(s.row * SHEET_COLS + col);
    }

    // --- Регистрация сцены ---------------------------------------------------

    $.scene.add('gallery', {
        enter($) {
            const size = $.gfx.size();

            // Имена 'left'/'right' в $.input.pressed() заняты кнопками мыши,
            // поэтому стрелки подключаем именованными действиями.
            $.input.bind('gallery_prev', ['a', 'Left']);
            $.input.bind('gallery_next', ['d', 'Right']);

            // Камера прижата к центру окна: мировые координаты = экранные.
            $.camera.unfollow().zoom(1).limits(null).at(size.w / 2, size.h / 2);
            $.world.color('#0c0e16');

            s.list = readSheets();
            s.index = 0;
            s.row = 0;
            s.speed = 1;
            s.paused = false;
            s.phase = 0;
            s.scrollRow = 0;

            if (!s.list.length) {
                text('g-empty', 40, 140, 'Манифест ассетов не найден — галерея пуста',
                     26, '#ff8b6b');
                return;
            }

            buildGrid(size);
            buildPreview(size);
            buildPanel(size);
            refresh();

            $.sound.music(MUSIC_MENU, { loop: true, volume: 0.35 });
        },

        exit() {
            // Документов RmlUi сцена не грузит: интерфейс — узлы <ui.*>,
            // они уходят вместе с миром при смене сцены.
            $.sound.stopMusic(300);
        },

        update(dt, $) {
            if ($.input.pressed('escape')) { $.scene.load('launcher'); return; }
            if (!s.list.length) return;

            const size = $.gfx.size();

            if ($.input.pressed('gallery_prev')) step(-1);
            if ($.input.pressed('gallery_next')) step(+1);

            STATES.forEach((st, i) => {
                if ($.input.pressed(String(i + 1))) setRow(st.row);
            });

            if ($.input.pressed('space')) togglePause();
            if ($.input.pressed('n')) stepFrame();

            // Прокрутка сетки: колесо мыши и W/S/вверх-вниз.
            let scroll = 0;
            const wheel = $.input.wheel().y;
            if (wheel > 0) scroll -= 1;
            else if (wheel < 0) scroll += 1;
            if ($.input.pressed('w') || $.input.pressed('up')) scroll -= 1;
            if ($.input.pressed('s') || $.input.pressed('down')) scroll += 1;
            if (scroll !== 0) {
                s.scrollRow = Math.max(0, Math.min(s.scrollRow + scroll, s.maxRow));
            }

            layoutGrid(size);
            tickAnim(dt);
        },
    });

    // Состояние галереи видно агенту в ответе на `state`.
    $.agent.expose('gallery_index', () => s.index);
    $.agent.expose('gallery_sheet', () => (s.list[s.index] ? s.list[s.index].label : null));
    $.agent.expose('gallery_sheets', () => s.list.length);
    $.agent.expose('gallery_row', () => s.row);
    $.agent.expose('gallery_speed', () => s.speed);
    $.agent.expose('gallery_paused', () => s.paused);
    $.agent.expose('gallery_frame', () => Math.floor(s.phase) % SHEET_COLS);
    $.agent.expose('gallery_scroll', () => s.scrollRow);
    $.agent.expose('gallery_visible', () => s.cards.filter((c) => c.thumb.get(0).visible).length);
}
