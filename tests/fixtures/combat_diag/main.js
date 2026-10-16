// Фикстура §28: цепочка удара, анатомия узла и контакты.
//
// Здесь узел специально «полный»: тело, несколько областей с ролями, опора,
// анимационное окно и политика обработки. По такому узлу видно, отвечает ли
// отладочный снимок на вопрос «почему удар не прошёл».

$.ready(($) => {
    $.world.gravity(0, 900).color('#0d1218').bounds(0, 0, 800, 600);
    $('<wall>', { id: 'floor' }).at(400, 560).size(760, 40).appendTo($.world);

    const hero = $('<player>', { id: 'hero' }).at(300, 500).size(26, 30).appendTo($.world);
    hero.hitbox('blade', { w: 60, h: 40, x: 340, y: 500, sensor: true });
    hero.hurtbox('body', { w: 26, h: 30, sensor: true });
    hero.controls('arrows');

    const foe = $('<npc>', { id: 'foe' }).at(360, 500).size(26, 30).appendTo($.world);
    foe.hurtbox('torso', { w: 26, h: 30, sensor: true });
    $.combat.attach('#foe', $.combat.createHealth({
        max: (() => { const m = {}; for (const z of $.combat.zones()) m[z] = 500; return m; })(),
    }));

    // Клип с окном: нужно, чтобы `anatomy().windows` было что показать.
    $.anim.define('swing', {
        duration: 400,
        tracks: [
            { binding: 'visible', keys: [{ at: 0, v: true }] },
            { type: 'event', name: 'open', at: 100, window: 'attack', windowPhase: 'open' },
            { type: 'event', name: 'close', at: 280, window: 'attack', windowPhase: 'close' },
        ],
    });

    // Политика обработки: у врага выключено обновление — это видно в снимке.
    $.processing.set('#foe', { update: false });

    const state = { attackId: null, hits: 0, refused: 0 };
    $.agent.expose('state', () => Object.assign({}, state));

    globalThis.__dbg = {
        // Имя `stats`, а не `state`: `$.agent.expose('state', …)` создаёт поле
        // в снимке агента, и одноимённый метод здесь затирался бы значением
        // снимка (проверено: `__dbg.state()` возвращал boolean вместо метода).
        stats() { return JSON.stringify(state); },
        attack() {
            const atk = $.combat.attack({ source: '#hero', owner: '#hero', amount: 9, window: 2000 });
            state.attackId = atk.id;
            return atk.id;
        },
        /** Удар по цели: возвращает ответ контракта §9 (и пишет цепочку). */
        strike() {
            const atk = $.combat.attacks().slice(-1)[0];
            if (!atk) return null;
            // Кандидатов передаём СПИСКОМ: strike() ждёт набор кандидатов
            // (обычно результат .areaOverlap()), а не один узел.
            const res = $.combat.strike(atk, [{ node: '#foe', role: 'hurtbox' }]);
            const r = (res && res.results && res.results[0]) || null;
            if (r && r.accepted) state.hits++; else state.refused++;
            return r;
        },
        chain(id) { return JSON.stringify($.trace.hit(id === undefined ? state.attackId : id)); },
        chains() { return JSON.stringify($.trace.hits().map((h) => ({ hit: h.hit, complete: h.complete }))); },
        anatomy(sel) { return JSON.stringify($.debug.anatomy(sel)); },
        contacts() { return JSON.stringify($.debug.contacts()); },
        traceOn(on) { $.trace.on(!!on); return true; },
        openWindow() { $.anim.player('hero').play('swing'); return true; },
    };
});
