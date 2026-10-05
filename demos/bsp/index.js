// ===========================================================================
// Демо: 2D BSP-дерево.
//
// Зачем это в 2D-движке. Пакетная отрисовка не имеет z-буфера: порядок задаётся
// очерёдностью спрайтов в пакете. Пока геометрия — регулярная сетка (как в
// сеточном рейкастере), глубина решается на каждую колонку экрана. Но как
// только появляются стены под произвольным углом, нужно упорядочивать целые
// отрезки, и здесь BSP даёт корректный порядок «от дальних к ближним» из любой
// точки наблюдателя — за один обход дерева, без сортировки и без мерцания.
//
// Обвязка — на `$`: сцена, ввод, камера, панель, звук, снимок для агента.
// Дерево и обход — низкоуровневые engine.bsp.*: это и есть суть демо.
// ===========================================================================

const WALL_THICKNESS = 7;
const PLAYER_SPEED = 260;
const SPRITE_COUNT = 14;

// Уровень: стены заданы отрезками. Специально есть наклонные — сеткой такое
// не описать.
const WALLS = [
    // Внешняя комната
    [60, 60, 1220, 60], [1220, 60, 1220, 660],
    [1220, 660, 60, 660], [60, 660, 60, 60],
    // Внутренние стены, в том числе под углом
    [300, 60, 300, 320],
    [300, 320, 640, 480],
    [640, 480, 640, 660],
    [900, 60, 900, 300],
    [900, 300, 1100, 300],
    [1100, 300, 980, 520],
    [640, 140, 820, 140],
    [420, 520, 640, 400],
];

const CHARACTERS = [
    'catgirl_green_ak_sprite_sheet.png',
    'catgirl_lilac_pistol_sprite_sheet.png',
    'enemy_03_zombie_girl_8x9.png',
    'enemy_06_ninja_assassin_8x9.png',
    'enemy_09_sniper_girl_8x9.png',
];

const MAX_COMMANDS = 4096;

// Сцена, живущая в мире прямо сейчас: обёртки для агента читают её поля.
let active = null;

export default function install($) {
    $.scene.add('bsp', {
        enter($) { exit(this, $); enter(this, $); active = this; },
        exit() { exit(this, $); if (active === this) active = null; },
        update(dt, $) { update(this, dt, $); },
        render($) { render(this, $); },
    });
}

function enter(s, $) {
    s.camera = { x: 640, y: 560 };
    s.showSplits = false;
    s.showOrder = false;
    s.stepping = false;
    s.orderStep = 0;
    s.order = [];
    s.commands = 0;
    s.xf = new Float32Array(MAX_COMMANDS * 6);
    s.colors = new Int32Array(MAX_COMMANDS);

    buildSegments(s, $);

    // Точки для BSP-сортировки: персонажи расставлены так, чтобы
    // перекрываться при виде сверху.
    s.actors = [];
    for (let i = 0; i < SPRITE_COUNT; i++) {
        const a = (i / SPRITE_COUNT) * Math.PI * 2;
        const x = 640 + Math.cos(a) * (140 + (i % 4) * 34);
        const y = 380 + Math.sin(a) * (90 + (i % 3) * 26);
        const sheet = CHARACTERS[i % CHARACTERS.length];
        // Маркер нужен дереву сцены и агенту ($.world.count(), снимок), но
        // рисуется персонаж своим кадром листа — маркер всегда скрыт.
        const node = $('<sprite>', { id: 'bsp-actor-' + i, x, y })
            .size(48, 64).color('#8fb4ff').visible(false).appendTo($.world);
        s.actors.push({
            x, y,
            sheet,
            phase: $.random.range(0, 6.28),
            frames: sheetFrames($, `demos/assets/art/characters/${sheet}`),
            node,
        });
    }

    // Клавиши читаются по именам, а не через $.input.bind(): имена действий
    // на букву клавиши ('up', 'r', 'f') в движке зацикливают разрешение
    // привязок (см. отчёт о API), поэтому обходимся именами клавиш.
    s.doc = $.ui.doc('demos/ui/bsp.rml').show();
    // Каждая кнопка подписывается на свой id: $.ui.doc().on() вешает слушателя
    // на конкретный элемент, а не на документ целиком.
    s.doc.on('bsp-splits', 'click', () => {
        s.showSplits = !s.showSplits;
        $.sound.play('demos/assets/audio/sfx/ui_click.ogg', { volume: 0.35 });
        refreshInfo(s);
    }).on('bsp-order', 'click', () => {
        s.stepping = !s.stepping;
        s.orderStep = 0;
        $.sound.play('demos/assets/audio/sfx/ui_click.ogg', { volume: 0.35 });
        refreshInfo(s);
    });

    $.sound.music('demos/assets/audio/music/menu.ogg', { loop: true, volume: 0.35 });
    refreshInfo(s);

    // Агенту — поля, по которым проверяется шаг по дереву.
    $.agent.expose('bsp', () => bspState());

    $.console.register('bsp_step', (args) => {
        s.orderStep += Number(args[0] || 1);
        refreshInfo(s);
        return String(s.orderStep);
    }, 'bsp_step [n] — пройти n шагов по порядку обхода');
}

