// ===========================================================================
// Фикстура тестов §41 (multi-target animation, property/audio tracks),
// §10 (маркеры и gameplay-окна) и §6 (домены часов) через агентский интерфейс.
//
// Два клипа из приёмки §41:
//   * 'attack' — кадры героя, поворот/позиция/видимость оружия, attack sensor,
//     emitter, вспышка света, SFX, camera cue, окно атаки и damage-маркер;
//   * 'squad'  — несколько персонажей одним клипом, camera cue, RmlUi fade/value
//     и музыка через audio cue;
// плюс сериализованный JSON-клип, цепочка завершений (flow) и старый формат
// дорожек для проверки совместимости.
//
// Результат складывается в $.agent.expose('animtracks', …); его читает
// tests/agent/highlevel_animtracks_test.py.
// ===========================================================================

$.ready(() => {
    $.world.gravity(0, 0).color('#101820').bounds(0, 0, 1280, 720);
    const white = $.gfx.white;
    const HIT = 'tests/fixtures/sdk/data_proj/assets/hit.ogg';

    const st = {
        parts: 0,          // завершённых частей цепочки flow
        part1: 0, part2: 0, part3: 0,
        hits: 0,           // damage-маркеры (не должны срабатывать на seek)
        boom: 0,           // method-действие game.boom
        cameraCue: 0,      // method-действие game.camera
        jsonHit: 0,
        legacySteps: 0,
        windows: 0,        // сколько раз окно открывалось
    };

    // --- Действия method-дорожек: только имена, без eval строки --------------
    $.anim.action('game.boom', () => { st.boom++; });
    $.anim.action('game.camera', (e) => {
        st.cameraCue++;
        $.camera.shake((e.data && e.data.intensity) || 4, 100);
    });

    // --- Сцена: герой с оружием, сенсором, эмиттером и вспышкой --------------
    $('<sprite>', { id: 'hero', frames: [white, white, white, white] })
        .at(200, 300).size(32, 32).appendTo($.world);
    const hero = $('#hero');
    $('<rect>', { id: 'weapon' }).at(0, 0).size(16, 16).appendTo(hero);
    // Attack-область (§40) с собственным native-индексом: shape.enabled из
    // клипа переключает именно её, не трогая основную форму тела.
    $('<rect>', { id: 'sensor' }).at(18, 0).size(24, 24).body('static')
        .area('attack', { shape: 'box', w: 24, h: 24, sensor: true, role: 'attack', enabled: true })
        .appendTo(hero);
    const attack_area = $('#sensor').areas()[0];
    $('<particles>', { id: 'smoke', amount: 4, rate: 30, lifetime: 400, speed: 20, seed: 5 })
        .at(0, 0).appendTo(hero);
    $('<light>', { id: 'flash', radius: 60, intensity: 0, color: '#ffd070' }).at(0, 0).appendTo(hero);

    // --- Клип атаки: один клип — шесть целей --------------------------------
    $.anim.clip('attack', {
        duration: 600,
        tracks: [
            { type: 'sprite', keys: [{ t: 0, v: 0 }, { t: 600, v: 3 }] },
            { type: 'rotation', target: 'weapon', keys: [{ t: 0, v: 0 }, { t: 300, v: 1.2 }, { t: 600, v: 0 }] },
            { type: 'position', target: 'weapon', keys: [
                { t: 0, v: { x: 0, y: 0 } }, { t: 300, v: { x: 12, y: -4 } }, { t: 600, v: { x: 0, y: 0 } }] },
            { type: 'visible', target: 'weapon', keys: [
                { t: 0, v: true }, { t: 480, v: false }, { t: 600, v: true }] },
            { type: 'shape', binding: 'shape.enabled', target: 'sensor',
              shape: attack_area ? attack_area.index : 0, keys: [
                { t: 0, v: false }, { t: 150, v: true }, { t: 400, v: false }] },
            { type: 'emitter', target: 'smoke', keys: [
                { t: 0, v: false }, { t: 150, v: true }, { t: 500, v: false }] },
            { type: 'light', binding: 'light.intensity', target: 'flash', keys: [
                { t: 0, v: 0 }, { t: 150, v: 3 }, { t: 500, v: 0 }] },
            { type: 'audio', at: 150, resource: HIT, bus: 'sfx', gain: 0.7,
              envelope: [{ t: 150, v: 1 }, { t: 500, v: 0 }] },
            { type: 'method', at: 150, name: 'game.boom' },
            { type: 'method', at: 150, name: 'game.camera', data: { intensity: 6 } },
        ],
        events: [
            { at: 150, name: 'attack-open', window: 'attack', windowPhase: 'open' },
            { at: 400, name: 'attack-close', window: 'attack', windowPhase: 'close' },
            { at: 350, name: 'hit', kind: 'damage', data: { power: 5 } },
        ],
    });

    // --- Клип отряда: несколько персонажей, камера, UI и музыка --------------
    $('<rect>', { id: 'squad-root' }).at(300, 500).size(8, 8).appendTo($.world);
    const squad = $('#squad-root');
    $('<rect>', { id: 'unit-a' }).at(0, 0).size(20, 20).appendTo(squad);
    $('<rect>', { id: 'unit-b' }).at(0, 0).size(20, 20).appendTo(squad);

    $.anim.clip('squad', {
        duration: 800,
        tracks: [
            { type: 'position', target: 'unit-a', keys: [
                { t: 0, v: { x: 0, y: 0 } }, { t: 800, v: { x: 120, y: 0 } }] },
            { type: 'position', target: 'unit-b', keys: [
                { t: 0, v: { x: 0, y: 0 } }, { t: 800, v: { x: -120, y: 0 } }] },
            { type: 'alpha', target: 'unit-a', keys: [{ t: 0, v: 1 }, { t: 800, v: 0.3 }] },
            { type: 'ui', binding: 'ui.style', doc: 'tests/fixtures/animtracks/ui/hud.rml',
              element: 'fade', property: 'opacity', keys: [{ t: 0, v: 1 }, { t: 800, v: 0 }] },
            { type: 'ui', binding: 'ui.value', doc: 'tests/fixtures/animtracks/ui/hud.rml',
              element: 'lives', keys: [{ t: 0, v: 3 }, { t: 800, v: 1 }] },
            { type: 'method', at: 100, name: 'game.camera', data: { intensity: 3 } },
            { type: 'audio', at: 0, resource: HIT, bus: 'music', gain: 0.6, keep: true },
        ],
        events: [{ at: 400, name: 'squad-half' }],
    });

    // --- Сериализованный JSON: воспроизводится без ручных frame-callback ----
    $.anim.load(JSON.stringify({
        clips: {
            'json-part': {
                duration: 300,
                tracks: [
                    { type: 'alpha', keys: [{ t: 0, v: 1 }, { t: 300, v: 0 }] },
                    { type: 'method', at: 100, name: 'game.boom' },
                ],
                events: [{ at: 200, name: 'json-hit' }],
            },
        },
    }));

    // --- Старый формат дорожек: совместимость --------------------------------
    $.anim.clip('legacy-old', {
        duration: 400,
        loop: 'loop',
        tracks: [
            { type: 'position', keys: [{ t: 0, v: { x: 0, y: 0 } }, { t: 400, v: { x: 60, y: 0 } }] },
            { type: 'alpha', keys: [{ t: 0, v: 1 }, { t: 400, v: 0.5 }] },
            { type: 'value', name: 'power', attr: true, keys: [{ t: 0, v: 100 }, { t: 400, v: 0 }] },
            { type: 'sprite', fps: 8, from: 0, to: 3 },
        ],
        events: [{ at: 200, name: 'legacy-step' }],
    });

    // --- Плееры --------------------------------------------------------------
    const heroP = $.anim.player('hero').target('#hero');
    heroP.on('hit', () => { st.hits++; });
    heroP.on('window', (e) => { if (e.window.open) st.windows++; });
    heroP.on('finished', () => { st.part1++; st.parts++; $.anim.player('squad').play('squad'); });
    heroP.play('attack');

    $.anim.player('squad').target('#squad-root');
    $.anim.player('squad').on('finished', () => { st.part2++; st.parts++; $.anim.player('json').play('json-part'); });

    $('<sprite>', { id: 'json-hero', frames: [white, white, white, white] })
        .at(600, 300).size(24, 24).appendTo($.world);
    $.anim.player('json').target('#json-hero');
    $.anim.player('json').on('json-hit', () => { st.jsonHit++; });
    $.anim.player('json').on('finished', () => { st.part3++; st.parts++; });

    $('<rect>', { id: 'legacy-hero' }).at(80, 600).size(20, 20).appendTo($.world);
    $.anim.player('legacy').target('#legacy-hero').play('legacy-old');
    $.anim.player('legacy').on('legacy-step', () => { st.legacySteps++; });

    // --- Домен presentation: продолжается на паузе (§6) ---------------------
    $.anim.clip('fx-clock', {
        duration: 1000,
        loop: 'loop',
        clock: 'presentation',
        tracks: [{ type: 'alpha', keys: [{ t: 0, v: 0 }, { t: 1000, v: 1 }] }],
    });
    $('<rect>', { id: 'fx-clock' }).at(900, 600).size(20, 20).appendTo($.world);
    $.anim.player('fx').target('#fx-clock').play('fx-clock');

    $.agent.expose('animtracks', () => st);
});
