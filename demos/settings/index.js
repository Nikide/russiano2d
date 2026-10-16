// ===========================================================================
// Эталонное меню настроек (демо).
//
// Отвечает на вопрос «дорого ли сделать на нашем движке полноценное меню
// настроек»: четыре вкладки (Графика / Звук / Управление / Язык), всё
// применяется НА ЛЕТУ, сохраняется через $.store и переживает перезапуск.
//
// Как устроено (и почему именно так):
//   * интерфейс — документ RmlUi `demos/settings/settings.rml` (закон
//     docs/UI_RMLUI_LAW.md: меню и экраны делаются только так). Разметка
//     статическая: строки видно глазами и копируют как образец, JS только
//     связывает их с настройками по id;
//   * настройки живут в $.store отдельным файлом settings.json (своего
//     «$.settings» в движке нет — это и есть рекомендуемый приём);
//   * кольцо выбора (row.sel) ведёт JS: клавиатура (стрелки), геймпад
//     (d-pad/стик) и мышь работают по одному и тому же коду. Почему не
//     $.ui.gamepadNavigation: он превращает геймпад в синтетические клавиши
//     для слоя `$`-виджетов и документы RmlUi этим путём НЕ ходят
//     (docs/highlevel/input.md §15) — поэтому документу нужен свой мост, и он
//     здесь: ~40 строк;
//   * захват клавиши — $.input.waitForInput() (в движке уже есть; отдельный
//     $.input.capture не нужен), конфликты показывает $.input.conflicts();
//   * контекст ввода `settings` включается, пока меню открыто, и «съедает»
//     подтверждение (consume), чтобы меню и игра не сработали одной клавишей.
//
// Запуск:
//   ./build/russiano2d --game demos --scene settings
//
// Числа этого образца (замер на живой сборке) — в docs/tutorial-settings.md.
// ===========================================================================

const DOC = 'demos/settings/settings.rml';

// Файл настроек: отдельный от save.json, чтобы сброс настроек не трогал
// прохождение игры.
const SETTINGS_FILE = 'settings.json';

// Действия, которые переназначаются во вкладке «Управление». Порядок = порядок
// строк в разметке.
const ACTIONS = [
    { action: 'jump', id: 'c-jump', label: 'Прыжок', def: ['space', 'w', 'gamepad.a'] },
    { action: 'left', id: 'c-left', label: 'Влево', def: ['a', 'left', 'gamepad.dpleft'] },
    { action: 'right', id: 'c-right', label: 'Вправо', def: ['d', 'right', 'gamepad.dpright'] },
    { action: 'attack', id: 'c-attack', label: 'Действие', def: ['j', 'gamepad.x'] },
];

const LANG_KEY = 'lang.code';

