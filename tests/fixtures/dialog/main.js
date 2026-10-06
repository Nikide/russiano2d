// Фикстура теста диалогов, экранов и текстовых стилей.
//
// Проверяется через агентский протокол (tests/agent/highlevel_dialog_test.py):
//   * $.font   — стили hud/title, наследование base, применение к узлу;
//   * $.screen — экран паузы: раскладка строками, фокус по кругу, стрелки,
//                Enter, мышь и Escape;
//   * $.dialog — стражник с ветками и условием, печатная машинка, ключ i18n.
//
// Требует, чтобы в src/highlevel/api.js были подключены installDialog и
// tickDialog из dialog.js (installFont/installScreen/tickScreen — уже там).
$.ready(() => {
    $.world.color('#101820').bounds(0, 0, 800, 600);

    // --- $.font: именованные стили ----------------------------------------
    $.font.define('hud', { size: 20, color: '#ffffff', align: 'center' });
    $.font.define('title', { base: 'hud', size: 30, color: '#ffd166' });

    $('<ui.label>', { id: 'hud_label', text: 'Счёт: 0' }).at(120, 40).size(240, 30);
    $.font.apply('#hud_label', 'hud');

    // --- $.screen: экран паузы --------------------------------------------
    $.screen.define('pause', {
        anchor: 'center', gap: 10, padding: 16, backdrop: true,
        rows: [
            { id: 'pause_title', tag: 'ui.label', text: 'Пауза', style: 'title', h: 40 },
            { id: 'resume', text: 'Продолжить' },
            { id: 'quit', text: 'В меню', action: 'quit', on: { click: () => $.store.set('clicked', true) } },
        ],
    });
    $.screen.on('activate', (e) => $.store.set('screen_action', e.id));
    $.screen.on('focus', (e) => $.store.set('screen_focus', e.id));
    $.screen.on('close', () => $.store.set('screen_closed', true));

    // --- $.dialog: стражник с ветками и условием --------------------------
    $.dialog.define('guard', {
        start: 'hello',
        nodes: {
            hello: {
                speaker: 'Стражник',
                portrait: 'art/guard.png',
                text: 'Стой! Кто идёт?',
                choices: [
                    { text: 'Я свой', to: 'pass', if: 'has_pass' },
                    { text: 'Уйти', to: null, do: () => $.store.set('left', true) },
                ],
            },
            pass: { text: 'Проходи.', to: 'bye' },
            bye: { text: 'Не задерживайся.', to: null },
        },
    });

    // Реплика с ложным условием не показывается вовсе.
    $.dialog.define('locked', {
        nodes: {
            start: { text: 'Первая', to: 'secret' },
            secret: { text: 'Секретная', if: 'has_pass', to: 'final' },
            final: { text: 'Финал', to: null },
        },
    });

    // Текст по ключу словаря: ключ подставляется переводом.
    $.i18n.add('ru', { 'dlg.greet': 'Привет, {name}!' });
    $.dialog.define('greet', { nodes: { start: { text: 'dlg.greet', to: null } } });

    // --- События диалога — в store, чтобы их читал тест -------------------
    $.dialog.on('line', (e) => $.store.set('dialog_line', e.id));
    $.dialog.on('choice', (e) => $.store.set('dialog_choice', e.text));
    $.dialog.on('end', (e) => {
        $.store.set('dialog_end', e.reason);
        $.store.set('talked', $.store.get('talked', 0) + 1);
    });

    // --- Начальные значения -----------------------------------------------
    $.store.set('has_pass', false);
    $.store.set('left', false);
    $.store.set('clicked', false);
    $.store.set('talked', 0);
    $.store.set('dialog_line', null);
    $.store.set('dialog_choice', null);
    $.store.set('dialog_end', null);
    $.store.set('screen_action', null);
    $.store.set('screen_focus', null);
    $.store.set('screen_closed', false);
});
