// ===========================================================================
// Диалоги и квестовые реплики: $.dialog — ветвящиеся разговоры данными.
//
// Зачем: реплики NPC, выборы игрока и квестовые ветки — это данные плюс
// маленькая машина состояний. Здесь диалог описывается одним объектом, а
// модуль ведёт состояние, печатает текст по буквам, рисует панель с портретом,
// именем и кнопками выбора:
//
//   $.dialog.define('guard', {
//       start: 'hello',
//       nodes: {
//           hello: { speaker: 'Стражник', portrait: 'art/guard.png',
//                    text: 'Стой! Кто идёт?',
//                    choices: [
//                        { text: 'Я свой', to: 'pass', if: 'has_pass' },
//                        { text: 'Уйти', to: null, do: () => $.store.set('left', true) },
//                    ] },
//           pass: { text: 'Проходи.', to: null },
//       },
//   });
//   $.dialog.play('guard');
//   $.dialog.on('end', () => $.store.set('talking', false));
//
// Ключевые решения:
//   * вся логика ветвления — чистые функции (conditionValue, visibleChoices,
//     advanceTyping, wrapDialogText): их гоняет qjs-харнесс без движка (§4);
//   * текст реплики можно задать строкой, массивом страниц или функцией —
//     последнее удобно для «Привет, {name}» из состояния игры;
//   * если строка совпала с ключом $.i18n (i18n.has), она переводится; иначе
//     остаётся как есть — отличить ключ от литерала иначе нельзя;
//   * условие (if) понимает функцию, boolean и строку-флаг: строка ищется в
//     $.dialog.flag() и в $.store — так ветку можно задать данными;
//   * узел с ложным if не показывается вовсе: переход идёт по его to/next.
// ===========================================================================

import { engine } from './native.js';
import { ctx, packColor, wrapOne } from './core.js';
import { measureFontText } from './font.js';
import { DialogThemes, validateMarkup } from './dialog_theme.js';
import { createDialogView, makeUiBackend } from './dialog_view.js';

// ---------------------------------------------------------------------------
// Настройки по умолчанию
// ---------------------------------------------------------------------------

const DEFAULTS = {
    speed: 40,                 // символов в секунду (печатная машинка)
    width: 640,                // ширина панели
    height: 132,               // высота текстовой части
    margin: 24,                // отступ от низа и краёв окна
    padding: 16,
    portrait: 96,              // сторона портрета
    lineSize: 20,              // размер строки реплики
    lineHeight: 1.35,
    maxLines: 4,
    maxChoices: 6,
    choiceH: 30,
    choiceGap: 6,
    panelColor: '#101722ee',
    textColor: '#ffffff',
    speakerColor: '#ffd166',
    choiceColor: '#22304aee',
    choiceHoverColor: '#2e405f',
};

// ---------------------------------------------------------------------------
// Чистые помощники (экспортируются — тестируются без движка)
// ---------------------------------------------------------------------------

