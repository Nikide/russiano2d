// ===========================================================================
// Демо: 2D-свет и тени через полигоны видимости.
//
// Идея. Свет — это не картинка, а геометрия. Для каждого источника считается
// полигон видимости: множество точек, до которых от источника доходит прямая,
// не пересекающая ни одной стены. Библиотека trylock/visibility делает это
// sweep-line алгоритмом за O(n log n).
//
// Полигон видимости всегда звёздчатый относительно источника, поэтому он
// триангулируется обычным веером: (центр, v[i], v[i+1]). Цвет в центре яркий,
// на периметре — затухающий по расстоянию, и интерполяция по вершинам даёт
// плавный радиальный градиент без единой текстуры. Тени получаются сами собой:
// всё, что не попало в полигон, остаётся неосвещённым.
//
// Обвязка — на `$`: сцена, ввод, камера, звук, панель, снимок для агента.
// Полигоны и батч треугольников — низкоуровневые engine.light.visibility()
// и engine.submitTriangles(): это суть демо.
// ===========================================================================

const TILE = 32;
const MAP_COLS = 40;
const MAP_ROWS = 22;
const PLAYER_SPEED = 190;
const PICK_RADIUS = 26;          // на каком расстоянии мышь «берёт» источник
const RADIUS_MIN = 60;
const RADIUS_MAX = 420;

// '#' — стена. Уровень намеренно с внутренними комнатами и коридорами:
// на нём хорошо видны тени от стен.
const MAP = [
    '########################################',
    '#......................................#',
    '#...#....#....#....#....#....#....#....#',
    '#......................................#',
    '#....########..........########........#',
    '#....#......#..........#......#........#',
    '#....#......#..........#......#........#',
    '#....#......#..........#......#........#',
    '#....########..........########........#',
    '#......................................#',
    '#........#....................#........#',
    '#........#....................#........#',
    '#......................................#',
    '#....########..........########........#',
    '#....#......#..........#......#........#',
    '#....#......#..........#......#........#',
    '#....#......#..........#......#........#',
    '#....########..........########........#',
    '#......................................#',
    '#...#....#....#....#....#....#....#....#',
    '#......................................#',
    '########################################',
];

// Цвета источников. Первый — «факел»: он ходит за игроком, пока его не
// утащат мышью; остальные стоят на местах.
const LIGHT_DEFS = [
    { color: [255, 196, 110], radius: 300, title: 'факел игрока' },
    { color: [255, 120, 60], radius: 240 },
    { color: [110, 190, 255], radius: 230 },
    { color: [130, 255, 170], radius: 220 },
    { color: [220, 130, 255], radius: 210 },
];

// Сколько источников пересчитывать за кадр. Полигон видимости — это
// O(n log n) по отрезкам плюс разрезание пересечений; при сотне отрезков
// пять источников подряд дают заметный провал кадра, поэтому полигоны
// обновляются по кругу, а между обновлениями источник плавно доезжает.
const POLY_STRIDE = 1;

// Верхняя граница буфера треугольников. Здесь 4096 треугольников веера —
// с запасом на пять источников с полигоном в сотни вершин.
const MAX_TRIANGLES = 4096;

// Сцена, живущая в мире прямо сейчас: обёртки для агента читают её поля.
let active = null;

export default function install($) {
    $.scene.add('light', {
        enter($) { exit(this, $); enter(this, $); active = this; },
        exit() { exit(this, $); if (active === this) active = null; },
        update(dt, $) { update(this, dt, $); },
        render($) { render(this, $); },
    });
}

