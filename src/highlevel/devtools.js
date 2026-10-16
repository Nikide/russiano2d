// ===========================================================================
// DevTools: инспектор сущностей (F2) и диагностическая панель (F1) на RmlUi.
//
// Разделы docs/PRODUCTION_POLISH.md, которым подчиняется файл:
//   §17 PERF    — сводка кадра, график, перцентили, иерархический профиль;
//   §20 ENTITY  — поиск/фильтры и пять секций инспектора (F2);
//   §21 picking — режим «Pick entity»: клик по миру выбирает узел в F2.
//
// Законы, по которым он написан:
//   * RmlUi — единственный обычный UI DevTools (docs/UI_RMLUI_LAW.md): панели
//     строятся разметкой в памяти (engine.ui.loadMarkup), игровые ассеты не
//     нужны;
//   * данные берутся из существующих подсистем ($.agent, $.debug, $.reload,
//     engine.profile(), $.pick) — второй реализации поиска и второй
//     измеряющей обвязки нет (docs/DEVTOOLS.md §6–§7);
//   * неизмеримое значение показывается как N/A, выдуманных чисел в панели
//     быть не должно (§17.1). Поэтому, например, «батчи» и «render targets»
//     честно N/A: движок не отдаёт эти счётчики в JS.
//
// Переключение вкладок — engine.ui.setClass(doc, id, 'hidden', bool). Разметка
// создаётся один раз, слушатели живут на элементах, содержимое обновляется
// setText/setHtml/setClass — innerHTML панели не пересобирается.
//
// Данные инспектора берутся из `$.agent.nodes('*')` — того же описания узла,
// которым пользуется агент: DevTools, агент и игра видят одно описание.
// ===========================================================================

import { engine } from './native.js';
import { ctx, query } from './core.js';
import { effectiveProcessing } from './triggers.js';
import { getScope } from './scene.js';
import { prefabOf } from './prefab.js';

const ROWS = 24;              // сколько строк списка; остальное — «ещё N»
const REFRESH_FRAMES = 6;     // 10 Гц при 60 к/с: дешевле, чем каждый кадр
const HISTORY_MAX = 300;      // своё кольцо кадров, если движок не даёт history
const GRAPH_BARS = 48;        // столбцов в графике кадра
const GRAPH_H = 56;           // высота области графика, px
const GRAPH_FLOOR_MS = 50;    // нижняя граница шкалы: 16.67 мс × 3
const FRAME_BUDGET_MS = 16.67; // бюджет кадра 60 к/с — порог подсветки
const NA = 'N/A';
const COPY_NONE = '—';

// Вкладки панели F1 и секции инспектора F2. Имена совпадают с id элементов
// `tab-<имя>`: по ним же переключается класс hidden.
const TABS = ['perf', 'tree', 'diag', 'assets', 'watch'];
const SECTIONS = ['identity', 'transform', 'gameplay', 'physics', 'presentation'];

// ---------------------------------------------------------------------------
// Разметка панелей. Строки вкладок объявлены здесь же — элементы существуют
// с момента создания документа, поэтому обработчики не теряются.
// ---------------------------------------------------------------------------

const MARKUP = `
<rml>
<head>
<style>
body { width: 100%; height: 100%; font-family: "Open Sans"; font-size: 13px; color: #dbe4f0; }
#dt { position: absolute; left: 12px; top: 12px; width: 760px; height: 520px;
      background-color: rgba(9,13,20,0.94); border-width: 1px; border-color: #33415a; }
#dt-title { display: block; padding: 4px 10px; color: #8fd8ff; }
#dt-bar { position: absolute; left: 10px; top: 28px; width: 740px; }
#dt-search { width: 140px; height: 24px; background-color: #203448; }
#dt-list { position: absolute; left: 10px; top: 58px; width: 330px; height: 380px; }
#dt-secbar { position: absolute; left: 348px; top: 58px; }
#dt-inspect { position: absolute; left: 348px; top: 88px; width: 402px; height: 348px; }
#dt-foot { position: absolute; left: 10px; top: 446px; }
#dt-status { position: absolute; left: 10px; top: 480px; width: 740px; font-size: 11px; color: #a8b8cc; }
.dt-row { display: block; padding: 1px 6px; }
.dt-row.sel { background-color: #1d2c44; color: #ffffff; }
.dt-row.gone { display: none; }
.dt-sec { display: block; white-space: pre-wrap; font-size: 11px; }
.dt-sec span { display: block; }
.dt-sec b { color: #8fd8ff; }
button { padding: 3px 8px; margin: 1px; }
button.on { background-color: #3d6a8f; color: #ffffff; }
input { width: 85px; height: 24px; background-color: #203448; }
.hidden { display: none; }
</style>
</head>
<body>
<div id="dt">
  <div id="dt-title">DevTools — сущности (F2 — открыть/закрыть)</div>
  <div id="dt-bar">
    <input id="dt-search" type="text"/><button id="dt-search-go">Найти</button>
    <button id="dt-filter-visible">visible</button>
    <button id="dt-filter-physics">physics</button>
    <button id="dt-filter-active">active</button>
    <button id="dt-filter-room">room</button>
    <button id="dt-pick">Pick entity</button>
  </div>
  <div id="dt-list"></div>
  <div id="dt-secbar">
    <button id="dt-secbtn-identity">Identity</button>
    <button id="dt-secbtn-transform">Transform</button>
    <button id="dt-secbtn-gameplay">Gameplay</button>
    <button id="dt-secbtn-physics">Physics</button>
    <button id="dt-secbtn-presentation">Presentation</button>
  </div>
  <div id="dt-inspect">
    <div id="tab-identity" class="dt-sec"></div>
    <div id="tab-transform" class="dt-sec hidden"></div>
    <div id="tab-gameplay" class="dt-sec hidden"></div>
    <div id="tab-physics" class="dt-sec hidden"></div>
    <div id="tab-presentation" class="dt-sec hidden"></div>
  </div>
  <div id="dt-foot">
    <button id="dt-copy">Скопировать селектор</button>
    <button id="dt-copy-nid">Copy node ID</button>
    <button id="dt-copy-js">Copy JS</button>
  </div>
  <div id="dt-status"></div>
</div>
</body>
</rml>`;

