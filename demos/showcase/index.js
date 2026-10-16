// ===========================================================================
// Пример §31-6 Спецификации: «Runtime integration».
//
// Один законченный сценарий на существующем `$`: RmlUi HUD, локализация на
// ходу, вставка на `$.timeline`, музыкальные слои через шины `$.audio` и
// переход между комнатами через область владения §5 (`prepare/commit/discard`).
// Ничего, кроме `$`: ни импорта внутренностей движка, ни `engine.*`.
//
// Запуск:
//   ./build/russiano2d --game demos/showcase
//   python3 tools/run_tests.py showcase_test      // автоматическая проверка
//
// Что проверяется автоматически:
//   * HUD-RmlUi показывает значение, которое игра реально меняет;
//   * переключение языка на ходу меняет строки HUD и диалога;
//   * вставка `$.timeline` доходит до конца и прерывается `stop()`;
//   * переход комнаты (prepare → commit) держит persistent HUD и заменяет мир;
//   * отменённый prepare не публикует сцену (число узлов до/после);
//   * музыкальные слои живут на своих шинах, громкость меняется по слою.
//
// Ограничения видны в конце файла (чего не хватило в API).
// ===========================================================================

const HUD_DOC = 'demos/showcase/rml/hud.rml';

// Три музыкальных слоя. Движок не имеет общего transport'а для stems (§25),
// поэтому «синхронность» здесь — это запуск всех слоёв в одном кадре на
// общем родителе `music` и независимая громкость каждой шины.
const STEMS = [
    { bus: 'music.base', file: 'demos/assets/audio/music/lobby_groove.mp3', gain: 0.45 },
    { bus: 'music.mid', file: 'demos/assets/audio/music/action.ogg', gain: 0.0 },
    { bus: 'music.top', file: 'demos/assets/audio/music/menu.ogg', gain: 0.0 },
];

