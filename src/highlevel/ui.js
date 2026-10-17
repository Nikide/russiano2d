// ===========================================================================
// Интерфейс: $.ui — узлы <ui.*> поверх сцены и документы RmlUi.
//
// Два пути, оба живые:
//   * узлы $('<ui.button>', {...}) — рисуются самим $.gfx, работают без
//     .rml-файлов, попадают на скриншот в headless-прогоне и полностью
//     доступны агенту;
//   * документы RmlUi — $.ui.doc('ui/menu.rml') — для сложной вёрстки,
//     стилей и шрифтов.
//
// Узлы интерфейса живут в координатах окна: камера на них не влияет.
// ===========================================================================

import { engine } from './native.js';
import { ctx, query, packColor, nodesWithFacet } from './core.js';
import { activeDialog } from './widgets.js';

// Кэш обёрток документов RmlUi: путь → обёртка (см. ui.doc()).
const docs = new Map();

// Текущий масштаб интерфейса. Живёт в модуле, а не в подсистеме: масштаб —
// настройка игрока, и он не должен сбрасываться при createApi().
let state_scale = 1;

// ---------------------------------------------------------------------------
// §15. Навигация интерфейса геймпадом
//
// Без неё игра на геймпаде неиграбельна: в меню не войти. Своего фокус-
// менеджера здесь НЕТ: слой превращает состояние геймпада в те же
// синтетические клавиши, которые уже читают экраны (screen.js), виджеты
// (widgets.js: кольцо фокуса, списки, ползунки, поля ввода) и диалоги.
// Поэтому `$.ui.focusedId()`/`focusNext()`/стек фокуса, автоповтор и кольцо
// фокуса ведут себя ровно так же, как при игре с клавиатуры.
//
//   $.ui.gamepadNavigation(true);        // включить (по умолчанию выключено)
//   $.ui.gamepadNavigation(true, { repeatDelay: 0.5, repeatRate: 0.1, axisThreshold: 0.6 });
//
// Раскладка: d-pad и левый стик — фокус, `A` — подтвердить (Return), `B` —
// отмена (Escape). Кнопки d-pad приоритетнее стика: у игрока остаётся точный
// ввод. Автоповтор: первое нажатие сразу, дальше пауза `repeatDelay`, затем
// `repeatRate` между повторами.
//
// Чего слой НЕ делает: документы RmlUi (DevTools, `.rml`) получают ввод
// событиями SDL, а синтетические клавиши `$` живут в JS. Для них нужен мост
// «геймпад → SDL-событие клавиши» в C; это отдельная работа, и в отчёте она
// отмечена как незакрытая (см. docs/highlevel/input.md §15).
// ---------------------------------------------------------------------------

const nav = {
    on: false,
    repeat_delay: 0.4,      // секунды до первого автоповтора
    repeat_rate: 0.12,      // секунды между повторами
    axis_threshold: 0.5,    // порог стика (мёртвая зона — отдельно, в $.input)
    dir: '',                // направление, удерживаемое сейчас
    t: 0,
    a: false,               // были ли A/B нажаты в прошлый тик (свой фронт)
    b: false,
};

/**
 * Отдавать ли направление СЫРОЙ стрелкой вместо обхода по Tab.
 *
 * В `$`-UI стрелки читают не все контролы, а конкретные: экран (screen.js
 * tickScreen) и диалог (dialog.js tickDialog) ведут ими свой фокус, списки,
 * ползунки, прокрутка и поля ввода — своё состояние (widgets.js). У кнопок и
 * флажков стрелка означает «следующий контрол», а обход в `$`-UI делает Tab —
 * второй фокус-менеджер не нужен, поэтому туда уходит Tab (+Shift назад).
 */
function navRawDirection(dir, $) {
    if ($.screen && typeof $.screen.isOpen === 'function' && $.screen.isOpen()) return true;
    if ($.ui && typeof $.ui.modalOpen === 'function' && $.ui.modalOpen()) return true;
    const focused = $.ui && typeof $.ui.focused === 'function' ? $.ui.focused() : null;
    const node = focused && typeof focused.get === 'function' ? focused.get(0) : null;
    if (!node) return false;
    return !(node.tag === 'ui.button' || node.tag === 'ui.checkbox');
}

/** Направление по d-pad/стику: кнопки точнее, поэтому они первые. */
function navDirection(pad) {
    if (pad.down('dpup')) return 'up';
    if (pad.down('dpdown')) return 'down';
    if (pad.down('dpleft')) return 'left';
    if (pad.down('dpright')) return 'right';
    const x = pad.axis('leftX');
    const y = pad.axis('leftY');
    if (Math.abs(y) >= nav.axis_threshold) return y < 0 ? 'up' : 'down';
    if (Math.abs(x) >= nav.axis_threshold) return x < 0 ? 'left' : 'right';
    return '';
}