function num(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

/**
 * Значение условия. Понимает:
 *   * undefined/null → true (условия нет);
 *   * функцию → !!fn() (исключение = false + сообщение в лог);
 *   * boolean → как есть;
 *   * строку/число → флаг с таким именем: flags(name).
 * flags — функция (name) → значение; её подставляет $.dialog.
 */
export function conditionValue(cond, flags) {
    if (cond === undefined || cond === null) return true;
    if (typeof cond === 'function') {
        try {
            return !!cond();
        } catch (e) {
            ctx.log(`$.dialog: условие бросило исключение — считаю ложным (${e})`);
            return false;
        }
    }
    if (typeof cond === 'boolean') return cond;
    if (typeof flags === 'function') return !!flags(cond);
    return !!cond;
}

/**
 * Видимые выборы реплики вместе с их ИНДЕКСАМИ в исходном массиве: игрок
 * выбирает по порядку на экране, а `do`/`to` берутся из настоящего элемента.
 * Возвращает [{ index, text, to, do, action }].
 */
export function visibleChoices(line, flags) {
    const list = line && Array.isArray(line.choices) ? line.choices : [];
    const out = [];
    for (let i = 0; i < list.length; i++) {
        const choice = list[i] || {};
        if (!conditionValue(choice.if !== undefined ? choice.if : choice.when, flags)) continue;
        out.push({
            index: i,
            text: choice.text,
            to: choice.to,
            do: choice.do,
            action: choice.action,
        });
    }
    return out;
}

/** Первые `count` символов строки (по кодпойнтам, чтобы эмодзи не рвались). */
export function revealText(text, count) {
    const chars = Array.from(String(text === undefined || text === null ? '' : text));
    const n = Math.max(0, Math.min(chars.length, Math.floor(count)));
    return chars.slice(0, n).join('');
}

/** Сколько символов показать после шага dt: возвращает новое число символов. */
export function advanceTyping(typed, total, speed, dt) {
    const step = Math.max(0, num(speed, DEFAULTS.speed)) * Math.max(0, num(dt, 0));
    return Math.min(Math.max(0, num(total, 0)), Math.max(0, num(typed, 0)) + step);
}

/**
 * Перенос текста по словам. measure(text) → ширина в пикселях; если measure
 * недоступен (нет движка), текст возвращается одной строкой. Слишком длинное
 * слово режется по символам, а не уезжает за край.
 */
export function wrapDialogText(text, maxWidth, measure) {
    const source = String(text === undefined || text === null ? '' : text);
    const width = num(maxWidth, 0);
    if (!(width > 0) || typeof measure !== 'function') return [source];
    const lines = [];
    let line = '';
    for (const word of source.split(/\s+/).filter((w) => w !== '')) {
        const candidate = line === '' ? word : line + ' ' + word;
        if (measure(candidate) <= width) { line = candidate; continue; }
        if (line !== '') { lines.push(line); line = ''; }
        // Слово шире строки — режем его по символам.
        let part = '';
        for (const ch of Array.from(word)) {
            if (part !== '' && measure(part + ch) > width) { lines.push(part); part = ch; }
            else part += ch;
        }
        line = part;
    }
    if (line !== '') lines.push(line);
    return lines.length ? lines : [source];
}

// ---------------------------------------------------------------------------
// Установка
// ---------------------------------------------------------------------------

// Диалог один на процесс, а tickDialog вызывается из кадрового цикла без
// ссылки на $ — рабочее состояние живёт на уровне модуля (как в screen.js).
let runtime = null;

/**
 * Поставить $.dialog. Определения живут в замыкании: повторный installDialog()
 * начинает с чистого списка диалогов.
 */
export function installDialog($, options) {
    const api = $ || {};
    const definitions = new Map();
    const listeners = new Map();
    const extra_flags = new Map();
    const speakers = new Map();
    const read_lines = new Set();
    const backlog_entries = [];
    const themes = new DialogThemes();
    const opts = options || {};
    let rml_failed = false;
    let lock_token = null;
    let auto_delay = 1.2;
    let world_mode = 'live';
    const slots = ['left', 'center', 'right', 'far-left', 'far-right'];

    const backend = opts.backend
        ? opts.backend
        : (api.ui && typeof api.ui.doc === 'function' ? makeUiBackend(engine.ui) : null);
    const rml_view = backend
        ? createDialogView({
            backend,
            themes,
            readText: (path) => {
                const fs = api.fs || ctx.fs;
                if (!fs || typeof fs.readText !== 'function') return null;
                const text = fs.readText(path, null);
                return text === undefined || text === null ? null : String(text);
            },
            onAction: (name) => { if (dialog && typeof dialog.action === 'function') dialog.action(name); },
        })
        : null;

    // Открытый диалог: { def, nodeId, line, pages, page, typed, typing, choices,
    //                    choiceFocus, speed, style, textSize, vars, view, portrait }
    let state = null;

    // Интерфейс для tickDialog: он не видит замыкание, но должен видеть всё
    // то же состояние и те же переходы.
    const rt = {
        speed: DEFAULTS.speed,
        vars: {},
        lastDef: null,
        api,
        state: null,
        flags: flagValue,
        viewportSize,
        updateView,
        advance,
        finish,
        choose,
        next,
        skip,
        autoDelayValue: () => auto_delay,
    };
    Object.defineProperty(rt, 'state', { get: () => state, set: (value) => { state = value; } });

    function on(name, fn) {
        if (typeof fn !== 'function') return dialog;
        if (!listeners.has(name)) listeners.set(name, []);
        listeners.get(name).push(fn);
        return dialog;
    }

    function emit(name, data) {
        const list = listeners.get(name);
        if (!list || !list.length) return;
        for (const fn of list.slice()) {
            try { fn(data === undefined ? {} : data); } catch (e) { ctx.log(`$.dialog: ошибка в обработчике "${name}": ${e}`); }
        }
    }

    /** Значение флага по имени: сначала $.dialog.flag(), потом $.store. */
    function flagValue(name) {
        const key = String(name);
        if (extra_flags.has(key)) return extra_flags.get(key);
        const store = api.store;
        if (store && typeof store.get === 'function') return store.get(key, undefined);
        return undefined;
    }

    // --- VN: speakers / expressions / portraits / view model -----------------

    function speakerEntry(id) {
        return speakers.get(String(id)) || null;
    }

    /** Registered speaker wins; an unregistered string stays a display name. */
    function resolveSpeaker(value) {
        if (value === undefined || value === null || value === '') return null;
        const key = String(value);
        const entry = speakers.get(key);
        if (entry) return { id: key, name: entry.name || key, entry };
        return { id: null, name: key, entry: null };
    }

    function currentSpeaker() {
        if (!state) return null;
        const value = state.line && state.line.speaker !== undefined ? state.line.speaker : state.def.speaker;
        return resolveSpeaker(value);
    }

    function currentExpression() {
        if (!state) return null;
        const value = state.line && state.line.expression !== undefined
            ? state.line.expression : state.def.expression;
        return value === undefined || value === null || value === '' ? null : String(value);
    }

    function currentPortrait() {
        if (!state) return null;
        const line = state.line || {};
        if (line.portrait !== undefined) return line.portrait === null ? null : String(line.portrait);
        const resolved = currentSpeaker();
        const entry = resolved && resolved.entry;
        const expression = currentExpression();
        if (entry && entry.portraits) {
            if (expression && entry.portraits[expression]) return String(entry.portraits[expression]);
            if (entry.portraits.neutral) return String(entry.portraits.neutral);
        }
        return state.def.portrait === undefined || state.def.portrait === null
            ? null : String(state.def.portrait);
    }

    function currentSlot() {
        if (!state) return 'center';
        const value = state.line && state.line.slot !== undefined
            ? state.line.slot : (state.def.slot !== undefined ? state.def.slot : 'center');
        const slot = String(value);
        return slots.includes(slot) ? slot : 'center';
    }

    function stableLineId() {
        if (!state) return null;
        return state.def.id + ':' + state.nodeId + ':' + state.page;
    }

    function acquireLock() {
        if (lock_token) return lock_token;
        const input = api.input;
        if (!input || typeof input.lock !== 'function') return null;
        lock_token = input.lock('dialog');
        return lock_token;
    }

    function releaseLock(reason) {
        if (!lock_token) return false;
        try { lock_token.release(reason); } catch (e) { /* token already gone */ }
        lock_token = null;
        return true;
    }

    function setWorldMode(mode) {
        const value = mode === undefined ? 'live' : String(mode);
        if (!['live', 'pause', 'cinematic'].includes(value)) return world_mode;
        world_mode = value;
        ctx.world_mode = value;
        ctx.gameplay_paused = value !== 'live';
        emit('worldmode', { mode: value });
        return world_mode;
    }

    function viewModel(choices) {
        if (!state) return null;
        const full = state.pages[state.page] || '';
        const shown = state.typing ? revealText(full, state.typed) : full;
        const resolved = currentSpeaker();
        const speakerName = resolved ? translate(resolved.name, state.vars) : '';
        const list = choices || visible();
        return {
            speakerName,
            speakerId: resolved && resolved.id ? resolved.id : null,
            speakerActive: true,
            expression: currentExpression(),
            portrait: currentPortrait(),
            slot: currentSlot(),
            text: shown,
            fullText: full,
            typing: !!state.typing,
            page: state.page,
            pages: state.pages.length,
            choices: list.map((choice, i) => ({
                index: choice.index,
                text: translate(choice.text, state.vars),
                focused: state.choiceFocus === i,
                to: choice.to,
                action: choice.action,
            })),
            auto: !!state.auto,
            skip: !!state.skipMode,
            backlogOpen: !!state.backlogOpen,
            hasSpeaker: speakerName !== '',
            hasPortrait: !!currentPortrait(),
            hasChoices: list.length > 0,
        };
    }

    function ensureRmlView() {
        if (!rml_view || rml_failed) return false;
        if (!rml_view.ready) {
            if (!rml_view.load(themes.current())) {
                rml_failed = true;
                ctx.log('$.dialog: RML-вид не загрузился — остаётся встроенная панель');
                return false;
            }
        }
        rml_view.show();
        return true;
    }

    function viewportSize() {
        const win = api.window;
        if (win && typeof win.size === 'function') {
            const s = win.size();
            if (s && num(s.w, 0) > 0 && num(s.h, 0) > 0) return { w: num(s.w, 0), h: num(s.h, 0) };
        }
        const gfx = api.gfx;
        if (gfx && typeof gfx.size === 'function') {
            const s = gfx.size();
            if (s && num(s.w, 0) > 0 && num(s.h, 0) > 0) return { w: num(s.w, 0), h: num(s.h, 0) };
        }
        const e = typeof engine !== 'undefined' ? engine : null;
        return { w: num(e && e.width, 800), h: num(e && e.height, 600) };
    }

    // --- Переводы ---------------------------------------------------------

    function translate(value, vars) {
        const i18n = api.i18n;
        const source = value === undefined || value === null ? '' : String(value);
        if (source === '' || !i18n || typeof i18n.has !== 'function' || !i18n.has(source)) return source;
        if (typeof i18n.tr === 'function') return String(i18n.tr(source, vars));
        if (typeof i18n.t === 'function') return String(i18n.t(source, vars));
        return source;
    }

    /** text реплики → массив страниц (строк). Строка, массив или функция. */
    function pagesOf(value, vars) {
        const raw = typeof value === 'function' ? value() : value;
        if (Array.isArray(raw)) return raw.map((s) => translate(s, vars));
        return [translate(raw, vars)];
    }

    // --- Вид (узлы ui.*) --------------------------------------------------

    function makeNode(tag, attrs) {
        let result = null;
        try {
            result = api('<' + tag + '>', attrs);
        } catch (e) {
            ctx.log(`$.dialog: не удалось создать <${tag}> — ${e}`);
            return null;
        }
        if (!result) return null;
        if (result.nodes) return result.nodes[0] || null;
        return result.tag ? result : null;
    }

    function attach(parent, node) {
        node.parent_node = parent;
        parent.child_nodes.push(node);
    }

    function ensureView() {
        if (!state) return null;
        if (rml_view && !rml_failed) return null; // RML presentation owns the UI
        if (state.view) return state.view;
        const panel = makeNode('ui.panel', { id: '__dialog', color: DEFAULTS.panelColor });
        if (!panel) return null;
        const view = { panel, portrait: null, speaker: null, lines: [], buttons: [], styleName: undefined };

        view.portrait = makeNode('ui.image', { id: '__dialog_portrait' });
        if (view.portrait) { view.portrait.visible = false; attach(panel, view.portrait); }

        view.speaker = makeNode('ui.label', { id: '__dialog_speaker', align: 'left', size: DEFAULTS.lineSize });
        if (view.speaker) { view.speaker.color = packColor(DEFAULTS.speakerColor); attach(panel, view.speaker); }

        for (let i = 0; i < DEFAULTS.maxLines; i++) {
            const node = makeNode('ui.label', { id: `__dialog_line${i}`, align: 'left', size: DEFAULTS.lineSize });
            if (!node) continue;
            node.visible = false;
            node.color = packColor(DEFAULTS.textColor);
            attach(panel, node);
            view.lines.push(node);
        }
        for (let i = 0; i < DEFAULTS.maxChoices; i++) {
            const node = makeNode('ui.button', {
                id: `__dialog_choice${i}`,
                color: DEFAULTS.choiceColor,
                hoverColor: DEFAULTS.choiceHoverColor,
            });
            if (!node) continue;
            node.visible = false;
            node.attrs._choice = i;
            node.on('click', () => {
                const index = num(node.attrs._choice, -1);
                if (index >= 0) choose(index);
            });
            attach(panel, node);
            view.buttons.push(node);
        }
        state.view = view;
        return view;
    }

    /** Стиль $.font (если объявлен) — на текст реплики, имя и кнопки выбора. */
    function applyStyle(view) {
        const name = state && state.style ? String(state.style) : null;
        if (view.styleName === name) return;
        view.styleName = name;
        state.textSize = DEFAULTS.lineSize;
        const font = api.font;
        if (!name || !font || typeof font.apply !== 'function') return;
        for (const node of [view.speaker, ...view.lines, ...view.buttons]) {
            if (node) font.apply(node, name);
        }
        const style = typeof font.get === 'function' ? font.get(name) : null;
        if (style && style.size) state.textSize = style.size;
    }

    /** Ширина строки в пикселях — для переноса текста. */
    function measure(text) {
        const size = (state && state.textSize) || DEFAULTS.lineSize;
        const font = api.font;
        if (font && state && state.style && typeof font.measure === 'function') {
            return num(font.measure(text, state.style), 0);
        }
        // Запасной путь, когда стиля нет: та же нормализация ответа движка
        // ([ширина, высота] → ширина), иначе перенос строк молча ломается.
        return measureFontText(text, size);
    }

    /** Видимые выборы текущей реплики (условия уже применены). */
    function visible() {
        return state ? visibleChoices(state.line, flagValue) : [];
    }

    function updateView() {
        if (!state) return;
        const choices = visible();
        state.choices = choices;
        if (rml_view && !rml_failed) {
            if (ensureRmlView()) rml_view.render(viewModel(choices));
            return;
        }
        const view = ensureView();
        if (!view) return;
        applyStyle(view);

        const vp = viewportSize();

        const pad = DEFAULTS.padding;
        const w = Math.min(DEFAULTS.width, Math.max(200, vp.w - DEFAULTS.margin * 2));
        const extra = choices.length ? 10 + choices.length * (DEFAULTS.choiceH + DEFAULTS.choiceGap) : 0;
        const h = DEFAULTS.height + extra;
        const left = Math.round((vp.w - w) / 2);
        const top = Math.round(vp.h - h - DEFAULTS.margin);

        view.panel.x = left + w / 2;
        view.panel.y = top + h / 2;
        view.panel.w = w;
        view.panel.h = h;

        const hasPortrait = !!state.portrait;
        const textLeft = left + pad + (hasPortrait ? DEFAULTS.portrait + 12 : 0);
        const textWidth = Math.max(80, w - pad * 2 - (hasPortrait ? DEFAULTS.portrait + 12 : 0));

        if (view.portrait) {
            view.portrait.visible = hasPortrait;
            if (hasPortrait) {
                view.portrait.x = left + pad + DEFAULTS.portrait / 2;
                view.portrait.y = top + pad + DEFAULTS.portrait / 2;
                view.portrait.w = DEFAULTS.portrait;
                view.portrait.h = DEFAULTS.portrait;
                if (typeof view.portrait.setSprite === 'function') view.portrait.setSprite(String(state.portrait));
            } else {
                view.portrait.sprite = -1;
            }
        }

        const speakerText = translate(state.line && state.line.speaker !== undefined ? state.line.speaker : state.def.speaker, state.vars);
        if (view.speaker) {
            view.speaker.visible = speakerText !== '';
            view.speaker.text = speakerText;
            view.speaker.x = textLeft;
            view.speaker.y = top + pad + 8;
        }

        // Печатающаяся страница: показываем только раскрытые символы.
        const full = state.pages[state.page] || '';
        const shown = state.typing ? revealText(full, state.typed) : full;
        const wrapped = wrapDialogText(shown, textWidth, measure);
        const size = state.textSize || DEFAULTS.lineSize;
        for (let i = 0; i < view.lines.length; i++) {
            const node = view.lines[i];
            const text = wrapped[i];
            node.visible = text !== undefined;
            if (text === undefined) continue;
            node.text = text;
            node.size = size;
            node.x = textLeft;
            node.y = top + pad + 34 + i * size * DEFAULTS.lineHeight;
        }

        for (let i = 0; i < view.buttons.length; i++) {
            const node = view.buttons[i];
            const choice = choices[i];
            const focused = !!choice && state.choiceFocus === i;
            node.visible = !!choice;
            node.hovered = focused;
            // Цвет меняем сами: ui._tick() сбрасывает .hovered по мыши в конце
            // кадра, то есть уже после tickDialog (см. docs/highlevel/dialog.md).
            node.color = choiceColor(focused);
            if (!choice) continue;
            node.attrs._choice = i;
            node.text = translate(choice.text, state.vars);
            node.x = left + w / 2;
            node.y = top + DEFAULTS.height + 5 + i * (DEFAULTS.choiceH + DEFAULTS.choiceGap) + DEFAULTS.choiceH / 2;
            node.w = w - pad * 2;
            node.h = DEFAULTS.choiceH;
        }
    }

    // Упакованные цвета кнопок выбора: packColor требует engine, поэтому
    // считаем один раз и только внутри функций.
    const choice_colors = { base: null, hover: null };
    function choiceColor(focused) {
        if (choice_colors.base === null) {
            choice_colors.base = packColor(DEFAULTS.choiceColor);
            choice_colors.hover = packColor(DEFAULTS.choiceHoverColor);
        }
        return focused ? choice_colors.hover : choice_colors.base;
    }

    // --- §16: смена языка НА ХОДУ -----------------------------------------
    // Диалог переводит тексты в момент отрисовки (translate → $.tr), поэтому
    // смена языка требует лишь перерисовать открытую реплику. Подписка живёт
    // РОВНО пока открыт диалог: иначе каждый диалог оставлял бы слушателя в
    // $.i18n и счётчик подписок рос бы от прогона к прогону.
    let lang_off = null;

    function watchLang() {
        if (lang_off) return;
        const i18n = api.i18n || ctx.i18n;
        if (!i18n || typeof i18n.onChange !== 'function') return;
        lang_off = i18n.onChange(() => { retranslate(); });
    }

    function unwatchLang() {
        if (!lang_off) return;
        try { lang_off(); } catch (e) { ctx.log(`$.dialog: отписка от языка: ${e}`); }
        lang_off = null;
    }

    /** Пересобрать текст открытой реплики на текущем языке (без перезапуска). */
    function retranslate() {
        if (!state || !state.line) return false;
        const pages = pagesOf(state.line.text, state.vars);
        state.pages = pages.length ? pages : [''];
        if (state.page >= state.pages.length) state.page = state.pages.length - 1;
        // Печать не перезапускаем: строка уже была прочитана на другом языке.
        state.typing = false;
        state.typed = Array.from(state.pages[state.page] || '').length;
        updateView();
        emit('typed', { id: state.nodeId, text: state.pages[state.page] || '' });
        return true;
    }

    function destroyView() {
        const view = state && state.view;
        if (!view) return;
        for (const node of [view.speaker, ...view.lines, ...view.buttons, view.portrait]) {
            if (node && typeof node.destroy === 'function') node.destroy();
        }
        if (view.panel && typeof view.panel.destroy === 'function') view.panel.destroy();
        state.view = null;
    }

    // --- Машина состояний --------------------------------------------------

    function runHook(fn, what) {
        try {
            fn();
        } catch (e) {
            ctx.log(`$.dialog: ошибка в ${what} реплики "${state ? state.nodeId : '?'}": ${e}`);
        }
    }

    /** Вход в реплику: do, страницы, событие 'line'. Узел с ложным if пропускаем. */
    function goto(nodeId, depth) {
        if (!state) return false;
        if (num(depth, 0) > 32) {
            ctx.log(`$.dialog: переходы по кругу вокруг "${nodeId}" — заканчиваю диалог`);
            return finish('loop');
        }
        const line = state.def.nodes[nodeId];
        if (!line || typeof line !== 'object') {
            ctx.log(`$.dialog: в диалоге "${state.def.id}" нет реплики "${nodeId}"`);
            return finish('missing');
        }
        const cond = line.if !== undefined ? line.if : line.when;
        if (!conditionValue(cond, flagValue)) {
            const target = line.to !== undefined ? line.to : line.next;
            if (target === undefined || target === null) return finish('skipped');
            return goto(target, num(depth, 0) + 1);
        }

        state.nodeId = nodeId;
        state.line = line;
        state.page = 0;
        state.pages = pagesOf(line.text, state.vars);
        state.typed = 0;
        state.speed = Math.max(1, num(line.speed, num(state.def.speed, state.apiSpeed)));
        state.style = line.style !== undefined ? line.style : state.def.style;
        state.textSize = DEFAULTS.lineSize;
        state.choiceFocus = 0;
        state.portrait = line.portrait !== undefined ? line.portrait : state.def.portrait;
        state.expression = currentExpression();
        state.speaker = currentSpeaker();
        state.slot = currentSlot();
        state.typing = (state.pages[0] || '').length > 0;
        state.auto = !!(line.auto !== undefined ? line.auto : state.def.auto);
        state.skipMode = false;
        state.backlogOpen = false;
        state.autoTimer = 0;

        const hook = line.do !== undefined ? line.do : line.onEnter;
        if (typeof hook === 'function') runHook(hook, 'do');
        recordLine(line);
        prefetchLine(line);
        updateView();
        const info = lineInfo();
        emit('line', info);
        if (!state.typing) emit('typed', { id: state.nodeId, text: info.text });
        return true;
    }

    /** Backlog + stable read/unread ids (one entry per narrative line). */
    function recordLine(line) {
        if (!state) return;
        const id = stableLineId();
        const resolved = currentSpeaker();
        const entry = {
            id,
            definition: state.def.id,
            node: state.nodeId,
            page: state.page,
            speaker: resolved ? resolveDisplayName(resolved) : '',
            speakerId: resolved && resolved.id ? resolved.id : null,
            expression: currentExpression(),
            text: state.pages[state.page] || '',
            unread: !read_lines.has(id),
        };
        entry.unread = false; // the line is on screen now
        read_lines.add(id);
        const existing = backlog_entries.findIndex((item) => item.id === id);
        if (existing >= 0) backlog_entries[existing] = entry;
        else backlog_entries.push(entry);
        if (backlog_entries.length > 500) backlog_entries.shift();
        emit('read', { id, unread: false });
    }

    /** Voice/textBlip/prefetch hooks — pure events, no asset loading here. */
    function prefetchLine(line) {
        if (!state) return;
        const resolved = currentSpeaker();
        const entry = resolved && resolved.entry;
        const expression = currentExpression();
        const assets = [];
        if (entry && entry.portraits && expression && entry.portraits[expression])
            assets.push(String(entry.portraits[expression]));
        if (entry && entry.portraits && entry.portraits.neutral)
            assets.push(String(entry.portraits.neutral));
        const voice = line.voice !== undefined ? line.voice : (entry && entry.voice);
        if (voice) assets.push(String(voice));
        if (assets.length) emit('prefetch', { assets, line: state.nodeId });
        if (voice) emit('voice', { src: String(voice), id: stableLineId(), node: state.nodeId });
        const blip = line.textBlip !== undefined ? line.textBlip : (entry && entry.textBlip);
        if (blip) emit('textBlip', { src: String(blip), id: stableLineId() });
    }

    function resolveDisplayName(resolved) {
        return resolved ? resolved.name : '';
    }

    function lineInfo() {
        const resolved = currentSpeaker();
        return {
            id: state.nodeId,
            stableId: stableLineId(),
            text: state.pages[state.page] || '',
            fullText: state.pages[state.page] || '',
            page: state.page,
            pages: state.pages.length,
            speaker: resolved ? resolved.name : state.line.speaker,
            speakerId: resolved && resolved.id ? resolved.id : null,
            displayName: resolved ? resolved.name : '',
            expression: currentExpression(),
            slot: currentSlot(),
            portrait: currentPortrait(),
            definition: state.def.id,
        };
    }

    /** Допечатать текущую страницу до конца. */
    function skip() {
        if (!state || !state.typing) return false;
        state.typed = Array.from(state.pages[state.page] || '').length;
        state.typing = false;
        updateView();
        emit('typed', { id: state.nodeId, text: state.pages[state.page] || '' });
        return true;
    }

    function next() {
        if (!state) return false;
        if (state.typing) return skip();
        if (state.page < state.pages.length - 1) {
            state.page += 1;
            state.typed = 0;
            state.typing = (state.pages[state.page] || '').length > 0;
            updateView();
            const info = lineInfo();
            emit('line', info);
            if (!state.typing) emit('typed', { id: state.nodeId, text: info.text });
            return true;
        }
        // Пока есть выборы, «дальше» некуда: игрок обязан выбрать.
        if (visible().length) return false;
        const target = state.line.to !== undefined ? state.line.to : state.line.next;
        if (target === undefined || target === null) return finish('end');
        return goto(target, 0);
    }

    /** Выбор по индексу в списке ВИДИМЫХ выборов (нумерация с нуля). */
    function choose(index) {
        if (!state) return false;
        if (state.typing) skip();
        const list = visible();
        const i = Math.floor(num(index, -1));
        if (i < 0 || i >= list.length) {
            ctx.log(`$.dialog.choose: нет выбора с номером ${index} — доступно ${list.length}`);
            return false;
        }
        const choice = list[i];
        state.choiceFocus = i;
        if (typeof choice.do === 'function') runHook(choice.do, 'do выбора');
        emit('choice', { index: choice.index, text: translate(choice.text, state.vars), to: choice.to, action: choice.action });
        if (choice.to === undefined || choice.to === null) return finish('end');
        return goto(choice.to, 0);
    }

    /** Завершение: состояние сбрасывается до событий, чтобы обработчик мог начать новый диалог. */
    function finish(reason) {
        if (!state) return false;
        const info = { reason, definition: state.def.id, node: state.nodeId };
        unwatchLang();                 // §16: подписок после закрытия не остаётся
        if (rml_view && rml_view.ready) rml_view.hide();
        releaseLock(reason || 'dialog end');
        setWorldMode('live');
        destroyView();
        state = null;
        emit('end', info);
        emit('close', info);
        return true;
    }

    /** Кадровый шаг печатной машинки. */
    function advance(dt) {
        if (!state || !state.typing) return;
        const full = Array.from(state.pages[state.page] || '').length;
        state.typed = advanceTyping(state.typed, full, state.speed, dt);
        if (state.typed >= full) {
            state.typed = full;
            state.typing = false;
            updateView();
            emit('typed', { id: state.nodeId, text: state.pages[state.page] || '' });
            return;
        }
        updateView();
    }

    // --- Публичное пространство -------------------------------------------

    function findDefinition(id) { return id === undefined || id === null ? null : definitions.get(String(id)) || null; }

    const dialog = {
        /**
         * Объявить диалог:
         *   $.dialog.define('guard', { start: 'hello', nodes: { hello: {…} } });
         * Поля диалога: start (по умолчанию реплика 'start', а если её нет —
         * первая в nodes), nodes, speaker, portrait, speed, style — значения по
         * умолчанию для всех его реплик.
         */
        define(id, spec) {
            if (id === undefined || id === null || id === '') {
                ctx.log('$.dialog.define: нужно непустое имя диалога, например define("guard", { nodes: {…} })');
                return dialog;
            }
            if (!spec || typeof spec !== 'object' || !spec.nodes || typeof spec.nodes !== 'object') {
                ctx.log(`$.dialog.define("${id}"): нужен объект nodes — { start: { text, choices } }`);
                return dialog;
            }
            const keys = Object.keys(spec.nodes);
            const start = spec.start !== undefined && spec.start !== null ? String(spec.start)
                : (keys.includes('start') ? 'start' : (keys[0] || 'start'));
            definitions.set(String(id), {
                id: String(id),
                start,
                nodes: spec.nodes,
                speaker: spec.speaker,
                portrait: spec.portrait,
                speed: spec.speed,
                style: spec.style,
            });
            return dialog;
        },

        has(id) { return definitions.has(String(id)); },
        list() { return [...definitions.keys()].sort(); },
        remove(id) {
            definitions.delete(String(id));
            if (state && state.def.id === String(id)) finish('removed');
            return dialog;
        },

        /**
         * Начать диалог:
         *   $.dialog.play('guard');            — диалог с его start-реплики
         *   $.dialog.play('guard', 'hello');   — конкретная реплика диалога
         *   $.dialog.play('hello');            — реплика последнего диалога
         * Возвращает true, если реплика открылась.
         */
        play(idOrNode, nodeId) {
            if (state) finish('restart');
            let def = null;
            let start = null;
            const single = nodeId === undefined || nodeId === null;
            if (!single) {
                def = findDefinition(idOrNode);
                start = String(nodeId);
            } else if (findDefinition(idOrNode)) {
                def = findDefinition(idOrNode);
                start = def.start;
            } else {
                // Один аргумент — это id реплики: ищем в последнем открытом диалоге.
                def = runtime.lastDef;
                start = String(idOrNode);
            }
            if (!def) {
                ctx.log(`$.dialog.play: диалог "${idOrNode}" не объявлен — см. $.dialog.list()`);
                return false;
            }
            if (!def.nodes[start]) {
                ctx.log(`$.dialog.play: в диалоге "${def.id}" нет реплики "${start}"`);
                return false;
            }
            runtime.lastDef = def;
            state = {
                def,
                nodeId: null,
                line: null,
                pages: [''],
                page: 0,
                typed: 0,
                typing: false,
                choices: [],
                choiceFocus: 0,
                speed: Math.max(1, num(def.speed, runtime.speed)),
                apiSpeed: Math.max(1, num(runtime.speed, DEFAULTS.speed)),
                style: def.style,
                textSize: DEFAULTS.lineSize,
                vars: { ...(runtime.vars || {}) },
                view: null,
                portrait: def.portrait,
                expression: null,
                speaker: null,
                slot: 'center',
                auto: false,
                skipMode: false,
                backlogOpen: false,
                worldMode: 'live',
            };
            // Диалог забирает клавиатуру: иначе Enter нажал бы и реплику, и
            // узел, оставшийся в фокусе у widgets.js.
            if (api.ui && typeof api.ui.blur === 'function') api.ui.blur();
            acquireLock();
            setWorldMode(def.worldMode || 'cinematic');
            ensureRmlView();
            unwatchLang();
            watchLang();               // §16: язык можно сменить на ходу
            emit('start', { definition: def.id, node: start });
            try {
                return goto(start, 0);
            } catch (error) {
                releaseLock('dialog exception');
                if (rml_view && rml_view.ready) rml_view.hide();
                state = null;
                ctx.log(`$.dialog.play: исключение — ${error && error.message ? error.message : error}`);
                return false;
            }
        },

        /** Совместимость cutscene/timeline: одна реплика без define(). */
        show(text, showOpts) {
            const spec = showOpts || {};
            const node = {
                text: String(text === undefined || text === null ? '' : text),
                speaker: spec.speaker !== undefined ? spec.speaker : spec.name,
                expression: spec.expression,
                portrait: spec.portrait,
                slot: spec.slot,
            };
            definitions.set('__inline', { id: '__inline', start: 'line', nodes: { line: node } });
            if (state) finish('restart');
            return dialog.play('__inline', 'line');
        },

        /**
         * §16: перечитать открытую реплику на текущем языке. Обычно звать не
         * нужно — диалог подписан на $.i18n.onChange сам; метод нужен тестам и
         * экранам, которые меняют словарь в обход $.i18n.
         */
        retranslate() { return retranslate(); },

        /** Подписан ли открытый диалог на смену языка (проверка «не течёт»). */
        langBound() { return !!lang_off; },

        /** Следующая реплика (или досрочное допечатывание текущей). */
        next,

        /** Выбрать вариант по номеру в списке видимых выборов. */
        choose,

        /** Выбрать вариант по тексту: $.dialog.chooseByText('Уйти'). */
        chooseByText(text) {
            if (!state) return false;
            const wanted = String(text === undefined || text === null ? '' : text).trim();
            const list = visible();
            let found = -1;
            for (let i = 0; i < list.length; i++) {
                if (String(translate(list[i].text, state.vars)).trim() === wanted) { found = i; break; }
            }
            if (found < 0) {
                for (let i = 0; i < list.length; i++) {
                    if (String(translate(list[i].text, state.vars)).trim().toLowerCase() === wanted.toLowerCase()) { found = i; break; }
                }
            }
            if (found < 0) {
                ctx.log(`$.dialog.chooseByText: варианта "${wanted}" нет среди видимых`);
                return false;
            }
            return choose(found);
        },

        /** Допечатать реплику целиком. */
        skip,

        /** Закрыть диалог: события 'end' и 'close' с reason 'manual'. */
        close() { return finish('manual'); },

        isOpen() { return !!state; },
        /** Печатается ли текст прямо сейчас. */
        isTyping() { return !!(state && state.typing); },
        /** id текущей реплики (или null). */
        node() { return state ? state.nodeId : null; },
        /** id открытого диалога (или null). */
        definition() { return state ? state.def.id : null; },
        /** Номер текущей страницы (с нуля) и число страниц. */
        page() { return state ? state.page : -1; },
        pageCount() { return state ? state.pages.length : 0; },

        /** Видимый (напечатанный) текст текущей страницы. */
        text() {
            if (!state) return '';
            const full = state.pages[state.page] || '';
            return state.typing ? revealText(full, state.typed) : full;
        },
        /** Полный текст текущей страницы, даже если он ещё печатается. */
        fullText() { return state ? (state.pages[state.page] || '') : ''; },
        /** Имя говорящего с учётом реестра и перевода (или ''). */
        speaker() {
            if (!state) return '';
            const resolved = currentSpeaker();
            return resolved ? translate(resolved.name, state.vars) : '';
        },
        /** Путь к портрету (или null). */
        portrait() { return currentPortrait(); },
        /** Видимые выборы: [{ index, text, to, action }], index — в исходном массиве. */
        choices() {
            if (!state) return [];
            return visible().map((c) => ({
                index: c.index,
                text: String(translate(c.text, state.vars)),
                to: c.to === undefined ? null : c.to,
                action: c.action,
            }));
        },
        /** Подсвеченный выбор (номер в списке видимых) или −1. */
        choiceFocus() { return state && visible().length ? state.choiceFocus : -1; },
        /** Перевести подсветку выбора на следующий (+1) или предыдущий (−1). */
        focusChoice(step) {
            if (!state) return false;
            const list = visible();
            if (!list.length) return false;
            const dir = num(step, 1) >= 0 ? 1 : -1;
            state.choiceFocus = (state.choiceFocus + dir + list.length) % list.length;
            updateView();
            return true;
        },

        /** Скорость печатной машинки в символах в секунду (геттер/сеттер). */
        speed(value) {
            if (value === undefined) return runtime.speed;
            runtime.speed = Math.max(1, num(value, DEFAULTS.speed));
            return dialog;
        },
        /** Параметры подстановки для переводов: {name}, {n}. */
        vars(values) {
            if (values === undefined) return { ...(runtime.vars || {}) };
            runtime.vars = { ...(runtime.vars || {}), ...(values || {}) };
            return dialog;
        },
        /** Свой флаг для условий: $.dialog.flag('has_pass', true). */
        flag(name, value) {
            if (name === undefined) return Object.fromEntries(extra_flags);
            if (value === undefined) { extra_flags.delete(String(name)); return dialog; }
            extra_flags.set(String(name), value);
            return dialog;
        },
        /** Видимые выборы «как есть» — для тестов и агента. */
        visibleChoices() { return visible(); },

        // --- VN: speaker registry / expressions / portrait slots -------------
        /**
         * $.dialog.speaker('w', { name:'???', portraits:{neutral:'...', smirk:'...'},
         *                        textBlip:'sfx/blip.wav', voice:'voice/w/line.ogg' })
         * Internal id is authored in scenes; `name` is what the player sees.
         * Without spec returns the registered entry (or null); without args
         * returns all registered ids.
         */
        speaker(id, spec) {
            // No args keeps the historical getter: current display name.
            if (id === undefined) return dialog.speakerName();
            const key = String(id);
            if (spec === undefined) {
                const entry = speakers.get(key);
                return entry ? { id: key, name: entry.name, portraits: { ...(entry.portraits || {}) },
                    textBlip: entry.textBlip, voice: entry.voice } : null;
            }
            if (!spec || typeof spec !== 'object') {
                ctx.log(`$.dialog.speaker("${key}"): нужен объект { name, portraits }`);
                return dialog;
            }
            speakers.set(key, {
                name: spec.name === undefined ? key : String(spec.name),
                portraits: spec.portraits && typeof spec.portraits === 'object' ? { ...spec.portraits } : {},
                textBlip: spec.textBlip,
                voice: spec.voice,
            });
            return dialog;
        },
        speakerId() {
            const resolved = currentSpeaker();
            return resolved && resolved.id ? resolved.id : null;
        },
        speakerName() {
            if (!state) return '';
            const resolved = currentSpeaker();
            return resolved ? translate(resolved.name, state.vars) : '';
        },
        speakerIds() { return [...speakers.keys()].sort(); },
        expression() { return currentExpression(); },
        portraitSlot() { return currentSlot(); },

        // --- VN: theme registry / custom RML / hot reload --------------------
        themeDefine(name, spec) {
            if (!themes.define(name, spec)) {
                ctx.log(`$.dialog.themeDefine: нужно имя темы`);
                return dialog;
            }
            return dialog;
        },
        theme(name) {
            if (name === undefined) return themes.current();
            if (!themes.use(String(name))) {
                ctx.log(`$.dialog.theme: тема "${name}" не объявлена`);
                return false;
            }
            if (rml_view && !rml_failed) {
                if (!rml_view.load(themes.current())) {
                    rml_failed = true;
                    ctx.log('$.dialog.theme: RML не загрузился — остаётся встроенная панель');
                    return false;
                }
                if (state) updateView();
            }
            emit('theme', { theme: themes.current() });
            return true;
        },
        themes() { return themes.names(); },
        themePush(name) {
            const token = themes.push(name);
            if (!token) {
                ctx.log(`$.dialog.themePush: тема "${name}" не объявлена`);
                return null;
            }
            if (rml_view && !rml_failed) rml_view.load(themes.current());
            if (state) updateView();
            emit('themePush', { theme: String(name) });
            return token;
        },
        /** Default RML + custom RCSS, custom RML + custom RCSS, etc. */
        template(path, rcss) {
            themes.define('__template__', { rml: String(path), rcss: rcss === undefined ? null : rcss });
            return dialog.theme('__template__');
        },
        validateTheme(markup) { return validateMarkup(markup); },
        /** Keep dialogue state; on invalid RML/RCSS the last valid UI stays. */
        hotReload() {
            if (!rml_view || rml_failed) {
                if (rml_view && !rml_failed) rml_failed = true;
                return false;
            }
            const ok = rml_view.reload();
            if (!ok) ctx.log('$.dialog.hotReload: невалидный RML/RCSS — оставлен последний валидный вид');
            else if (state) updateView();
            return ok;
        },
        view() { return rml_view; },
        viewLoaded() { return !!(rml_view && rml_view.ready); },

        // --- VN: auto / skip / backlog / read / save -------------------------
        auto(on) {
            if (on === undefined) return !!(state ? state.auto : false);
            if (!state) return false;
            state.auto = !!on;
            state.autoTimer = 0;
            updateView();
            return true;
        },
        autoDelay(seconds) {
            if (seconds === undefined) return auto_delay;
            auto_delay = Math.max(0.1, num(seconds, auto_delay));
            return dialog;
        },
        backlog() { return backlog_entries.map((entry) => ({ ...entry })); },
        backlogOpen(on) {
            if (on === undefined) return !!(state && state.backlogOpen);
            if (!state) return false;
            state.backlogOpen = !!on;
            updateView();
            emit('backlog', { open: state.backlogOpen });
            return true;
        },
        backlogClear() { backlog_entries.length = 0; return dialog; },
        unreadCount() { return backlog_entries.filter((entry) => entry.unread).length; },
        isRead(id) { return read_lines.has(String(id)); },
        markRead(id) {
            const key = String(id);
            read_lines.add(key);
            for (const entry of backlog_entries) if (entry.id === key) entry.unread = false;
            return dialog;
        },
        /** Serializable narrative state (flags + position + theme + read ids). */
        saveState() {
            return {
                version: 1,
                open: !!state,
                definition: state ? state.def.id : null,
                node: state ? state.nodeId : null,
                page: state ? state.page : 0,
                speakerId: dialog.speakerId(),
                expression: currentExpression(),
                theme: themes.current(),
                auto: !!(state && state.auto),
                worldMode: world_mode,
                flags: Object.fromEntries(extra_flags),
                read: [...read_lines],
                backlog: backlog_entries.map((entry) => ({ ...entry })),
            };
        },
        /** Resume; presentation state is re-applied through the same runtime. */
        restore(payload) {
            if (!payload || typeof payload !== 'object') return false;
            if (payload.theme && themes.has(String(payload.theme))) dialog.theme(String(payload.theme));
            if (Array.isArray(payload.read)) for (const id of payload.read) read_lines.add(String(id));
            if (Array.isArray(payload.backlog)) {
                backlog_entries.length = 0;
                for (const entry of payload.backlog) backlog_entries.push({ ...entry });
            }
            if (payload.flags && typeof payload.flags === 'object') {
                for (const [key, value] of Object.entries(payload.flags)) extra_flags.set(String(key), value);
            }
            if (!payload.open || !payload.definition) {
                setWorldMode(payload.worldMode || 'live');
                return true;
            }
            if (!definitions.has(String(payload.definition))) return false;
            if (!dialog.play(String(payload.definition), String(payload.node || ''))) return false;
            if (state && Number.isFinite(payload.page) && payload.page > 0) {
                state.page = Math.min(payload.page, state.pages.length - 1);
                state.typed = Array.from(state.pages[state.page] || '').length;
                state.typing = false;
                updateView();
            }
            if (payload.auto) state.auto = true;
            if (payload.worldMode) setWorldMode(payload.worldMode);
            return true;
        },

        // --- VN: actions / world mode / locks --------------------------------
        action(name) {
            const action = String(name === undefined || name === null ? '' : name);
            emit('action', { action });
            switch (action) {
                case 'next': return dialog.next();
                case 'skip': return dialog.skip();
                case 'auto': return dialog.auto(!(state && state.auto));
                case 'backlog': return dialog.backlogOpen(!(state && state.backlogOpen));
                case 'save': emit('save', { state: dialog.saveState() }); return true;
                case 'load': emit('load', {}); return true;
                default: return false;
            }
        },
        worldMode(mode) {
            if (mode === undefined) return world_mode;
            return setWorldMode(mode);
        },
        /** Prefetch hook: assets are announced, loading belongs to the game. */
        prefetch(assets) {
            const list = Array.isArray(assets) ? assets.map(String) : [];
            if (list.length) emit('prefetch', { assets: list });
            return dialog;
        },
        lockHeld() { return !!lock_token; },
        /** Test/exception hook: release the dialog input lock immediately. */
        releaseLock(reason) { return releaseLock(reason === undefined ? 'manual' : reason); },

        /** Agent/DevTools snapshot of narrative presentation state. */
        inspect() {
            const resolved = currentSpeaker();
            return {
                open: !!state,
                definition: state ? state.def.id : null,
                step: state ? state.nodeId : null,
                page: state ? state.page : 0,
                pages: state ? state.pages.length : 0,
                speaker: resolved ? resolved.id : null,
                displayName: resolved ? resolved.name : '',
                expression: currentExpression(),
                portrait: currentPortrait(),
                slot: currentSlot(),
                theme: themes.current(),
                typing: !!(state && state.typing),
                text: state ? state.pages[state.page] || '' : '',
                choices: state ? dialog.choices() : [],
                auto: !!(state && state.auto),
                backlogOpen: !!(state && state.backlogOpen),
                worldMode: world_mode,
                inputLocked: !!lock_token,
                flags: Object.fromEntries(extra_flags),
                unread: dialog.unreadCount(),
                view: rml_view && rml_view.ready ? 'rml' : 'builtin',
            };
        },

        /** Обёртка панели диалога (или null). */
        panel() { return state && state.view && state.view.panel ? wrapOne(state.view.panel) : null; },

        /** Подписка на события: start/line/typed/choice/end/close. */
        on,
        off(name, fn) {
            if (!name) { listeners.clear(); return dialog; }
            const list = listeners.get(name);
            if (!list) return dialog;
            listeners.set(name, fn ? list.filter((f) => f !== fn) : []);
            return dialog;
        },
        /** Сколько подписчиков у события — для тестов. */
        listenerCount(name) { return (listeners.get(name) || []).length; },
    };

    runtime = rt;
    ctx.dialog = dialog;
    api.dialog = dialog;
    return dialog;
}

// ---------------------------------------------------------------------------
// Кадровый шаг: печатная машинка, выбор стрелками, Enter/Space, Escape
// ---------------------------------------------------------------------------

/**
 * Шаг кадра: печатает текст по буквам, ведёт подсветку выбора и клавиатуру
 * (стрелки/Enter/Space/Escape). Вызывать каждый кадр из общего цикла.
 */
export function tickDialog(dt) {
    const rt = runtime;
    const state = rt && rt.state;
    if (!rt || !state) return;
    const step = num(dt, 1 / 60);
    if (state.skipMode && state.typing) rt.skip();
    else rt.advance(step);

    const input = rt.api.input;
    if (!input) return;
    const choices = visibleChoices(state.line, rt.flags);
    state.choices = choices;

    if (input.pressed('escape')) { rt.finish('manual'); return; }
    if (input.pressed('a')) rt.api.dialog.auto(!state.auto);
    if (input.pressed('h') || input.pressed('tab')) rt.api.dialog.backlogOpen(!state.backlogOpen);
    if (state.auto && !state.typing && !choices.length) {
        state.autoTimer = (state.autoTimer || 0) + step;
        if (state.autoTimer >= (rt.autoDelayValue ? rt.autoDelayValue() : 1.2)) {
            state.autoTimer = 0;
            rt.next();
            return;
        }
    } else {
        state.autoTimer = 0;
    }
    if (choices.length) {
        if (input.pressed('down') || input.pressed('gamepad.dpad.down')) rt.api.dialog.focusChoice(1);
        else if (input.pressed('up') || input.pressed('gamepad.dpad.up')) rt.api.dialog.focusChoice(-1);
        if (input.pressed('enter') || input.pressed('space') || input.pressed('gamepad.a')) {
            rt.choose(state.choiceFocus); return;
        }
        // Мышь: 'click' по кнопке уже шлёт ui-слой — здесь только подсветка.
        const m = typeof input.mouse === 'function' ? input.mouse() : null;
        const view = state.view;
        if (view && m && Number.isFinite(m.x)) {
            for (let i = 0; i < view.buttons.length; i++) {
                const node = view.buttons[i];
                if (!node || node.visible === false) continue;
                const hw = Math.abs(node.w) / 2;
                const hh = Math.abs(node.h) / 2;
                if (m.x >= node.x - hw && m.x <= node.x + hw && m.y >= node.y - hh && m.y <= node.y + hh) {
                    if (state.choiceFocus !== i) { state.choiceFocus = i; rt.updateView(); }
                    break;
                }
            }
        }
    } else if (input.pressed('enter') || input.pressed('space') || input.pressed('gamepad.a')) {
        rt.next();
    }
}
