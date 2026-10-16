// Фикстура §21: бюджеты VFX, часы эффектов, завершение и reduced-настройки.
//
// Игра намеренно повторяет один и тот же удар много раз: так проверяется, что
// серия из сотен ударов не растёт по узлам и эмиттерам, а presentation-настройки
// не меняют исход боя.

$.ready(($) => {
    $.world.gravity(0, 900).color('#0d1218').bounds(0, 0, 800, 600);
    $('<wall>', { id: 'floor' }).at(400, 560).size(760, 40).appendTo($.world);

    const hero = $('<player>', { id: 'hero' }).at(200, 500).size(24, 32).appendTo($.world);
    // Области боя объявляются как в игре: у героя — blade (чем бьёт), у врага —
    // hurtbox (куда попадают). Без области попадание невозможно по построению.
    // Лезвие накрывает позицию цели: области в этой фикстуре служат только для
    // того, чтобы удар был настоящим gameplay-попаданием (§9), а не счётчиком.
    hero.hitbox('blade', { w: 280, h: 64, x: 300, y: 500, sensor: true });
    const enemy = $('<npc>', { id: 'foe' }).at(420, 500).size(24, 32).appendTo($.world);
    enemy.hurtbox('body', { w: 30, h: 36, sensor: true });

    // Модель HP — чтобы урон был настоящим игровым числом, а не «счётчиком».
    // `burst` — отдельный разовый эффект фикстуры; по умолчанию он выключен,
    // чтобы замер частиц показывал именно фидбек §21, а не оба источника сразу.
    const state = { hits: 0, damage: 0, ends: 0, plays: 0, burst: false };
    // HP намеренно огромный: серия из 200 ударов не должна «убить» цель, иначе
    // дальнейшие удары получат destroyed_target и бюджет перестанет измеряться.
    // Модель создаётся явно: `$.combat.health(sel)` только ЧИТАЕТ существующую.
    const bigHp = {};
    for (const zone of $.combat.zones()) bigHp[zone] = 100000000;
    $.combat.attach('#foe', $.combat.createHealth({ max: bigHp }));

    // Разовый эффект удара: живёт на presentation-часах, поэтому hit-stop и
    // пауза его не останавливают (как вспышку и тряску).
    const burst = $('<particles>', { class: 'burst' }).at(0, 0)
        .params({
            amount: 12, one_shot: true, clock: 'presentation',
            lifetime: [80, 160], speed: [60, 160], max_particles: 48,
        })
        .emitting(false)
        .appendTo($.world);
    burst.on('particlesEnd', () => { state.ends = (state.ends || 0) + 1; });

    // Сколько узлов и эмиттеров в мире — по этим числам проверяется бюджет.
    const counts = () => ({
        nodes: $.world.count(),
        emitters: $('particles').length,
        particles: (() => { let n = 0; $('particles').each((i, e) => { n += e.count(); }); return n; })(),
    });

    /**
     * Один удар: урон через контракт §9 (`damageRequest`) + фидбек §21.
     *
     * Специально НЕ через areaOverlap: этой фикстуре важны бюджеты и часы, а
     * не геометрия удара (её проверяет melee_test). `damageRequest` — тот же
     * gameplay-путь: HP меняется, событие `damage` выходит, presentation
     * вызывается отдельно.
     */
    function strike() {
        const res = $.combat.damageRequest({
            target: '#foe', source: '#hero', amount: 7, damageType: 'melee',
            rehit: 'always',
        });
        const applied = res && res.accepted ? 1 : 0;
        if (applied) {
            state.hits += 1;
            state.damage += 7;
            if (state.burst) burst.at(420, 500).restart();
            $.hits.play(res, { preset: 'punch', knockback: 0 });
        }
        state.plays = $.hits.stats().plays;
        return applied;
    }

    // Мост для теста. `$.agent.expose` зовёт функцию без аргументов и не
    // возвращает объекты с вложенными узлами, поэтому параметризованные вызовы
    // идут через globalThis: тест пишет `__fx.n = 200` и зовёт `__fx.runHits()`.
    // Это тестовый хук в фикстуре, а не API движка.
    globalThis.__fx = {
        n: 1,
        reduced: null,
        runHits() {
            let applied = 0;
            const count = Math.max(0, Math.floor(Number(this.n) || 0));
            for (let i = 0; i < count; i++) applied += strike();
            return JSON.stringify(Object.assign({ applied }, state));
        },
        counts() { return JSON.stringify(counts()); },
        state() { return JSON.stringify(state); },
        reducedNow() { return JSON.stringify($.hits.reduced()); },
        clear() { state.hits = 0; state.damage = 0; state.ends = 0; state.plays = 0; return true; },
        withBurst(on) { state.burst = !!on; return true; },
    };
    $.agent.expose('counts', counts);
    $.agent.expose('state', () => Object.assign({}, state));
    $.agent.expose('reduced', () => $.hits.reduced());

});
