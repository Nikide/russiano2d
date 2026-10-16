// ===========================================================================
// Пример §31-3 Спецификации: «Pattern arena».
//
// Законченный сценарий на существующем `$`: арена с волнами и боссом, фазы по
// явным правилам (HP/таймер/маркер), отменяемая фаза без «отложенных
// выстрелов», пул врагов и снарядов, пауза по выбранным часам и смерть с
// рестартом без утечек. Ничего кроме `$`: ни импорта внутренностей движка, ни
// `engine.*`.
//
// Запуск:
//   ./build/russiano2d --game demos/arena
//   python3 tools/run_tests.py arena_test          // автоматическая проверка
//
// Что проверяется автоматически:
//   * HP/таймер/маркер меняют фазу по явным правилам;
//   * interrupt отменяет фазу: после него за 90 кадров ни одного нового
//     снаряда (deferred shots не остаются);
//   * 120+ спавнов из пула не растят узлы: пул переиспользует created;
//   * пауза останавливает таймеры фазы и снаряды, resume продолжает без потерь;
//   * смерть считается один раз, после неё фазы молчат;
//   * restart возвращает узлы/тела/подписки/таймеры к исходным числам, а
//     прогресс волн начинается заново (явное правило).
// ===========================================================================

const W = 1280;
const H = 720;

// Фазы — открытые данные: id, порог HP, длительность, интервал действий,
// сколько врагов и снарядов за раз. Порядок — от «здорового» босса к «злому».
const PHASES = [
    { id: 'prepare', hpMax: 101, duration: 900, spawns: 2, shots: 0, label: 'Подготовка' },
    { id: 'volley', hpMax: 75, duration: 1400, interval: 320, spawns: 0, shots: 1, label: 'Залп' },
    { id: 'summon', hpMax: 50, duration: 1600, interval: 500, spawns: 3, shots: 0, label: 'Призыв' },
    { id: 'burst', hpMax: 25, duration: 1400, interval: 200, spawns: 1, shots: 3, label: 'Шквал' },
];

const IDS = PHASES.map((p) => p.id);

