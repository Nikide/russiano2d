// ===========================================================================
// Пример §31-2 Спецификации: «Melee/contact».
//
// Один законченный сценарий на существующем `$` — окна анимации, несколько
// hurtbox у цели, отражение снаряда, физическая отдача и hit-фидбек:
//
//   * удар наносится ТОЛЬКО в окне анимации: клип `slash` объявляет маркеры
//     `window: 'attack'` / `windowPhase: 'open' | 'close'`, и по открытию окна
//     игра создаёт `$.combat.attack({...})`, а по закрытию — `endAttack()`;
//   * пока окно открыто, удар «щупает» hitbox каждый кадр, а дедупликация по
//     владельцу цели (§9) превращает несколько hurtbox в ОДИН gameplay-hit;
//   * снаряд `#shot` летит в героя; при поднятом щите (Shift) попадание в
//     область `guard` отражается: `$.combat.reflect()` даёт новую attack
//     identity, нового владельца и команду, снаряд летит обратно;
//   * отдача — импульс тела плюс канал внешней скорости (§8), поэтому её не
//     стирает `.controls()`, а стена останавливает тело: сквозь неё не пройти;
//   * hit-фидбек (hit-stop, тряска, вспышка, частицы) — `$.hitFx` по событию
//     `damage`: presentation не участвует в расчёте урона.
//
// Запуск и проверка — demos/melee/README.md, tests/agent/melee_test.py.
// Только `$`: ни `engine.*`, ни импорта внутренностей движка.
// ===========================================================================

const FLOOR_Y = 560;          // поверхность пола (верх плиты)
const PILLAR_X = 980;         // колонна: об неё проверяется отдача «в стену»
const SLASH_MS = 420;         // длина клипа удара
const WINDOW_OPEN_MS = 120;   // маркер открытия окна удара
const WINDOW_CLOSE_MS = 300;  // маркер закрытия
const SLASH_DAMAGE = 25;
const SLASH_IMPULSE = { x: 320, y: -40 };
const SHOT_SPEED = 430;
const SHOT_DAMAGE = 18;

export default function install($) {
    // Состояние примера. Счётчики продублированы в $.store: по ним агентский
    // тест проверяет поведение, не заглядывая внутрь сцены.
    const state = {
        hits: 0,            // принятых gameplay-попаданий
        damage: 0,          // суммарный применённый урон
        deaths: 0,          // смертей ровно по ответу damage
        feedback: 0,        // сколько раз сыграл presentation
        slashing: false,
        attack: null,       // текущая атака героя (данные §9)
        shot: null,         // атака снаряда
        reflected: 0,
    };

    $.scene.add('melee', {
        enter($) { enter($, state); },
        update(dt, $) { tick($, dt, state); },
    });
}

// ---------------------------------------------------------------------------
// Сцена
// ---------------------------------------------------------------------------

function enter($, state) {
    $.world.gravity(0, 1800).color('#101322')
           .bounds(0, -320, 1280, 900);

    buildArena($);
    buildHero($, state);
    buildEnemies($, state);
    buildAnimation($, state);
    buildHud($);

    state.hits = 0;
    state.damage = 0;
    state.deaths = 0;
    state.feedback = 0;
    state.reflected = 0;
    state.slashing = false;
    state.attack = null;
    state.shot = null;
    syncCounters($, state);
    $.store.set('feedback', true);

    $.camera.follow('#hero', { smooth: 0.2, deadzone: [60, 30], lookahead: 40, offset: [0, -40] });
    $.camera.limits(0, 0, 1280, 900);
}

function buildArena($) {
    // Пол и стены арены: динамические тела должны во что-то упираться, иначе
    // «отдача сквозь стену» нечего проверять.
    $('<wall>', { class: 'floor' }).at(640, FLOOR_Y + 40).size(1280, 80).appendTo($.world);
    $('<wall>', { class: 'wall' }).at(-8, 320).size(48, 640).appendTo($.world);
    $('<wall>', { class: 'wall' }).at(1288, 320).size(48, 640).appendTo($.world);
    // Колонна: в неё упирается отброшенный враг. Она нарочно низкая: тела на
    // полу (низ 560) задевают её верх (545), а снаряд летит выше и проходит.
    $('<wall>', { class: 'pillar' }).at(PILLAR_X, FLOOR_Y + 12).size(24, 54).appendTo($.world);
}

function buildHero($, state) {
    $('<player>', { id: 'hero' }).at(400, FLOOR_Y - 60).size(26, 30)
        .health(100).team(1)
        .controls({ axis: 'both', coyote: 100, jumpBuffer: 120, jumpCut: 0.5 })
        .collision(26, 30)
        .attr({ jumpForce: 700 })
        .appendTo($.world);

    // Роли форм (§9): движение — тело узла, удар — hitbox-область, щит —
    // отдельная область, которую включает Shift.
    $('#hero').hitbox('blade', { w: 54, h: 26, x: 32 });
    $('#hero').areaOn('blade', false);
    $('#hero').hitbox('guard', { w: 16, h: 46, x: -16 });
    $('#hero').areaOn('guard', false);
    // Герой тоже уязвим: без щита снаряд достаёт и его.
    $('#hero').hurtbox('body', { w: 26, h: 30 });
    subscribeDamage($, '#hero', state);
}