function enter(s, $) {
    s.doc = null;
    s.dragging = -1;
    s.polyIndex = 0;
    s.vertexCount = 0;
    s.triangles = new Float32Array(MAX_TRIANGLES * 3 * 6);
    s.commands = 0;
    s.xf = new Float32Array(4096 * 6);
    s.colors = new Int32Array(4096);
    s.polyStats = { verts: 0, ms: 0, updates: 0 };

    buildTiles(s);
    buildSegments(s);
    s.player = { x: 20.5 * TILE, y: 9.5 * TILE };
    buildLights(s, $);
    s.carried = true;            // факел игрока идёт за игроком

    s.showShadows = true;
    s.showFill = true;
    s.showRays = false;

    // Ввод читается по именам клавиш, а не через $.input.bind(): имена
    // действий, совпадающие с буквой клавиши ('t', 'f', 'r'), в движке
    // зацикливают разрешение привязок (см. отчёт о API).
    s.doc = $.ui.doc('demos/ui/light.rml').show();
    // Подписка идёт на каждый элемент отдельно: $.ui.doc().on() вешает
    // слушателя на конкретный id, а обработчик всегда получает именно его.
    s.doc.on('light-shadows', 'click', () => toggle(s, 'showShadows', 'light-shadows', 'тени', $))
         .on('light-fill', 'click', () => toggle(s, 'showFill', 'light-fill', 'заливка полигонов', $))
         .on('light-rays', 'click', () => toggle(s, 'showRays', 'light-rays', 'лучи', $));
    s.doc.text('light-walls', s.segmentCount);

    $.sound.music('demos/assets/audio/music/menu.ogg', { loop: true, volume: 0.35 });

    // Агенту — координаты источников: по ним проверяется перетаскивание.
    $.agent.expose('light', () => lightState());

    $.console.register('light_move', (args) => {
        const i = Number(args[0] || 0);
        const x = Number(args[1] || 0);
        const y = Number(args[2] || 0);
        if (!s.lights[i]) return 'нет источника ' + i;
        s.lights[i].x = x;
        s.lights[i].y = y;
        s.lights[i].polygon = null;
        s.carried = false;
        return `${x} ${y}`;
    }, 'light_move <i> <x> <y> — поставить источник');
}

function exit(s, $) {
    if (s.doc) s.doc.hide();
    s.doc = null;
    s.lights = [];
    $.sound.stopMusic(300);
}

function lightState() {
    const s = active;
    if (!s) return null;
    return {
        lights: s.lights.map((l, i) => ({
            i, x: round(l.x), y: round(l.y), radius: l.radius,
            color: l.color.join(','), polygon: l.polygon ? l.polygon.length / 2 : 0,
        })),
        dragging: s.dragging,
        carried: s.carried,
        player: { x: round(s.player.x), y: round(s.player.y) },
        segments: s.segmentCount,
        poly_verts: s.polyStats.verts,
        poly_ms: round(s.polyStats.ms),
        shadows: s.showShadows,
        fill: s.showFill,
        rays: s.showRays,
    };
}

function round(v) { return Math.round(v * 1000) / 1000; }

function buildTiles(s) {
    s.walls = [];
    s.floorTiles = [];
    for (let row = 0; row < MAP_ROWS; row++) {
        for (let col = 0; col < MAP_COLS; col++) {
            const x = col * TILE + TILE / 2;
            const y = row * TILE + TILE / 2;
            if (MAP[row][col] === '#') s.walls.push({ x, y });
            else s.floorTiles.push({ x, y });
        }
    }
}

function buildSegments(s) {
    // Грани выводятся не по одной на тайл, а склеиваются в длинные
    // отрезки. Это важно: обёртка над библиотекой разрезает пересечения
    // за O(n^2), а буфер под полигон растёт примерно как 8n^2 — на сотнях
    // коротких отрезков демо просто захлебнётся.
    const solid = (c, r) => r < 0 || r >= MAP_ROWS || c < 0 || c >= MAP_COLS || MAP[r][c] === '#';
    const segs = [];

    // Вертикальные грани: линия x = c*TILE между колонками c-1 и c.
    for (let c = 0; c <= MAP_COLS; c++) {
        let run = -1;
        for (let r = 0; r <= MAP_ROWS; r++) {
            const edge = r < MAP_ROWS && solid(c - 1, r) !== solid(c, r);
            if (edge && run < 0) run = r;
            if (!edge && run >= 0) {
                segs.push(c * TILE, run * TILE, c * TILE, r * TILE);
                run = -1;
            }
        }
    }

    // Горизонтальные грани: линия y = r*TILE между строками r-1 и r.
    for (let r = 0; r <= MAP_ROWS; r++) {
        let run = -1;
        for (let c = 0; c <= MAP_COLS; c++) {
            const edge = c < MAP_COLS && solid(c, r - 1) !== solid(c, r);
            if (edge && run < 0) run = c;
            if (!edge && run >= 0) {
                segs.push(run * TILE, r * TILE, c * TILE, r * TILE);
                run = -1;
            }
        }
    }

    s.segments = new Float32Array(segs);
    s.segmentCount = segs.length / 4;
}

