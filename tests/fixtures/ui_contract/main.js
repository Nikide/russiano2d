// ===========================================================================
// Фикстура теста контракта UI/HUD, локализации и timeline (§16).
//
// Что здесь есть, чтобы приёмка была числами, а не описанием:
//   * persistent HUD (живёт в слое $.ui и переживает смену/рестарт комнаты)
//     отдельно от временного окна (его закрывает смена сцены);
//   * документ RmlUi с обязательными ID — контракт через $.ui.checkRequired();
//   * два языка (ru/en), смена НА ХОДУ, пропавший ключ и явный маркер;
//   * модальное окно (<ui.dialog>) и немодальное (панель) — блокировка ввода;
//   * стек фокуса: Escape закрывает верхний контекст и возвращает фокус;
//   * timeline с маркерами: play → stop / skip без роста подписок и таймеров
//     и без «дорисовки» UI после остановки.
//
// Наблюдения лежат в globalThis.U — их читает tests/agent/highlevel_ui_contract_test.py.
// ===========================================================================

$.ready(() => {
    const U = globalThis.U = {
        rooms: 0,            // сколько раз вошли в комнату
        frames: 0,
        closed: 0,
        hp_node: null,
    };

    $.world.gravity(0, 0).color('#101820').bounds(0, 0, 800, 600);

    // --- языки ---------------------------------------------------------------
    $.i18n.add('ru', $.fs.readJSON('lang/ru.json', {}));
    $.i18n.add('en', $.fs.readJSON('lang/en.json', {}));
    $.i18n.lang('ru');

    // --- HUD: persistent, живёт вне сцен ------------------------------------
    // Значения обновляет игра каждый кадр: тест видит, что HUD не только цел,
    // но и продолжает получать данные после рестарта комнаты.
    $('<ui.panel>', { id: 'hud', color: '#0b1220cc' })
        .at(400, 40).size(420, 64).appendTo($.ui);
    U.hp_node = $('<ui.label>', { id: 'hud_hp', text: 'HP 100', size: 18 })
        .at(240, 30).appendTo($.ui);
    $('<ui.bar>', { id: 'hud_bar', value: 100, max: 100 })
        .at(400, 62).size(360, 10).appendTo($.ui);
    $('<ui.label>', { id: 'hud_tr', text: '', size: 16 })
        .at(240, 80).appendTo($.ui);
    // Якорный узел в правом нижнем углу: по нему видно, что resize не ломает
    // раскладку, а переносит привязанный элемент вместе с краем окна.
    $('<ui.label>', { id: 'hud_right', text: 'v1.0', size: 14 })
        .at(760, 560).size(80, 24).anchor('bottom-right').appendTo($.ui);

    // Узлы привязок: cooldown, таймер, прогресс загрузки, устройство.
    $('<ui.label>', { id: 'hud_cd', text: '', size: 14 }).at(120, 30).appendTo($.ui);
    $('<ui.label>', { id: 'hud_timer', text: '', size: 14 }).at(120, 50).appendTo($.ui);
    $('<ui.label>', { id: 'hud_load', text: '', size: 14 }).at(120, 70).appendTo($.ui);
    $('<ui.label>', { id: 'hud_device', text: '', size: 14 }).at(120, 90).appendTo($.ui);

    // Кнопка меню: на ней проверяются фокус и возврат фокуса после диалога.
    $('<ui.button>', { id: 'menu_btn', text: 'Меню', size: 18 })
        .at(120, 560).size(120, 32).appendTo($.ui);

    // §16: HUD постоянный — смена сцены и рестарт комнаты его не сносят.
    // Временное окно (temp_window) постоянным НЕ помечено и уходит вместе со
    // своей сценой: в этом и разница между HUD и окном.
    $.ui.persist('#hud, #hud_hp, #hud_bar, #hud_tr, #hud_right, #menu_btn, '
        + '#hud_cd, #hud_timer, #hud_load, #hud_device');

    // Перевод узла и элемента документа — обе привязки должны обновляться на
    // смену языка на ходу.
    $.ui.tr('#hud_tr', 'hud.hp');
    const hud_doc = $.ui.doc('ui/hud.rml').show();
    hud_doc.tr('hp_text', 'hud.hp');
    hud_doc.tr('ammo_text', { key: 'hud.ammo', n: 12 });

    // Контракт обязательных ID: игра объявляет, движок проверяет.
    $.ui.required([
        { doc: 'ui/hud.rml', ids: ['hp_text', 'ammo_text'] },
    ]);

    // --- ввод: игровой контекст ---------------------------------------------
    $.input.bind('jump', ['space']);
    $.input.bind('right', ['d', 'right']);
    $.input.context('gameplay', { active: true, priority: 0,
                                  binds: { jump: ['space'], right: ['d', 'right'] } });
    U.jumpSeen = () => U.jump_seen;
    U.rightSeen = () => U.right_seen;
    U.pressRight = () => $.input.synthPress('d');
    U.right_seen = 0;
    U.closeTemp = () => { if (temp) { temp.remove(); temp = null; return true; } return false; };
    U.jump_seen = 0;
    U.right_down_seen = 0;
    U.blocked_frames = 0;

    // --- временное окно (не модальное) --------------------------------------
    let temp = null;

    // --- комнаты -------------------------------------------------------------
    function spawnHero() {
        if ($('#hero').nodes.length) return true;
        $('<rect>', { id: 'hero', class: 'scene-persistent' }).at(400, 300).size(24, 32)
            .appendTo($.world);
        return true;
    }

    $.scene.add('room1', {
        enter() { U.rooms++; spawnHero(); },
        exit() { if (temp) { temp.remove(); temp = null; } },
    });
    $.scene.add('room2', { enter() { U.rooms++; spawnHero(); } });
    $.scene.load('room1', { transition: 'none' });

    // --- кадровый шаг игры ---------------------------------------------------
    $.update(() => {
        U.frames++;
        if ($.ui.inputBlocked()) U.blocked_frames++;
        // Игровой ввод: модальное окно не должно пропускать нажатия.
        if ($.ui.inputBlocked()) return;
        if ($.input.pressed('jump')) U.jump_seen++;
        // 'right' нужен для проверки модальности: Space модальное окно трактует
        // как активацию своей кнопки и закрывается — это его штатное поведение.
        if ($.input.pressed('right')) U.right_seen++;
        if ($.input.down('right')) U.right_down_seen++;
    });

    // --- публичные ручки для теста ------------------------------------------
    // --- §16: привязки данных -------------------------------------------------
    // Источники — игра: здоровье, cooldown, таймер прохождения, прогресс
    // загрузки и выбранное устройство. Значения меняет тест через U.set(...).
    U.model = { hp: 100, hp_max: 100, cooldown: 0, device: 'клавиатура' };
    U.set = (key, value) => { U.model[key] = value; return true; };
    $.ui.bind('#hud_bar', () => U.model.hp / U.model.hp_max);
    $.ui.bind('#hud_hp', () => 'HP ' + U.model.hp);
    $.ui.bind('#hud_cd', () => U.model.cooldown, { text: (v) => 'CD ' + Number(v).toFixed(1) });
    $.ui.bind('#hud_timer', () => $.time.now(), { text: (v) => 'T ' + Number(v).toFixed(2) });
    $.ui.bind('#hud_load', () => ($.loading && $.loading.visible ? $.loading.value() : 0),
              { text: (v) => 'LOAD ' + Math.round(Number(v) * 100) + '%' });
    $.ui.bind('#hud_device', () => U.model.device);
    U.bindStats = () => $.ui.bindStats();
    U.bindings = () => $.ui.bindings();
    U.hudBound = () => {
        const get = (id) => { const n = $('#' + id).nodes[0]; return n ? { value: n.value, text: n.text } : null; };
        return { timer: get('hud_timer'), load: get('hud_load'), device: get('hud_device'), cd: get('hud_cd') };
    };

    U.lang = (code) => { $.i18n.lang(code); return $.tr('hud.hp'); };
    U.tr = (key) => $.tr(key);
    U.missing = () => $.i18n.missing();
    U.clearMissing = () => $.i18n.clearMissing();
    U.mark = (flag) => { $.i18n.mark(flag); return $.tr('nope.key'); };
    U.numbers = () => ({ ru: $.i18n.number(1234567.5, { decimals: 1 }), sep: $.i18n.separators() });

    U.hudValue = () => {
        const hp = $('#hud_hp').nodes[0];
        const bar = $('#hud_bar').nodes[0];
        const tr = $('#hud_tr').nodes[0];
        return {
            exists: !!hp,
            hp: hp ? hp.text : null,
            bar: bar ? bar.value : null,
            tr: tr ? tr.text : null,
            pos: hp ? { x: Math.round(hp.x), y: Math.round(hp.y) } : null,
        };
    };
    U.hudCount = () => $('#hud, #hud_hp, #hud_bar, #hud_tr').nodes.length;
    U.docText = (element) => hud_doc.content(element);
    U.docRect = (element) => hud_doc.rect(element);
    U.required = () => $.ui.checkRequired();
    U.documents = () => $.ui.documents();
    U.translations = () => $.ui.trList();
    U.retranslate = () => $.ui.retranslate();

    U.restartRoom = () => { $.scene.load('room1', { transition: 'none' }); return true; };
    U.gotoRoom2 = () => { $.scene.load('room2', { transition: 'none' }); return true; };
    U.room = () => $.scene.current();
    U.tempWindow = () => {
        temp = $('<ui.panel>', { id: 'temp_window', color: '#203040ff' })
            .at(400, 300).size(200, 120).appendTo($.ui);
        return !!temp;
    };
    U.tempExists = () => !!$('#temp_window').nodes[0];

    // --- модальное окно / фокус ---------------------------------------------
    U.focus = (sel) => { $.ui.focus(sel); return $.ui.focusedId(); };
    U.focused = () => $.ui.focusedId();
    U.focusStack = () => $.ui.focusStack();
    U.modal = () => {
        const d = $.ui.dialog({ title: 'Пауза', text: 'Продолжить?', buttons: ['Да', 'Нет'] });
        U.dialog_open = true;
        return d;
    };
    U.modalOpen = () => $.ui.modalOpen();
    U.inputBlocked = () => $.ui.inputBlocked();
    U.consumed = () => $.input.consumed();
    U.pressEscape = () => $.input.synthPress('escape');
    U.pressJump = () => $.input.synthPress('space');
    U.tapJump = () => $.input.synthPress('space');
    U.bindCount = () => $.input.binds ? $.input.binds().length : 0;

    // --- длинный текст на панели --------------------------------------------
    U.longText = (lang) => {
        $.i18n.lang(lang);
        return $.tr('long.paragraph');
    };
    U.measure = (text, size) => engine.measureText(text, size);
    U.wrap = (text, width, size) => {
        // Перенос — как его делает диалог: по словам, с измерением движком.
        const words = String(text).split(/\s+/);
        const lines = [];
        let line = '';
        for (const w of words) {
            const probe = line ? line + ' ' + w : w;
            if (engine.measureText(probe, size)[0] > width && line) { lines.push(line); line = w; }
            else line = probe;
        }
        if (line) lines.push(line);
        return lines;
    };

    // --- timeline с маркерами -----------------------------------------------
    // Timeline с маркерами: один и тот же id встречается дважды (сработать
    // обязан один раз), `once: false` — сработать каждый раз.
    // Своя сцена: $.timeline.define забирает сцену себе (её enter и запускает
    // прогон), поэтому комнаты HUD-теста остаются отдельными.
    $.timeline.define('intro', {
        scene: 'cut_intro',
        script: [
            { label: 'start', marker: 'intro_begin' },
            { wait: 0.02 },
            { marker: 'intro_once' },
            { marker: 'intro_once' },
            { marker: 'intro_repeat', once: false },
            { wait: 0.02 },
            { marker: 'intro_late' },
            { label: 'end' },
        ],
    });
    U.marker_events = [];
    $.timeline.on('marker', (data) => U.marker_events.push(data && data.marker ? data.marker : String(data)));
    U.markerEvents = () => U.marker_events.slice();
    U.clearMarkerEvents = () => { U.marker_events.length = 0; return true; };
    U.markerListenerCount = () => $.timeline.listenerCount('marker');

    U.layout = () => {
        const right = $('#hud_right').nodes[0];
        const hp = $('#hud_hp').nodes[0];
        const doc = hud_doc.rect('hp_text');
        return {
            w: $.window.size().w, h: $.window.size().h,
            right: right ? { x: Math.round(right.x), y: Math.round(right.y) } : null,
            hp: hp ? { x: Math.round(hp.x), y: Math.round(hp.y) } : null,
            doc_hp: doc ? { x: Math.round(doc.x), y: Math.round(doc.y), w: Math.round(doc.w) } : null,
            scale: $.ui.scale(),
        };
    };
    U.resize = (w, h) => { $.window.resize(w, h); return true; };
    U.markers = () => ($.timeline.markers ? $.timeline.markers() : []);
    U.skippedMarkers = () => ($.timeline.skippedMarkers ? $.timeline.skippedMarkers() : []);
    // Камера и музыка ДО прогона: timeline обязан вернуть их по контракту.
    // Герой создаётся в комнате (мир чистится на смене сцены) и помечен
    // постоянным, иначе его снесло бы вместе с прошлой комнатой.
    // Существующий трек: проверяем возврат именно ИГРАВШЕЙ музыки.
    const MUSIC_FILE = (($.fs.list('assets/audio/music') || [])[0]) || 'missing.ogg';
    U.armCamera = () => {
        spawnHero();
        $.camera.follow('#hero');
        $.camera.zoom(2);
        $.sound.music('assets/audio/music/' + MUSIC_FILE, { loop: true });
        return true;
    };
    U.zoom = () => $.camera.zoom();
    U.followedId = () => {
        const w = $.camera.followed();
        const n = w && w.get ? w.get(0) : null;
        return n ? (n.id || n.tag) : null;
    };
    // Текущий трек: своего геттера у $.sound нет, а прогон кладёт отчёт в state.
    U.musicTrack = () => (($.timeline.state() || {}).restored || {}).music || null;
    U.musicPlaying = () => ($.sound.musicPlaying ? $.sound.musicPlaying() : null);
    U.musicFile = () => MUSIC_FILE;
    // transition: 'none' — тест не должен ждать затухание, чтобы увидеть прогон.
    U.playIntro = () => { U.clearMarkerEvents(); return $.timeline.play('intro', { transition: 'none' }); };
    U.timelineState = () => $.timeline.state();
    U.stopIntro = () => $.timeline.stop('test');
    U.skipIntro = () => $.timeline.skip();
    U.timelineListeners = () => $.timeline.listenerCount();
    U.i18nListeners = () => $.i18n.listenerCount();
    U.dialogBound = () => $.dialog.langBound();
    U.dialogRunning = () => $.dialog.isOpen();
    U.uiNodeCount = () => $('#hud, #hud_hp, #hud_bar, #hud_tr, #temp_window').nodes.length;

    // Камера и звук: timeline обязан вернуть их по контракту (§16).
    U.cameraTarget = () => ($.camera.followed ? $.camera.followed() : null);
    U.musicLayers = () => ($.sound && $.sound.musicLayers ? $.sound.musicLayers().length : 0);
});