/** Узел-«получатель урона» с НЕСКОЛЬКИМИ hurtbox: удар должен быть один. */
function buildEnemies($, state) {
    buildHurtable($, 'grunt', 460, 100, true);
    buildHurtable($, 'brute', 900, 120, false);
    subscribeDamage($, '.hurtable', state);
    // Стрелок — источник снаряда; урон ему прилетает только отражённым.
    // Он слева от героя: снаряд летит ВДОЛЬ арены и не задевает меле-целей
    // справа, поэтому отражение проверяется чисто.
    $('<rect>', { id: 'shooter' }).at(120, FLOOR_Y - 22).size(32, 44)
        .health(60).team(3).body('static').collision(32, 44)
        .appendTo($.world)
        .hurtbox('torso', { w: 36, h: 44 });
    subscribeDamage($, '#shooter', state);
}

function buildHurtable($, id, x, hp, manyHurtboxes) {
    $('<rect>', { id, class: 'hurtable' })
        .at(x, FLOOR_Y - 22).size(32, 44)
        .health(hp).team(2)
        .body('dynamic').allowSleep(false)
        // Трение задаётся ДО .collision(): тело пересоздаётся и читает attrs.
        .attr({ friction: 0.6 })
        .collision(32, 44)
        .appendTo($.world);
    $('#' + id).hurtbox('torso', { w: 36, h: 30 });
    if (manyHurtboxes) {
        // Три формы одной цели: gameplay-hit обязан быть ОДИН.
        $('#' + id).hurtbox('head', { w: 18, h: 18, y: -22 });
        $('#' + id).hurtbox('legs', { w: 30, h: 18, y: 18 });
    }
}

// ---------------------------------------------------------------------------
// Анимация удара и gameplay-окно (§10/§41)
// ---------------------------------------------------------------------------

function buildAnimation($, state) {
    $.anim.clip('slash', {
        duration: SLASH_MS,
        loop: 'once',
        tracks: [
            { type: 'sprite', keys: [{ t: 0, v: 0 }, { t: WINDOW_OPEN_MS, v: 1 },
                                     { t: WINDOW_CLOSE_MS, v: 2 }, { t: SLASH_MS, v: 0 }] },
            { type: 'scale', axis: 'x', keys: [{ t: 0, v: 1 }, { t: WINDOW_OPEN_MS, v: 1.18 },
                                               { t: SLASH_MS, v: 1 }] },
        ],
        events: [
            // Окно атаки: игра открывает удар не «пока играет клип», а по
            // маркерам — ровно 180 мс из 420.
            { at: WINDOW_OPEN_MS, name: 'attack-open', window: 'attack', windowPhase: 'open' },
            { at: WINDOW_CLOSE_MS, name: 'attack-close', window: 'attack', windowPhase: 'close' },
        ],
    });

    const player = $.anim.player('hero').target('#hero');
    player.on('window', (e) => {
        const open = !!(e.window && e.window.open);
        $('#hero').areaOn('blade', open);
        if (open) {
            state.attack = $.combat.attack({
                source: '#hero', owner: '#hero', team: 1,
                amount: SLASH_DAMAGE, damageType: 'slash',
                window: WINDOW_CLOSE_MS - WINDOW_OPEN_MS,
                rehit: 'once',
                impulse: SLASH_IMPULSE,
                data: { zone: 'chest' },
            });
        } else if (state.attack) {
            $.combat.endAttack(state.attack);
            state.attack = null;
        }
    });
    player.on('finished', () => { state.slashing = false; });
}

// ---------------------------------------------------------------------------
// Кадр
// ---------------------------------------------------------------------------

function tick($, dt, state) {
    const hero = $('#hero');
    if (!hero.length) return;
    const player = $.anim.player('hero');

    // --- Атака: только по окну анимации -------------------------------------
    if ($.input.pressed('space') && !state.slashing) {
        state.slashing = true;
        player.play('slash');
    }
    if (state.attack && player.window('attack')) {
        // Каждый кадр окна удар «щупает» hitbox: попадание возможно и тогда,
        // когда цель вошла в него уже после открытия окна.
        $.combat.strike(state.attack, hero.areaOverlap('blade'), { zone: 'chest' });
    }

    // --- Щит и снаряд --------------------------------------------------------
    const guarding = $.input.down('shift');
    hero.areaOn('guard', guarding);

    if ($.input.pressed('j') && !$('#shot').length) spawnShot($, state);

    const shot = $('#shot');
    if (shot.length && state.shot) {
        const guardHits = guarding ? hero.areaOverlap('guard') : [];
        const blocked = guardHits.some((c) => c.node && c.node.attr('id') === 'shot');
        if (blocked) {
            reflectShot($, state, shot);
        } else {
            const res = $.combat.strike(state.shot, shot.areaOverlap('body'));
            if (res.accepted > 0) { shot.remove(); state.shot = null; }
        }
        // Снаряд улетел за арену — убираем, чтобы пример не копил тела.
        if (shot.length && (shot.pos().x < 0 || shot.pos().x > 1280)) {
            shot.remove();
            state.shot = null;
        }
    }

    hud($, state);
}