function buildLights(s, $) {
    // Игрок плюс четыре статичных факела в разных концах уровня.
    const spots = [
        { x: 20.5 * TILE, y: 11.5 * TILE },   // центральный зал
        { x: 6.5 * TILE, y: 2.5 * TILE },     // левый верх
        { x: 33.5 * TILE, y: 19.5 * TILE },   // правый низ
        { x: 6.5 * TILE, y: 19.5 * TILE },    // левый низ
    ];

    s.lights = LIGHT_DEFS.map((def, i) => ({
        color: def.color,
        radius: def.radius,
        x: i === 0 ? spots[0].x : spots[i - 1].x,
        y: i === 0 ? spots[0].y : spots[i - 1].y,
        polygon: null,
    }));

    // Маркеры мира: список источников и сами факелы видны агенту в снимке
    // и дают $.world.count(); рисует свет всё равно веер треугольников.
    s.lightNodes = s.lights.map((l, i) => $('<light>', {
        id: 'light-source-' + i, x: l.x, y: l.y,
        color: `rgb(${l.color.join(',')})`, radius: l.radius,
    }).visible(false).appendTo($.world));
    s.playerNode = $('<player>', { id: 'light-player', x: s.player.x, y: s.player.y })
        .size(28, 40).visible(false).appendTo($.world);
}

function toggle(s, field, element, label, $) {
    s[field] = !s[field];
    $.sound.play('demos/assets/audio/sfx/ui_click.ogg', { volume: 0.3 });
    if (s.doc) s.doc.text(element, `${label}: ${s[field] ? 'вкл' : 'выкл'}`);
}

// ---------------------------------------------------------------------------
// Логика
// ---------------------------------------------------------------------------

function update(s, dt, $) {
    if ($.input.pressed('escape')) { $.scene.load('launcher'); return; }
    if ($.input.pressed('t')) toggle(s, 'showShadows', 'light-shadows', 'тени', $);
    if ($.input.pressed('f')) toggle(s, 'showFill', 'light-fill', 'заливка полигонов', $);
    if ($.input.pressed('r')) toggle(s, 'showRays', 'light-rays', 'лучи', $);
    if ($.input.pressed('c')) {
        s.carried = !s.carried;
        $.sound.play('demos/assets/audio/sfx/ui_click.ogg', { volume: 0.3 });
    }

    const vec = $.input.vec('both');
    s.player.x += vec.x * PLAYER_SPEED * dt;
    s.player.y += vec.y * PLAYER_SPEED * dt;

    // Источник можно тащить мышью: берём ближайший под курсором и ведём его,
    // пока кнопка нажата. Так освещение меняется прямо на глазах.
    const mouse = $.input.mouse();
    if ($.input.mousePressed('left')) {
        const picked = nearestLight(s, mouse.x, mouse.y);
        if (picked >= 0) {
            s.dragging = picked;
            s.carried = false;               // игрок отпустил факел
            $.sound.play('demos/assets/audio/sfx/ui_click.ogg', { volume: 0.3 });
        }
    }
    if (s.dragging >= 0) {
        if ($.input.mouseDown('left')) {
            const l = s.lights[s.dragging];
            l.x = mouse.x;
            l.y = mouse.y;
            l.polygon = null;                // пересчитаем сразу, без очереди
        } else {
            s.dragging = -1;
        }
    }

    // Колесо мыши меняет радиус источника под курсором (или у нулевого).
    const wheel = $.input.wheel().y;
    if (wheel !== 0) {
        const i = nearestLight(s, mouse.x, mouse.y);
        const l = s.lights[i >= 0 ? i : 0];
        l.radius = Math.max(RADIUS_MIN, Math.min(RADIUS_MAX, l.radius * (wheel > 0 ? 1.1 : 0.9)));
        l.polygon = null;
    }

    // Факел игрока идёт за игроком, пока его не утащили.
    if (s.carried) { s.lights[0].x = s.player.x; s.lights[0].y = s.player.y; }

    updatePolygons(s, $);

    $.camera.at(20.5 * TILE, 11 * TILE);
    s.playerNode.at(s.player.x, s.player.y);
    for (let i = 0; i < s.lightNodes.length; i++) {
        s.lightNodes[i].hide().at(s.lights[i].x, s.lights[i].y);
    }
}