function exit(s, $) {
    if (s.doc) s.doc.hide();
    s.doc = null;
    s.actors = [];
    // Дерево живёт в рантайме, а не в сцене: без clear() оно останется
    // построенным для следующей сцены.
    engine.bsp.clear();
    $.sound.stopMusic(300);
}

function bspState() {
    const s = active;
    if (!s) return null;
    const limit = orderLimit(s);
    const stepIndex = s.order.length ? s.order[Math.min(limit, s.order.length) - 1] : -1;
    const seg = stepIndex >= 0 ? engine.bsp.segment(stepIndex) : null;
    return {
        segments: engine.bsp.count(),
        nodes: engine.bsp.nodes(),
        depth: engine.bsp.depth(),
        order_length: s.order.length,
        step: s.orderStep,
        limit,
        stepping: s.stepping,
        current_segment: stepIndex,
        current_segment_user: seg ? seg[4] : -1,
        current_segment_split: seg ? !!seg[5] : false,
        camera: { x: round(s.camera.x), y: round(s.camera.y) },
        show_splits: s.showSplits,
    };
}

function round(v) { return Math.round(v * 1000) / 1000; }

/** Сколько отрезков показывать: целиком или по шагам. */
function orderLimit(s) {
    if (!s.stepping) return s.order.length;
    return Math.min(s.order.length, Math.floor(s.orderStep) + 1);
}

function buildSegments(s, $) {
    // stride 5: x1, y1, x2, y2, метка. Метка — индекс исходной стены,
    // чтобы понимать, какие отрезки порождены разрезанием.
    const flat = new Float32Array(WALLS.length * 5);
    WALLS.forEach((w, i) => {
        flat[i * 5 + 0] = w[0];
        flat[i * 5 + 1] = w[1];
        flat[i * 5 + 2] = w[2];
        flat[i * 5 + 3] = w[3];
        flat[i * 5 + 4] = i;
    });

    const ok = engine.bsp.build(flat);
    $.log(`BSP: ${ok ? 'построено' : 'ОШИБКА'}, отрезков ${engine.bsp.count()}, ` +
          `узлов ${engine.bsp.nodes()}, глубина ${engine.bsp.depth()}`);
}

function refreshInfo(s) {
    if (!s.doc) return;
    s.doc.text('bsp-segments', engine.bsp.count());
    s.doc.text('bsp-nodes', engine.bsp.nodes());
    s.doc.text('bsp-depth', engine.bsp.depth());
    s.doc.text('bsp-splits', s.showSplits ? 'разрезы: видны' : 'разрезы: скрыты');
    s.doc.text('bsp-order', s.stepping ? `порядок: шаг ${s.orderStep}` : 'порядок: целиком');
}

// ---------------------------------------------------------------------------
// Логика
// ---------------------------------------------------------------------------

function update(s, dt, $) {
    if ($.input.pressed('escape')) { $.scene.load('launcher'); return; }
    if ($.input.pressed('tab')) {
        s.showSplits = !s.showSplits;
        $.sound.play('demos/assets/audio/sfx/ui_click.ogg', { volume: 0.3 });
        refreshInfo(s);
    }
    if ($.input.pressed('space')) {
        s.stepping = !s.stepping;
        s.orderStep = 0;
        refreshInfo(s);
    }

    // Шаг вперёд-назад по порядку обхода: номер узла меняется с каждым шагом.
    // Клавиши шага — только стрелки/E/Q: у '[' и ']' нет имён в SDL.
    if ($.input.pressed(']') || $.input.pressed('e')) {
        s.orderStep += 1;
        $.sound.play('demos/assets/audio/sfx/ui_click.ogg', { volume: 0.25 });
        refreshInfo(s);
    }
    if ($.input.pressed('[') || $.input.pressed('q')) {
        s.orderStep = Math.max(0, s.orderStep - 1);
        refreshInfo(s);
    }

    const vec = $.input.vec('both');
    s.camera.x += vec.x * PLAYER_SPEED * dt;
    s.camera.y += vec.y * PLAYER_SPEED * dt;
    $.camera.at(s.camera.x, s.camera.y);
}

// ---------------------------------------------------------------------------
// Отрисовка
// ---------------------------------------------------------------------------

