// ===========================================================================
// Stress-стенд §35.2 Спецификации производственной готовности.
//
// Набор сцен, которые по отдельности нагружают подсистемы: физику и контакты,
// тайлмап, альфу и VFX, свет и тени, интерфейс. Числа объектов — предложенные
// Спецификацией точки измерения (§35.2): 200 противников, 500 снарядов,
// 5 000 частиц, 32 света, большая карта с видимой и невидимой частью.
//
// Запуск:
//   ./build/russiano2d --game demos/stress --scene physics
//   ./build/russiano2d --game demos/stress --scene tilemap
//   ./build/russiano2d --game demos/stress --scene vfx
//   ./build/russiano2d --game demos/stress --scene lights
//   ./build/russiano2d --game demos/stress --scene ui
//   ./build/russiano2d --game demos/stress --scene all
//
// Замер (перцентили frame time, CPU-зоны, счётчики) делает
// tools/bench_stress.py: он гоняет сцену агентом и читает факты профайлера.
//
// Стенд ничего не «оптимизирует» и не подменяет профиль: он создаёт ровно
// заявленное число объектов и отдаёт счётчики. Результат измерения — отдельно.
// ===========================================================================

/** Сколько объектов создавать. Числа из §35.2. */
export const COUNTS = {
    enemies: 200,
    projectiles: 500,
    particles: 5000,
    lights: 32,
    tilemapCols: 200,
    tilemapRows: 100,
};

const TILE = 32;

/** Общая часть: мир, камера, HUD со счётчиками. */
function setup($, title) {
    $.world.gravity(0, 1200).color('#0e1420');
    $.camera.follow('#focus', { smooth: 0, lookahead: 0 });

    $('<ui.panel>', { id: 'bench-bg' }).at(220, 40).size(400, 76)
        .color('#0d1220cc').appendTo($.ui);
    $('<ui.label>', { id: 'bench-title', size: 18, color: '#ffd54a' })
        .at(24, 14).appendTo($.ui).text(title);
    $('<ui.label>', { id: 'bench-counts', size: 16, color: '#cfe0f5' })
        .at(24, 42).appendTo($.ui);

    // Точка, за которой следит камера: движется по кругу, чтобы кадр не
    // «застывал» и отсечение работало как в игре.
    $('<rect>', { id: 'focus' }).at(0, 0).size(2, 2).color('#00000000').appendTo($.world);
}

function counters($) {
    // Частицы считаем у каждого эмиттера: `$.particles.count()` — метод узла,
    // а не подсистемы, поэтому на пустой выборке он не отвечает.
    let particles = 0;
    try { $('.fx').each((i, e) => { particles += e.count(); }); } catch (e) { particles = -1; }
    return {
        nodes: $.world.count(),
        bodies: $.debug.limits ? $.debug.limits().bodies : -1,
        particles,
        lights: $('light').length,
    };
}

function tickFocus($, radius = 600) {
    const t = $.time.realNow() * 0.4;
    $('#focus').at(Math.cos(t) * radius, 300 + Math.sin(t) * 120);
}

function hud($, title, scene) {
    const c = counters($);
    $('#bench-counts').text(`узлов ${c.nodes} · тел ${c.bodies} · частиц ${c.particles} · свет ${c.lights} · ${scene}`);
}