export default function install($) {
    const state = {
        hp: 100,
        phase: 'idle',
        wave: 0,
        phases: 0,
        spawned: 0,
        shots: 0,
        deaths: 0,
        interrupts: 0,
        phaseCancels: 0,
        paused: false,
        playerDead: false,
        hpPlayer: 100,
        lastCancel: null,
        marker: null,
        hits: 0,          // подписки арены: проверяют, что restart не копит их
        heartbeat: 0,     // scoped-таймер арены
    };
    if ($.agent && typeof $.agent.expose === 'function') {
        $.agent.expose('arena', () => state);
    }

    const player = { x: W / 2, y: H - 80 };
    let phaseScope = null;
    let phaseSerial = 0;

    // --- Пул: враги и снаряды ------------------------------------------------
    // Пул переиспользует узлы и выключает их тела: 120+ спавнов не растят
    // ни узлы, ни тела Box2D. `initial: 0` — узлы заводятся по требованию.
    $.pool.create({
        name: 'arena-minions', tag: 'enemy', max: 48, initial: 0,
        w: 18, h: 18, hp: 10, speed: 70, color: '#ff7a7a',
    });
    $.pool.create({
        name: 'arena-shots', tag: 'bullet', max: 64, initial: 0,
        w: 8, h: 8, color: '#ffd34d', gravity: false,
    });

    function releaseAll() {
        $.pool.releaseAll('arena-minions');
        $.pool.releaseAll('arena-shots');
    }

    /** Текущая точка игрока: узел мог уехать управлением. */
    function playerPos() {
        const node = $('#player');
        return node.length ? node.pos() : { x: player.x, y: player.y };
    }

    function spawnWave(count) {
        const me = playerPos();
        let made = 0;
        for (let i = 0; i < count; i++) {
            const side = i % 4;
            const x = side === 0 ? 40 : (side === 1 ? W - 40 : 120 + (i * 37) % (W - 240));
            const y = side < 2 ? 80 + (i * 53) % (H - 200) : (side === 2 ? 80 : H - 160);
            const node = $.pool.spawn('arena-minions', { x, y });
            if (!node.length) break;                    // пул исчерпан — не ошибка
            const dx = me.x - x;
            const dy = me.y - y;
            const len = Math.max(1, Math.hypot(dx, dy));
            node.velocity(dx / len * 70, dy / len * 70);
            made++;
        }
        state.spawned += made;
        return made;
    }

    function fireShots(count) {
        const boss = $('#boss');
        if (!boss.length) return 0;
        const p = boss.pos();
        let made = 0;
        for (let i = 0; i < count; i++) {
            const spread = (i - (count - 1) / 2) * 0.25;
            const node = $.pool.spawn('arena-shots', { x: p.x, y: p.y });
            if (!node.length) break;
            const me = playerPos();
            const dx = me.x - p.x;
            const dy = me.y - p.y;
            const len = Math.max(1, Math.hypot(dx, dy));
            const cos = Math.cos(spread);
            const sin = Math.sin(spread);
            const vx = (dx * cos - dy * sin) / len * 260;
            const vy = (dx * sin + dy * cos) / len * 260;
            node.velocity(vx, vy);
            made++;
        }
        state.shots += made;
        return made;
    }

    // --- Фазы ----------------------------------------------------------------
    /** Индекс фазы по HP босса: чем меньше HP, тем злее фаза. */
    function phaseByHp(hp) {
        let index = 0;
        for (let i = 0; i < PHASES.length; i++) if (hp <= PHASES[i].hpMax) index = i;
        return index;
    }

    /**
     * Следующая фаза: минимум на шаг вперёд (таймер всегда двигает арену) и не
     * меньше той, которую требует HP. На последней фазе остаётся она же —
     * дальше только смерть.
     */
    function pickPhase() {
        const byHp = phaseByHp(state.hp);
        const next = Math.min(PHASES.length - 1, Math.max(state.wave + 1, byHp));
        state.wave = next;
        return PHASES[next].id;
    }

    function stopPhase(cancelled, reason) {
        if (!phaseScope) return false;
        const scope = phaseScope;
        phaseScope = null;
        if (cancelled) {
            state.phaseCancels++;
            state.lastCancel = reason || 'cancel';
        }
        // Закрытие области — немедленное: все scoped-таймеры и потоки фазы
        // снимаются, поэтому «отложенных выстрелов» после отмены не остаётся.
        scope.close({ immediate: true, reason: reason || 'фаза завершена' });
        return true;
    }

    function act(phase) {
        if (state.playerDead || !phaseScope) return;
        if (phase.shots > 0) fireShots(phase.shots);
        if (phase.spawns > 0) spawnWave(phase.spawns);
    }

    function startPhase(id) {
        stopPhase(true, 'смена фазы');
        const phase = PHASES.find((p) => p.id === id) || PHASES[0];
        state.phase = phase.id;
        state.phases++;
        phaseSerial++;
        phaseScope = $.scene.scope('arena:phase:' + phaseSerial);
        // Выстрелы/волны фазы — её таймеры: закрытие области отменяет и их.
        if (phase.spawns > 0) phaseScope.after(0, () => act(phase));
        if (phase.interval && (phase.shots > 0 || phase.spawns > 0)) {
            phaseScope.every(phase.interval, () => act(phase));
        }
        // Таймер фазы: переход по явному правилу (в игровом времени, поэтому
        // пауза его останавливает).
        phaseScope.after(phase.duration, () => {
            if (!state.playerDead) $.state.send('#boss', 'next');
        });
    }

    /** Отмена фазы: считается отдельно от обычного конца фазы. */
    function cancelPhase(reason) {
        state.interrupts++;
        state.phaseCancels++;
        state.lastCancel = reason || 'interrupt';
    }

    function onDeath() {
        // dead.enter вызывается ровно один раз на смерть: повторный `killed`
        // уже не находит перехода, поэтому счётчик не растёт.
        state.deaths++;
        state.playerDead = true;
        state.phase = 'dead';
        stopPhase(true, 'смерть игрока');
        $.pool.releaseAll('arena-shots');
    }

    // --- Машина фаз: переходы по событиям, цель выбирается по данным ---------
    const nextTarget = () => (state.hp <= 0 ? 'dead' : pickPhase());
    const phaseState = (id) => ({
        enter: () => startPhase(id),
        exit: () => stopPhase(false),
        on: {
            next: nextTarget,
            // Отмена — переход в idle с явным учётом: exit закроет область
            // фазы (та же безопасная операция), а счётчик отличает отмену от
            // естественного конца.
            interrupt: { target: 'idle', action: () => cancelPhase('interrupt') },
            killed: 'dead',
        },
    });

    let machine = $.state.get('arena-boss');
    if (!machine) {
        machine = $.state.create({
            name: 'arena-boss',
            initial: 'idle',
            data: state,
            states: {
                idle: {
                    enter: () => { state.phase = 'idle'; stopPhase(false); },
                    on: { start: 'prepare', killed: 'dead' },
                },
                prepare: phaseState('prepare'),
                volley: phaseState('volley'),
                summon: phaseState('summon'),
                burst: phaseState('burst'),
                dead: { enter: () => onDeath(), on: { restart: 'prepare' } },
            },
        });
    }

    // --- Сцена арены ----------------------------------------------------------
    function build($, scope) {
        releaseAll();
        $.world.gravity(0, 0).color('#141a2a').bounds(0, 0, W, H);
        $('<wall>', { id: 'arena-wall-l' }).at(16, H / 2).size(32, H).appendTo($.world);
        $('<wall>', { id: 'arena-wall-r' }).at(W - 16, H / 2).size(32, H).appendTo($.world);
        $('<player>', { id: 'player' }).at(player.x, player.y).size(26, 30)
            .health(100).controls({ axis: 'both' }).collision(26, 30).appendTo($.world);
        $('<enemy>', { id: 'boss' }).at(W / 2, 120).size(48, 48).health(100)
            .body('kinematic').appendTo($.world);

        // HUD — ui-узлы (как в foundations/melee): пример про фазы, не про UI.
        $('<ui.panel>', { id: 'hud-bg' }).at(230, 52).size(440, 92)
            .color('#0d1220bb').appendTo($.ui);
        $('<ui.label>', { id: 'hud-phase', size: 17, color: '#ffd54a' }).at(20, 12).appendTo($.ui);
        $('<ui.label>', { id: 'hud-hp', size: 17, color: '#e8f0ff' }).at(20, 36).appendTo($.ui);
        $('<ui.label>', { id: 'hud-counts', size: 16, color: '#9fb3cc' }).at(20, 60).appendTo($.ui);
        $('<ui.label>', { id: 'hud-state', size: 16, color: '#ff9c8a' }).at(20, 84).appendTo($.ui);
        void scope;
    }

    function hud() {
        if ($('#hud-phase').length === 0) return;
        $('#hud-phase').text(`Фаза: ${state.phase} · волна ${state.wave}`);
        $('#hud-hp').text(`Босс: ${Math.max(0, Math.round(state.hp))} · игрок: ${Math.max(0, Math.round(state.hpPlayer))}`);
        $('#hud-counts').text(`Врагов: ${$.pool.get('arena-minions').active} · снарядов: ${$.pool.get('arena-shots').active} · заспавнено: ${state.spawned}`);
        $('#hud-state').text(state.playerDead ? `СМЕРТЬ (#${state.deaths}) — R рестарт`
            : (state.paused ? 'ПАУЗА — P продолжить' : 'Пробел — урон · I — отмена · P — пауза · R — рестарт'));
    }

    $.scene.add('arena', {
        enter($, scope) {
            // Явное правило рестарта: арена начинается заново (не продолжает
            // волну), счётчики этой жизни обнуляются, пул возвращается.
            state.hp = 100;
            state.hpPlayer = 100;
            state.phase = 'idle';
            state.wave = 0;
            state.phases = 0;
            state.spawned = 0;
            state.shots = 0;
            state.deaths = 0;
            state.interrupts = 0;
            state.phaseCancels = 0;
            state.playerDead = false;
            state.paused = false;
            state.lastCancel = null;
            state.marker = null;
            state.hits = 0;
            state.heartbeat = 0;
            build($, scope);
            // Подписка и таймер принадлежат области сцены (§5): после restart
            // их число возвращается к исходному, а не удваивается.
            $.signal.on('arena:hit', () => { state.hits++; });
            if (scope && typeof scope.every === 'function') {
                scope.every(1000, () => { state.heartbeat++; });
            }
            $.state.attach('#boss', machine);
            machine.set('prepare');
            $.camera.limits(0, 0, W, H);
        },
        exit() {
            stopPhase(true, 'сцена закрыта');
            releaseAll();
        },
        update(dt, $) {
            tick($, dt);
        },
    });

    // --- Кадровая логика ------------------------------------------------------
    function tick($, dt) {
        const game_dt = $.time.delta();          // 0 на паузе и в hit-stop
        hud();
        if (state.playerDead) return;

        // Пробел — урон боссу (проверка HP-правила вручную).
        if ($.input.pressed('space')) damage(10);
        if ($.input.pressed('i')) cancel('manual');
        if ($.input.pressed('p')) togglePause();
        if ($.input.pressed('r')) restart();
        if ($.input.pressed('k')) hitPlayer(999);

        if (state.paused || game_dt <= 0) return;
        moveActors($);
    }

    function moveActors($) {
        const me = playerPos();
        const minions = $.pool.get('arena-minions');
        if (minions && minions.active > 0) {
            minions.nodes().each((i, el) => {
                const p = el.pos();
                if (p.x < -40 || p.x > W + 40 || p.y < -40 || p.y > H + 40) { el.release(); return; }
                const dx = me.x - p.x;
                const dy = me.y - p.y;
                const len = Math.max(1, Math.hypot(dx, dy));
                el.velocity(dx / len * 70, dy / len * 70);
            });
        }
        const shots = $.pool.get('arena-shots');
        if (shots && shots.active > 0) {
            shots.nodes().each((i, el) => {
                const p = el.pos();
                if (p.x < -20 || p.x > W + 20 || p.y < -20 || p.y > H + 20) el.release();
            });
        }
    }

    // --- Публичный фасад примера ---------------------------------------------
    function damage(amount) {
        if (state.playerDead) return false;
        state.hp -= Math.max(0, Number(amount) || 0);
        if (state.hp <= 0) { state.hp = 0; $.state.send('#boss', 'killed'); return true; }
        const want = phaseByHp(state.hp);
        if (want > state.wave || state.phase === 'idle') $.state.send('#boss', 'next');
        return true;
    }

    function hitPlayer(amount) {
        if (state.playerDead) return false;               // смерть ровно один раз
        state.hpPlayer -= Math.max(0, Number(amount) || 0);
        if (state.hpPlayer <= 0) {
            state.hpPlayer = 0;
            $.state.send('#boss', 'killed');
        }
        return true;
    }

    function cancel(reason) {
        if (state.playerDead || state.phase === 'idle') return false;
        state.lastCancel = reason || 'interrupt';
        // Счётчики отмены ставит action перехода (см. phaseState), чтобы не
        // задваивать их при отказе перехода.
        return $.state.send('#boss', 'interrupt');
    }

    function marker(id) {
        if (state.playerDead) return false;
        if (IDS.indexOf(String(id)) < 0) return false;
        state.marker = String(id);
        return $.state.set('#boss', String(id));
    }

    function togglePause() {
        return setPaused(!state.paused);
    }

    function setPaused(value) {
        const on = value === undefined ? true : value !== false;
        state.paused = on;
        if (on) $.time.pause(); else $.time.resume();
        // §44: пока пауза, арене не нужны ни update, ни timers, ни физика —
        // это видно и проверяется через .processing().
        for (const sel of ['#player', '#boss']) {
            const nodes = $(sel);
            if (nodes.length) nodes.processing(on ? { update: false, timers: false, physics: false } : null);
        }
        return state.paused;
    }

    function restart() {
        setPaused(false);
        return $.scene.load('arena', { transition: 'none', scope: true });
    }

    function spawnWavePublic(count) { return spawnWave(Math.max(0, Math.floor(count) || 0)); }
    function fireShotsPublic(count) { return fireShots(Math.max(0, Math.floor(count) || 0)); }

    $.arena = {
        state() { return state; },
        phase() { return state.phase; },
        hp() { return state.hp; },
        damage,
        hitPlayer,
        cancel,
        marker,
        pause: setPaused,
        togglePause,
        restart,
        spawnWave: spawnWavePublic,
        fireShots: fireShotsPublic,
        releaseAll,
        poolStats() { return $.pool.stats(); },
        counts() { return $.scene.counts(); },
        hudText() {
            const out = {};
            for (const sel of ['hud-phase', 'hud-hp', 'hud-counts', 'hud-state']) {
                out[sel] = $('#' + sel).length ? $('#' + sel).text() : null;
            }
            return out;
        },
    };
}