function spawnShot($, state) {
    $('<circle>', { id: 'shot' }).at(180, FLOOR_Y - 34).size(14, 14)
        .collisionCircle(7)
        .body('dynamic').gravity(false).allowSleep(false)
        // Снаряд — sensor: тела он не толкает, попадание считает gameplay
        // (areaOverlap + §9). Физический CCD-снаряд, который останавливают
        // стены, показан в tests/agent/highlevel_ccd_test.py (§7).
        .sensor(true)
        .appendTo($.world)
        .hitbox('body', { w: 22, h: 22 })
        .velocity(SHOT_SPEED, 0);
    state.shot = $.combat.attack({
        source: '#shooter', owner: '#shooter', team: 3,
        amount: SHOT_DAMAGE, damageType: 'bullet',
        window: 6000, rehit: 'once',
    });
}

/** Отражение: новая identity, новый владелец и команда — по явному правилу. */
function reflectShot($, state, shot) {
    const reflected = $.combat.reflect(state.shot, {
        source: '#hero', owner: '#hero', team: 1,
        multiplier: 1.5, damageType: 'bullet',
    });
    state.shot = reflected;
    state.reflected++;
    $.store.set('reflected', state.reflected);
    // Данные отражённой атаки — в $.store: тест проверяет смену владельца,
    // команды и то, что журнал попаданий ведёт движок, а не игра.
    $.store.set('reflect', {
        id: reflected.id, from: reflected.reflectedFrom, reflected: !!reflected.reflected,
        owner_id: reflected.owner_id, source_id: reflected.source_id, team: reflected.team,
        hits: reflected.hits.length,
    });
    // Данные игры: цвет и направление снаряда — presentation, но владение
    // снарядом меняется по тому же правилу, что и attack identity.
    shot.attr('team', 1);
    shot.color('#7fe0ff');
    shot.velocity(-SHOT_SPEED * 1.25, 0);
    if ($.sound && typeof $.sound.play === 'function' && $.store.get('sound', false)) {
        // Ассеты в пример не входят: строка ниже — точка подключения звука.
        $.sound.play('assets/audio/sfx/pickup_01.ogg');
    }
}

// ---------------------------------------------------------------------------
// Урон → счётчики и presentation
// ---------------------------------------------------------------------------

/** Обработчики 'damage' вешаются один раз на узел: узел помнит свою подписку. */
function subscribeDamage($, selector, state) {
    $(selector).each((i, node) => {
        if (node.attr('melee_subscribed')) return;
        node.attr('melee_subscribed', true);
        node.on('damage', (e) => onDamage($, state, e));
    });
}

function onDamage($, state, e) {
    const res = e.data || {};
    if (!res.accepted) return;
    state.hits++;
    state.damage += res.applied;
    if (res.death) state.deaths++;
    syncCounters($, state);

    // Presentation: hit-stop, тряска, вспышка, частицы. Источник урона —
    // ответ §9, а не эффект: выключение фидбека не меняет ни урон, ни hits.
    // $.hits играет ПРЯМО по ответу — точка и цель берутся из него самого,
    // собирать `{ x, y, self }` руками не нужно.
    if ($.store.get('feedback', true) === false) return;
    if (typeof $.hitFx !== 'function') return;
    state.feedback++;
    $.store.set('feedbackPlays', state.feedback);
    $.hitFx(res, res.death ? 'death' : 'crit');
}

function syncCounters($, state) {
    $.store.set('hits', state.hits);
    $.store.set('damage', state.damage);
    $.store.set('deaths', state.deaths);
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------

function buildHud($) {
    $('<ui.panel>', { id: 'hud-bg' }).at(200, 44).size(400, 76)
        .color('#0d1220bb').appendTo($.ui);
    $('<ui.label>', { id: 'hud-hits', size: 17, color: '#e8f0ff' }).at(20, 14).appendTo($.ui);
    $('<ui.label>', { id: 'hud-window', size: 17, color: '#ffd54a' }).at(20, 38).appendTo($.ui);
    $('<ui.label>', { id: 'hud-hint', size: 15, color: '#9fb3cc' }).at(20, 62).appendTo($.ui);
}

function hud($, state) {
    const player = $.anim.player('hero');
    $('#hud-hits').text(`Удары: ${state.hits} · урон: ${state.damage} · смертей: ${state.deaths}`);
    $('#hud-window').text(`Окно удара: ${player.window('attack') ? 'открыто' : 'закрыто'}`
        + ` · отражено: ${state.reflected}`);
    $('#hud-hint').text('Space — удар · Shift — щит · J — выстрел · A/D — шаг');
}
