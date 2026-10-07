// ===========================================================================
// DevTools: инспектор сущностей на RmlUi (ROADMAP, фаза 8).
//
// Что делает: список сущностей → выбор → свойства (transform / physics /
// gameplay) → «скопировать селектор». Это НЕ редактор сцен и не источник истины
// (docs/DEVTOOLS.md §6): временное изменение значений здесь не сохраняется.
//
// Почему RmlUi, а не ImGui: закон интерфейса (docs/UI_RMLUI_LAW.md) — весь UI
// движка на RmlUi. Панель строится разметкой в памяти (engine.ui.loadMarkup),
// игровые ассеты не нужны.
//
// Данные берутся из `$.agent.snapshot()` — той же инспекции, которой пользуется
// агент: второй реализации поиска быть не должно (docs/DEVTOOLS.md §7).
// ===========================================================================

import { ctx, query } from './core.js';

const ROWS = 24;              // сколько строк списка; остальное — «ещё N»
const REFRESH_FRAMES = 6;     // 10 Гц при 60 к/с: дешевле, чем каждый кадр

const MARKUP = `
<rml>
<head>
<style>
body { font-family: LatoLatin; font-size: 13px; color: #dbe4f0; }
#dt { position: absolute; left: 12px; top: 12px; width: 640px; height: 360px;
      background-color: rgba(9,13,20,0.94); border-width: 1px; border-color: #33415a; }
#dt-title { display: block; padding: 6px 10px; color: #8fd8ff; }
#dt-list { position: absolute; left: 10px; top: 34px; width: 300px; height: 290px; }
#dt-inspect { position: absolute; left: 322px; top: 34px; width: 306px; height: 300px; }
#dt-foot { position: absolute; left: 10px; top: 330px; }
.dt-row { display: block; padding: 2px 6px; }
.dt-row.sel { background-color: #1d2c44; color: #ffffff; }
.dt-row.gone { display: none; }
#dt-copy { padding: 3px 10px; }
</style>
</head>
<body>
<div id="dt">
  <div id="dt-title">DevTools — сущности (F2 — открыть/закрыть)</div>
  <div id="dt-list"></div>
  <div id="dt-inspect">Выберите сущность слева.</div>
  <div id="dt-foot"><button id="dt-copy">Скопировать селектор</button></div>
</div>
</body>
</rml>`;

function selectorOf(brief) {
    if (!brief) return null;
    if (brief.id) return `#${brief.id}`;
    if (brief.class) return `.${String(brief.class).split(/\s+/)[0]}`;
    return brief.tag || null;
}

function rowText(brief, index) {
    const hp = brief.max_hp ? ` ${brief.hp}/${brief.max_hp}` : '';
    const name = brief.id ? `#${brief.id}` : `${brief.tag}#${brief.uid}`;
    return `${index + 1}. ${name} <${brief.tag}>${hp}`;
}

function briefHtml(b) {
    const list = (rows) => rows
        .map(([k, v]) => `<span>${k}: ${v}</span><br/>`)
        .join('');
    return '<b>' + (b.id ? `#${b.id}` : `<${b.tag}>`) + '</b><br/><br/>'
        + list([
            ['tag', b.tag],
            ['class', b.class || '—'],
            ['uid', b.uid],
            ['pos', `${b.x}, ${b.y}`],
            ['size', `${b.w} × ${b.h}`],
            ['angle', b.angle],
            ['hp', b.max_hp ? `${b.hp} / ${b.max_hp}` : '—'],
            ['team', b.team === undefined ? '—' : b.team],
            ['alive', b.alive ? 'да' : 'нет'],
            ['visible', b.visible ? 'да' : 'нет'],
            ['body', b.body === null || b.body === undefined ? 'нет' : b.body],
            ['aria', b.aria ? JSON.stringify(b.aria) : '—'],
        ]);
}