/** Кадр навигации: направление, автоповтор, подтвердить/отмена. */
function tickGamepadNav($, dt) {
    if (!nav.on || !$.input || typeof $.input.gamepad !== 'function') return;
    if (typeof $.input.synthPress !== 'function') return;
    const pad = $.input.gamepad(0);
    const dir = navDirection(pad);
    // Куда уходит направление: сырой стрелкой (экран, диалог, список, ползунок)
    // или обходом по Tab — единственным обходом контролов в `$`-UI.
    const raw = dir ? navRawDirection(dir, $) : false;
    const key = raw ? dir : 'tab';
    const backward = dir === 'up' || dir === 'left';
    if (dir && !raw) {
        // Обратный обход: widgets.js смотрит down('lshift').
        if (backward) $.input.synthDown('lshift');
        else $.input.synthRelease('lshift');
    } else {
        $.input.synthRelease('lshift');
    }
    if (!dir) {
        nav.dir = '';
        nav.t = 0;
    } else if (dir !== nav.dir) {
        nav.dir = dir;
        nav.t = 0;
        $.input.synthPress(key);                 // первый шаг — сразу
    } else {
        nav.t += dt;
        if (nav.t >= nav.repeat_delay) {
            nav.t -= nav.repeat_rate;            // остаток не теряем: темп ровный
            $.input.synthPress(key);
        }
    }
    // Подтвердить/отмена — теми же клавишами, что читают экраны и виджеты.
    //
    // Фронт считаем сами по УРОВНЮ кнопки, а не через `pad.pressed()`: у того
    // фронт живёт ровно один кадр движка, и тик интерфейса, пропустивший этот
    // кадр (агентская инъекция применяется между кадрами), терял бы нажатие
    // целиком. Свой фронт переживает пропуск: кнопка всё ещё нажата — значит
    // для интерфейса она нажата только что.
    const a = pad.down('a');
    const b = pad.down('b');
    if (a && !nav.a) $.input.synthPress('enter');
    if (b && !nav.b) $.input.synthPress('escape');
    nav.a = a;
    nav.b = b;
}

/**
 * Узел внутри поддерева `ancestor`? Нужен, чтобы модальный диалог пропускал
 * ввод своим детям (кнопкам окна), но блокировал всё остальное.
 */
function isInside(ancestor, node) {
    for (let cur = node; cur; cur = cur.parent_node) {
        if (cur === ancestor) return true;
    }
    return false;
}