// Словари: свои ключи меню + уже существующие ключи движка не трогаем.
const DICT = {
    ru: {
        'settings.title': 'Настройки',
        'settings.tab.graphics': 'Графика',
        'settings.tab.sound': 'Звук',
        'settings.tab.controls': 'Управление',
        'settings.tab.lang': 'Язык',
        'settings.g.fullscreen': 'Полный экран',
        'settings.g.mode': 'Разрешение',
        'settings.g.scale': 'Масштаб интерфейса',
        'settings.g.smaa': 'Сглаживание SMAA',
        'settings.g.fps': 'Показывать FPS',
        'settings.s.master': 'Общая громкость',
        'settings.s.sfx': 'Эффекты',
        'settings.s.music': 'Музыка',
        'settings.s.mute': 'Тишина',
        'settings.s.test': 'Проверить звук',
        'settings.c.jump': 'Прыжок',
        'settings.c.left': 'Влево',
        'settings.c.right': 'Вправо',
        'settings.c.attack': 'Действие',
        'settings.c.gamepad': 'Навигация геймпадом',
        'settings.c.reset': 'Сбросить управление',
        'settings.l.reset': 'Сбросить все настройки',
        'settings.yes': 'да',
        'settings.no': 'нет',
        'settings.chosen': 'выбрана',
        'settings.notChosen': '—',
        'settings.pressEnter': 'нажмите Enter',
        'settings.pressKey': 'нажмите клавишу…',
        'settings.waiting': 'ждём клавишу (Esc — отмена)',
        'settings.on': 'включено',
        'settings.off': 'выключено',
        'settings.windowed': 'окно',
        'settings.desktop': 'рабочий стол',
        'settings.exclusive': 'эксклюзивно',
    },
    en: {
        'settings.title': 'Settings',
        'settings.tab.graphics': 'Graphics',
        'settings.tab.sound': 'Sound',
        'settings.tab.controls': 'Controls',
        'settings.tab.lang': 'Language',
        'settings.g.fullscreen': 'Fullscreen',
        'settings.g.mode': 'Resolution',
        'settings.g.scale': 'UI scale',
        'settings.g.smaa': 'SMAA antialiasing',
        'settings.g.fps': 'Show FPS',
        'settings.s.master': 'Master volume',
        'settings.s.sfx': 'Effects',
        'settings.s.music': 'Music',
        'settings.s.mute': 'Mute',
        'settings.s.test': 'Test sound',
        'settings.c.jump': 'Jump',
        'settings.c.left': 'Left',
        'settings.c.right': 'Right',
        'settings.c.attack': 'Action',
        'settings.c.gamepad': 'Gamepad navigation',
        'settings.c.reset': 'Reset controls',
        'settings.l.reset': 'Reset all settings',
        'settings.yes': 'yes',
        'settings.no': 'no',
        'settings.chosen': 'selected',
        'settings.notChosen': '—',
        'settings.pressEnter': 'press Enter',
        'settings.pressKey': 'press a key…',
        'settings.waiting': 'waiting for a key (Esc cancels)',
        'settings.on': 'on',
        'settings.off': 'off',
        'settings.windowed': 'windowed',
        'settings.desktop': 'desktop',
        'settings.exclusive': 'exclusive',
    },
};

// Значения по умолчанию: одно место правды и для первого запуска, и для сброса.
function defaults() {
    return {
        'gfx.fullscreen': 'windowed',
        'gfx.modeIndex': -1,          // -1 — «режим рабочего стола», не трогаем
        'gfx.scale': 1,
        'gfx.smaa': 'off',            // off | medium | high
        'gfx.fps': true,
        'snd.master': 0.8,
        'snd.sfx': 0.8,
        'snd.music': 0.6,
        'snd.mute': false,
        'ctl.gamepad': true,
        [LANG_KEY]: 'ru',
    };
}