export function installDevTools($) {
    const state = {
        doc: -1,
        open: false,
        selected_uid: null,
        selector: null,
        rows: 0,
        entities: 0,
        refreshed: 0,
    };

    // Список сущностей берём у `$.agent.nodes('*')` — это тот же nodeBrief,
    // которым пользуются команды query/inspect: DevTools, агент и игра видят
    // одно описание (docs/DEVTOOLS.md §7), и лишних зависимостей (окно, камера)
    // тут не нужно.
    function briefs() {
        if (ctx.agent && typeof ctx.agent.nodes === 'function') return ctx.agent.nodes('*');
        return [];
    }

    function setRow(doc, i, brief, selected) {
        const id = `dt-row-${i}`;
        if (!brief) {
            engineOfSetClass(doc, id, 'gone', true);
            return;
        }
        engineOfSetText(doc, id, rowText(brief, i));
        engineOfSetClass(doc, id, 'gone', false);
        engineOfSetClass(doc, id, 'sel', selected);
    }

    function refresh(force) {
        if (!state.open || state.doc < 0) return state;
        state.refreshed++;
        if (!force && state.refreshed % REFRESH_FRAMES !== 0) return state;

        const all = briefs();
        const entities = all.slice(0, ROWS);
        state.entities = all.length;
        state.rows = entities.length;

        let selected = null;
        for (let i = 0; i < ROWS; i++) {
            const brief = entities[i] || null;
            if (brief && brief.uid === state.selected_uid) selected = brief;
            setRow(state.doc, i, brief, !!brief && brief.uid === state.selected_uid);
        }

        if (selected) {
            state.selector = selectorOf(selected);
            engineOfSetHtml(state.doc, 'dt-inspect', briefHtml(selected));
        } else if (state.entities === 0) {
            engineOfSetHtml(state.doc, 'dt-inspect', 'В мире нет сущностей.');
        }
        engineOfSetText(state.doc, 'dt-title',
            `DevTools — сущности: ${state.entities} (F2 — закрыть)`);
        return state;
    }

    // Мостики к движку: без GUI (юнит-тест) они просто ничего не делают.
    function engineOfSetText(doc, id, text) {
        if (typeof engine !== 'undefined' && engine.ui) engine.ui.setText(doc, id, text);
    }
    function engineOfSetClass(doc, id, cls, add) {
        if (typeof engine !== 'undefined' && engine.ui) engine.ui.setClass(doc, id, cls, add);
    }
    function engineOfSetHtml(doc, id, html) {
        if (typeof engine !== 'undefined' && engine.ui) engine.ui.setHtml(doc, id, html);
    }

    function select(uid) {
        state.selected_uid = uid;
        const brief = briefs().find((b) => b.uid === uid) || null;
        state.selector = selectorOf(brief);
        refresh(true);
        return state.selector;
    }

    function open() {
        if (typeof engine === 'undefined' || !engine.ui || typeof engine.ui.loadMarkup !== 'function') {
            ctx.log('$.devtools: сборка без RmlUi — панель недоступна');
            return false;
        }
        if (state.doc < 0) {
            state.doc = engine.ui.loadMarkup('devtools', MARKUP);
            if (state.doc < 0) {
                ctx.log('$.devtools: не удалось создать документ панели');
                return false;
            }
            // Строки и кнопка создаются один раз: обработчик в RmlUi живёт на
            // элементе, поэтому перерисовывать разметку нельзя — обновляем
            // текст и классы (иначе слушатели исчезли бы вместе с элементами).
            for (let i = 0; i < ROWS; i++) {
                engine.ui.on(state.doc, `dt-row-${i}`, 'click', () => {
                    const brief = briefs()[i];
                    if (brief) select(brief.uid);
                });
            }
            engine.ui.on(state.doc, 'dt-copy', 'click', () => {
                if (state.selector && typeof engine.setClipboard === 'function') {
                    engine.setClipboard(state.selector);
                }
                ctx.log(`$.devtools: селектор ${state.selector || '—'} в буфере обмена`);
            });
        }
        engine.ui.show(state.doc);
        state.open = true;
        refresh(true);
        return true;
    }

    function close() {
        if (state.doc >= 0 && typeof engine !== 'undefined' && engine.ui) engine.ui.hide(state.doc);
        state.open = false;
        return true;
    }

    const devtools = {
        /** Открыть панель (в сборке без RmlUi честно вернёт false). */
        open,
        close,
        toggle() { return state.open ? (close(), false) : open(); },
        isOpen() { return state.open; },

        /** Выбрать сущность по uid (строки списка) — для тестов и команд. */
        select,

        /** Выбрать по селектору: `$.devtools.selectBy('#hero')`. */
        selectBy(sel) {
            const node = query(sel)[0];
            return node ? select(node.uid) : null;
        },

        /** Селектор выбранной сущности — то, что копирует кнопка. */
        selector() { return state.selector; },

        /** Машиночитаемое состояние панели (правила 8–9: только факты). */
        panel() {
            return {
                open: state.open,
                doc: state.doc,
                rows: state.rows,
                entities: state.entities,
                selected: state.selected_uid,
                selector: state.selector,
                refreshed: state.refreshed,
            };
        },

        /** Перерисовать немедленно (тесты и внешние команды). */
        refresh() {
            refresh(true);
            return devtools.panel();
        },
    };

    ctx.devtools = devtools;
    $.devtools = devtools;
}

/** Кадровый шаг: F2 открывает/закрывает панель, содержимое обновляется редко. */
export function tickDevTools(dt) {
    const d = ctx.devtools;
    if (!d) return;
    if (ctx.input && ctx.input.pressed && ctx.input.pressed('f2')) d.toggle();
    if (d.isOpen()) d.refresh();
}
