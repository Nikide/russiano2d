// ===========================================================================
// Общая «сцена уровня» для платформера.
//
// Зачем модуль: три уровня кампании отличаются ТОЛЬКО данными (ASCII-карта,
// палитра, скорость врагов). Всё остальное — сборка мира, параллакс-фон,
// ловушки, чекпойнты, шипы, движущиеся платформы, ворота и правила уровня —
// живёт здесь, поэтому новый уровень добавляется файлом данных, а не копией
// логики (принцип «игра — это код и данные», docs/PHILOSOPHY.md §1).
//
// Тайл 32x32. Легенда карты:
//   #  земля/стена (статичное тело)      =  односторонняя платформа
//   ^  шипы (урон при касании)            o  монета
//   E  патрульный враг                    C  ящик (динамическое тело)
//   F  движущаяся платформа (влево-вправо)
//   K  чекпойнт (точка возрождения)       P  старт игрока
//   X  ворота: открываются, когда собраны все монеты
//   .  пусто
//
// Что уровень отдаёт наружу: объект с update(dt, $), check($) и полями
// состояния (монеты, время, статус). Сцена кампании (game/scenes/*.js) только
// вызывает их и рисует HUD — так HUD и правила не дублируются на каждом уровне.
// ===========================================================================

export const TILE = 32;

// Кадры атласа: полоса 4 тайла по 32 px (tools/make_atlas.py).
const FRAME = { ground: 1, crate: 2, coin: 3, player: 0 };

/** Превратить ASCII-карту в массив строк, достроив недостающие пробелы. */
function normalizeRows(rows) {
    const width = rows.reduce((w, r) => Math.max(w, r.length), 0);
    return rows.map((r) => r.padEnd(width, '.'));
}

/**
 * Создать уровень по описанию.
 *
 * spec: {
 *   id, rows,                 — идентификатор и ASCII-карта
 *   sky, ground, hill,        — цвета фона/земли/дальних холмов
 *   coinGoal,                 — сколько монет открывает ворота (по умолчанию все)
 *   enemySpeed, gravity,      — необязательные настройки
 * }
 */