// ---------------------------------------------------------------------------
// Чего не хватило в публичном API (честно; src/** не трогал)
//
// 1. У `$.pool` нет «пула с колбэком на выдачу без ручной настройки скорости»:
//    `spawn` возвращает обёртку, но чтобы вернуть узел, надо помнить пул или
//    звать `.release()` на узле. Удобной `$.pool.autoRelease(node, ms)` нет —
//    время жизни снаряда приходится проверять в кадре вручную.
// 2. `$.combat.attacks(owner)` существует и подходит для «окон» (§9), но у
//    примера нет попаданий по игроку из пула: чтобы связать снаряд с атакой,
//    нужен контакт/overlap — это уже §7/§9-сценарий, поэтому здесь урон
//    боссу — явный вызов `$.arena.damage()`, а не физическое окно.
// 3. У `$.state` нет «отменяемого перехода»: `send()` делает переход сразу, а
//    отмена фазы — это закрытие области владения (§5) плюс переход в `idle`.
//    Хук `onCancel`/`abort` у FSM не нужен, но и не существует; отложенные
//    действия приходится держать в scope, а не в состоянии.
// 4. `$.time.pause()` не сообщает, сколько игрового времени «съела» пауза:
//    фаза продолжается ровно с того же места (это проверено), но узнать
//    остаток таймера из `$` нельзя — тест проверяет по факту возобновления.
// 5. У пула нет публичного `$.pool.setMax/ensure` для дозагрузки: `create` с
//    тем же именем возвращает существующий пул с предупреждением, изменить
//    `max` на ходу нельзя.
// ---------------------------------------------------------------------------
