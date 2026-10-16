// ===========================================================================
// Фикстура тестов restore (§10/§14/§26): tests/agent/save_restore_test.py.
//
// Собирает платформерную сцену с «живыми» действиями (прыжок, летящая пуля,
// cooldown врага, фаза фазового противника), регистрирует фабрики поведения,
// подписки и таймеры на восстановленных узлах, умеет сохранять/грузить слоты
// и считать наблюдаемые числа. Всё, что нужно тесту, лежит в globalThis.SR —
// тест зовёт это через eval.
// ===========================================================================

$.ready(() => {
    const C = {
        builds: 0,        // сколько раз собран мир
        loads: 0,         // вызовов фабрик поведения при восстановлении
        subs: 0,          // создано подписок на восстановленных узлах
        timers: 0,        // создано таймеров
        live_timers: 0,   // таймеров, которые ещё живы
        hits: 0,          // сработало подписок
        deaths: 0,        // событий смерти в этой сессии
    };
    const SR = globalThis.SR = { C, ready: false };

    $.world.gravity(0, 1800).color('#101820').bounds(-4000, -4000, 8000, 8000);
    $.save.dir('build/test_saves_restore');

    // Потоки RNG создаём ДО первого сохранения: в снимок попадают только уже
    // существующие потоки, и ленивый поток после restore продолжил бы старую
    // последовательность (см. docs/highlevel/save.md).
    $.random.stream('generation');
    $.random.stream('gameplay');
    $.random.stream('presentation');
    for (const slot of $.save.list({ meta: false })) $.save.remove(slot.slot);

    /**
     * Подписка и таймер узла. Ставятся ровно один раз на узел (флаг srWired) и
     * снимаются вместе с узлом — поэтому повторный restore не удваивает
     * счётчики (приёмка §14).
     */
    function wire(node) {
        if (node.attrs.srWired) return;
        node.attrs.srWired = 1;
        const sub = $.signal.on('sr:hit', (payload) => {
            if (!payload || payload.nid !== node.nid) return;
            C.hits++;
        });
        const timer = $.time.after(5000, () => { C.timers++; C.live_timers--; });
        C.subs++;
        C.live_timers++;
        node.on('remove', () => {
            $.signal.off('sr:hit', sub);
            $.time.cancel(timer);
            C.live_timers--;
        });
    }

    // --- Фабрики поведения: в слот уходят данные, логика остаётся в коде -----
    $.save.behavior('.hero', {
        save(node) {
            return { hp: node.cur_hp, jump: node.attrs.jump || 0, phase: node.attrs.phase || 'idle' };
        },
        load(node, data) {
            node.cur_hp = data.hp;
            node.attrs.jump = data.jump;
            node.attrs.phase = data.phase;
            C.loads++;
            wire(node);
        },
    });
    $.save.behavior('.walker', {
        save(node) { return { hp: node.cur_hp, cd: node.attrs.cd || 0, phase: node.attrs.phase || 'patrol' }; },
        load(node, data) {
            node.cur_hp = data.hp;
            node.attrs.cd = data.cd;
            node.attrs.phase = data.phase;
            C.loads++;
            wire(node);
        },
    });
    $.save.behavior('.bullet', {
        save(node) { return { ttl: node.attrs.ttl === undefined ? 2 : node.attrs.ttl }; },
        load(node, data) { node.attrs.ttl = data.ttl; C.loads++; },
    });

    /** Собрать мир: герой в прыжке, пуля в полёте, враг с cooldown, фазовый враг. */
    SR.build = function () {
        C.builds++;
        // Мир пересобирается с нуля: так прогоны реплея стартуют из одного и
        // того же состояния (иначе узлы наслаивались бы и hash расходился).
        for (const node of $.world.all().nodes.slice()) if (!node.removed) node.destroy();
        const hero = $('<player>', { id: 'hero', class: 'hero' }).at(0, 0).size(20, 30).appendTo($.world);
        hero.attr('jump', 1).attr('phase', 'jump');
        hero.velocity(40, -320);                       // «в прыжке»
        $('<bullet>', { id: 'shot', class: 'bullet' }).at(120, -40).appendTo($.world)
            .velocity(300, -60).attr('ttl', 1.5);
        const walker = $('<enemy>', { id: 'walker', class: 'walker' }).at(200, 0).appendTo($.world);
        walker.attr('cd', 0.4).attr('phase', 'windup');
        const boss = $('<enemy>', { id: 'boss', class: 'walker' }).at(400, 0).appendTo($.world);
        boss.attr('cd', 1.2).attr('phase', 'phase2');
        return $.world.count();
    };

    /** Сбить «живое» состояние: так видно, что restore его вернул. */
    SR.breakState = function () {
        $('#hero').velocity(0, 0).attr('jump', 0).attr('phase', 'idle');
        $('#shot').velocity(0, 0).attr('ttl', 0);
        $('#walker').attr('cd', 9).attr('phase', 'dead');
        $('#boss').attr('cd', 9).attr('phase', 'dead');
    };

    SR.save = function (slot) { return $.save.slot(slot).save(); };
    SR.restore = function (slot, opts) { return $.save.load(slot, opts); };
    SR.readText = function (path) { return $.fs.readText(path); };
    SR.writeText = function (path, text) { return $.fs.write(path, text); };
    SR.exists = function (path) { return $.fs.exists(path); };
    SR.removeFile = function (path) { return $.fs.remove(path); };
    SR.stats = function () { return $.save.stats(); };
    SR.recover = function (slot) { return $.save.recover(slot); };

    /** Наблюдаемые числа после действия. */
    SR.watch = function () {
        const sp = (id) => { const v = $('#' + id).velocity(); return [v.x, v.y]; };
        return {
            nodes: $.world.count(),
            hero_hp: $('#hero').hp(),
            hero_jump: $('#hero').attr('jump'),
            hero_phase: $('#hero').attr('phase'),
            hero_v: sp('hero'),
            shot_v: sp('shot'),
            shot_ttl: $('#shot').attr('ttl'),
            walker_cd: $('#walker').attr('cd'),
            walker_phase: $('#walker').attr('phase'),
            boss_cd: $('#boss').attr('cd'),
            boss_phase: $('#boss').attr('phase'),
            subs: $.signal.count(),
            live_timers: C.live_timers,
            behavior_loads: C.loads,
            builds: C.builds,
            deaths_session: C.deaths,
            deaths_stat: $.save.counter('deaths'),
            rng: $.random.state(),
        };
    };

    /** Смерть героя: статистика прохождения растёт ровно один раз на событие. */
    SR.die = function () {
        C.deaths++;
        $.save.counter('deaths', 1);
        $.signal.emit('sr:death', { nid: $('#hero').nid() });
        return $.save.counter('deaths');
    };

    /** Сработала ли подписка узла (проверка, что подписки живы после restore). */
    SR.ping = function (id) {
        const node = $('#' + id).get(0);
        const before = C.hits;
        if (node) $.signal.emit('sr:hit', { nid: node.nid });
        return C.hits - before;
    };

    // --- Детерминированная логика для §26 -----------------------------------
    SR.genNumbers = function () {
        const r = $.random.stream('generation');
        const out = [];
        for (let i = 0; i < 4; i++) out.push(Math.floor(r.next() * 1000));
        return out;
    };
    SR.damage = function () {
        const r = $.random.stream('gameplay');
        return Math.floor(r.next() * 10) + 1;
    };
    /** Косметика: потребляет presentation-поток, на gameplay влиять не должна. */
    SR.cosmetic = function () {
        const r = $.random.stream('presentation');
        return Math.floor(r.next() * 100);
    };
    SR.events = [];
    SR.scenario = function () {
        SR.events.length = 0;
        const gen = SR.genNumbers();
        const dmg = SR.damage();
        SR.events.push('gen:' + gen.join('-'));
        SR.events.push('damage:' + dmg);
        const hash = $.random.hashCells([gen[0], gen[1], dmg, Math.round($('#hero').pos().x * 1000)]);
        return { events: SR.events.slice(), hash, gen, dmg };
    };
    SR.rngRestore = function (state) { return $.random.restore(state); };
    SR.rngState = function () { return $.random.state(); };

    /** Записать слот с несуществующим ассетом (проверка «недостающий ассет»). */
    SR.writeBrokenAsset = function (slot) {
        const payload = $.save.snapshot();
        payload.namespaces.room.world[0].sprite = 'нет-такого-ассета.png';
        $.fs.write($.save.path(slot), JSON.stringify(payload, null, 2));
        return true;
    };

    // --- §26: реплей в движке -------------------------------------------------
    SR.playing = false;
    SR.mismatchAfter = 0;      // на каком подвижном кадре специально разойтись

    SR.replayIdentity = function (v) { return $.replay.identity(v); };
    SR.replayActions = function (list) { return $.replay.actions(list, 'fixture/v1'); };
    SR.replayWatchHash = function (every) { return $.replay.checkpoints({ every }); };
    SR.replayHeader = function () { return $.replay.header(); };
    SR.replayText = function () { return $.replay.toText(); };
    SR.replayLoad = function (text) { return $.replay.load(text); };
    SR.replayDivergence = function () { return $.replay.divergence(); };
    SR.replayCheckpoints = function () { return $.replay.checkpointsList(); };
    SR.replayCheckpointAt = function (tick) { return $.replay.checkpointAt(tick); };
    SR.replayRecord = function () { return $.replay.record(SR.sample, SR.drive); };
    SR.replayPlay = function () { SR.playing = true; return $.replay.play(); };
    SR.replayStop = function () { SR.playing = false; return $.replay.stop(); };

    /** Ввод кадра на уровне разрешённых actions (§26). */
    SR.sample = function () {
        const out = [];
        if ($.input.down('right')) out.push('right');
        if ($.input.down('left')) out.push('left');
        return out;
    };

    /** Одна и та же функция на запись и на проигрывание. */
    SR.drive = function (payload) {
        // При записи и проигрывании форма одна: { actions, raw } (§26).
        const actions = payload && Array.isArray(payload.actions) ? payload.actions
            : (Array.isArray(payload) ? payload : []);
        const dx = actions.indexOf('right') >= 0 ? 1 : (actions.indexOf('left') >= 0 ? -1 : 0);
        const hero = $('#hero');
        if (!hero || !dx) return;
        hero.move(dx * 120 * ($.time.delta() || 0), 0);
        if (SR.playing && SR.mismatchAfter > 0 && --SR.mismatchAfter === 0) hero.move(40, 0);
    };

    SR.ready = true;
});