const RUNTIME_MARKUP = `
<rml>
<head>
<style>
body { width: 100%; height: 100%; font-family: "Open Sans"; font-size: 13px; color: #dbe4f0; }
#rt { position: absolute; left: 12px; top: 12px; width: 760px; height: 560px;
      background-color: #0c1522; border-width: 1px; border-color: #33415a; }
#rt-title { display: block; padding: 4px 10px; color: #8fd8ff; }
#rt-tabs { position: absolute; left: 10px; top: 28px; }
.rt-tab { padding: 3px 8px; margin: 1px; }
.rt-tab.on { background-color: #3d6a8f; color: #ffffff; }
.rt-section { display: block; color: #8fd8ff; font-size: 12px; }
.rt-data { display: block; white-space: pre-wrap; font-size: 11px; }
.hidden { display: none; }
#tab-perf { position: absolute; left: 10px; top: 58px; width: 740px; height: 380px; }
#tab-tree { position: absolute; left: 10px; top: 58px; width: 740px; height: 380px; }
#tab-diag { position: absolute; left: 10px; top: 58px; width: 740px; height: 380px; }
#tab-assets { position: absolute; left: 10px; top: 58px; width: 740px; height: 380px; }
#tab-watch { position: absolute; left: 10px; top: 58px; width: 740px; height: 380px; }
#rt-perf-summary { position: absolute; left: 0px; top: 18px; width: 740px; height: 130px; }
#rt-perf-graph-title { position: absolute; left: 0px; top: 154px; }
#rt-perf-graph { position: absolute; left: 0px; top: 176px; width: 500px; height: ${GRAPH_H}px;
                 background-color: #101a28; }
#rt-perf-stats { position: absolute; left: 0px; top: 240px; width: 740px; height: 58px; }
#rt-perf-buttons { position: absolute; left: 0px; top: 306px; }
#rt-tree-left { position: absolute; left: 0px; top: 20px; width: 360px; }
#rt-tree-right { position: absolute; left: 372px; top: 20px; width: 368px; }
#rt-stats { position: absolute; left: 0px; top: 0px; width: 740px; height: 44px; }
#rt-profile { position: absolute; left: 0px; top: 68px; width: 740px; height: 120px; }
#rt-limits { position: absolute; left: 0px; top: 216px; width: 740px; height: 80px; }
#rt-textures { position: absolute; left: 0px; top: 300px; width: 740px; height: 70px; }
#rt-assets { position: absolute; left: 0px; top: 20px; width: 740px; height: 60px; }
#rt-assets-buttons { position: absolute; left: 0px; top: 90px; }
#rt-watches { position: absolute; left: 0px; top: 20px; width: 740px; height: 240px; }
#rt-watch-buttons { position: absolute; left: 0px; top: 270px; }
#rt-tools { position: absolute; left: 10px; top: 446px; width: 740px; }
#rt-error { display: block; font-size: 11px; color: #ffb0a0; }
.rt-bar { position: absolute; bottom: 0px; width: 5px; background-color: #4a9ad4; }
.rt-bar.over { background-color: #d4a24a; }
.rt-bar.peak { background-color: #d45a4a; }
button { padding: 3px 8px; margin: 1px; }
input { width: 85px; height: 24px; background-color: #203448; }
</style>
</head>
<body>
<div id="rt">
  <div id="rt-title">DevTools R2D (F1 — закрыть)</div>
  <div id="rt-tabs">
    <button id="rt-tab-perf" class="rt-tab">PERF</button>
    <button id="rt-tab-tree" class="rt-tab">ПРОФИЛЬ</button>
    <button id="rt-tab-diag" class="rt-tab">ДИАГНОСТИКА</button>
    <button id="rt-tab-assets" class="rt-tab">АССЕТЫ</button>
    <button id="rt-tab-watch" class="rt-tab">НАБЛЮДЕНИЯ</button>
  </div>

  <div id="tab-perf">
    <div class="rt-section">Сводка кадра (§17.1). Неизмеряемое — N/A</div>
    <div id="rt-perf-summary" class="rt-data"></div>
    <div id="rt-perf-graph-title" class="rt-section">График кадра (§17.2): <span id="rt-perf-graph-src"></span></div>
    <div id="rt-perf-graph"></div>
    <div id="rt-perf-stats" class="rt-data"></div>
    <div id="rt-perf-buttons">
      <button id="rt-perf-profiler">Профайлер подсистем</button>
      <button id="rt-perf-reset">Сбросить профиль</button>
    </div>
  </div>

  <div id="tab-tree" class="hidden">
    <div class="rt-section">Иерархический профиль (§17.3–17.4): движковые зоны и $.debug.profiler.*</div>
    <div id="rt-tree-left" class="rt-data"></div>
    <div id="rt-tree-right" class="rt-data"></div>
  </div>

  <div id="tab-diag" class="hidden">
    <div class="rt-section">Счётчики мира и кадра</div>
    <div id="rt-stats" class="rt-data"></div>
    <div class="rt-section">Профиль кадра CPU/GPU</div>
    <div id="rt-profile" class="rt-data"></div>
    <button id="rt-reset">Сбросить профиль</button>
    <div class="rt-section">Таблицы runtime</div>
    <div id="rt-limits" class="rt-data"></div>
    <div class="rt-section">Текстуры</div>
    <div id="rt-textures" class="rt-data"></div>
  </div>

  <div id="tab-assets" class="hidden">
    <div class="rt-section">Ассеты §27 (hot reload)</div>
    <div id="rt-assets" class="rt-data"></div>
    <div id="rt-assets-buttons">
      <button id="rt-assets-reload">Перезагрузить ассеты</button>
      <button id="rt-assets-poll">Применить изменившиеся</button>
    </div>
  </div>

  <div id="tab-watch" class="hidden">
    <div class="rt-section">Наблюдения: значение / previous / delta / min / max / порог</div>
    <div id="rt-watches" class="rt-data"></div>
    <div id="rt-watch-buttons">
      <input id="rt-watch-th" type="text"/>
      <button id="rt-watch-apply">Порог (имя=значение)</button>
      <button id="rt-watch-reset">Сбросить мин/макс</button>
    </div>
  </div>

  <div id="rt-tools">
    Гравитация X<input id="rt-gx" type="text"/> Y<input id="rt-gy" type="text"/>
    <button id="rt-gravity">Применить</button>
    <button id="rt-reload">Перезапустить (F5)</button>
    <button id="rt-nodes">Инспектор узлов</button>
    <div id="rt-error"></div>
  </div>
</div>
</body>
</rml>`;

// ---------------------------------------------------------------------------
// Мелкие помощники: числа, текст, безопасный HTML.
// ---------------------------------------------------------------------------

/** Значение — конечное число? Только такие попадают в UI как числа. */
function isNum(v) {
    return typeof v === 'number' && Number.isFinite(v);
}

/** Число с фиксированной точностью или N/A. */
function numText(v, digits) {
    if (!isNum(v)) return NA;
    const d = digits === undefined ? 2 : digits;
    return v.toFixed(d);
}

/** Миллисекунды: «1.23 мс» или N/A. */
function msText(v, digits) {
    return isNum(v) ? numText(v, digits === undefined ? 2 : digits) + ' мс' : NA;
}

/** Целое или N/A (счётчики не выдумываем). */
function intText(v) {
    return isNum(v) ? String(Math.round(v)) : NA;
}

/** Текст или «—» для пустых/отсутствующих значений. */
function orDash(v) {
    if (v === undefined || v === null || v === '') return COPY_NONE;
    return String(v);
}