function nearestLight(s, x, y) {
    let best = -1;
    let bestDist = PICK_RADIUS;
    for (let i = 0; i < s.lights.length; i++) {
        const d = Math.hypot(s.lights[i].x - x, s.lights[i].y - y);
        if (d < bestDist) { bestDist = d; best = i; }
    }
    return best;
}

/** Полигоны видимости: по кругу, чтобы кадр не проваливался на пяти источниках. */
function updatePolygons(s, $) {
    const started = engine.time;
    let verts = 0;
    let updates = 0;

    for (let step = 0; step < POLY_STRIDE; step++) {
        const i = s.polyIndex % s.lights.length;
        const l = s.lights[i];
        l.polygon = engine.light.visibility(s.segments, l.x, l.y);
        s.polyIndex++;
        updates++;
        if (!l.polygon) $.log(`свет: полигон источника ${i} не поместился в буфер`);
    }

    for (const l of s.lights) if (l.polygon) verts += l.polygon.length / 2;

    s.polyStats.verts = verts;
    s.polyStats.ms = s.polyStats.ms * 0.85 + (engine.time - started) * 1000 * 0.15;
    s.polyStats.updates += updates;
}

// ---------------------------------------------------------------------------
// Отрисовка
// ---------------------------------------------------------------------------

function render(s, $) {
    if (!s.player) return;
    const w = engine.width;
    const h = engine.height;

    s.commands = 0;
    for (const t of s.floorTiles) push(s, engine.whiteSprite, t.x, t.y, TILE, TILE, 0, $.gfx.rgba(26, 28, 38));
    for (const wall of s.walls) push(s, engine.whiteSprite, wall.x, wall.y, TILE, TILE, 0, $.gfx.rgba(46, 50, 64));
    flush(s);

    // --- Свет ---
    s.vertexCount = 0;
    if (s.showFill && s.showShadows) {
        for (const light of s.lights) if (light.polygon) emitLightFan(s, light);
    } else if (s.showFill) {
        // Тени выключены — светим кругом, без учёта стен.
        for (const light of s.lights) emitFullCircle(s, light);
    }
    engine.submitTriangles(s.triangles.subarray(0, s.vertexCount * 6), s.vertexCount);

    // Отрисовка поверх света: ядра источников и (по желанию) лучи.
    s.commands = 0;
    for (const light of s.lights) {
        const r = 9 + Math.sin(engine.time * 7 + light.x) * 1.6;
        push(s, engine.whiteSprite, light.x, light.y, r * 2, r * 2, 0, engine.WHITE);
        if (s.dragging >= 0 && s.lights[s.dragging] === light) {
            $.gfx.draw.ring(light.x, light.y, PICK_RADIUS, '#ffe08a', 2);
        }
    }

    if (s.showRays && s.lights[0].polygon) {
        const poly = s.lights[0].polygon;
        const lx = s.lights[0].x;
        const ly = s.lights[0].y;
        for (let i = 0; i < poly.length; i += 2) {
            const mx = (lx + poly[i]) / 2;
            const my = (ly + poly[i + 1]) / 2;
            const dx = poly[i] - lx;
            const dy = poly[i + 1] - ly;
            const d = Math.hypot(dx, dy);
            push(s, engine.whiteSprite, mx, my, d, 1, Math.atan2(dy, dx), $.gfx.rgba(255, 230, 160, 90));
        }
    }

    // Игрок: в этом демо он — носитель факела.
    push(s, engine.whiteSprite, s.player.x, s.player.y, 22, 30, 0, $.gfx.rgba(230, 240, 255));
    flush(s);

    // --- Подписи поверх кадра ---
    $.gfx.text('2D-свет: полигоны видимости', 18, 22, { size: 20, color: '#e8f0ff' });
    $.gfx.text(`источников ${s.lights.length} · вершин ${s.polyStats.verts} · ` +
               `полигон ${s.polyStats.ms.toFixed(1)} мс · ЛКМ — тащить источник · колесо — радиус`,
               18, 48, { size: 15, color: '#9fb4d0' });

    if (s.doc) {
        s.doc.text('light-count', s.lights.length);
        s.doc.text('light-verts', s.polyStats.verts);
        s.doc.text('light-ms', s.polyStats.ms.toFixed(1));
        s.doc.text('light-shadows', s.showShadows ? 'тени: включены' : 'тени: выключены');
        s.doc.text('light-fill', s.showFill ? 'заливка полигонов: видна' : 'заливка: скрыта');
        s.doc.text('light-rays', s.showRays ? 'лучи: видны' : 'лучи: скрыты');
    }
}

