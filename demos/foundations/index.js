// ===========================================================================
// Пример §31-1 Спецификации: «Platform foundations».
//
// Один законченный сценарий на существующем `$`: край платформы, склон,
// односторонние платформы, движущаяся платформа, зоны камеры и геймпад.
// Ничего, кроме `$`: ни импорта внутренностей движка, ни `engine.*`.
//
// Запуск:
//   ./build/russiano2d --game demos/foundations
//   python3 tests/agent/foundations_test.py     // автоматическая проверка
//
// Что проверяется автоматически:
//   * игрок стоит на земле, идёт, прыгает;
//   * поднимается по склону и не застревает на ступенях;
//   * односторонняя платформа держит сверху и пропускает снизу;
//   * `S`+`Space` спрыгивает сквозь неё;
//   * движущаяся платформа несёт игрока (смещения совпадают);
//   * зона камеры меняет зум и границы при входе;
//   * геймпад читается тем же `$.input`, что клавиатура.
// ===========================================================================

const TILE = 32;
const SLOPE_STEPS = 8;        // ступеней на склон: полигонального тайла нет
const SLOPE_DEG = 26;         // наклон склона

// Карта: одна клетка — 32 px, ровно 48 колонок.
//   #  земля              =  односторонняя платформа
//   /  склон вверх        F  движущаяся платформа
//   P  старт игрока       .  пусто
const LEVEL = [
    '................................................',
    '................................................',
    '................................................',
    '................................................',
    '................................................',
    '..............======............................',
    '..........................F.....................',
    '........====....................................',
    '................................................',
    '........................======..................',
    '................................................',
    '.................====...........................',
    '....................====........................',
    '................................................',
    '.........######..................###############',
    '........#######.................################',
    '..P..../#######................/################',
    '################################################',
];