/** Экранирование пользовательских строк перед setHtml. */
function esc(v) {
    return String(v)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** Вызов, который не должен ронять панель: ошибку показываем как N/A. */
function call(fn, fallback) {
    if (typeof fn !== 'function') return fallback;
    try {
        const v = fn();
        return v === undefined ? fallback : v;
    } catch (e) {
        return fallback;
    }
}

// ---------------------------------------------------------------------------
// Группировка зон профиля (§17.3). Имена меток — из api.js (порядок меток =
// порядок фаз кадра). Незнакомое имя — пользовательская зона (§17.4).
// ---------------------------------------------------------------------------

const SUB_ORDER = [
    'синк физики', 'контакты', 'сцена', 'время', 'логика игры', 'катсцена',
    'анимация+ввод', 'анимация', 'real2d', 'плеер анимации', 'состояния',
    'последовательности', 'задачи', 'области', 'экраны', 'диалоги', 'таймлайн',
    'tilemap', 'vfx', 'частицы', 'навигация', 'префабы', 'слои', 'виджеты',
    'триггеры', 'наблюдения', 'devtools', 'i18n', 'пулы', 'вьюпорты', 'http',
    'sdk', 'шины звука', 'акустика', 'интерфейс',
];

const SUB_GROUP = (() => {
    const g = {};
    const sim = ['синк физики', 'контакты', 'сцена', 'время', 'логика игры', 'катсцена',
                 'задачи', 'области', 'состояния', 'последовательности', 'триггеры',
                 'навигация', 'префабы', 'tilemap', 'наблюдения', 'пулы', 'вьюпорты',
                 'http', 'sdk', 'devtools', 'i18n', 'real2d'];
    const pres = ['анимация+ввод', 'анимация', 'плеер анимации', 'экраны', 'диалоги',
                  'таймлайн', 'vfx', 'частицы', 'слои', 'виджеты', 'интерфейс'];
    const audio = ['шины звука', 'акустика'];
    for (const n of sim) g[n] = 'simulation';
    for (const n of pres) g[n] = 'presentation';
    for (const n of audio) g[n] = 'audio';
    return g;
})();

const NATIVE_GROUP = {
    'JS: логика': 'simulation',
    'физика (Box2D)': 'simulation',
    'JS: сборка батча': 'presentation',
    'ожидание swapchain': 'presentation',
    'загрузка VB/IB': 'presentation',
    'draw-команды': 'presentation',
    'интерфейс (RmlUi)': 'presentation',
    'прочее': 'other',
    'GPU: кадр': 'gpu',
};

const GROUP_TITLE = {
    simulation: 'Simulation (§17.3)',
    presentation: 'Presentation (§17.3)',
    audio: 'Audio (§17.3)',
    user: 'Пользовательские зоны $.debug.profiler.* (§17.4)',
    other: 'Прочее',
    gpu: 'GPU',
};

export function installDevTools($) {
    const state = {
        doc: -1,
        open: false,
        selected_uid: null,
        selector: null,
        selected_nid: null,
        rows: 0,
        entities: 0,
        refreshed: 0,
        // §20: поиск и фильтры списка.
        search: '',
        search_kind: null,          // 'selector' | 'text' | null
        filters: { visible: false, physics: false, active: false, room: false },
        offset: 0,
        section: 'identity',
        // §21: режим выбора кликом по миру.
        pick: false,
        pick_hover_uid: null,
        last_pick: null,
        last_copied: null,
    };

    // Мостики к движку: без GUI (юнит-тест) они просто ничего не делают.
    function uiSetText(doc, id, text) {
        if (typeof engine !== 'undefined' && engine.ui) engine.ui.setText(doc, id, text);
    }
    function uiSetClass(doc, id, cls, add) {
        if (typeof engine !== 'undefined' && engine.ui) engine.ui.setClass(doc, id, cls, add);
    }
    function uiSetHtml(doc, id, html) {
        if (typeof engine !== 'undefined' && engine.ui) engine.ui.setHtml(doc, id, html);
    }
    function uiSetValue(doc, id, value) {
        if (typeof engine !== 'undefined' && engine.ui) engine.ui.setValue(doc, id, value);
    }
    function uiValue(doc, id) {
        if (typeof engine === 'undefined' || !engine.ui) return null;
        return engine.ui.getValue(doc, id);
    }
    function uiOk() {
        return typeof engine !== 'undefined' && engine.ui;
    }

    // -----------------------------------------------------------------------
    // §20: список сущностей, поиск и фильтры.
    // -----------------------------------------------------------------------

    /** Живые узлы реестра: uid → узел. Один проход, а не поиск на каждый узел. */
    function liveByUid() {
        const map = new Map();
        for (const node of ctx.nodes) if (!node.removed) map.set(node.uid, node);
        return map;
    }

    /** Описание узлов берём у агента — второго описания быть не должно (§7). */
    function agentBriefs() {
        if (ctx.agent && typeof ctx.agent.nodes === 'function') return ctx.agent.nodes('*');
        return [];
    }

    /** Селектор узла: id → класс → стабильный nid (уникален и всегда есть). */
    function selectorOf(node) {
        if (!node) return null;
        if (node.id) return `#${node.id}`;
        if (node.classes && node.classes.size > 0) return `.${[...node.classes][0]}`;
        if (node.nid) return `[nid=${node.nid}]`;
        return node.tag || null;
    }

    /** Имя prefab, из которого инстанцирован узел (§20.1), или null. */
    function prefabName(node) {
        return call(() => prefabOf(node), null);
    }

    /** Источник узла: script из attrs, иначе prefab, иначе неизвестен. */
    function sourceOf(node) {
        if (!node) return COPY_NONE;
        if (node.attrs && node.attrs.script) return String(node.attrs.script);
        const p = prefabName(node);
        return p ? `prefab:${p}` : COPY_NONE;
    }

    /** Узлы текущей опубликованной комнаты (§20: фильтр current room). */
    function roomNodeSet() {
        const rs = ctx.roomState;
        if (!rs || !rs.scope) return null;
        const scope = call(() => getScope(String(rs.scope)), null);
        if (!scope || typeof scope.nodes !== 'function') return null;
        const set = new Set();
        for (const n of scope.nodes()) set.add(n.uid);
        return set;
    }

    /** Строка поиска — селектор (если похожа) или подстрока по полям узла. */
    function applySearch(text) {
        state.search = String(text === undefined || text === null ? '' : text);
        const q = state.search.trim();
        state.search_kind = null;
        if (q) state.search_kind = /^[#.[]/.test(q) ? 'selector' : 'text';
        state.offset = 0;
        return state.search;
    }

    function searchSet(q) {
        const set = new Set();
        const found = call(() => query(q), []);
        for (const node of found || []) set.add(node.uid);
        return set;
    }

    function textMatch(node, brief, q) {
        const s = q.toLowerCase();
        const parts = [
            brief.id, brief.tag, brief.class, brief.kind, brief.state,
            prefabName(node), node.attrs ? node.attrs.state : null,
        ];
        for (const p of parts) {
            if (p === undefined || p === null) continue;
            if (String(p).toLowerCase().indexOf(s) >= 0) return true;
        }
        return false;
    }

    /**
     * Список пар «описание агента + живой узел» после поиска и фильтров.
     * Возвращает только факты: total — сколько прошло фильтр.
     */
    function filtered() {
        const map = liveByUid();
        const q = state.search.trim();
        const sel_set = q && state.search_kind === 'selector' ? searchSet(q) : null;
        const room = state.filters.room ? roomNodeSet() : null;
        const out = [];
        for (const brief of agentBriefs()) {
            const node = map.get(brief.uid);
            if (!node) continue;
            if (state.filters.visible && brief.visible !== true) continue;
            if (state.filters.physics && !(isNum(brief.body) && brief.body >= 0)) continue;
            if (state.filters.active && !call(() => effectiveProcessing(node).update !== false, true)) continue;
            if (state.filters.room && !(room && room.has(node.uid))) continue;
            if (q) {
                // Селектор пробуем как селектор; если он ничего не нашёл —
                // ищем тем же текстом по полям узла (поиск обязан находить).
                const ok = sel_set ? (sel_set.has(node.uid) || textMatch(node, brief, q))
                                   : textMatch(node, brief, q);
                if (!ok) continue;
            }
            out.push({ brief, node });
        }
        return out;
    }

    function rowText(brief, index) {
        const hp = brief.max_hp ? ` ${brief.hp}/${brief.max_hp}` : '';
        const name = brief.id ? `#${brief.id}` : `${brief.tag}#${brief.uid}`;
        const kind = brief.kind ? ` [${brief.kind}]` : '';
        return `${index + 1}. ${name} <${brief.tag}>${kind}${hp}`;
    }

    function setRow(doc, i, brief, selected) {
        const id = `dt-row-${i}`;
        if (!brief) {
            uiSetClass(doc, id, 'gone', true);
            return;
        }
        uiSetText(doc, id, rowText(brief, i));
        uiSetClass(doc, id, 'gone', false);
        uiSetClass(doc, id, 'sel', selected);
    }

    // -----------------------------------------------------------------------
    // §20.1–20.5: секции инспектора.
    // -----------------------------------------------------------------------

    function sectionRows(rows) {
        const clean = rows.map(([k, v]) => [k, orDash(v)]);
        const html = clean.map(([k, v]) => `<span>${esc(k)}: ${esc(v)}</span>`).join('');
        const text = clean.map(([k, v]) => `${k}: ${v}`).join('\n');
        return { rows: clean, html, text };
    }

    function identitySection(node) {
        const room = call(() => (ctx.scene ? ctx.scene.current() : null), null);
        // Владелец — область §5: показываем текущую комнату только если узел
        // действительно в её списке владения (иначе «—», а не догадка).
        const room_set = roomNodeSet();
        const owner = room_set && room_set.has(node.uid) ? String(room) : COPY_NONE;
        const tags = call(() => node.get('tags'), '');
        return sectionRows([
            ['selector', selectorOf(node)],
            ['nid', node.nid],
            ['uid', node.uid],
            ['kind', node.kind],
            ['tag', node.tag],
            ['class', [...node.classes].join(' ') || COPY_NONE],
            ['tags', tags || COPY_NONE],
            ['prefab', prefabName(node) || COPY_NONE],
            ['source', sourceOf(node)],
            ['owner (room)', owner],
            ['scene', room === null || room === undefined ? COPY_NONE : String(room)],
        ]);
    }

    function transformSection(node) {
        const parent = node.parent_node;
        const local = node.local_mode === true;
        return sectionRows([
            ['позиция (мир)', `${round2(node.x)}, ${round2(node.y)}`],
            ['позиция (локальная)', local ? `${round2(node.local_x)}, ${round2(node.local_y)}` : COPY_NONE],
            ['угол (мир)', `${round2(node.angle)} рад (${round2(node.angle * 180 / Math.PI)}°)`],
            ['угол (локальный)', local ? `${round2(node.local_angle)} рад` : COPY_NONE],
            ['масштаб', `${round2(node.scale_x === undefined ? 1 : node.scale_x)} × ${round2(node.scale_y === undefined ? 1 : node.scale_y)}`],
            ['размер', `${round2(node.w)} × ${round2(node.h)}`],
            ['родитель', parent ? selectorOf(parent) : COPY_NONE],
            ['детей', node.child_nodes.length],
        ]);
    }

    function gameplaySection(node) {
        const attrs = call(() => JSON.stringify(node.attrs), '{}');
        const state_attr = node.attrs ? node.attrs.state : undefined;
        const hp = node.max_hp > 0 ? `${round2(node.cur_hp)} / ${round2(node.max_hp)}` : COPY_NONE;
        return sectionRows([
            ['state', state_attr === undefined ? COPY_NONE : state_attr],
            ['hp (exposed)', hp],
            ['value / max', `${round2(node.value)} / ${round2(node.max_value)}`],
            ['team', node.team],
            ['speed', round2(node.speed)],
            ['alive', node.cur_hp > 0 && !node.removed ? 'да' : 'нет'],
            ['attrs', attrs.length > 320 ? attrs.slice(0, 320) + '…' : attrs],
        ]);
    }

    function physicsSection(node) {
        const a = call(() => $.debug.anatomy(node), null);
        const body = node.body >= 0 ? `${node.body} (${node.body_kind || '—'})` : COPY_NONE;
        const vel = node.body >= 0 ? call(() => engine.getVelocity(node.body), null) : null;
        const areas = a && a.areas ? a.areas.map((x) => `${x.name || '#' + x.index}${x.sensor ? ' (sensor)' : ''}`).join(', ') : '';
        const contacts = call(() => $.debug.contacts(), []) || [];
        const mine = contacts.filter((c) => c.self === node.nid || c.other === node.nid);
        const ground = a && a.ground ? (a.ground.on ? `да${a.ground.oneWay ? ' (one-way)' : ''}` : 'нет') : NA;
        return sectionRows([
            ['body', body],
            ['скорость', vel ? `${round2(vel[0])}, ${round2(vel[1])} px/с` : COPY_NONE],
            ['области', areas || COPY_NONE],
            ['контакты (за шаг)', String(mine.length)],
            ['опора (floor)', ground],
            ['слой (layer bits)', node.body >= 0 ? '0x' + (node.layer_bits >>> 0).toString(16) : COPY_NONE],
            ['маска (mask)', node.body >= 0 ? '0x' + (node.collision_mask >>> 0).toString(16) : COPY_NONE],
            ['группа', node.body >= 0 ? String(node.collision_group) : COPY_NONE],
        ]);
    }

    function presentationSection(node) {
        const a = call(() => $.debug.anatomy(node), null);
        const windows = a && a.windows ? (Array.isArray(a.windows) ? a.windows.join(', ') : String(a.windows)) : '';
        const clip = node.attrs ? node.attrs.clip : undefined;
        const material = node.attrs ? node.attrs.material : undefined;
        const mask = node.attrs ? node.attrs.lightMask : undefined;
        let mat = COPY_NONE;
        if (typeof material === 'string') mat = material;
        else if (material && typeof material === 'object') mat = 'объект (inline)';
        return sectionRows([
            ['visible', node.visible ? 'да' : 'нет'],
            ['alpha', round2(node.alpha)],
            ['layer', node.layer],
            ['depth', node.depth],
            ['ключ сортировки', `layer ${node.layer} → depth ${node.depth} → y ${round2(node.y)}`],
            ['спрайт', node.sprite >= 0 ? String(node.sprite) : COPY_NONE],
            ['clip', clip === undefined || clip === null ? COPY_NONE : (clip === true ? 'по коробке' : JSON.stringify(clip))],
            ['анимация (окна)', windows || COPY_NONE],
            ['кадр анимации', isNum(node.frame_index) && node.frame_index > 0 ? String(node.frame_index) : COPY_NONE],
            ['материал', mat],
            ['маска света', mask === undefined ? 'все (по умолчанию)' : '0x' + (Number(mask) >>> 0).toString(16)],
        ]);
    }

    function round2(v) {
        return isNum(v) ? Math.round(v * 100) / 100 : v;
    }

    /** Выбранный узел (или null, если он уже удалён — это тоже факт). */
    function selectedNode() {
        if (state.selected_uid === null) return null;
        for (const node of ctx.nodes) {
            if (node.uid === state.selected_uid && !node.removed) return node;
        }
        return null;
    }

    /** Данные всех пяти секций выбранного узла (то же, что видно в панели). */
    function inspect() {
        const node = selectedNode();
        if (!node) {
            return { found: false, uid: state.selected_uid, nid: state.selected_nid,
                     selector: state.selector, sections: {} };
        }
        const sections = {
            identity: identitySection(node),
            transform: transformSection(node),
            gameplay: gameplaySection(node),
            physics: physicsSection(node),
            presentation: presentationSection(node),
        };
        return { found: true, uid: node.uid, nid: node.nid, selector: selectorOf(node), sections };
    }

    function setSection(name) {
        if (SECTIONS.indexOf(name) < 0) return false;
        state.section = name;
        if (state.doc >= 0) {
            for (const s of SECTIONS) {
                uiSetClass(state.doc, 'tab-' + s, 'hidden', s !== name);
                uiSetClass(state.doc, 'dt-secbtn-' + s, 'on', s === name);
            }
        }
        return true;
    }

    // -----------------------------------------------------------------------
    // §21: выбор сущности кликом по миру + подсветка bounds.
    // -----------------------------------------------------------------------

    /** Курсор в экранных координатах. */
    function mousePos() {
        if (typeof engine === 'undefined') return { x: 0, y: 0 };
        return { x: engine.mouseX, y: engine.mouseY };
    }

    /** Курсор над панелью? Тогда клик принадлежит панели, а не миру. */
    function overPanel(p) {
        if (!uiOk() || state.doc < 0 || typeof engine.ui.rect !== 'function') return false;
        const r = call(() => engine.ui.rect(state.doc, 'dt'), null);
        if (!r) return false;
        return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
    }

    /** Узел под точкой экрана — через тот же $.pick, что и игра. */
    function pickAtScreen(p) {
        if (typeof $.pick !== 'function') return null;
        const world = ctx.camera && typeof ctx.camera.screenToWorld === 'function'
            ? ctx.camera.screenToWorld({ x: p.x, y: p.y })
            : { x: p.x, y: p.y };
        if (!world) return null;
        const wrapped = call(() => $.pick(world), null);
        const node = wrapped && wrapped.nodes && wrapped.nodes[0] ? wrapped.nodes[0] : null;
        return node ? { node, world } : null;
    }

    /** Клик по миру: выбрать узел и запомнить факт выбора (для панели и тестов). */
    function pickFromScreen(p) {
        if (!state.pick) return null;
        if (overPanel(p)) return null;
        const hit = pickAtScreen(p);
        if (!hit) {
            state.last_pick = null;
            return null;
        }
        const node = hit.node;
        select(node.uid);
        state.last_pick = {
            uid: node.uid, nid: node.nid, selector: selectorOf(node),
            source: sourceOf(node), tag: node.tag,
            screen: { x: round2(p.x), y: round2(p.y) },
            world: { x: round2(hit.world.x), y: round2(hit.world.y) },
        };
        return state.last_pick;
    }

    /** Подсветка bounds выбранного (красный) и наведённого (жёлтый) узла. */
    function highlight(node, color) {
        if (!node || !$.debug || !$.debug.draw) return;
        const hw = Math.abs(node.w) / 2;
        const hh = Math.abs(node.h) / 2;
        call(() => $.debug.draw.rect({ x: node.x - hw, y: node.y - hh },
                                     { x: node.x + hw, y: node.y + hh }, color), null);
    }

    /** Кадровый шаг picking: подсветка наведения и клик по миру. */
    function tickPick() {
        if (!state.pick || state.doc < 0 || !state.open) return;
        const p = mousePos();
        const inside = overPanel(p);
        const hit = inside ? null : pickAtScreen(p);
        state.pick_hover_uid = hit ? hit.node.uid : null;
        if (hit) highlight(hit.node, '#ffd24a');
        const picked = selectedNode();
        if (picked) highlight(picked, '#ff5a4a');
        if (!inside && ctx.input && typeof ctx.input.mousePressed === 'function' && ctx.input.mousePressed(1)) {
            pickFromScreen(p);
        }
    }

    // -----------------------------------------------------------------------
    // Копирование (§21): Copy selector / Copy node ID / Copy JS.
    // -----------------------------------------------------------------------

    function copyText(text, what) {
        if (!text) return false;
        state.last_copied = { what, text: String(text) };
        if (typeof engine.setClipboard === 'function') engine.setClipboard(String(text));
        return true;
    }

    function copySelector() {
        return copyText(state.selector, 'selector');
    }
    function copyNodeId() {
        const node = selectedNode();
        return copyText(node ? node.nid : null, 'nid');
    }
    function copyJs() {
        const sel = state.selector;
        return copyText(sel ? `$('${sel}')` : null, 'js');
    }

    function status(text) {
        if (state.doc >= 0) uiSetText(state.doc, 'dt-status', text);
    }

    // -----------------------------------------------------------------------
    // Обновление панели сущностей (F2).
    // -----------------------------------------------------------------------

    function refresh(force) {
        if (!state.open || state.doc < 0) return state;
        state.refreshed++;
        if (!force && state.refreshed % REFRESH_FRAMES !== 0) return state;

        const all = filtered();
        state.entities = all.length;
        const view = all.slice(state.offset, state.offset + ROWS);
        state.rows = view.length;

        for (let i = 0; i < ROWS; i++) {
            const item = view[i] || null;
            const brief = item ? item.brief : null;
            if (brief && brief.uid === state.selected_uid) state.selector = selectorOf(item.node);
            setRow(state.doc, i, brief, !!brief && brief.uid === state.selected_uid);
        }

        const from = state.entities === 0 ? 0 : state.offset + 1;
        const to = state.offset + state.rows;
        const flt = Object.keys(state.filters).filter((k) => state.filters[k]);
        uiSetText(state.doc, 'dt-title',
            `DevTools — сущности: ${state.entities} (${from}–${to})`
            + (state.search ? ` | поиск ${state.search_kind === 'selector' ? 'селектором' : 'текстом'}: "${state.search}"` : '')
            + (flt.length ? ` | фильтры: ${flt.join(', ')}` : '')
            + ' | F2 — закрыть');

        // Секции инспектора: обновляем только тексты, разметка не пересобирается.
        const info = inspect();
        if (!info.found) {
            uiSetHtml(state.doc, 'tab-identity',
                `<span>${state.selected_uid === null ? 'Выберите сущность слева или включите Pick entity.' : 'Выбранная сущность исчезла из мира.'}</span>`);
            for (const s of SECTIONS) if (s !== 'identity') uiSetHtml(state.doc, 'tab-' + s, '');
            return state;
        }
        state.selector = info.selector;
        state.selected_nid = info.nid;
        for (const s of SECTIONS) uiSetHtml(state.doc, 'tab-' + s, info.sections[s].html);
        return state;
    }

    function select(uid) {
        state.selected_uid = uid === undefined ? null : uid;
        const node = selectedNode();
        state.selector = node ? selectorOf(node) : null;
        state.selected_nid = node ? node.nid : null;
        // §21: выбранный кликом узел обязан быть виден в списке — сдвигаем окно.
        if (node && state.open) {
            const all = filtered();
            const idx = all.findIndex((it) => it.node.uid === node.uid);
            if (idx >= 0 && (idx < state.offset || idx >= state.offset + ROWS)) {
                state.offset = Math.floor(idx / ROWS) * ROWS;
            }
        }
        refresh(true);
        return state.selector;
    }

    function selectBy(sel) {
        const node = query(sel)[0];
        return node ? select(node.uid) : null;
    }

    function setFilter(name, value) {
        if (!(name in state.filters)) return false;
        state.filters[name] = value === undefined ? !state.filters[name] : !!value;
        state.offset = 0;
        if (state.doc >= 0) uiSetClass(state.doc, 'dt-filter-' + name, 'on', state.filters[name]);
        refresh(true);
        status(`Фильтр ${name}: ${state.filters[name] ? 'включён' : 'выключен'} (сущностей ${state.entities})`);
        return state.filters[name];
    }

    function setPick(on) {
        state.pick = on === undefined ? !state.pick : !!on;
        if (state.doc >= 0) uiSetClass(state.doc, 'dt-pick', 'on', state.pick);
        status(state.pick
            ? 'Pick entity: кликните по объекту в мире (клик по панели не выбирает)'
            : 'Pick entity выключен');
        return state.pick;
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
            uiSetHtml(state.doc, 'dt-list', Array.from({length: ROWS}, (_, i) =>
                `<div class="dt-row" id="dt-row-${i}"></div>`).join(''));
            // Строки и кнопки создаются один раз: обработчик в RmlUi живёт на
            // элементе, поэтому перерисовывать разметку нельзя — обновляем
            // текст и классы (иначе слушатели исчезли бы вместе с элементами).
            for (let i = 0; i < ROWS; i++) {
                engine.ui.on(state.doc, `dt-row-${i}`, 'click', () => {
                    const all = filtered();
                    const item = all[state.offset + i];
                    if (item) select(item.node.uid);
                });
            }
            engine.ui.on(state.doc, 'dt-search-go', 'click', () => {
                applySearch(uiValue(state.doc, 'dt-search'));
                refresh(true);
                status(`Поиск: ${state.search || 'пусто'} → ${state.entities} сущностей`);
            });
            engine.ui.on(state.doc, 'dt-copy', 'click', () => {
                copySelector();
                ctx.log(`$.devtools: селектор ${state.selector || '—'} в буфере обмена`);
                status(`Скопировано: ${state.last_copied ? state.last_copied.text : COPY_NONE}`);
            });
            engine.ui.on(state.doc, 'dt-copy-nid', 'click', () => {
                copyNodeId();
                status(`Скопировано: ${state.last_copied ? state.last_copied.text : COPY_NONE}`);
            });
            engine.ui.on(state.doc, 'dt-copy-js', 'click', () => {
                copyJs();
                status(`Скопировано: ${state.last_copied ? state.last_copied.text : COPY_NONE}`);
            });
            engine.ui.on(state.doc, 'dt-pick', 'click', () => setPick());
            for (const name of ['visible', 'physics', 'active', 'room']) {
                engine.ui.on(state.doc, `dt-filter-${name}`, 'click', () => setFilter(name));
            }
            for (const name of SECTIONS) {
                engine.ui.on(state.doc, `dt-secbtn-${name}`, 'click', () => setSection(name));
            }
        }
        const w = Math.max(560, Math.min(760, engine.width - 24));
        const h = Math.max(360, Math.min(520, engine.height - 24));
        engine.ui.setProperty(state.doc, 'dt', 'width', w + 'px');
        engine.ui.setProperty(state.doc, 'dt', 'height', h + 'px');
        engine.ui.show(state.doc);
        state.open = true;
        setSection(state.section);
        for (const name of ['visible', 'physics', 'active', 'room']) {
            uiSetClass(state.doc, `dt-filter-${name}`, 'on', state.filters[name]);
        }
        uiSetClass(state.doc, 'dt-pick', 'on', state.pick);
        refresh(true);
        return true;
    }

    function close() {
        if (state.doc >= 0 && typeof engine !== 'undefined' && engine.ui) engine.ui.hide(state.doc);
        state.open = false;
        return true;
    }

    // =======================================================================
    // Панель F1: вкладки, PERF, дерево профиля, диагностика, ассеты, наблюдения.
    // =======================================================================

    const runtime = {
        open: false, doc: -1, frames: 0, snapshot: null,
        tab: 'perf',
        graph_samples: [],       // свои замеры, когда движок не отдаёт history
        watch_stats: new Map(),  // имя → { prev, min, max, threshold }
        last_perf: null,
        last_tree: null,
    };

    // --- §17.1: сводка кадра ------------------------------------------------

    /** Время метки подсистемы из $.debug.profiler.report() (или null). */
    function subTime(report, names) {
        if (!report) return null;
        let sum = 0;
        let found = false;
        for (const n of names) {
            const t = report[n];
            if (t && isNum(t.avg_ms)) { sum += t.avg_ms; found = true; }
        }
        return found ? sum : null;
    }

    /**
     * Сводка §17.1. Каждое поле несёт источник; всё неизмеряемое — null
     * (в тексте N/A). Числа берутся только из движка.
     */
    function perfData() {
        const stats = call(() => $.debug.stats(), {}) || {};
        const counters = stats.counters || call(() => $.debug.counters(), {}) || {};
        const limits = call(() => $.debug.limits(), {}) || {};
        const prof = call(() => $.debug.profile(), null);
        const rows = prof && Array.isArray(prof.rows) ? prof.rows : [];
        const render = call(() => $.debug.render(), null);
        const info = render && render.info ? render.info : null;
        const light = call(() => ($.gfx && $.gfx.light && $.gfx.light.stats ? $.gfx.light.stats() : null), null);
        const textures = call(() => $.debug.textures(), []) || [];
        const profiler_on = call(() => $.debug.profiler.isOn(), false);
        const report = profiler_on ? call(() => $.debug.profiler.report(), null) : null;

        const zone = (name) => {
            for (const r of rows) if (r && r.name === name && r.valid !== false && isNum(r.ms)) return r.ms;
            return null;
        };
        const zoneSum = (names) => {
            let sum = 0;
            let found = false;
            for (const n of names) {
                const v = zone(n);
                if (v !== null) { sum += v; found = true; }
            }
            return found ? sum : null;
        };

        const gpu_available = !!(prof && prof.gpu_available === true);
        const gpu_ms = gpu_available && prof && isNum(prof.gpu_ms) && prof.gpu_ms >= 0 ? prof.gpu_ms : null;

        // Формы: сумма по живым телам (engine.shapeCount — единственный
        // источник). Дубли body id не считаем дважды.
        let shapes = null;
        if (typeof engine.shapeCount === 'function') {
            const seen = new Set();
            let sum = 0;
            for (const node of ctx.nodes) {
                if (node.removed || !(node.body >= 0)) continue;
                if (seen.has(node.body)) continue;
                seen.add(node.body);
                const n = call(() => engine.shapeCount(node.body), null);
                if (isNum(n)) sum += n;
            }
            shapes = seen.size > 0 ? sum : 0;
        }

        const rows_spec = [
            ['fps', 'FPS', isNum(stats.fps) ? stats.fps : null, '', '$.debug.stats().fps'],
            ['frame_ms', 'кадр', isNum(stats.frame_ms) ? stats.frame_ms : null, 'мс', '$.debug.stats().frame_ms'],
            ['simulation_ms', 'симуляция CPU', zone('JS: логика'), 'мс', 'engine.profile().rows «JS: логика»'],
            ['render_ms', 'рендер CPU', zoneSum(['JS: сборка батча', 'загрузка VB/IB', 'draw-команды']), 'мс', 'engine.profile().rows (батч+upload+draw)'],
            ['gpu_ms', 'GPU', gpu_ms, 'мс', gpu_available ? 'engine.profile().gpu_ms' : 'engine.profile().gpu_available = false'],
            ['physics_ms', 'физика', zone('физика (Box2D)'), 'мс', 'engine.profile().rows «физика (Box2D)»'],
            ['js_ms', 'JS (метки подсистем)', subTime(report, SUB_ORDER), 'мс', profiler_on ? '$.debug.profiler.report()' : 'профайлер подсистем выключен'],
            ['animation_ms', 'анимация', subTime(report, ['анимация', 'анимация+ввод', 'плеер анимации']), 'мс', '$.debug.profiler.report()'],
            ['ui_ms', 'UI', zone('интерфейс (RmlUi)') !== null ? zone('интерфейс (RmlUi)') : subTime(report, ['интерфейс']), 'мс', 'engine.profile().rows / $.debug.profiler'],
            ['audio_ms', 'звук', subTime(report, ['шины звука', 'акустика']), 'мс', '$.debug.profiler.report()'],
            ['contacts', 'контактов (живых)', isNum(limits.contact_events) ? limits.contact_events : null, '', 'engine.limits().contact_events'],
            ['draw_calls', 'draw calls', info && isNum(info.draws) ? info.draws : null, '', 'engine.renderInfo().draws'],
            ['batches', 'батчи', null, '', 'движок не отдаёт счётчик батчей в JS'],
            ['sprites', 'спрайтов за кадр', isNum(stats.sprites) ? stats.sprites : null, '', '$.debug.stats().sprites'],
            ['particles', 'частиц', isNum(counters.particles) ? counters.particles : null, '', '$.debug.counters().particles'],
            ['lights', 'источников света', light && isNum(light.lights) ? light.lights : null, '', '$.gfx.light.stats().lights'],
            ['shadow_lights', 'источников с тенями', light && isNum(light.shadowLights) ? light.shadowLights : null, '', '$.gfx.light.stats().shadowLights'],
            ['bodies', 'тел', isNum(counters.bodies) ? counters.bodies : null, '', '$.debug.counters().bodies'],
            ['shapes', 'форм', shapes, '', 'Σ engine.shapeCount(тело)'],
            ['nodes', 'узлов', isNum(counters.nodes) ? counters.nodes : null, '', '$.debug.counters().nodes'],
            ['timers', 'таймеров', null, '', 'нет публичного счётчика таймеров'],
            ['tweens', 'твинов', isNum(counters.tweens) ? counters.tweens : null, '', '$.debug.counters().tweens'],
            ['audio_voices', 'голосов звука', isNum(stats.sounds) ? stats.sounds : null, '', '$.debug.stats().sounds'],
            ['textures', 'текстур', isNum(limits.textures) ? limits.textures : textures.length, '', 'engine.limits().textures'],
            ['render_targets', 'render targets', null, '', 'движок не отдаёт счётчик render target в JS'],
        ];

        const rows_out = rows_spec.map(([key, label, value, unit, source]) => {
            const measured = isNum(value);
            const text = `${label}: ${measured ? (unit ? numText(value, 2) + ' ' + unit : String(Math.round(value * 100) / 100)) : NA}`;
            return { key, label, value: measured ? value : null, unit, source, measured, text };
        });
        const summary = {};
        for (const r of rows_out) summary[r.key] = r.value;

        const lines = [];
        for (let i = 0; i < rows_out.length; i += 3) {
            lines.push(rows_out.slice(i, i + 3).map((r) => r.text).join(' | '));
        }
        return { rows: rows_out, summary, text: lines.join('\n'), profiler_on };
    }

    // --- §17.2: график кадра и перцентили -----------------------------------

    function percentile(sorted, p) {
        if (!sorted.length) return null;
        const idx = (sorted.length - 1) * p;
        const lo = Math.floor(idx);
        const hi = Math.ceil(idx);
        if (lo === hi) return sorted[lo];
        return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
    }

    function graphData(perf) {
        const prof = call(() => $.debug.profile(), null);
        const engine_hist = prof && Array.isArray(prof.history) ? prof.history.filter(isNum) : null;
        const engine_stats = prof && prof.stats && isNum(prof.stats.current) ? prof.stats : null;
        const from_engine = !!(engine_hist && engine_hist.length > 0);
        const samples = from_engine ? engine_hist.slice() : runtime.graph_samples.slice();
        const source = from_engine
            ? 'engine.profile().history'
            : '$.debug.stats().frame_ms (свои замеры, ~10 Гц)';

        let stats_out;
        let stats_source;
        if (engine_stats) {
            stats_out = {
                current: engine_stats.current, min: engine_stats.min, mean: engine_stats.mean,
                p50: engine_stats.p50, p95: engine_stats.p95, p99: engine_stats.p99,
                max: engine_stats.max, count: engine_stats.count,
            };
            stats_source = 'engine.profile().stats';
        } else {
            const sorted = samples.slice().sort((a, b) => a - b);
            const sum = samples.reduce((a, b) => a + b, 0);
            stats_out = {
                current: samples.length ? samples[samples.length - 1] : null,
                min: sorted.length ? sorted[0] : null,
                mean: sorted.length ? sum / sorted.length : null,
                p50: percentile(sorted, 0.5),
                p95: percentile(sorted, 0.95),
                p99: percentile(sorted, 0.99),
                max: sorted.length ? sorted[sorted.length - 1] : null,
                count: samples.length,
            };
            stats_source = 'свои замеры $.debug.stats().frame_ms';
        }

        // Столбцы: если замеров больше, чем столбцов — берём равномерную выборку.
        const bars = [];
        if (samples.length > 0) {
            const n = Math.min(GRAPH_BARS, samples.length);
            const step = samples.length / n;
            const top = Math.max(GRAPH_FLOOR_MS, stats_out.max === null || stats_out.max === undefined ? 0 : stats_out.max);
            for (let i = 0; i < n; i++) {
                const ms = samples[Math.min(samples.length - 1, Math.floor(i * step))];
                const h = Math.max(1, Math.min(GRAPH_H, Math.round((ms / top) * GRAPH_H)));
                const cls = ms >= FRAME_BUDGET_MS * 2 ? 'peak' : (ms > FRAME_BUDGET_MS ? 'over' : '');
                bars.push({ ms: Math.round(ms * 100) / 100, h, cls });
            }
        }

        const stats_text = 'текущий ' + msText(stats_out.current)
            + ' | мин ' + msText(stats_out.min)
            + ' | среднее ' + msText(stats_out.mean)
            + ' | p50 ' + msText(stats_out.p50)
            + ' | p95 ' + msText(stats_out.p95)
            + ' | p99 ' + msText(stats_out.p99)
            + ' | макс ' + msText(stats_out.max)
            + ' | замеров ' + intText(stats_out.count) + ' (' + stats_source + ')';

        return { source, samples, bars, stats: stats_out, stats_source, text: stats_text, floor_ms: GRAPH_FLOOR_MS };
    }

    /** Столбцы графика — разметкой: высота в px, поэтому картинка = данные. */
    function graphHtml(graph) {
        return graph.bars.map((b, i) =>
            `<div class="rt-bar${b.cls ? ' ' + b.cls : ''}" id="rt-graph-bar-${i}" `
            + `style="left: ${i * 6}px; height: ${b.h}px;"></div>`).join('');
    }

    // --- §17.3–17.4: иерархический профиль ----------------------------------

    function treeData() {
        const prof = call(() => $.debug.profile(), null);
        const rows = prof && Array.isArray(prof.rows) ? prof.rows : [];
        const profiler_on = call(() => $.debug.profiler.isOn(), false);
        const report = profiler_on ? call(() => $.debug.profiler.report(), null) : null;

        const groups = { simulation: [], presentation: [], audio: [], other: [], user: [], gpu: [] };
        for (const r of rows) {
            if (!r) continue;
            const g = NATIVE_GROUP[r.name] || 'other';
            groups[g].push({
                name: r.name,
                ms: r.valid === false ? null : (isNum(r.ms) ? r.ms : null),
                peak: r.valid === false ? null : (isNum(r.peak) ? r.peak : null),
                calls: null,
                source: 'engine.profile().rows',
            });
        }
        if (report) {
            const known = [];
            const rest = [];
            for (const name of Object.keys(report)) {
                if (SUB_ORDER.indexOf(name) >= 0) known.push(name); else rest.push(name);
            }
            known.sort((a, b) => SUB_ORDER.indexOf(a) - SUB_ORDER.indexOf(b));
            for (const name of known.concat(rest)) {
                const t = report[name];
                const g = SUB_GROUP[name] || 'user';
                groups[g].push({
                    name, ms: isNum(t.avg_ms) ? t.avg_ms : null,
                    peak: isNum(t.max_ms) ? t.max_ms : null,
                    calls: isNum(t.calls) ? t.calls : null,
                    source: SUB_GROUP[name] ? '$.debug.profiler' : '$.debug.profiler (пользовательская зона)',
                });
            }
        }

        const pad = (s, n) => {
            let out = String(s);
            while (out.length < n) out += ' ';
            return out;
        };
        const renderGroups = (names) => {
            const out = [];
            for (const g of names) {
                const list = groups[g];
                if (!list || list.length === 0) continue;
                out.push(GROUP_TITLE[g]);
                for (const r of list) {
                    const peak = r.peak !== null ? ' (пик ' + numText(r.peak, 3) + ')' : '';
                    const calls = r.calls !== null ? ' ×' + r.calls : '';
                    out.push('  ' + pad(r.name, 24) + pad(msText(r.ms, 3) + calls + peak, 22));
                }
            }
            return out.join('\n');
        };

        const left = renderGroups(['simulation']);
        const right = renderGroups(['presentation', 'audio', 'user', 'other', 'gpu']);
        const note = profiler_on
            ? ''
            : '\nпрофайлер подсистем выключен: метки $.debug.profiler не записаны '
              + '(кнопка «Профайлер подсистем» на вкладке PERF)';
        return {
            profiler_on,
            groups,
            native_rows: rows.length,
            text: { left: left + note, right },
        };
    }

    // --- §17.5: наблюдения (previous/delta/min/max/порог) -------------------

    function watchRows() {
        const list = call(() => $.debug.watches(), []) || [];
        const out = [];
        for (const w of list) {
            const v = w && isNum(w.value) ? w.value : null;
            let st = runtime.watch_stats.get(w.name);
            if (!st) { st = { prev: null, min: null, max: null, threshold: null }; runtime.watch_stats.set(w.name, st); }
            if (v !== null) {
                st.min = st.min === null ? v : Math.min(st.min, v);
                st.max = st.max === null ? v : Math.max(st.max, v);
            }
            const delta = (v !== null && st.prev !== null) ? v - st.prev : null;
            const hit = (v !== null && st.threshold !== null) ? Math.abs(v) >= st.threshold : false;
            out.push({
                name: w.name, value: v, previous: st.prev, delta, min: st.min, max: st.max,
                threshold: st.threshold, threshold_hit: hit,
                text: `${w.name}: ${v === null ? NA : numText(v, 3)}`
                    + ` | previous ${st.prev === null ? NA : numText(st.prev, 3)}`
                    + ` | delta ${delta === null ? NA : numText(delta, 3)}`
                    + ` | min ${st.min === null ? NA : numText(st.min, 3)}`
                    + ` | max ${st.max === null ? NA : numText(st.max, 3)}`
                    + ` | порог ${st.threshold === null ? COPY_NONE : numText(st.threshold, 3)}`
                    + (hit ? ' ПРЕВЫШЕН' : ''),
            });
            st.prev = v === null ? st.prev : v;
        }
        return out;
    }

    function watchText() {
        const rows = watchRows();
        if (rows.length === 0) return 'Наблюдений нет: $.debug.watch("hp", () => 42)';
        return rows.map((r) => r.text).join('\n');
    }

    function watchThreshold(name, value) {
        if (typeof name !== 'string' || !name) return false;
        let st = runtime.watch_stats.get(name);
        if (!st) { st = { prev: null, min: null, max: null, threshold: null }; runtime.watch_stats.set(name, st); }
        if (value === null || value === false || value === undefined) st.threshold = null;
        else if (isNum(value)) st.threshold = value;
        else return false;
        return true;
    }

    function watchReset() {
        for (const st of runtime.watch_stats.values()) { st.prev = null; st.min = null; st.max = null; }
        return true;
    }

    // --- Обновление панели F1 ----------------------------------------------

    function refreshRuntime(force) {
        if (!runtime.open) return;
        if (!force && ++runtime.frames % REFRESH_FRAMES !== 1) return;
        runtime.snapshot = {
            stats: call(() => $.debug.stats(), {}),
            profile: call(() => $.debug.profile(), null),
            limits: call(() => $.debug.limits(), {}),
            gravity: call(() => $.world.gravity(), null),
            reloads: call(() => $.script.count(), 0),
            error: call(() => $.script.error(), ''),
            textures: call(() => $.debug.textures(), []),
            watches: call(() => $.debug.watches(), []),
            assets: $.reload ? {
                stats: call(() => $.reload.stats(), null),
                list: call(() => $.reload.list(), []),
                graph: call(() => $.reload.graph(), null),
            } : null,
        };
        const r = runtime.snapshot;
        const doc = runtime.doc;

        // §17: сводка, график и перцентили.
        const perf = perfData();
        runtime.last_perf = perf;
        // Свои замеры копим только когда движок не отдаёт history (§17.2):
        // иначе график рисовался бы по второму источнику.
        const has_history = !!(r.profile && Array.isArray(r.profile.history) && r.profile.history.length > 0);
        if (!has_history && isNum(r.stats.frame_ms)) {
            runtime.graph_samples.push(r.stats.frame_ms);
            if (runtime.graph_samples.length > HISTORY_MAX) runtime.graph_samples.shift();
        }
        const graph = graphData(perf);
        uiSetText(doc, 'rt-perf-summary', perf.text);
        uiSetHtml(doc, 'rt-perf-graph', graphHtml(graph));
        uiSetText(doc, 'rt-perf-graph-src', graph.source + (graph.bars.length ? '' : ' — замеров пока нет'));
        uiSetText(doc, 'rt-perf-stats', graph.text);
        uiSetClass(doc, 'rt-perf-profiler', 'on', perf.profiler_on);

        // §17.3–17.4: дерево.
        const tree = treeData();
        runtime.last_tree = tree;
        uiSetText(doc, 'rt-tree-left', tree.text.left);
        uiSetText(doc, 'rt-tree-right', tree.text.right);

        // Диагностика (прежний состав панели).
        const lines = Object.entries(r.stats).filter(([, v]) => typeof v !== 'object')
            .map(([k, v]) => `${k}: ${v}`).join('  |  ');
        uiSetText(doc, 'rt-stats', lines);
        uiSetText(doc, 'rt-profile', r.profile ?
            'Кадр: ' + r.profile.frame_ms.toFixed(2) + ' мс\n' + (r.profile.zones || []).map((z) =>
                z.name + ': ' + (z.valid ? z.ms.toFixed(3) + ' мс; пик ' + z.peak.toFixed(3) : 'нет данных')).join('\n') : 'Профиль недоступен');
        uiSetText(doc, 'rt-limits', Object.entries(r.limits).map(([k, v]) => k + ': ' + v).join(' | '));
        uiSetText(doc, 'rt-textures', r.textures.map((t) => t.id + ': ' + t.name + ' (' + t.width + ' x ' + t.height + ')').join(' | '));
        uiSetText(doc, 'rt-watches', watchText());
        // §27: индикатор хот-релоада — сколько ассетов под наблюдением, сколько
        // неудачных, что случилось последним и сколько handle'ов ждёт
        // освобождения (очередь §27).
        if (r.assets) {
            const st = r.assets.stats;
            const last = st.last
                ? `${st.last.ok ? 'ok' : 'FAILED'} ${st.last.stage}${st.last.code ? ' ' + st.last.code : ''} v${st.last.version}`
                : '—';
            uiSetText(doc, 'rt-assets',
                `под наблюдением: ${st.watched} | неудачных: ${st.failed} | версий применено: ${st.applied}` +
                ` | ждут освобождения: ${st.pending_release} | последнее: ${last}`);
        } else {
            uiSetText(doc, 'rt-assets', '$.reload не поставлен в этой сборке');
        }
    }

    function setTab(name) {
        if (TABS.indexOf(name) < 0) return false;
        runtime.tab = name;
        if (runtime.doc >= 0) {
            for (const t of TABS) {
                uiSetClass(runtime.doc, 'tab-' + t, 'hidden', t !== name);
                uiSetClass(runtime.doc, 'rt-tab-' + t, 'on', t === name);
            }
        }
        return true;
    }

    function openRuntime() {
        if (!engine.ui || typeof engine.ui.loadMarkup !== 'function') return false;
        if (runtime.doc < 0) {
            runtime.doc = engine.ui.loadMarkup('runtime-debug', RUNTIME_MARKUP);
            if (runtime.doc < 0) return false;
            engine.ui.on(runtime.doc, 'rt-reset', 'click', () => $.debug.profileReset());
            engine.ui.on(runtime.doc, 'rt-reload', 'click', () => $.script.request('RmlUi DevTools'));
            engine.ui.on(runtime.doc, 'rt-nodes', 'click', () => { closeRuntime(); open(); });
            // §17: кнопки вкладки PERF.
            engine.ui.on(runtime.doc, 'rt-perf-reset', 'click', () => {
                $.debug.profileReset();
                runtime.graph_samples.length = 0;
                refreshRuntime(true);
            });
            engine.ui.on(runtime.doc, 'rt-perf-profiler', 'click', () => {
                const on = !call(() => $.debug.profiler.isOn(), false);
                call(() => $.debug.profiler.on(on), null);
                refreshRuntime(true);
            });
            // Вкладки: разметка не меняется, меняются только классы.
            for (const t of TABS) {
                engine.ui.on(runtime.doc, 'rt-tab-' + t, 'click', () => setTab(t));
            }
            // §17.5: порог наблюдения «имя=значение».
            engine.ui.on(runtime.doc, 'rt-watch-apply', 'click', () => {
                const raw = String(uiValue(runtime.doc, 'rt-watch-th') === null ? '' : uiValue(runtime.doc, 'rt-watch-th')).trim();
                const m = /^([^=<>]+)\s*(?:=|>|<)\s*(-?\d+(?:[.,]\d+)?)$/.exec(raw);
                if (!m) {
                    uiSetText(runtime.doc, 'rt-error', 'Порог: введите «имя=число» или «имя>число».');
                    return;
                }
                watchThreshold(m[1].trim(), Number(String(m[2]).replace(',', '.')));
                uiSetText(runtime.doc, 'rt-error', `Порог для «${m[1].trim()}» применён.`);
                refreshRuntime(true);
            });
            engine.ui.on(runtime.doc, 'rt-watch-reset', 'click', () => { watchReset(); refreshRuntime(true); });
            // §27: кнопки хот-релоада ассетов. Данные не трогают: применяется
            // то, что уже прочитано и проверено конвейером $.reload.
            if ($.reload) {
                engine.ui.on(runtime.doc, 'rt-assets-reload', 'click', () => {
                    const res = $.reload.reloadAll();
                    uiSetText(runtime.doc, 'rt-assets',
                        `Перезагружено ${res.applied} из ${res.total}, ошибок ${res.failed}`);
                    refreshRuntime(true);
                });
                engine.ui.on(runtime.doc, 'rt-assets-poll', 'click', () => {
                    const res = $.reload.poll();
                    uiSetText(runtime.doc, 'rt-assets',
                        `Изменилось ${res.applied}, ошибок ${res.failed}`);
                    refreshRuntime(true);
                });
            }
            engine.ui.on(runtime.doc, 'rt-gravity', 'click', () => {
                const x = uiValue(runtime.doc, 'rt-gx');
                const y = uiValue(runtime.doc, 'rt-gy');
                if (!String(x).trim() || !String(y).trim() || !Number.isFinite(Number(x)) || !Number.isFinite(Number(y))) {
                    uiSetText(runtime.doc, 'rt-error', 'Введите конечные числа X и Y.');
                    return;
                }
                $.world.gravity(Number(x), Number(y));
                uiSetText(runtime.doc, 'rt-error', 'Гравитация применена к текущему миру.');
            });
        }
        const g = $.world.gravity();
        engine.ui.setValue(runtime.doc, 'rt-gx', String(g.x));
        engine.ui.setValue(runtime.doc, 'rt-gy', String(g.y));
        engine.ui.setProperty(runtime.doc, 'rt', 'width', Math.max(560, Math.min(760, engine.width - 24)) + 'px');
        engine.ui.setProperty(runtime.doc, 'rt', 'height', Math.max(420, Math.min(560, engine.height - 24)) + 'px');
        engine.ui.show(runtime.doc);
        runtime.open = true; runtime.frames = 0;
        setTab(runtime.tab);
        refreshRuntime(true);
        return true;
    }
    function closeRuntime() {
        if (runtime.doc >= 0) engine.ui.hide(runtime.doc);
        runtime.open = false;
        return true;
    }

    const devtools = {
        openRuntime,
        closeRuntime,
        refreshRuntime,
        runtimePanel() {
            return {
                open: runtime.open, doc: runtime.doc, tab: runtime.tab,
                frames: runtime.frames, snapshot: runtime.snapshot,
            };
        },
        /** Переключить вкладку панели F1 (для тестов и команд). */
        tab: setTab,
        /** Текущая вкладка панели F1. */
        tabName() { return runtime.tab; },
        /** Секция инспектора F2 (Identity/Transform/Gameplay/Physics/Presentation). */
        section: setSection,
        sectionName() { return state.section; },

        /** §17: сводка кадра, график, перцентили — те же факты, что в панели. */
        perf() {
            const perf = perfData();
            const graph = graphData(perf);
            return { tab: runtime.tab, rows: perf.rows, summary: perf.summary,
                     text: { summary: perf.text, stats: graph.text, source: graph.source },
                     graph: { source: graph.source, stats: graph.stats, stats_source: graph.stats_source,
                              bars: graph.bars, samples: graph.samples.length, floor_ms: graph.floor_ms } };
        },
        /** §17.3–17.4: дерево профиля (движковые зоны + $.debug.profiler.*). */
        tree() { return treeData(); },
        /** §17.5: наблюдения с previous/delta/min/max/порог. */
        watches() { return watchRows(); },
        watchThreshold,
        watchReset,

        /** Открыть панель (в сборке без RmlUi честно вернёт false). */
        open,
        close,
        toggle() { return state.open ? (close(), false) : open(); },
        isOpen() { return state.open; },

        /** Выбрать сущность по uid (строки списка) — для тестов и команд. */
        select,

        /** Выбрать по селектору: `$.devtools.selectBy('#hero')`. */
        selectBy,

        /** Селектор выбранной сущности — то, что копирует кнопка. */
        selector() { return state.selector; },

        /** §20: поиск по selector/ID/tag/kind/prefab/state. */
        search(text) {
            const r = applySearch(text);
            if (state.doc >= 0) uiSetValue(state.doc, 'dt-search', state.search);
            refresh(true);
            return r;
        },
        searchText() { return { text: state.search, kind: state.search_kind }; },

        /** §20: фильтры visible/physics/active/room. */
        filter(name, value) { return setFilter(name, value); },
        filters() { return Object.assign({}, state.filters); },

        /** §20: данные всех секций выбранного узла (те же, что в панели). */
        inspect,

        /** §21: режим Pick entity. */
        pickMode(on) { return setPick(on); },
        pickOn() { return state.pick; },
        /** Кадровый шаг picking: подсветка bounds и выбор кликом по миру. */
        tickPick,
        /** Выбор кликом по экранной точке — тем же путём, что и клик мышью. */
        pickAt(x, y) {
            const was = state.pick;
            state.pick = true;
            const r = pickFromScreen({ x: Number(x) || 0, y: Number(y) || 0 });
            state.pick = was;
            return r;
        },
        /** Последний выбор кликом: selector/source/координаты (§21). */
        picked() { return state.last_pick; },
        pickHover() { return state.pick_hover_uid; },

        /** §21: действия копирования. LastCopied — что реально ушло в буфер. */
        copySelector, copyNodeId, copyJs,
        lastCopied() { return state.last_copied; },

        /** Машиночитаемое состояние панели (правила 8–9: только факты). */
        panel() {
            return {
                open: state.open,
                doc: state.doc,
                rows: state.rows,
                entities: state.entities,
                selected: state.selected_uid,
                selected_nid: state.selected_nid,
                selector: state.selector,
                refreshed: state.refreshed,
                search: state.search,
                search_kind: state.search_kind,
                filters: Object.assign({}, state.filters),
                offset: state.offset,
                section: state.section,
                pick: state.pick,
                pick_hover: state.pick_hover_uid,
                picked: state.last_pick,
            };
        },

        /**
         * §27: состояние хот-релоада ассетов — индикатор, список и граф.
         * Тесты и внешние инструменты видят те же факты, что панель.
         */
        assets() {
            if (!$.reload) return null;
            return { indicator: $.reload.indicator(), stats: $.reload.stats(),
                     list: $.reload.list(), graph: $.reload.graph() };
        },

        /** Нажать кнопки хот-релоада программно (без RmlUi): тесты и команды. */
        assetsReload() { return $.reload ? $.reload.reloadAll() : null; },
        assetsPoll() { return $.reload ? $.reload.poll() : null; },

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
    if (ctx.input && ctx.input.pressed) {
        if (ctx.input.pressed('f2')) d.toggle();
        if (ctx.input.pressed('f1') && ctx.debug) ctx.debug.toggle();
    }
    d.refreshRuntime();
    if (d.isOpen()) {
        d.refresh();
        // §21: подсветка и выбор кликом — каждый кадр, но только пока панель
        // открыта и включён режим Pick entity.
        if (d.pickOn()) d.tickPick();
    }
}