// Веер треугольников из центра источника по вершинам полигона видимости.
// Полигон звёздчатый относительно источника, поэтому веер его покрывает.
function emitLightFan(s, light) {
    const poly = light.polygon;
    const n = poly.length / 2;
    if (n < 2) return;
    if (s.vertexCount + n * 3 > MAX_TRIANGLES * 3) return;   // буфер полон

    const [r, g, b] = light.color;
    const lx = light.x;
    const ly = light.y;
    const invR2 = 1 / (light.radius * light.radius);

    // Периметр: плавное затухание по расстоянию до источника.
    const perimAlpha = (x, y) => {
        const dx = x - lx;
        const dy = y - ly;
        const t = 1 - Math.min(1, (dx * dx + dy * dy) * invR2);
        return t * t * 190;
    };

    for (let i = 0; i < n; i++) {
        const ax = poly[i * 2];
        const ay = poly[i * 2 + 1];
        const j = (i + 1) % n;
        const bx = poly[j * 2];
        const by = poly[j * 2 + 1];

        pushVertex(s, lx, ly, r, g, b, 205);
        pushVertex(s, ax, ay, r, g, b, perimAlpha(ax, ay));
        pushVertex(s, bx, by, r, g, b, perimAlpha(bx, by));
    }
}

// Круглый источник, когда тени выключены: тот же веер, но по окружности.
function emitFullCircle(s, light) {
    const [r, g, b] = light.color;
    const steps = 48;
    for (let i = 0; i < steps; i++) {
        const a0 = (i / steps) * Math.PI * 2;
        const a1 = ((i + 1) / steps) * Math.PI * 2;
        pushVertex(s, light.x, light.y, r, g, b, 205);
        pushVertex(s, light.x + Math.cos(a0) * light.radius,
                   light.y + Math.sin(a0) * light.radius, r, g, b, 0);
        pushVertex(s, light.x + Math.cos(a1) * light.radius,
                   light.y + Math.sin(a1) * light.radius, r, g, b, 0);
    }
}

function pushVertex(s, x, y, r, g, b, a) {
    if ((s.vertexCount + 1) * 6 > s.triangles.length) return;
    const o = s.vertexCount * 6;
    const t = s.triangles;
    t[o] = x; t[o + 1] = y;
    t[o + 2] = r; t[o + 3] = g; t[o + 4] = b; t[o + 5] = a;
    s.vertexCount++;
}

function push(s, sprite, x, y, w, h, angle, color) {
    if (s.commands >= 4096) return;
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