export default function install($) {
    // Зоны камеры — данные: прямоугольник, зум, вынос. Несколько зон
    // разрешаются правилом «последняя вошедшая» (см. tickZones).
    const zones = [
        { id: 'entry', x: 0, y: 0, w: 620, h: 576, zoom: 1.0, lookahead: 70 },
        { id: 'climb', x: 460, y: 0, w: 700, h: 576, zoom: 1.15, lookahead: 100 },
        { id: 'high', x: 1050, y: 0, w: 486, h: 576, zoom: 0.9, lookahead: 60 },
    ];

    const state = { platformHome: 0, platformRange: 0, zone: 'entry' };

    $.scene.add('foundations', {
        enter($) {
            $.world.gravity(0, 1800).color('#121826');
            $.world.bounds(-64, -320, LEVEL[0].length * TILE + 128, LEVEL.length * TILE + 320);

            buildLevel($);

            $.camera.follow('#hero', {
                smooth: 0.16, deadzone: [40, 24], lookahead: 70, offset: [0, -30],
            });
            applyZone($, zones[0]);

            buildHud($);
        },

        update(dt, $) {
            tickZones($);
            tickMovingPlatforms($);
            hud($, state);
        },
    });

    // --- Уровень ------------------------------------------------------------
    function buildLevel($) {
        // Верх земли по колонкам: нужен склону, чтобы его ступени начинались
        // ровно от поверхности, а не в воздухе.
        const groundTop = [];
        for (let tx = 0; tx < LEVEL[0].length; tx++) {
            groundTop[tx] = LEVEL.length * TILE;
            for (let ty = 0; ty < LEVEL.length; ty++) {
                if (LEVEL[ty][tx] === '#') { groundTop[tx] = ty * TILE; break; }
            }
        }
        LEVEL.forEach((row, ty) => {
            for (let tx = 0; tx < row.length; tx++) {
                const cell = row[tx];
                const x = tx * TILE + TILE / 2;
                const y = ty * TILE + TILE / 2;

                if (cell === '#') {
                    $('<wall>', { class: 'brick' }).at(x, y).size(TILE, TILE).appendTo($.world);
                } else if (cell === '=') {
                    // Односторонняя платформа: сверху держит, снизу и сбоку
                    // пропускает; спрыгивание — `.dropThrough()` или S/↓+Space
                    // во встроенном управлении.
                    $('<wall>', { class: 'oneway' }).at(x, y).size(TILE, 12)
                        .oneWay(true).appendTo($.world);
                } else if (cell === '/') {
                    buildSlope($, tx, groundTop);
                } else if (cell === 'F') {
                    $('<wall>', { class: 'mover' }).at(x, y).size(96, 16)
                        .body('kinematic').appendTo($.world);
                    state.platformHome = x;
                    state.platformRange = 4 * TILE;
                } else if (cell === 'P') {
                    $('<player>', { id: 'hero' }).at(x, y).size(26, 30)
                        .health(100)
                        .controls({ axis: 'both', coyote: 110, jumpBuffer: 130, jumpCut: 0.45 })
                        .collision(26, 30)
                        .attr({ jumpForce: 700 })
                        .appendTo($.world);
                }
            }
        });
    }

    /**
     * Склон из ступеней.
     *
     * Физического примитива «наклонный тайл» у движка нет (§42 даёт частичную
     * коллизию клетки, но не произвольный уклон), поэтому склон собирается из
     * статических боксов с шагом меньше тела игрока: контроллер проходит его
     * как непрерывную поверхность. Это тот самый приём, который Спецификация
     * называет допустимым («ступенчатые slopes» вместо нового примитива).
     */
    function buildSlope($, tx, groundTop) {
        // Наклонный уклон — один полигонный треугольник (`.shape('polygon', …)`),
        // а не лестница из боксов: у тела игрока есть трение, и вертикальный
        // уступ даже в 4 px его останавливает, а мельче шаг — это десятки тел
        // на склон. Треугольник даёт настоящую наклонную поверхность, поэтому
        // контроллер едет по ней так же, как по горизонтальному полу.
        //
        // Локальные точки полигона задаются от центра узла; узел ставим в
        // центр треугольника, чтобы числа в данных читались как мировые.
        const x0 = tx * TILE;                       // левый край клетки склона
        const yTop = groundTop[tx];                 // высота поверхности слева
        const yBottom = LEVEL.length * TILE;        // подошва уровня
        const x1 = x0 + TILE;                       // подъём на одну клетку вправо
        const y1 = groundTop[tx + 1] === undefined ? yTop - TILE : groundTop[tx + 1];
        const cx = (x0 + x1 + x0) / 3;
        const cy = (yTop + y1 + yBottom) / 3;
        $('<wall>', { class: 'slope' })
            .at(cx, cy)
            .body('static')
            .shape('polygon', [
                x0 - cx, yTop - cy,
                x1 - cx, y1 - cy,
                x0 - cx, yBottom - cy,
            ])
            .appendTo($.world);
    }

    // --- Движущаяся платформа ------------------------------------------------
    // Кинематическое тело ходит по отрезку; Box2D сам несёт того, кто на нём
    // стоит, а `.controls()` прибавляет скорость опоры к скорости игрока.
    function tickMovingPlatforms($) {
        $('.mover').each((i, platform) => {
            const t = $.time.now() * 0.7 + i * 0.9;
            platform.velocity(Math.cos(t) * state.platformRange * 0.7, 0);
            platform.x = state.platformHome + Math.sin(t) * state.platformRange;
        });
    }

    // --- Зоны камеры --------------------------------------------------------
    function tickZones($) {
        const hero = $('#hero');
        if (!hero.length) return;
        const p = hero.pos();
        let active = null;
        for (const zone of zones) {
            if (p.x >= zone.x && p.x <= zone.x + zone.w
                && p.y >= zone.y && p.y <= zone.y + zone.h) {
                active = zone;
            }
        }
        if (active && active.id !== state.zone) {
            state.zone = active.id;
            applyZone($, active);
        }
    }

    function applyZone($, zone) {
        $.camera.zoom(zone.zoom);
        $.camera.deadzone([40, 24]);
        $.camera.lookahead(zone.lookahead === undefined ? 70 : zone.lookahead);
        $.camera.limits(zone.x, zone.y, zone.w, zone.h);
    }

    // --- HUD ----------------------------------------------------------------
    function buildHud($) {
        $('<ui.panel>', { id: 'hud-bg' }).at(200, 54).size(380, 108)
            .color('#0d1220bb').appendTo($.ui);
        $('<ui.label>', { id: 'hud-move', size: 17, color: '#e8f0ff' }).at(24, 16).appendTo($.ui);
        $('<ui.label>', { id: 'hud-ground', size: 17, color: '#cfe0f5' }).at(24, 40).appendTo($.ui);
        $('<ui.label>', { id: 'hud-zone', size: 17, color: '#ffd54a' }).at(24, 64).appendTo($.ui);
        $('<ui.label>', { id: 'hud-pad', size: 17, color: '#9fb3cc' }).at(24, 88).appendTo($.ui);
    }

    function hud($, st) {
        const hero = $('#hero');
        if (!hero.length) return;
        const v = hero.velocity();
        const pads = typeof $.input.padCount === 'function' ? $.input.padCount() : 0;
        $('#hud-move').text(`Скорость: ${v.x.toFixed(0)}, ${v.y.toFixed(0)}`);
        $('#hud-ground').text(`Земля: ${hero.onFloor() ? 'да' : 'нет'} · стена: ${hero.onWall() ? 'да' : 'нет'}`);
        $('#hud-zone').text(`Зона камеры: ${st.zone}`);
        $('#hud-pad').text(`Геймпадов: ${pads} · движение: ${$.input.vec('both').x.toFixed(2)}`);
    }
}