export function installUi($) {
    // §16: реестр «элемент → ключ перевода». Держит и узлы <ui.*>, и элементы
    // открытых документов RmlUi: при смене языка всё это перерисовывается
    // одной функцией, а не «кто успел подписаться».
    const tr_entries = [];
    // §16: привязки данных (здоровье, cooldown, таймер, прогресс загрузки,
    // устройство). Не «описание метода», а измеримая связь «источник → вид»:
    // значение обновляется, только если оно изменилось, и это видно счётчиками.
    const bindings = [];
    // Обязательные ID интерфейса: игра объявляет контракт один раз, движок
    // проверяет его структурой (не «есть методы», а «вот чего нет»).
    let required = [];

    /** Ключ перевода в объектной форме: { key: 'hud.ammo', n: 12 } (§16). */
    function trSpec(spec, extra) {
        if (spec && typeof spec === 'object' && !Array.isArray(spec)) {
            const key = spec.key !== undefined ? spec.key : spec.tr;
            const params = Object.assign({}, spec, extra || {});
            return { key: key === undefined ? '' : String(key), params };
        }
        return { key: spec === undefined || spec === null ? '' : String(spec), params: extra || null };
    }

    /** Записать значение источника в вид. `force` — первое применение. */
    function applyBinding(entry, force) {
        let value;
        try {
            value = entry.get();
        } catch (e) {
            entry.error = String(e && e.message ? e.message : e);
            if (force) ctx.log(`$.ui.bind("${entry.name}"): источник упал: ${entry.error}`);
            return false;
        }
        entry.error = null;
        if (!force && value === entry.last) { entry.skipped++; return false; }
        entry.last = value;
        entry.value = value;
        entry.updates++;
        const o = entry.opts;
        const text = typeof o.text === 'function' ? o.text(value) : String(value);
        try {
            if (entry.doc) {
                entry.doc.text(entry.element, text);
            } else {
                const list = query(entry.selector);
                for (const node of list) {
                    if (o.property && typeof node.set === 'function') node.set(o.property, value);
                    else if (node.tag === 'ui.bar' && typeof value === 'number') node.value = value;
                    else node.text = text;
                }
            }
        } catch (e) {
            entry.error = String(e && e.message ? e.message : e);
            return false;
        }
        return true;
    }

    function applyTrEntry(entry) {
        const spec = trSpec(entry.key, entry.params);
        const value = $.tr ? $.tr(spec.key, spec.params) : spec.key;
        entry.resolved_key = spec.key;
        if (entry.doc) {
            entry.doc.text(entry.element, value);
        } else {
            const list = query(entry.selector);
            for (let i = 0; i < list.length; i++) list[i].text = String(value);
            entry.matched = list.length;
        }
        entry.value = value;
        return value;
    }

    /**
     * Цели по селектору для методов `$.ui.*` — с ОДНИМ сообщением на пару
     * «место + цель» (правило task-46…49): методы зовутся в UI-цикле, поэтому
     * дедупликация обязательна, иначе опечатка в имени заливает журнал.
     *
     * Возвращает список узлов. Пустой список = промах (сообщение уже сказано).
     * `many` — как трактовать несколько совпадений:
     *   'all'   — применяю ко всем (множественный API: `show/hide/bar/label/aria`);
     *   'first' — беру первый (геттеры `aria`/`ariaOf`: вернуть можно только одно).
     */
    const ui_missed = new Set();

    function uiTargets(where, sel, many) {
        const list = typeof sel === 'string'
            ? query(sel)
            : (sel && sel.nodes ? sel.nodes : (sel && sel.tag ? [sel] : []));
        if (typeof sel !== 'string') return list;
        const key = where + ' ' + sel;
        if (!list.length) {
            if (!ui_missed.has(key)) {
                ui_missed.add(key);
                ctx.log(`$.ui.${where}: селектор "${sel}" ни к чему не подошёл — ничего не меняю`);
            }
            return list;
        }
        ui_missed.delete(key);
        // Селектор-СПИСОК (`'#a, #b'`) — множественность заявлена автором, это
        // обычная форма из доки: молчим. Одиночный селектор, подошедший к
        // нескольким узлам, называем вслух — раньше это было молчаливое
        // «применил ко всем».
        const listed = sel.indexOf(',') >= 0;
        if (list.length > 1 && !listed) {
            const mkey = key + ' (много)';
            if (!ui_missed.has(mkey)) {
                ui_missed.add(mkey);
                ctx.log(`$.ui.${where}: селектор "${sel}" подошёл к ${list.length} узлам — `
                      + (many === 'first' ? 'беру первый' : 'применяю ко всем'));
            }
        }
        return list;
    }

    const ui = {
        // --- Узлы <ui.*> -----------------------------------------------------

        /** Показать/скрыть узлы интерфейса по селектору (несколько — все). */
        show(sel) {
            for (const n of uiTargets('show', sel, 'all')) n.visible = true;
            return ui;
        },
        hide(sel) {
            for (const n of uiTargets('hide', sel, 'all')) n.visible = false;
            return ui;
        },

        /** Полоса здоровья/прогресса: $.ui.bar('#hp', 0.5). */
        bar(sel, value, max) {
            for (const n of uiTargets('bar', sel, 'all')) {
                n.value = value;
                if (max !== undefined) n.max_value = max;
            }
            return ui;
        },

        /** Текст любого ui-узла. */
        label(sel, text) {
            for (const n of uiTargets('label', sel, 'all')) n.text = String(text);
            return ui;
        },

        /** Частота кадров для HUD. */
        fps() { return Math.round(engine.fps); },

        /**
         * Масштаб интерфейса: `$.ui.scale(1.5)` — крупнее для большого экрана
         * или для слабого зрения. Без аргумента читает текущий.
         *
         * Масштабируются узлы <ui.*> — положение, размер и кегль текста.
         * Масштаб применяется ОДИН РАЗ: повторный `scale(1.5)` не увеличит
         * вдвое, а поставит ровно 1.5 (пересчёт от текущего к новому).
         */
        scale(value) {
            if (value === undefined) return state_scale;
            const next = Math.max(0.25, Math.min(4, Number(value) || 1));
            const ratio = next / state_scale;
            if (ratio !== 1) {
                const nodes = nodesWithFacet('ui');
                for (const node of nodes) {
                    node.x *= ratio;
                    node.y *= ratio;
                    node.w *= ratio;
                    node.h *= ratio;
                    if (node.size) node.size *= ratio;
                }
            }
            state_scale = next;
            return ui;
        },

        /** Прочитать масштаб без изменения. */
        scaleValue() { return state_scale; },

        /**
         * Семантика для ассистивных технологий: `$.ui.aria('#play', { role: 'button',
         * label: 'Начать игру' })`.
         *
         * Свойства лежат на узле (`node.aria`) и попадают в снимок агента,
         * поэтому доступность интерфейса проверяется автотестом. Сам движок
         * ничего не произносит: озвучивает оболочка, читающая снимок.
         */
        aria(sel, props) {
            // Без props — геттер: вернуть можно только одно значение, поэтому
            // при нескольких совпадениях берётся первый (и об этом сказано).
            const list = uiTargets('aria', sel, props ? 'all' : 'first');
            if (!props) return list.length ? (list[0].aria || null) : null;
            for (const node of list) {
                node.aria = Object.assign({}, node.aria || {}, props);
            }
            return ui;
        },

        /** Сколько ui-узлов имеют семантику. */
        ariaCount() {
            let n = 0;
            for (const node of nodesWithFacet('ui')) if (node.aria) n++;
            return n;
        },

        /** Семантика узла (или null) — удобно в проверках. */
        ariaOf(sel) {
            const list = uiTargets('ariaOf', sel, 'first');
            return list.length ? (list[0].aria || null) : null;
        },

        // --- Документы RmlUi --------------------------------------------------
        /**
         * Открывает .rml-документ и возвращает обёртку с методами документа.
         *   const menu = $.ui.doc('ui/menu.rml').show();
         *   menu.on('btn-play', 'click', () => $.scene.load('level1'));
         */
        doc(path) {
            // Обёртки кэшируются по пути: движок кэширует сам документ, поэтому
            // второй $ui.doc() на тот же файл обязан вернуть тот же объект —
            // иначе слушатели RmlUi повесились бы дважды.
            if (docs.has(path)) return docs.get(path);
            const id = engine.ui.load(path);
            if (id < 0) ctx.log(`$: не удалось загрузить документ "${path}"`);
            const wrapper = makeDoc(id, path);
            docs.set(path, wrapper);
            return wrapper;
        },

        // --- §16: локализация открытых документов и узлов --------------------

        /**
         * Привязать текст узла интерфейса к ключу перевода и запомнить связь:
         * при смене языка `$.i18n.lang('en')` строка обновится сама.
         *
         *   $.ui.tr('#menu_play', 'menu.play');
         */
        tr(selector, key, params) {
            ensureTrHook();
            const entry = { selector: String(selector), key, params: params || null,
                            doc: null, element: null, value: null, matched: 0 };
            tr_entries.push(entry);
            applyTrEntry(entry);
            return ui;
        },

        /** Внутреннее: регистрация элемента документа (зовёт doc.tr()). */
        _trDoc(doc, element, key, params) {
            ensureTrHook();
            // key храним КАК ЕСТЬ: это может быть объектная форма { key, n }.
            const entry = { doc, element: String(element), key,
                            params: params || null, selector: null, value: null, matched: 0 };
            tr_entries.push(entry);
            applyTrEntry(entry);
            return entry;
        },

        /** Внутреннее: снять записи выгруженного документа (иначе мёртвые id). */
        _trDropDoc(doc) {
            for (let i = tr_entries.length - 1; i >= 0; i--) {
                if (tr_entries[i].doc === doc) tr_entries.splice(i, 1);
            }
        },

        /** Перечитать все привязанные тексты (зовётся хуком i18n.onChange). */
        retranslate() {
            for (let i = 0; i < tr_entries.length; i++) applyTrEntry(tr_entries[i]);
            return ui;
        },

        /** Что привязано к переводу — для отладки и тестов. */
        trList() {
            return tr_entries.map((e) => ({
                selector: e.selector, element: e.element, key: e.key,
                value: e.value, matched: e.matched,
                doc: e.doc ? e.doc.path : null,
            }));
        },

        // --- §16: привязки данных --------------------------------------------

        /**
         * Привязать вид к источнику значения.
         *
         *   $.ui.bind('#hp_bar',  () => hero.hp / hero.hpMax);          // полоса
         *   $.ui.bind('#time_lbl', () => $.time.now(), { text: (v) => v.toFixed(1) + ' с' });
         *   $.ui.bind({ doc: 'ui/hud.rml', element: 'device' }, () => $.input.device());
         *
         * Источник — функция. Вид: узел `<ui.bar>` получает `value`, остальное —
         * текст; элемент документа получает текст. Перерисовка происходит лишь
         * при смене значения (`updates`), одинаковые кадры считаются в `skipped`.
         */
        bind(target, source, opts) {
            const get = typeof source === 'function' ? source
                : (source && typeof source.get === 'function' ? source.get : null);
            if (typeof get !== 'function') {
                ctx.log('$.ui.bind: источник — функция или { get() }');
                return ui;
            }
            const entry = {
                target, get, opts: opts || {}, last: undefined, updates: 0, skipped: 0,
                error: null, value: undefined, doc: null, element: null, selector: null,
            };
            if (target && typeof target === 'object' && target.doc) {
                const doc = docs.get(String(target.doc));
                if (!doc) {
                    ctx.log(`$.ui.bind: документ "${target.doc}" не открыт`);
                    return ui;
                }
                entry.doc = doc;
                entry.element = String(target.element);
                entry.name = target.doc + '#' + target.element;
            } else {
                entry.selector = String(target);
                entry.name = entry.selector;
            }
            bindings.push(entry);
            applyBinding(entry, true);
            return ui;
        },

        /** Снять привязки: `$.ui.unbind('#hp_bar')` или все без аргумента. */
        unbind(target) {
            if (target === undefined) { const n = bindings.length; bindings.length = 0; return n; }
            const name = typeof target === 'object' && target.doc
                ? target.doc + '#' + target.element : String(target);
            for (let i = bindings.length - 1; i >= 0; i--) {
                if (bindings[i].name === name) bindings.splice(i, 1);
            }
            return ui;
        },

        /** Состояние привязок — для HUD-отладки и тестов. */
        bindings() {
            return bindings.map((b) => ({
                target: b.name, value: b.value, updates: b.updates, skipped: b.skipped,
                error: b.error,
            }));
        },

        /** Сколько обновлений/пропусков всего: проверка «не перерисовываем зря». */
        bindStats() {
            let updates = 0;
            let skipped = 0;
            for (const b of bindings) { updates += b.updates; skipped += b.skipped; }
            return { bindings: bindings.length, updates, skipped };
        },

        // --- §16: постоянный интерфейс против временных окон -----------------

        /**
         * Пометить узлы постоянными: смена сцены и рестарт комнаты их не
         * сносят (`clearWorld` пропускает класс `scene-persistent`).
         *
         *   $.ui.persist('#hud, #hud_hp, #hud_bar');   // HUD переживёт load()
         *   $.ui.transient('#pause_menu');             // а это — нет
         */
        persist(...targets) {
            for (const sel of targets) {
                for (const n of uiTargets('persist', sel, 'all')) {
                    if (n.classes && typeof n.classes.add === 'function') n.classes.add('scene-persistent');
                    n.attrs.persistent = true;
                }
            }
            return ui;
        },

        /** Снять постоянство: узел снова принадлежит сцене. */
        transient(...targets) {
            for (const sel of targets) {
                for (const n of uiTargets('transient', sel, 'all')) {
                    if (n.classes && typeof n.classes.remove === 'function') n.classes.remove('scene-persistent');
                    n.attrs.persistent = false;
                }
            }
            return ui;
        },

        /** Сколько постоянных ui-узлов живо — проверка «HUD пережил смену». */
        persistCount() { return ui.persistList().length; },

        /** ID постоянных ui-узлов (для отчёта и теста). */
        persistList() {
            const out = [];
            const nodes = nodesWithFacet('ui');
            for (let i = 0; i < nodes.length; i++) {
                const n = nodes[i];
                if (n.classes && n.classes.has && n.classes.has('scene-persistent')) out.push(n.id || n.tag);
            }
            return out;
        },

        /** Открытые документы RmlUi (пути) — контракт ID проверяется по ним. */
        documents() { return [...docs.keys()]; },

        /** Есть ли элемент с таким ID в открытом документе. */
        has(docPath, elementId) {
            const doc = docs.get(String(docPath));
            if (!doc) return false;
            const rect = doc.rect(String(elementId));
            return !!(rect && rect.w !== undefined && rect.w >= 0);
        },

        /**
         * §16: объявить обязательные ID интерфейса.
         *
         *   $.ui.required([{ doc: 'ui/hud.rml', ids: ['hp_bar', 'hp_text'] }]);
         *   $.ui.checkRequired();   // { ok, checked, missing: [{ doc, id }] }
         *
         * Проверка идёт через существующий API документов (rect элемента),
         * а не через парсинг .rml: важно, что ID доступен игре СЕЙЧАС.
         */
        required(list) {
            if (list === undefined) return required.map((r) => ({ doc: r.doc, ids: r.ids.slice() }));
            required = [];
            for (const item of [].concat(list)) {
                if (!item || !item.doc) continue;
                required.push({ doc: String(item.doc),
                                ids: (item.ids || []).map(String) });
            }
            return ui;
        },

        /** Проверить обязательные ID: структура, готовая к отчёту и тесту. */
        checkRequired() {
            const missing = [];
            let checked = 0;
            for (const item of required) {
                for (const id of item.ids) {
                    checked++;
                    if (!ui.has(item.doc, id)) missing.push({ doc: item.doc, id });
                }
            }
            return { ok: missing.length === 0, checked, missing,
                     documents: ui.documents() };
        },

        /** §16: полный отчёт интерфейса — документы, обязательные ID, переводы. */
        report() {
            return {
                documents: ui.documents(),
                required: ui.checkRequired(),
                translations: ui.trList(),
                scale: state_scale,
                aria: ui.ariaCount(),
            };
        },

        /** Иконка Material Design по имени (2235 штук встроены в движок). */
        icon(name) { return engine.ui.icon(name); },
        hasIcon(name) { return engine.ui.hasIcon(name); },

        /**
         * Поставить иконку Material Design на узел: `$.ui.setIcon('#play', 'play_arrow')`.
         * Отдельная метка с иконкой нужна там, где глиф клеится к тексту и
         * строка перестаёт быть выровненной по центру кнопки.
         */
        setIcon(target, name) {
            const glyph = engine.ui.hasIcon(name) ? engine.ui.icon(name) : '';
            const nodes = typeof target === 'string' ? $(target) : target;
            return nodes.eachNode((_, el) => {
                const node = el;
                node.text = glyph;
                node.size = node.size || 24;
            });
        },
        iconNames() { return engine.ui.iconNames(); },
        iconCount() { return engine.ui.iconCount(); },

        /**
         * Навигация интерфейса геймпадом (§15): d-pad и левый стик ведут
         * фокус с автоповтором, `A` подтверждает, `B` отменяет. Без аргумента —
         * геттер. По умолчанию выключено: игра включает сама, чтобы поведение
         * существующих игр не менялось.
         *
         *   $.ui.gamepadNavigation(true);
         *   $.ui.gamepadNavigation(true, { repeatDelay: 0.5, repeatRate: 0.1 });
         *
         * Подробности и ограничения (документы RmlUi этим путём не ходят) —
         * docs/highlevel/input.md §15.
         */
        gamepadNavigation(on, opts) {
            if (on === undefined) return nav.on;
            nav.on = !!on;
            if (opts && typeof opts === 'object') {
                if (opts.repeatDelay !== undefined) {
                    nav.repeat_delay = Math.max(0, Number(opts.repeatDelay) || 0);
                }
                if (opts.repeatRate !== undefined) {
                    nav.repeat_rate = Math.max(0.01, Number(opts.repeatRate) || 0.12);
                }
                if (opts.axisThreshold !== undefined) {
                    nav.axis_threshold = Math.min(1, Math.max(0.05, Number(opts.axisThreshold) || 0.5));
                }
            }
            if (!nav.on) { nav.dir = ''; nav.t = 0; }
            return ui;
        },

        /** Внутреннее: обработка наведения и кликов по ui-узлам. */
        _tick() {
            ensureTrHook();
            // Геймпад → синтетические клавиши: до обработки ввода подсистемами
            // (порядок кадра: этот тик идёт последним, поэтому нажатие видно
            // со следующего кадра — так же, как у клавиатуры в записи/реплее).
            if (nav.on) {
                const time = ctx.time;
                const dt = time && typeof time.presentationDelta === 'function'
                    ? time.presentationDelta()
                    : (time && typeof time.rawDelta === 'function' ? time.rawDelta() : 1 / 60);
                tickGamepadNav($, dt);
            }
            // §16: привязки данных — до обработки ввода, чтобы игрок видел
            // актуальные значения в том же кадре.
            for (let i = 0; i < bindings.length; i++) applyBinding(bindings[i], false);
            // Срез ui-узлов держит индекс реестра: нет узлов — цикл пуст, и
            // полного обхода мира здесь больше нет (§5, P2 отчёта).
            const nodes = nodesWithFacet('ui');
            if (nodes.length === 0) return;
            // Модальный диалог забирает ввод целиком: этот проход идёт ПОСЛЕ
            // tickWidgets (и после его проверки модальности), поэтому без
            // своего гейта клик проходил в контролы под затемнением.
            const modal = activeDialog();
            const mx = engine.mouseX;
            const my = engine.mouseY;
            const down = engine.mouseDown(1);
            const pressed = engine.mousePressed(1);
            for (let i = 0; i < nodes.length; i++) {
                const node = nodes[i];
                // Пока открыт диалог, чужие контролы не получают ни наведения,
                // ни кликов — иначе кнопка под окном срабатывала бы «сквозь».
                if (modal && node !== modal && !isInside(modal, node)) {
                    if (node.hovered) {
                        node.hovered = false;
                        if (node.tag === 'ui.button') node.emit('mouseleave', {});
                    }
                    node.pressed = false;
                    continue;
                }
                const inside = node.visible &&
                    mx >= node.x - node.w / 2 && mx <= node.x + node.w / 2 &&
                    my >= node.y - node.h / 2 && my <= node.y + node.h / 2;
                if (inside !== node.hovered) {
                    node.hovered = inside;
                    if (node.tag === 'ui.button') node.emit(inside ? 'mouseenter' : 'mouseleave', {});
                }
                if (inside && pressed) {
                    node.pressed = true;
                    node.emit('mousedown', { button: 'left' });
                }
                if (node.pressed && !down) {
                    node.pressed = false;
                    node.emit('mouseup', { button: 'left' });
                    if (inside) node.emit('click', { button: 'left' });
                }
            }
        },
    };

    ctx.ui = ui;
    // §16: подписка на смену языка — открытые документы и привязанные узлы
    // обновляются на ходу, без перезапуска игры. installUi идёт РАНЬШЕ
    // installI18n, поэтому подписка ставится лениво: первый же кадр или первая
    // привязка текста её включает.
    function ensureTrHook() {
        if (ui._tr_off) return true;
        const i18n = ($ && $.i18n) || ctx.i18n;
        if (!i18n || typeof i18n.onChange !== 'function') return false;
        ui._tr_off = i18n.onChange(() => ui.retranslate());
        return true;
    }
    ui._ensureTrHook = ensureTrHook;
    ensureTrHook();
    return ui;
}