export default function install($) {
    // 1. Физика и контакты: много динамических тел, часть из них сталкивается.
    $.scene.add('physics', {
        enter($) {
            setup($, 'Физика и контакты');
            const cols = Math.ceil(Math.sqrt(COUNTS.enemies));
            for (let i = 0; i < COUNTS.enemies; i++) {
                const x = (i % cols) * 24 + 40;
                const y = Math.floor(i / cols) * 24 + 40;
                $('<rect>', { class: 'mob' }).at(x, y).size(10, 10)
                    .body('dynamic').attr({ density: 1, friction: 0.4, restitution: 0.1 })
                    .appendTo($.world);
            }
            for (let i = 0; i < COUNTS.projectiles; i++) {
                $('<rect>', { class: 'bullet' }).at(40 + (i % 50) * 6, 620).size(4, 4)
                    .body('dynamic').bullet(true).attr({ density: 0.2 })
                    .velocity((i % 7 - 3) * 200, -400 - (i % 5) * 60)
                    .appendTo($.world);
            }
            // Пол, чтобы телам было во что упереться.
            $('<wall>', { class: 'floor' }).at(500, 700).size(1400, 40).appendTo($.world);
            $.world.bounds(0, 0, 1000, 800);
        },
        update(dt, $) { tickFocus($); hud($, 'Физика и контакты', 'physics'); },
    });

    // 2. Тайлмап: большая карта, видимая и невидимая часть.
    $.scene.add('tilemap', {
        enter($) {
            setup($, 'Тайлмап 200×100');
            const rows = [];
            for (let y = 0; y < COUNTS.tilemapRows; y++) {
                let row = '';
                for (let x = 0; x < COUNTS.tilemapCols; x++) {
                    row += (y % 7 === 0 || x % 11 === 0) ? '#' : '.';
                }
                rows.push(row);
            }
            $.tilemap.fromASCII(rows, { '#': 1, '.': 0 },
                { id: 'map', tile: TILE, solid: true }).at(0, 0);
        },
        update(dt, $) { tickFocus($, 900); hud($, 'Тайлмап 200×100', 'tilemap'); },
    });

    // 3. VFX и альфа: 5 000 частиц в нескольких эмиттерах плюс спрайты.
    $.scene.add('vfx', {
        enter($) {
            setup($, 'Частицы и альфа');
            for (let i = 0; i < 20; i++) {
                $('<particles>', { class: 'fx' })
                    .at(60 + i * 46, 300)
                    .params({
                        amount: Math.floor(COUNTS.particles / 20),
                        one_shot: false,
                        speed: [40, 160],
                        lifetime: [600, 1400],
                        size: [2, 5],
                        gravity: [0, 220],
                        spread: 360,
                        direction: 0,
                        max_particles: 400,
                    })
                    .emitting(true)
                    .appendTo($.world);
            }
            for (let i = 0; i < 200; i++) {
                $('<sprite>', { class: 'deco' }).at((i % 20) * 48, 420 + Math.floor(i / 20) * 12)
                    .size(24, 24).alpha(0.6).color('#7fd1ff').appendTo($.world);
            }
        },
        update(dt, $) { tickFocus($, 500); hud($, 'Частицы и альфа', 'vfx'); },
    });

    // 4. Свет и тени: 32 источника и набор окклюдеров, часть — вне кадра.
    $.scene.add('lights', {
        enter($) {
            setup($, 'Свет и тени');
            for (let i = 0; i < COUNTS.lights; i++) {
                const angle = (i / COUNTS.lights) * Math.PI * 2;
                $('<light>').at(500 + Math.cos(angle) * (160 + (i % 4) * 90),
                                320 + Math.sin(angle) * (120 + (i % 3) * 60))
                    .radius(140 + (i % 5) * 40)
                    .color(i % 2 ? '#ffd27f' : '#7fd1ff')
                    .intensity(0.7)
                    .appendTo($.world);
            }
            for (let i = 0; i < 60; i++) {
                $('<wall>', { class: 'occluder' }).at(200 + i * 14, 240).size(10, 200).appendTo($.world);
            }
            for (let i = 0; i < 60; i++) {
                $('<wall>', { class: 'occluder' }).at(200 + i * 14, 520).size(10, 200).appendTo($.world);
            }
        },
        update(dt, $) { tickFocus($, 300); hud($, 'Свет и тени', 'lights'); },
    });

    // 5. Интерфейс: много узлов <ui.*> — проверка цены UI-прохода.
    $.scene.add('ui', {
        enter($) {
            setup($, 'Интерфейс');
            for (let i = 0; i < 300; i++) {
                $('<ui.panel>', { class: 'ui-many' })
                    .at(10 + (i % 30) * 41, 120 + Math.floor(i / 30) * 26)
                    .size(36, 20).color(i % 2 ? '#1b2740' : '#243354')
                    .appendTo($.ui);
            }
            for (let i = 0; i < 60; i++) {
                $('<ui.label>', { class: 'ui-many-label' })
                    .at(10 + (i % 30) * 41, 120 + Math.floor(i / 30) * 26)
                    .size(12).color('#cfe0f5').text(String(i))
                    .appendTo($.ui);
            }
        },
        update(dt, $) { tickFocus($, 400); hud($, 'Интерфейс', 'ui'); },
    });

    // 6. Всё вместе: смешанная сцена — «согласованная игровая сцена» §35.2.
    $.scene.add('all', {
        enter($) {
            setup($, 'Смешанная сцена');
            for (let i = 0; i < 60; i++) {
                $('<rect>', { class: 'mob' }).at(100 + (i % 12) * 60, 200 + Math.floor(i / 12) * 40)
                    .size(14, 14).body('dynamic').appendTo($.world);
            }
            for (let i = 0; i < 120; i++) {
                $('<rect>', { class: 'bullet' }).at(60 + (i % 40) * 8, 640).size(4, 4)
                    .body('dynamic').bullet(true).velocity((i % 5 - 2) * 160, -300).appendTo($.world);
            }
            for (let i = 0; i < 8; i++) {
                $('<particles>', { class: 'fx' }).at(120 + i * 130, 280)
                    .params({ amount: 120, speed: [40, 140], lifetime: [500, 1200], size: [2, 4],
                                 max_particles: 400, spread: 360, direction: 0 })
                    .emitting(true).appendTo($.world);
            }
            for (let i = 0; i < 12; i++) {
                $('<light>').at(120 + i * 90, 260).radius(160).color('#ffd27f').intensity(0.6)
                    .appendTo($.world);
            }
            $('<wall>', { class: 'floor' }).at(600, 700).size(1200, 40).appendTo($.world);
        },
        update(dt, $) { tickFocus($, 500); hud($, 'Смешанная сцена', 'all'); },
    });

    // Счётчики для стенда: агент читает их одним запросом.
    $.agent.expose('counts', () => counters($));
    $.agent.expose('count_targets', () => COUNTS);
}