export default function installSettings($) {
    // --- Состояние модуля ---------------------------------------------------
    const state = {
        built: false,
        open: false,
        scene: null,        // сцена, из которой открыли меню (для возврата)
        tab: 'graphics',
        sel: 0,
        root: [],           // строки активной вкладки (id + как менять значение)
        capturing: null,    // строка, которая ждёт клавишу
        modes: [],          // $.window.displayModes()
        openMs: 0,          // сколько заняло открытие экрана (мс)
        applyMs: 0,         // сколько заняло последнее применение (мс)
        applyLog: [],       // [{ key, ms }] — для отчёта и теста
        saves: 0,
        saveMs: 0,
        resetMs: 0,       // полный сброс всех настроек (мс)
        toggleMs: 0,      // показать/скрыть уже загруженный документ (мс)
        frames: 0,
    };

    const doc = () => {
        const d = $.ui.doc(DOC);
        return d && d.id >= 0 ? d : null;
    };
    const tr = (key) => $.tr(key, {}, key);

    // Файл настроек: отдельный от save.json игры. Читаем его сразу: без
    // $.store.load() значения лежали бы на диске, но движок брал бы дефолты
    // (проверено — «настройки не переживали перезапуск» именно из-за этого).
    $.store.file(SETTINGS_FILE);
    $.store.load(SETTINGS_FILE);

    // Словари меню: $.i18n.add сливает ключи, повторный вызов безопасен.
    // Без этой регистрации $.tr вернул бы сам ключ (проверено на живом прогоне:
    // в подписи было «settings.g.smaa» вместо «Сглаживание SMAA»).
    $.i18n.add('ru', DICT.ru);
    $.i18n.add('en', DICT.en);

    // --- Настройки: чтение, запись, применение ------------------------------
    function readAll() {
        const def = defaults();
        const out = {};
        for (const key of Object.keys(def)) out[key] = $.store.get('settings.' + key, def[key]);
        for (const item of ACTIONS) {
            const saved = $.store.get('binds.' + item.action, null);
            out['bind.' + item.action] = Array.isArray(saved) && saved.length ? saved : item.def.slice();
        }
        return out;
    }

    /** Применить одну настройку к движку. Возвращает то, что применилось. */
    function apply(key, value) {
        const t0 = $.time.perfNow();
        if (key === 'gfx.fullscreen') {
            if (value === 'windowed') $.window.fullscreen(false);
            else if (value === 'desktop') $.window.fullscreen(true);
            else {
                const mode = state.modes[state.values['gfx.modeIndex']];
                $.window.fullscreen({ mode: 'exclusive', width: mode ? mode.width : 0,
                                      height: mode ? mode.height : 0,
                                      refresh: mode ? mode.refresh : 0 });
            }
            // ВАЖНО (находка task-41): сразу после смены режима окну нужно 4–6
            // кадров устояться. Мгновенная проверка ввода в этот момент теряет
            // нажатие, поэтому меню не ждёт немедленного эха, а кольцо выбора
            // продолжает жить по своему состоянию.
        } else if (key === 'gfx.modeIndex') {
            const mode = state.modes[value];
            if (mode && state.values['gfx.fullscreen'] === 'exclusive') {
                $.window.fullscreen({ mode: 'exclusive', width: mode.width,
                                      height: mode.height, refresh: mode.refresh });
            }
        } else if (key === 'gfx.scale') {
            $.ui.scale(value);
        } else if (key === 'gfx.smaa') {
            // $.gfx.smaa({preset}) задаёт только качество поиска: включение —
            // отдельный флаг (проверено: после preset:'medium' было on:false).
            if (value === 'off') $.gfx.smaa(false);
            else $.gfx.smaa({ on: true, preset: value });
        } else if (key === 'gfx.fps') {
            const d = doc();
            if (d) d.style('fps', 'visibility', value ? 'visible' : 'hidden');
        } else if (key === 'snd.master') {
            $.sound.volume(value);
        } else if (key === 'snd.sfx') {
            $.sound.sfxVolume(value);
        } else if (key === 'snd.music') {
            $.sound.musicVolume(value);
        } else if (key === 'snd.mute') {
            $.sound.mute(value);
        } else if (key === 'ctl.gamepad') {
            // Слой `$`-виджетов: геймпад → синтетические клавиши. Документы
            // RmlUi этим путём не ходят, поэтому кольцо в этом меню ведёт
            // собственный код (padTick) — см. шапку файла.
            $.ui.gamepadNavigation(!!value, { repeatDelay: 0.4, repeatRate: 0.12 });
        } else if (key.startsWith('bind.')) {
            const action = key.slice(5);
            $.input.bind(action, value);
        } else if (key === LANG_KEY) {
            $.i18n.lang(value);
            retranslate();
        }
        state.applyMs = $.time.perfNow() - t0;
        state.applyLog.push({ key, ms: state.applyMs });
        if (state.applyLog.length > 40) state.applyLog.shift();
        return state.applyMs;
    }

    function store(key, value, opts) {
        $.store.set('settings.' + key, value);
        state.values[key] = value;
        apply(key, value);
        render(key);
        if (!opts || opts.save !== false) saveSoon();
    }

    // Запись на диск: настройки меняются пачками (стрелка удерживается), поэтому
    // пишем один раз через 250 мс после последней правки. autoSave() у $.store
    // тоже есть (раз в 30 с по игровому времени), но для меню нужно быстрее.
    let saveTimer = 0;
    function saveSoon() {
        // Таймеры движка, а не setTimeout: в QuickJS его нет (проверено),
        // а $.time.after живёт по игровому времени и снимается $.time.cancel.
        if (saveTimer) $.time.cancel(saveTimer);
        saveTimer = $.time.after(250, () => {
            saveTimer = 0;
            const t0 = $.time.perfNow();
            $.store.file(SETTINGS_FILE).save();
            state.saveMs = $.time.perfNow() - t0;
            state.saves += 1;
            say($.tr('settings.saved', {}, 'настройки сохранены') + ' · ' + SETTINGS_FILE);
        });
    }

    function saveNow() {
        if (saveTimer) { $.time.cancel(saveTimer); saveTimer = 0; }
        const t0 = $.time.perfNow();
        $.store.file(SETTINGS_FILE).save();
        state.saveMs = $.time.perfNow() - t0;
        state.saves += 1;
    }

    // --- Что показывать в строках ------------------------------------------
    function label(key) {
        const map = {
            'gfx.fullscreen': 'settings.g.fullscreen',
            'gfx.modeIndex': 'settings.g.mode',
            'gfx.scale': 'settings.g.scale',
            'gfx.smaa': 'settings.g.smaa',
            'gfx.fps': 'settings.g.fps',
            'snd.master': 'settings.s.master',
            'snd.sfx': 'settings.s.sfx',
            'snd.music': 'settings.s.music',
            'snd.mute': 'settings.s.mute',
            'snd.test': 'settings.s.test',
            'ctl.gamepad': 'settings.c.gamepad',
            'ctl.reset': 'settings.c.reset',
            'lang.ru': 'lang.ru',
            'lang.en': 'lang.en',
            'lang.reset': 'settings.l.reset',
        };
        if (key.startsWith('bind.')) {
            const item = ACTIONS.find((a) => a.action === key.slice(5));
            return item ? item.label : key;
        }
        return map[key] ? tr(map[key]) : key;
    }

    function valueText(key) {
        const v = state.values[key];
        if (key === 'gfx.fullscreen') return tr('settings.' + v);
        if (key === 'gfx.modeIndex') {
            const mode = state.modes[v];
            return mode ? (mode.width + '×' + mode.height + ' @' + mode.refresh + ' Гц') : '—';
        }
        if (key === 'gfx.scale') return Number(v).toFixed(2) + '×';
        if (key === 'gfx.smaa') return v === 'off' ? tr('settings.off') : String(v);
        if (key === 'gfx.fps' || key === 'snd.mute' || key === 'ctl.gamepad') {
            return v ? tr('settings.yes') : tr('settings.no');
        }
        if (key === 'snd.master' || key === 'snd.sfx' || key === 'snd.music') {
            return Math.round(v * 100) + '%';
        }
        if (key.startsWith('bind.')) {
            const keys = state.values[key];
            return ($.input.glyphs ? $.input.glyphs(key.slice(5)) : keys).join(' / ').toUpperCase();
        }
        if (key === 'lang.ru' || key === 'lang.en') {
            const code = key.slice(5);
            return $.i18n.lang() === code ? tr('settings.chosen') : tr('settings.notChosen');
        }
        return String(v);
    }

    // --- Разметка строк: id → настройка ------------------------------------
    function rowsFor(tab) {
        if (tab === 'graphics') {
            return [row('g-fullscreen', 'gfx.fullscreen', 'cycle'),
                    row('g-mode', 'gfx.modeIndex', 'cycle'),
                    row('g-scale', 'gfx.scale', 'slider', { min: 0.75, max: 2, step: 0.25 }),
                    row('g-smaa', 'gfx.smaa', 'cycle'),
                    row('g-fps', 'gfx.fps', 'toggle')];
        }
        if (tab === 'sound') {
            return [row('s-master', 'snd.master', 'slider', { min: 0, max: 1, step: 0.05 }),
                    row('s-sfx', 'snd.sfx', 'slider', { min: 0, max: 1, step: 0.05 }),
                    row('s-music', 'snd.music', 'slider', { min: 0, max: 1, step: 0.05 }),
                    row('s-mute', 'snd.mute', 'toggle'),
                    row('s-test', 'snd.test', 'action')];
        }
        if (tab === 'controls') {
            const list = ACTIONS.map((a) => row(a.id, 'bind.' + a.action, 'key'));
            list.push(row('c-gamepad', 'ctl.gamepad', 'toggle'));
            list.push(row('c-reset', 'ctl.reset', 'action'));
            return list;
        }
        return [row('l-ru', 'lang.ru', 'action'),
                row('l-en', 'lang.en', 'action'),
                row('l-reset', 'lang.reset', 'action')];
    }

    function row(id, key, kind, opts) {
        return Object.assign({ id, key, kind, text: valueText(key) }, opts || {});
    }

    /** Вкладка строки — по префиксу id: g-*, s-*, c-*, l-*. */
    function tabOf(id) {
        const map = { g: 'graphics', s: 'sound', c: 'controls', l: 'lang' };
        return map[id.charAt(0)] || null;
    }

    // --- Отрисовка ----------------------------------------------------------
    function render(key) {
        const d = doc();
        if (!d) return;
        for (const item of state.root) {
            if (key && item.key !== key) continue;
            const text = valueText(item.key);
            d.text('val-' + item.id, text);
            const fill = fillPercent(item);
            if (fill !== null) d.style('fill-' + item.id, 'width', fill + '%');
        }
        d.text('status', statusLine());
    }

    function fillPercent(item) {
        if (item.kind !== 'slider') return null;
        const min = item.min === undefined ? 0 : item.min;
        const max = item.max === undefined ? 1 : item.max;
        return Math.round(((state.values[item.key] - min) / (max - min)) * 100);
    }

    function statusLine() {
        const busy = $.sound.busy();
        const parts = [$.tr('settings.status.channels', { busy: busy.active, total: busy.total },
                            'каналов ' + busy.active + '/' + busy.total),
                       $.tr('settings.status.save', { n: state.saves }, 'сохранений: ' + state.saves)];
        if (state.capturing) parts.push(tr('settings.waiting'));
        return parts.join(' · ');
    }

    function say(text) {
        const d = doc();
        if (d) d.text('status', text + ' · ' + statusLine());
    }

    /** Перерисовать подписи после смены языка (без перезапуска). */
    function retranslate() {
        const d = doc();
        if (!d) return;
        d.text('title', tr('settings.title'));
        for (const [id, key] of [['tab-graphics', 'settings.tab.graphics'],
                                 ['tab-sound', 'settings.tab.sound'],
                                 ['tab-controls', 'settings.tab.controls'],
                                 ['tab-lang', 'settings.tab.lang']]) {
            d.text(id, tr(key));
        }
        for (const item of state.root) d.text('lbl-' + item.id, label(item.key));
        for (const tab of ['graphics', 'sound', 'controls', 'lang']) {
            for (const item of rowsFor(tab)) d.text('lbl-' + item.id, label(item.key));
        }
        render();
    }

    // --- Кольцо выбора ------------------------------------------------------
    function setTab(tab) {
        const d = doc();
        if (!d) return;
        state.tab = tab;
        state.root = rowsFor(tab);
        for (const name of ['graphics', 'sound', 'controls', 'lang']) {
            d.cls('page-' + name, 'on', name === tab);
            d.cls('tab-' + name, 'on', name === tab);
        }
        select(0);
        render();
    }

    function select(index) {
        const d = doc();
        if (!d || !state.root.length) return;
        const count = state.root.length;
        state.sel = ((index % count) + count) % count;
        for (let i = 0; i < count; i++) {
            d.cls('row-' + state.root[i].id, 'sel', i === state.sel);
        }
    }

    function current() { return state.root[state.sel]; }

    // --- Изменение значений -------------------------------------------------
    function change(item, direction) {
        if (!item) return;
        const key = item.key;
        if (item.kind === 'slider') {
            const min = item.min === undefined ? 0 : item.min;
            const max = item.max === undefined ? 1 : item.max;
            const step = item.step || 0.05;
            let v = Number(state.values[key]) + direction * step;
            v = Math.min(max, Math.max(min, Math.round(v * 1000) / 1000));
            store(key, v);
        } else if (item.kind === 'toggle') {
            store(key, !state.values[key]);
        } else if (item.kind === 'cycle') {
            const options = cycleOptions(key);
            const at = options.indexOf(state.values[key]);
            const next = options[((at < 0 ? 0 : at) + direction + options.length) % options.length];
            store(key, next);
        } else if (item.kind === 'key') {
            capture(item);
        } else if (item.kind === 'action') {
            runAction(key);
        }
    }

    function cycleOptions(key) {
        if (key === 'gfx.fullscreen') return ['windowed', 'desktop', 'exclusive'];
        if (key === 'gfx.smaa') return ['off', 'medium', 'high'];
        if (key === 'gfx.modeIndex') {
            // Пустой список режимов (headless, веб) — не ломаемся, показываем
            // единственный вариант «как есть».
            if (!state.modes.length) return [-1];
            const indexes = state.modes.map((_, i) => i);
            return [-1].concat(indexes);
        }
        return [];
    }

    function runAction(key) {
        if (key === 'snd.test') {
            $.sound.play('demos/assets/audio/sfx/ui_click.ogg', { volume: 0.5 });
            state.applied = $.time.perfNow();
            say($.tr('settings.test.sound', {}, 'звук играет: проверьте каналы и громкость'));
        } else if (key === 'ctl.reset') {
            for (const item of ACTIONS) store('bind.' + item.action, item.def.slice());
            $.input.resetDefaults();
            say($.tr('settings.reset.controls', {}, 'управление сброшено к эталону'));
        } else if (key === 'lang.ru' || key === 'lang.en') {
            store(LANG_KEY, key.slice(5));
            say($.tr('settings.lang.applied', {}, 'язык применён на лету'));
        } else if (key === 'lang.reset') {
            resetAll();
        }
    }

    /** Сброс к значениям по умолчанию: и в движке, и в файле настроек. */
    function resetAll() {
        const t0 = $.time.perfNow();
        const def = defaults();
        for (const key of Object.keys(def)) {
            state.values[key] = def[key];
            $.store.set('settings.' + key, def[key]);
            apply(key, def[key]);
        }
        for (const item of ACTIONS) {
            state.values['bind.' + item.action] = item.def.slice();
            $.store.set('binds.' + item.action, item.def.slice());
            apply('bind.' + item.action, item.def.slice());
        }
        const d = doc();
        if (d) d.cls('row-l-reset', 'capture', true);
        $.time.after(400, () => { const dd = doc(); if (dd) dd.cls('row-l-reset', 'capture', false); });
        render();
        saveNow();
        state.resetMs = $.time.perfNow() - t0;
        say($.tr('settings.reset.all', {}, 'все настройки сброшены') + ' · '
            + Math.round(state.resetMs * 1000) + ' мкс');
    }

    // --- Захват клавиши -----------------------------------------------------
    // $.input.waitForInput() — штатный способ: отдаёт имя клавиши, умеет timeout,
    // отменяется $.input.cancelWaits(). Пока идёт захват, меню не реагирует на
    // навигацию: иначе нажатая клавиша одновременно и переназначилась бы, и
    // переключила строку.
    function capture(item) {
        if (state.capturing) return;
        const d = doc();
        const action = item.key.slice(5);
        state.capturing = item;
        if (d) d.cls('row-' + item.id, 'capture', true);
        say(tr('settings.waiting'));
        $.input.waitForInput({ timeout: 5000, ignore: ['escape'] }).then((key) => {
            const dd = doc();
            state.capturing = null;
            if (dd) dd.cls('row-' + item.id, 'capture', false);
            if (!key) { say($.tr('settings.capture.timeout', {}, 'захват отменён')); return; }
            const conflicts = $.input.conflicts ? $.input.conflicts(action, [key]) : [];
            store('bind.' + action, [key]);
            if (conflicts.length) {
                say($.tr('settings.capture.conflict', { n: conflicts.length },
                         'назначено, но клавиша занята ещё у ' + conflicts.length + ' действий'));
            } else {
                say($.tr('settings.capture.done', { key }, key + ' назначена'));
            }
        }).catch(() => {
            const dd = doc();
            state.capturing = null;
            if (dd) dd.cls('row-' + item.id, 'capture', false);
        });
    }

    // --- Ввод: клавиатура, геймпад, мышь ------------------------------------
    function bindKeys() {
        // Игровые действия: их и переназначает вкладка «Управление». Эталон
        // (markDefaults) — чтобы $.input.resetDefaults() возвращал именно наши
        // значения по умолчанию, а не то, что успели навязать демо-сцены.
        for (const item of ACTIONS) $.input.bind(item.action, item.def.slice());
        $.input.markDefaults();
        // Контекст ввода: пока меню открыто, оно приоритетнее игры, а confirm
        // «съедается», чтобы одна клавиша не сработала дважды (§15).
        $.input.context('settings', {
            active: false,
            priority: 40,
            binds: {
                menu_up: ['up', 'w', 'gamepad.dpup'],
                menu_down: ['down', 's', 'gamepad.dpdown'],
                menu_left: ['left', 'a', 'gamepad.dpleft'],
                menu_right: ['right', 'd', 'gamepad.dpright'],
                menu_confirm: ['enter', 'space', 'gamepad.a'],
                menu_back: ['escape', 'gamepad.b'],
                menu_tab: ['tab'],
            },
        });
    }

    function inputFrame() {
        const d = doc();
        if (!d || !state.open) return;
        const tabs = ['graphics', 'sound', 'controls', 'lang'];

        if ($.input.pressed('menu_tab')) {
            setTab(tabs[(tabs.indexOf(state.tab) + 1) % tabs.length]);
            $.input.consume('menu_tab');
        }
        if ($.input.pressed('menu_down')) { select(state.sel + 1); $.input.consume('menu_down'); }
        if ($.input.pressed('menu_up')) { select(state.sel - 1); $.input.consume('menu_up'); }
        if ($.input.pressed('menu_left')) { change(current(), -1); $.input.consume('menu_left'); }
        if ($.input.pressed('menu_right')) { change(current(), +1); $.input.consume('menu_right'); }
        if ($.input.pressed('menu_confirm')) {
            const item = current();
            if (item) change(item, +1);
            $.input.consume('menu_confirm');
        }
        if ($.input.pressed('menu_back')) {
            $.input.consume('menu_back');
            if (state.capturing) { $.input.cancelWaits('menu'); return; }
            close();
        }
    }

    // Геймпад: тот же код, что у клавиатуры, но своим кольцом. Документы RmlUi
    // не получают синтетические клавиши `$`, поэтому мост живёт здесь.
    let padRepeat = 0;
    function padTick(dt) {
        if (!state.open || !state.values['ctl.gamepad']) return;
        const pad = $.input.gamepad(0);
        if (!pad || !pad.connected()) return;
        padRepeat -= dt;
        if (padRepeat > 0) return;
        const step = (name, delta) => {
            if (pad.pressed(name)) { delta(); padRepeat = 0.18; return true; }
            return false;
        };
        const up = pad.down('dpup') || pad.axis(1) < -0.6;
        const down = pad.down('dpdown') || pad.axis(1) > 0.6;
        const left = pad.down('dpleft') || pad.axis(0) < -0.6;
        const right = pad.down('dpright') || pad.axis(0) > 0.6;
        if (up) { select(state.sel - 1); padRepeat = 0.18; }
        else if (down) { select(state.sel + 1); padRepeat = 0.18; }
        else if (left) { change(current(), -1); padRepeat = 0.18; }
        else if (right) { change(current(), +1); padRepeat = 0.18; }
        else if (step('a', () => change(current(), +1))) { /* подтверждение */ }
        else if (step('b', () => close())) { /* назад */ }
    }

    // --- Открытие и закрытие ------------------------------------------------
    function build() {
        const d = doc();
        if (!d) return false;
        bindKeys();
        for (const [id, tab] of [['tab-graphics', 'graphics'], ['tab-sound', 'sound'],
                                 ['tab-controls', 'controls'], ['tab-lang', 'lang']]) {
            d.on(id, 'click', () => setTab(tab));
        }
        // Мышь: клик по строке = то же, что Enter; hover подсвечивает строку.
        for (const tab of ['graphics', 'sound', 'controls', 'lang']) {
            for (const item of rowsFor(tab)) {
                d.on('row-' + item.id, 'click', () => {
                    // Строка скрытой вкладки на клик не реагирует: программный
                    // doc.click(id) иначе менял бы настройку невидимой страницы.
                    if (tabOf(item.id) !== state.tab) return;
                    const at = state.root.findIndex((r) => r.id === item.id);
                    if (at < 0) return;
                    if (state.sel !== at) { select(at); return; }   // первый клик — выбор
                    change(item, +1);                              // повторный — действие
                });
                d.on('row-' + item.id, 'mouseover', () => {
                    if (tabOf(item.id) !== state.tab) return;
                    const at = state.root.findIndex((r) => r.id === item.id);
                    if (at >= 0 && state.root[state.sel].id !== item.id) select(at);
                });
            }
        }
        return true;
    }

    function enter(previous) {
        const t0 = $.time.perfNow();
        const d = doc();
        if (!d) { $.log('настройки: не удалось загрузить ' + DOC); return false; }
        // Откуда пришли — туда Esc и вернёт: игру открывает меню так:
        //   $.scene.load('settings', { from: $.scene.current() })
        state.scene = previous || null;
        state.values = readAll();
        state.modes = ($.window.displayModes() || []).slice(0, 64);
        if (!state.built) { state.built = build(); }
        if (!state.built) return false;

        // Применяем сохранённое: игра должна получить те же настройки, что были
        // в прошлый раз, ещё до первого кадра с меню.
        for (const key of Object.keys(state.values)) apply(key, state.values[key]);
        for (const item of ACTIONS) apply('bind.' + item.action, state.values['bind.' + item.action]);
        $.ui.scale(state.values['gfx.scale']);
        setTab(state.tab || 'graphics');
        retranslate();
        d.show();
        $.input.context('settings').active(true);
        if (state.values['ctl.gamepad']) {
            $.ui.gamepadNavigation(true, { repeatDelay: 0.4, repeatRate: 0.12 });
        }
        state.open = true;
        state.openMs = $.time.perfNow() - t0;
        say($.tr('settings.opened', {}, 'настройки открыты'));
        return true;
    }

    function close() {
        const d = doc();
        state.open = false;
        state.capturing = null;
        $.input.cancelWaits('close');
        $.input.context('settings').active(false);
        if (d) d.hide();
        saveNow();
        const back = state.scene;
        state.scene = null;
        if (back && back !== 'settings') $.scene.load(back);
    }

    // --- Сцена --------------------------------------------------------------
    $.scene.add('settings', {
        enter($, scope) {
            if (!enter(scope && scope.from ? scope.from : null)) return;
            $.world.color('#0b1220');
        },
        exit() {
            const d = doc();
            if (d) d.hide();
            state.open = false;
            $.input.context('settings').active(false);
        },
        update(dt) {
            state.frames += 1;
            inputFrame();
            padTick(dt);
            if (state.frames % 15 === 0) {
                const d = doc();
                if (d) d.text('fps', Math.round($.ui.fps()) + ' FPS');
            }
        },
    });

    // --- Факты для агента и тестов -----------------------------------------
    // Игра сама рассказывает о себе: тест читает эти поля из снимка, а не
    // парсит разметку.
    $.agent.expose('settings', () => ({
        open: state.open,
        tab: state.tab,
        selected: current() ? current().id : null,
        capturing: state.capturing ? state.capturing.id : null,
        values: Object.assign({}, state.values),
        modes: state.modes.length,
        openMs: Math.round(state.openMs * 1000) / 1000,
        applyMs: Math.round(state.applyMs * 1000) / 1000,
        applyUs: Math.round(state.applyMs * 1000),     // микросекунды: мс на дешёвых вызовах дают 0
        applyLog: state.applyLog.slice(-8),
        saves: state.saves,
        saveMs: Math.round(state.saveMs * 1000) / 1000,
        resetMs: Math.round(state.resetMs * 1000) / 1000,
        toggleMs: Math.round(state.toggleMs * 1000) / 1000,
        frames: state.frames,
        file: SETTINGS_FILE,
        rows: state.root.length,
    }));
}