function makeDoc(id, path) {
    // Реестр подписок документа: { element, event, fn, id }.
    // Ключ идемпотентности — ПАРА+ОБРАБОТЧИК, а не просто пара: два разных
    // обработчика на один элемент+событие должны работать оба (раньше второй
    // молча выбрасывался). `id` — слот пула engine.ui (его же возвращает on).
    const entries = [];
    // Одно предупреждение на пару: повторная подписка тем же обработчиком —
    // не ошибка, но и не повод заливать журнал при вызове каждый кадр.
    const warned = new Set();

    function findEntry(element, event, fn) {
        for (const entry of entries) {
            if (entry.element === element && entry.event === event && entry.fn === fn) {
                return entry;
            }
        }
        return null;
    }

    /** Убрать из локального реестра; возвращает число записей. */
    function dropEntries(element, event, fn) {
        let dropped = 0;
        for (let i = entries.length - 1; i >= 0; i--) {
            const entry = entries[i];
            if (entry.element !== element || entry.event !== event) continue;
            if (fn !== undefined && entry.fn !== fn) continue;
            entries.splice(i, 1);
            dropped++;
        }
        return dropped;
    }

    return {
        id,
        path,
        // Без аргумента — документ целиком. С аргументом — ЭЛЕМЕНТ документа:
        // раньше `doc.hide('petals')` молча скрывал весь документ (аргумент
        // игнорировался), и это был костыль BASHNYA H1: игру заставляли писать
        // `doc.style(id,'display','none')`. Класс `hidden` — тот же, что у
        // setClass, поэтому поведение совпадает с обходом, но без обхода.
        show(element) {
            if (element === undefined) engine.ui.show(id);
            else this.style(element, 'display', '');
            return this;
        },
        hide(element) {
            if (element === undefined) engine.ui.hide(id);
            // Инлайн-стиль, а не класс: у игры может не быть правила `.hidden`,
            // и тогда класс не скрыл бы ничего. Ровно так же выглядит их обход
            // `doc.style('petals','display','none')` — только без обхода.
            else this.style(element, 'display', 'none');
            return this;
        },
        // Снимаем документ и выкидываем его из кэша: иначе $.ui.doc(path)
        // после unload() вернул бы ту же обёртку с мёртвым id.
        unload() {
            // Снимаем свои подписки ДО выгрузки документа: слоты пула должны
            // вернуться (в сборке без RmlUi detach-уведомления нет, и без
            // явного off слоты остались бы занятыми навсегда).
            for (const entry of entries) {
                if (typeof engine.ui.off === 'function' && entry.id >= 0) {
                    engine.ui.off(id, entry.element, entry.event, entry.fn);
                }
            }
            entries.length = 0;
            engine.ui.unload(id);
            ctx.ui._trDropDoc(this);      // мёртвые id в реестре переводов не держим
            docs.delete(path);
            return this;
        },
        /**
         * §16: текст элемента документа по ключу перевода. Запись запоминается:
         * `$.i18n.lang('en')` обновит открытый документ сам.
         */
        tr(element, key, params) { ctx.ui._trDoc(this, element, key, params); return this; },
        visible() { return engine.ui.visible(id); },
        text(element, text) { engine.ui.setText(id, element, String(text)); return this; },
        html(element, html) { engine.ui.setHtml(id, element, html); return this; },
        cls(element, name, add) { engine.ui.setClass(id, element, name, add !== false); return this; },
        // Геометрия раскладки: работает и для скрытого элемента (в отличие от
        // `rect`, который честно отдаёт null — H1). Нужна тем, кто проверяет
        // вычисленные размеры, а не видимость.
        layoutRect(element) { return engine.ui.layoutRect(id, String(element)); },
        style(element, property, value) { engine.ui.setProperty(id, element, property, value); return this; },
        /** Значение поля ввода (`<input>`, `<textarea>`, `<select>`) или атрибута value; null — нет элемента. */
        value(element) { return engine.ui.getValue(id, element); },
        setValue(element, value) { return engine.ui.setValue(id, element, String(value)); },
        /** Внутренняя разметка элемента (то, что записал `text()`/`html()`); null — нет элемента. */
        content(element) { return engine.ui.getText(id, element); },
        attr(element, name, value) {
            if (value === undefined) return engine.ui.getAttr(id, element, name);
            engine.ui.setAttr(id, element, name, String(value));
            return this;
        },
        /** Нажать элемент программно (событие click, как от мыши): агент и тесты управляют интерфейсом без пикселей. */
        click(element) { return engine.ui.click(id, element); },
        /** Прямоугольник элемента в координатах окна { x, y, w, h } — для тестов агента и наведения. */
        rect(element) { return engine.ui.rect(id, element); },

        /**
         * Обработчик события элемента документа. Возвращает id слота пула
         * (раньше возвращалась обёртка документа — это изменение поведения).
         *
         * Идемпотентность — по паре+обработчику: повторный on с ТОЙ ЖЕ
         * функцией возвращает прежний id и не плодит слушателей (одно
         * предупреждение), а ВТОРОЙ РАЗНЫЙ обработчик той же пары получает
         * свой слот и работает. Ключ — документ+элемент+событие+функция.
         */
        on(element, event, fn) {
            if (typeof fn !== 'function') {
                throw new TypeError(`$: doc.on("${element}", "${event}") в "${path}" `
                    + '— нужна функция');
            }
            const previous = findEntry(element, event, fn);
            const slot = engine.ui.on(id, element, event, fn);
            const live = typeof slot === 'number' && slot >= 0;
            // Мок qjs-теста engine.ui.on ничего не возвращает: ведём реестр
            // локально, чтобы listeners() и идемпотентность работали и там.
            const mocked = slot === undefined;
            if (previous) {
                if (live) previous.id = slot;
                const key = path + '\u0000' + element + '\u0000' + event;
                if (!warned.has(key)) {
                    warned.add(key);
                    ctx.log(`$: "${element}" уже слушает "${event}" в "${path}" — `
                        + 'повторная подписка тем же обработчиком пропущена');
                }
                return live ? slot : previous.id;
            }
            if (live || mocked) {
                entries.push({ element, event, fn, id: live ? slot : -1 });
                return live ? slot : -1;
            }
            ctx.log(`$: не удалось подписать "${element}" на "${event}" в "${path}" — `
                + 'элемента нет или все слоты обработчиков заняты');
            return -1;
        },

        /**
         * Снять обработчик(и): без fn — все обработчики пары.
         * Возвращает число снятых (как engine.ui.off).
         */
        off(element, event, fn) {
            let removed = 0;
            if (typeof engine.ui.off === 'function') {
                removed = engine.ui.off(id, element, event, fn);
            }
            const dropped = dropEntries(element, event, fn);
            return typeof removed === 'number' ? removed : dropped;
        },

        /** Пары «элемент\u0000событие» подписок документа — для тестов. */
        listeners() { return entries.map((entry) => entry.element + '\u0000' + entry.event); },
    };
}