function render(s, $) {
    if (!s.camera) return;
    s.commands = 0;

    s.order = engine.bsp.order(s.camera.x, s.camera.y, true) || [];
    const limit = orderLimit(s);

    // Порядок обхода пересчитывается каждый кадр: он зависит от наблюдателя.
    for (let i = 0; i < limit; i++) {
        const seg = engine.bsp.segment(s.order[i]);
        if (!seg) continue;
        drawWall(s, $, seg, i, limit);
    }

    // Персонажи сортируются по расстоянию от камеры. Вставку точек прямо
    // в BSP-дерево (как в Doom) движок пока не умеет — см. src/bsp.h.
    const order = s.actors
        .map((a, i) => ({ i, d: Math.hypot(a.x - s.camera.x, a.y - s.camera.y) }))
        .sort((a, b) => b.d - a.d);

    for (const entry of order) {
        const a = s.actors[entry.i];
        if (!a || !a.frames) continue;
        const frame = Math.floor($.time.now() * 6 + a.phase) % a.frames.length;
        push(s, a.frames[frame], a.x, a.y, 48, 64, 0, engine.WHITE);
    }

    // Курсор наблюдателя и подсветка текущего узла дерева.
    push(s, engine.whiteSprite, s.camera.x, s.camera.y, 12, 12, 0, $.gfx.rgba(255, 220, 120));

    const current = limit > 0 ? engine.bsp.segment(s.order[Math.min(limit, s.order.length) - 1]) : null;
    if (current && s.stepping) {
        const cx = (current[0] + current[2]) / 2;
        const cy = (current[1] + current[3]) / 2;
        const len = Math.hypot(current[2] - current[0], current[3] - current[1]) + 26;
        const angle = Math.atan2(current[3] - current[1], current[2] - current[0]);
        push(s, engine.whiteSprite, cx, cy, len, WALL_THICKNESS + 12, angle, $.gfx.rgba(255, 236, 120, 150));
    }

    flush(s);

    // Подписи поверх кадра: что делает обход дерева прямо сейчас.
    const info = bspState();
    $.gfx.text('2D BSP · порядок отрисовки без z-буфера', 18, 22,
               { size: 20, color: '#e8f0ff' });
    $.gfx.text(`шаг ${info.limit} / ${info.order_length} · отрезок #${info.current_segment} · ` +
               `метка стены ${info.current_segment_user}` + (info.current_segment_split ? ' (разрез)' : ''),
               18, 48, { size: 16, color: '#9fb4d0' });
    if (!info.stepping) {
        $.gfx.text('Space — обход по шагам · Shift уже не нужен: шаг это [ и ]',
                   18, 70, { size: 15, color: '#6d809a' });
    }
}

/** Цвет стены: разрез, обычная, либо градиент по номеру шага. */
function wallColor(s, $, seg, orderIndex, limit) {
    if (s.stepping) {
        const t = limit > 1 ? orderIndex / (limit - 1) : 0;
        return $.gfx.rgba(80 + 175 * t, 120 - 60 * t, 255 - 150 * t);
    }
    if (seg[5]) {
        return s.showSplits ? $.gfx.rgba(255, 150, 90) : $.gfx.rgba(90, 96, 110);
    }
    return $.gfx.rgba(150, 170, 200);
}

function drawWall(s, $, seg, orderIndex, limit) {
    const [x1, y1, x2, y2] = seg;
    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2;
    const length = Math.hypot(x2 - x1, y2 - y1);
    const angle = Math.atan2(y2 - y1, x2 - x1);
    push(s, engine.whiteSprite, cx, cy, length, WALL_THICKNESS, angle, wallColor(s, $, seg, orderIndex, limit));
}

function push(s, sprite, x, y, w, h, angle, color) {
    if (s.commands >= MAX_COMMANDS) return;
    const o = s.commands * 6;
    s.xf[o] = sprite; s.xf[o + 1] = x; s.xf[o + 2] = y;
    s.xf[o + 3] = w; s.xf[o + 4] = h; s.xf[o + 5] = angle;
    s.colors[s.commands] = color;
    s.commands++;
}

function flush(s) {
    if (s.commands === 0) return;
    const colors = new Uint32Array(s.commands);
    for (let i = 0; i < s.commands; i++) colors[i] = s.colors[i];
    engine.submitSprites(s.xf.subarray(0, s.commands * 6), colors, s.commands);
    s.commands = 0;
}

/** Кадры листа персонажа — через спрайты `$` (`.frames()` хранит их в кэше). */
function sheetFrames($, path) {
    const probe = $('<sprite>').frames({ src: path, cols: 8, rows: 9, cw: 48, ch: 64 }).hide();
    const frames = probe.get(0).frames;
    probe.remove();
    return frames;
}