export function makeLevel(spec) {
    const rows = normalizeRows(spec.rows);
    const cols = rows[0].length;
    const width = cols * TILE;
    const height = rows.length * TILE;
    const gravity = spec.gravity === undefined ? 1800 : spec.gravity;
    const enemySpeed = spec.enemySpeed === undefined ? 45 : spec.enemySpeed;

    const state = {
        id: spec.id,
        cols, rows: rows.length, width, height,
        coins: 0, totalCoins: 0, goal: 0,
        time: 0, deaths: 0, done: false, failed: false,
        checkpoint: null, checkpointTaken: false,
        platforms: [],      // движущиеся платформы: [node, halfRange, phase, speed]
        bobbers: [],        // плавающие монеты: [node, baseY, phase]
        spawn: { x: TILE * 2, y: TILE * 2 },
    };

    // --- Фон: небо, дальние холмы, облака -----------------------------------
    // Слои рисуются до мира (layer < 0) и параллаксят по-разному: холмы идут
    // медленнее мира, облака — ещё медленнее. Коэффициент 0 — «приколот к
    // экрану», 1 — «как мир» (docs/highlevel/layers.md).
    function buildBackground($) {
        const clouds = $('<layer>', { name: 'clouds', order: -30 }).appendTo($.world);
        const hills = $('<layer>', { name: 'hills', order: -20 }).appendTo($.world);

        for (let i = 0; i < 14; i++) {
            const x = 120 + i * 260;
            const y = 70 + (i % 3) * 46;
            $('<rect>', { class: 'cloud' }).at(x, y).size(150 + (i % 4) * 40, 34)
                .color(i % 2 ? '#2b3a5c' : '#33456b')
                .parallax(0.25)
                .appendTo(clouds);
        }
        for (let i = 0; i < 12; i++) {
            const x = i * 260 - 40;
            const h = 150 + (i % 5) * 60;
            $('<rect>', { class: 'hill' }).at(x, height - h / 2 + 30).size(300, h)
                .color(spec.hill || '#1b2740')
                .parallax(0.55)
                .appendTo(hills);
        }
    }

    // --- Мир ----------------------------------------------------------------
    function buildWorld($) {
        const world = $('<layer>', { name: 'world', order: 0 }).appendTo($.world);

        rows.forEach((row, ty) => {
            for (let tx = 0; tx < row.length; tx++) {
                const cell = row[tx];
                const x = tx * TILE + TILE / 2;
                const y = ty * TILE + TILE / 2;
                if (cell === '.') continue;

                if (cell === '#') {
                    $('<wall>', { class: 'brick' }).at(x, y).size(TILE, TILE)
                        .sprite({ src: 'assets/atlas.png', cols: 4, rows: 1, cw: TILE, ch: TILE })
                        .frame(FRAME.ground)
                        .color(spec.ground || '#ffffff')
                        .appendTo(world);
                } else if (cell === '=') {
                    // Односторонняя платформа: сверху стоит, снизу и сбоку
                    // проходит. Форма — тонкая плита, чтобы «верх» был очевиден.
                    $('<wall>', { class: 'platform' }).at(x, y).size(TILE, 12)
                        .oneWay(true)
                        .color(spec.platform || '#7d6b52')
                        .appendTo(world);
                } else if (cell === '^') {
                    $('<wall>', { class: 'spike' }).at(x, y + 6).size(TILE - 8, 20)
                        .sensor(true)
                        .color('#ff5d5d')
                        .attr({ damage: 25, spike: true })
                        .appendTo(world);
                } else if (cell === 'C') {
                    // Плотность и трение — в конструктор: Box2D читает их один раз,
                    // при создании тела, поэтому .attr() после .body() ничего бы не
                    // изменил (раньше это молчало — §6.6 плана дополировки).
                    $('<rect>', { class: 'crate', density: 0.8, friction: 0.5 })
                        .at(x, y).size(TILE, TILE)
                        .body('dynamic')
                        .sprite({ src: 'assets/atlas.png', cols: 4, rows: 1, cw: TILE, ch: TILE })
                        .frame(FRAME.crate)
                        .appendTo(world);
                } else if (cell === 'o') {
                    state.totalCoins++;
                    const coin = $('<sprite>', { class: 'coin' }).at(x, y).size(18, 18)
                        .sprite({ src: 'assets/atlas.png', cols: 4, rows: 1, cw: TILE, ch: TILE })
                        .frame(FRAME.coin)
                        .appendTo(world)
                        .on('pickup', (e) => collectCoin($, e.self));
                    state.bobbers.push([coin, y, (tx + ty) * 0.7]);
                } else if (cell === 'E') {
                    $('<enemy>', { class: 'walker' }).at(x, y).size(28, 30)
                        .sprite({ src: 'assets/atlas.png', cols: 4, rows: 1, cw: TILE, ch: TILE })
                        .frame(FRAME.player)
                        .color('#ff8b6b')
                        .appendTo(world)
                        .attr({ dir: 1, speed: enemySpeed });
                } else if (cell === 'F') {
                    const platform = $('<wall>', { class: 'mover' }).at(x, y).size(96, 16)
                        .body('kinematic')
                        .color('#5f8dd3')
                        .appendTo(world);
                    state.platforms.push([platform, 3.2 * TILE, 0, 0.6]);
                } else if (cell === 'K') {
                    // Флаг чекпойнта — обычный узел-метка. Тело ему не нужно:
                    // срабатывание считает update() по расстоянию, поэтому
                    // чекпойнт ловится независимо от того, бежит игрок или
                    // падает сквозь него на большой скорости.
                    $('<sprite>', { class: 'checkpoint' }).at(x, y).size(12, 40)
                        .color('#63d6a0')
                        .appendTo(world);
                } else if (cell === 'X') {
                    const gate = $('<wall>', { id: 'exit', class: 'gate' }).at(x, y).size(TILE, TILE * 2)
                        .sensor(true)
                        .color('#3a4a6b')
                        .appendTo(world)
                        .attr({ closed: true });
                    state.gate = gate;
                } else if (cell === 'P') {
                    state.spawn = { x, y };
                }
            }
        });

        $('<player>', { id: 'hero' }).at(state.spawn.x, state.spawn.y).size(26, 30)
            .sprite({ src: 'assets/atlas.png', cols: 4, rows: 1, cw: TILE, ch: TILE })
            .frame(FRAME.player)
            .health(100)
            .controls(spec.controls || { axis: 'both', coyote: 100, jumpBuffer: 120, jumpCut: 0.45 })
            .collision(26, 30)
            .attr({ jumpForce: 700, dir: 1 })
            .appendTo(world)
            .on('hit', (e) => onHurt($, e))
            .on('death', () => onDeath($));
    }

    // --- Правила ------------------------------------------------------------
    function collectCoin($, coin) {
        $.sound.playAt('assets/audio/sfx/pickup_01.ogg', coin);
        coin.remove();
        state.coins++;
        if (state.coins >= state.goal && state.gate && state.gate.attr('closed')) {
            state.gate.attr('closed', false).color('#ffd54a');
            $.camera.shake(4, 160);
            $.sound.play('assets/audio/sfx/pickup_01.ogg', { volume: 1 });
        }
    }

    function onHurt($, event) {
        // Отклик удара: тряска, вспышка, короткий hit-stop и красная вспышка
        // экрана. Всё это — существующие подсистемы ($.camera, $.time, $.hits),
        // вызываем их в одном месте, чтобы новый уровень не забыл про отклик.
        const hero = event.self;
        $.camera.shake(6, 220);
        hero.flash('#ff5555', 140);
        // $.hits.play — общий обработчик удара: искры, вспышка узла, вспышка
        // экрана, тряска, hit-stop, отдача, squash. Если модуля нет (старая
        // сборка), остаются тряска и вспышка выше — отклик не пропадает.
        if ($.hits && typeof $.hits.play === 'function') {
            $.hits.play(hero, { preset: 'hit', shake: 0 });
        } else if ($.time && typeof $.time.hitStop === 'function') {
            $.time.hitStop(70);
            $.fx.flash('#ff3b30', { ms: 90, alpha: 0.22 });
        }
    }

    function onDeath($) {
        if (state.done) return;
        state.deaths++;
        $.sound.play('assets/audio/sfx/hurt_01.ogg', { volume: 0.9 });
        const hero = $('#hero');
        if (!hero.length) return;
        const p = state.checkpoint || state.spawn;
        hero.at(p.x, p.y);
        hero.velocity(0, 0);
        hero.hp(100);
        hero.flash('#ffffff', 200);
        $.camera.shake(8, 260);
    }

    /** Телепорт в точку возрождения: и чекпойнт, и падение в яму. */
    function respawn($, penalty) {
        const hero = $('#hero');
        if (!hero.length) return;
        const p = state.checkpoint || state.spawn;
        hero.at(p.x, p.y).velocity(0, 0);
        if (penalty) hero.damage(penalty);
        $.camera.shake(5, 180);
    }

    function update(dt, $) {
        if (state.done) return;
        state.time += dt;

        const hero = $('#hero');
        if (!hero.length) return;
        const hp = hero.hp();

        // Монеты: подбор по касанию + лёгкое покачивание.
        $('.coin').each((i, c) => {
            if (c.distanceTo(hero) < 30) c.emit('pickup');
        });
        for (let i = 0; i < state.bobbers.length; i++) {
            const [node, baseY, phase] = state.bobbers[i];
            if (node.removed) continue;
            node.y = baseY + Math.sin(state.time * 2.4 + phase) * 3;
        }

        // Шипы: сенсор, поэтому урон наносим сами, раз в 0.6 с.
        $('.spike').each((i, spike) => {
            if (spike.distanceTo(hero) > 26) return;
            if (state.time - (spike.attr('last_hit') || -10) < 0.6) return;
            spike.attr('last_hit', state.time);
            hero.damage(spike.attr('damage') || 20);
            // Отбрасывание шипом: сами задаём скорость (у .knockAway в этой
            // сборке нет — отдача телу живёт в $.hits.knockback).
            const dir = hero.x < spike.x ? -1 : 1;
            hero.velocity(dir * 200, -320);
        });

        // Патрульные враги: разворот у стены, нанесение урона при касании.
        let touching = false;
        $('.walker').each((i, e) => {
            if (!e.alive()) { e.remove(); return; }
            // Разворот у стены. Проверки «на краю» (.onLedge) в этом движке нет:
            // враг без стены честно идёт до края и падает — так уровень и
            // проектируется (под патрульными всегда есть пол).
            if (e.onWall()) e.attr('dir', -e.attr('dir'));
            e.velocity(e.attr('dir') * enemySpeed, e.velocity().y);
            e.flip(e.attr('dir') < 0, false);
            if (e.distanceTo(hero) < 32) touching = true;
        });
        if (touching && state.time - (state.last_touch || -10) > 0.5) {
            state.last_touch = state.time;
            hero.damage(10);
            const enemy = $('.walker').get(0);
            if (enemy) hero.velocity(hero.x < enemy.x ? -180 : 180, -240);
        }

        // Движущиеся платформы: кинематическое тело ходит по отрезку и несёт
        // то, что на нём стоит (Box2D сам передаёт импульс опоре).
        for (let i = 0; i < state.platforms.length; i++) {
            const [node, range, phase, speed] = state.platforms[i];
            if (node.removed) continue;
            const t = state.time * speed + phase;
            const offset = Math.sin(t) * range;
            node.velocity(Math.cos(t) * range * speed, 0);
            // Страховка от накопления ошибки: подправляем позицию к ожидаемой.
            const target = node.attr('home_x');
            if (target === undefined) node.attr('home_x', node.x);
            node.x = (target === undefined ? node.x : target) + offset;
        }

        // Чекпойнты: касание запоминает точку возрождения (один раз на флаг).
        $('.checkpoint').each((i, flag) => {
            if (flag.attr('taken')) return;
            if (flag.distanceTo(hero) > 34) return;
            flag.attr('taken', true).color('#d8ffe9');
            const p = hero.pos();
            state.checkpoint = { x: p.x, y: p.y };
            state.checkpointTaken = true;
            $.sound.play('assets/audio/sfx/pickup_01.ogg', { volume: 0.7 });
            $.fx.pulse(p.x, p.y, { radius: 40, ms: 260, color: '#63d6a0' });
        });

        // Проверка падения в яму: уровень строится так, что провал = смерть.
        if (hero.y > height + 80 || hero.y < -320) respawn($, 20);

        // Ворота: открыты и игрок дошёл — уровень пройден.
        if (state.gate && !state.gate.attr('closed') && hero.distanceTo(state.gate) < 42) {
            state.done = true;
            $.camera.shake(4, 200);
        }

        // Камера не должна выезжать за пределы уровня.
        $.camera.limits(0, 0, width, height);
        if (hp <= 0) onDeath($);
    }

    function build($) {
        state.coins = 0;
        state.goal = spec.coinGoal === undefined ? state.totalCoins : spec.coinGoal;
        state.done = false;
        state.checkpoint = null;
        state.checkpointTaken = false;
        state.platforms.length = 0;
        state.bobbers.length = 0;
        state.totalCoins = 0;
        buildBackground($);
        buildWorld($);
        if (spec.coinGoal === undefined) state.goal = state.totalCoins;
        $.camera.follow('#hero', { smooth: 0.16, offset: [0, -40], lookahead: 60 });
        return state;
    }

    return { state, build, update, spec };
}