export default function install($) {
    // --- Локализация --------------------------------------------------------
    // Один словарь на язык; строки HUD и реплик вставки — ключи.
    $.i18n.add('ru', {
        'hud.score': 'Очки: {score}',
        'hud.room': 'Комната: {room}',
        'hud.lang': 'Язык: {lang}',
        'hud.music': 'Слоёв музыки: {n}',
        'room.lobby': 'лобби',
        'room.arena': 'арена',
        'intro.line1': 'Интеграция: HUD, язык, таймлайн и слои музыки.',
        'intro.line2': 'Эта вставка идёт поверх комнаты и её можно прервать.',
        'intro.line3': 'Возвращаемся в комнату — HUD остался на месте.',
    });
    $.i18n.add('en', {
        'hud.score': 'Score: {score}',
        'hud.room': 'Room: {room}',
        'hud.lang': 'Language: {lang}',
        'hud.music': 'Music layers: {n}',
        'room.lobby': 'lobby',
        'room.arena': 'arena',
        'intro.line1': 'Runtime integration: HUD, language, timeline and music layers.',
        'intro.line2': 'This cutscene plays over the room and can be interrupted.',
        'intro.line3': 'Back to the room — the HUD stayed in place.',
    });
    $.i18n.lang('ru');
    $.i18n.fallback('ru');

    const state = {
        score: 0,
        lang: 'ru',
        room: 'lobby',
        stems: 0,
        stemGains: { 'music.base': 0.45, 'music.mid': 0, 'music.top': 0 },
        introRuns: 0,
        introBeats: 0,
        introMarkers: 0,
        introDone: 0,
        introStopped: 0,
        lastReason: null,
        inIntro: false,
        prepareOk: false,
        preparedNodes: 0,
        cancelled: 0,
        hudReady: false,
    };
    if ($.agent && typeof $.agent.expose === 'function') {
        $.agent.expose('showcase', () => state);
    }

    // --- RmlUi HUD: живёт вне сцен ----------------------------------------
    // Документ RmlUi — не узел мира, поэтому его не трогают ни смена сцены,
    // ни clearWorld, ни закрытие области владения: это и есть persistent HUD.
    let hud = null;
    if ($.ui && typeof $.ui.doc === 'function') {
        hud = $.ui.doc(HUD_DOC);
        if (hud && hud.show) hud.show();
        state.hudReady = !!(hud && hud.id !== undefined && hud.id >= 0);
        if (!state.hudReady) $.log('showcase: HUD-документ не загрузился — проверьте ' + HUD_DOC);
    }

    function drawHud() {
        if (!hud) return;
        hud.text('hud-score', $.tr('hud.score', { score: state.score }));
        hud.text('hud-room', $.tr('hud.room', { room: $.tr('room.' + state.room) }));
        hud.text('hud-lang', $.tr('hud.lang', { lang: state.lang.toUpperCase() }));
        hud.text('hud-music', $.tr('hud.music', { n: state.stems }));
    }
    // Один постоянный кадровый хук: HUD обновляется и в комнате, и во вставке.
    $.update(drawHud);

    // --- Музыкальные слои ---------------------------------------------------
    function startStems() {
        if (state.stems > 0) return state.stems;
        if (!$.audio || typeof $.audio.play !== 'function') return 0;
        for (const stem of STEMS) {
            $.audio.bus(stem.bus, { parent: 'music', volume: stem.gain });
            $.audio.play(stem.file, { bus: stem.bus, loop: true, volume: 1 });
        }
        state.stems = STEMS.length;
        for (const stem of STEMS) state.stemGains[stem.bus] = stem.gain;
        return state.stems;
    }

    function setStem(bus, gain) {
        if (!$.audio) return false;
        $.audio.volume(bus, gain);
        state.stemGains[bus] = $.audio.volume(bus);
        return true;
    }

    // --- Комнаты: мир принадлежит области владения --------------------------
    function buildLobby($, scope) {
        $('<wall>', { id: 'lobby-floor', class: 'room-part' })
            .at(640, 660).size(1200, 40).appendTo($.world);
        for (let i = 0; i < 4; i++) {
            $('<rect>', { id: 'lobby-block-' + i }).at(200 + i * 60, 620).size(28, 28)
                .appendTo($.world);
        }
        void scope;
    }

    function buildArena($, scope) {
        $('<wall>', { id: 'arena-floor', class: 'room-part' })
            .at(640, 660).size(1200, 40).appendTo($.world);
        for (let i = 0; i < 6; i++) {
            $('<rect>', { id: 'arena-block-' + i }).at(180 + i * 70, 600).size(32, 32)
                .appendTo($.world);
        }
        state.preparedNodes = scope ? scope.counts().nodes : 0;
    }

    $.scene.add('lobby', {
        enter($, scope) {
            state.room = 'lobby';
            buildLobby($, scope);
        },
    });

    // prepare строит мир во ВРЕМЕННОЙ области: до commit он не принадлежит
    // сцене, discard его убирает целиком. enter только «публикует» состояние.
    $.scene.add('arena', {
        prepare($, scope) { buildArena($, scope); },
        enter($, scope) {
            state.room = 'arena';
            // Обычный load('arena') не зовёт prepare: собираем мир здесь,
            // а путь prepare → commit уже построил его во временной области.
            if (!$('#arena-floor').length) buildArena($, scope);
        },
    });

    let pending = null;

    function prepareArena() {
        pending = $.scene.prepare('arena');
        state.prepareOk = pending.ok === true;
        state.preparedNodes = pending.ok && pending.scope ? pending.scope.counts().nodes : 0;
        return state.prepareOk;
    }

    function commitArena() {
        if (!pending || pending.ok !== true) return false;
        const handle = pending;
        pending = null;
        state.prepareOk = false;
        $.scene.commit(handle, { transition: 'none' });
        return true;
    }

    function discardArena() {
        if (!pending) return false;
        const handle = pending;
        pending = null;
        state.prepareOk = false;
        state.cancelled++;
        return $.scene.discard(handle);
    }

    function goLobby() {
        return $.scene.load('lobby', { transition: 'none', scope: true });
    }

    // --- Вставка на существующем $.timeline ---------------------------------
    // Реплики — ключи словаря: язык переключается на ходу, текст берётся из
    // $.i18n в момент показа. `emit` — маркер вставки, `add` — правка очков.
    $.timeline.define('showcase-intro', {
        title: 'Вставка runtime integration',
        backdrop: '#0b1020',
        script: [
            { narrate: 'intro.line1' },
            { wait: 150 },
            { narrate: 'intro.line2', emit: 'intro-mid', data: { room: 'lobby' } },
            // Маркер вставки правит состояние игры: HUD покажет новые очки.
            { do: () => { if ($.showcase) $.showcase.addScore(5); } },
            { wait: 150 },
            { narrate: 'intro.line3' },
        ],
    });

    $.timeline.on('start', () => { state.inIntro = true; });
    $.timeline.on('beat', (e) => { state.introBeats = e.count; });
    $.timeline.on('intro-mid', () => { state.introMarkers++; });
    $.timeline.on('end', (e) => {
        if (!state.inIntro) return;
        state.inIntro = false;
        state.lastReason = e.reason;
        if (e.reason === 'manual') state.introStopped++;
        else state.introDone++;
        // Возвращаемся в комнату: старый мир вставки снят её сценой, комната
        // собирается заново в новой области, HUD остаётся.
        const back = state.room === 'arena' ? 'arena' : 'lobby';
        $.scene.load(back, { transition: 'none', scope: true });
    });

    function playIntro() {
        state.introRuns++;
        state.introMarkers = 0;
        state.introBeats = 0;
        // Авто-режим: вставка не требует нажатий, поэтому её можно догнать
        // до конца в тесте и в headless-прогоне.
        $.timeline.auto(500);
        $.timeline.play('showcase-intro', { transition: 'none' });
        return true;
    }

    function stopIntro() {
        return $.timeline.stop('manual');
    }

    // --- Публичный фасад примера --------------------------------------------
    $.showcase = {
        state() { return state; },
        addScore(n) {
            state.score += Math.round(Number(n) || 0);
            drawHud();
            return state.score;
        },
        setLang(code) {
            const lang = String(code) === 'en' ? 'en' : 'ru';
            $.i18n.lang(lang);
            state.lang = lang;
            drawHud();
            return lang;
        },
        hudContent(element) { return hud ? hud.content(element) : null; },
        hudVisible() { return hud ? !!hud.visible() : false; },
        startStems,
        setStem,
        prepareArena,
        commitArena,
        discardArena,
        goLobby,
        playIntro,
        stopIntro,
        room: () => state.room,
    };

    // Музыка стартует сразу: demo должно звучать, а не ждать команды.
    startStems();
}

// ---------------------------------------------------------------------------
// Чего не хватило в API (честно)
//
// 1. §25 (music stems) не реализован: у звука нет общего transport/clock, нет
//    `stems.start(time)`, seek и sample-accurate синхронизации. Здесь слои
//    запускаются в одном кадре на общих шинах `music.*`, а «переключение
//    интенсивности» — это громкость шины. Для настоящих stems нужен общий
//    транспорт (docs/PRODUCTION_READINESS.md §25).
// 2. RmlUi HUD обновляется вручную (`doc.text(el, $.tr(…))`): у документов нет
//    data-binding на `$.store`/`$.i18n`, поэтому переключение языка требует
//    кадрового перерисовывания строк (здесь — один `$.update`-хук).
// 3. `$.scene.prepare` не умеет «невидимую» подготовку: узлы временной области
//    физически существуют в мире до commit (в примере это один кадр). Прогресс
//    загрузки и скрытие staging-мира остаются за игрой (§45).
// 4. `$.timeline` регистрирует сцену на своё имя и грузится обычным
//    `$.scene.load` — вставка не является overlay поверх текущей сцены, мир
//    комнаты на время вставки снимается. Комната собирается заново после
//    вставки; persistent HUD (RmlUi-документ) при этом не страдает.
// ---------------------------------------------------------------------------
