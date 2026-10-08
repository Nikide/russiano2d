// ===========================================================================
// HTML-представления SDK (RML-фрагменты). Чистые функции: строка на входе —
// строка на выходе, поэтому проверяются без движка. Весь UI — RmlUi
// (docs/UI_RMLUI_LAW.md); здесь только разметка для $.ui.doc().html().
// ===========================================================================

import { escapeHtml, assetTypeLabel, formatUpdated, formatSize, dirOf } from './model.js';

const MAX_ASSET_ROWS = 300;

/** Карточки инструментов из реестра. Невалидная запись остаётся видимой и помечена. */
export function toolCards(tools, diagsByTool) {
    if (!tools || tools.length === 0) return '<p class="empty">Реестр пуст: в sdk_tools.json нет инструментов.</p>';
    let html = '';
    for (const t of tools) {
        const bad = !t.valid;
        const notes = (diagsByTool && diagsByTool[t.id || ('#' + t.index)]) || [];
        html += '<div class="card' + (bad ? ' invalid' : '') + '">' +
            '<div class="card-head"><span class="card-name">' + escapeHtml(t.name || t.id || '(без имени)') + '</span>' +
            (t.category ? '<span class="tag">' + escapeHtml(t.category) + '</span>' : '') +
            (bad ? '<span class="tag tag-bad">ошибка записи</span>' : '') + '</div>' +
            '<div class="card-desc">' + escapeHtml(t.description) + '</div>' +
            '<div class="card-meta">id: ' + escapeHtml(t.id) + ' · обновлён ' + escapeHtml(formatUpdated(t.last_updated)) +
            ' · экран: ' + escapeHtml(t.entry) + '</div>';
        for (const n of notes) html += '<div class="card-note">' + escapeHtml(n.code) + ': ' + escapeHtml(n.message) + '</div>';
        html += '<div class="card-actions">' +
            (bad ? '' : '<button class="btn" data-key="' + escapeHtml(t.id) + '">Открыть</button>') + '</div></div>';
    }
    return html;
}

/** Строки Asset Browser. Больше MAX_ASSET_ROWS не рисуем: фильтр сужает список. */
export function assetRows(entries, selected) {
    if (!entries || entries.length === 0) return '<p class="empty">Файлов нет.</p>';
    let html = '';
    const shown = Math.min(entries.length, MAX_ASSET_ROWS);
    for (let i = 0; i < shown; i++) {
        const e = entries[i];
        const dir = dirOf(e.path);
        const name = dir ? e.path.slice(dir.length + 1) : e.path;
        html += '<div class="row' + (e.path === selected ? ' sel' : '') + '" data-key="' + escapeHtml(e.path) + '">' +
            '<span class="row-name">' + escapeHtml(name) + '</span>' +
            '<span class="row-dir">' + escapeHtml(dir) + '</span>' +
            '<span class="row-type">' + escapeHtml(assetTypeLabel(e.type)) + '</span>' +
            '<span class="row-size">' + escapeHtml(formatSize(e.size)) + '</span>' +
            (e.tool ? '<span class="row-tool">→ ' + escapeHtml(e.tool) + '</span>' : '') + '</div>';
    }
    if (entries.length > shown) {
        html += '<p class="empty">Показано ' + shown + ' из ' + entries.length + ' — уточните фильтр.</p>';
    }
    return html;
}

/** Панель диагностик: severity, code, asset, message. */
export function diagRows(diags) {
    if (!diags || diags.length === 0) return '<p class="empty">Диагностик нет.</p>';
    let html = '';
    for (let i = 0; i < diags.length; i++) {
        const d = diags[i];
        const sev = d.severity === 'warning' ? 'warn' : d.severity === 'info' ? 'info' : 'err';
        html += '<div class="diag diag-' + sev + '" data-key="' + i + '">' +
            '<span class="diag-sev">' + escapeHtml(String(d.severity || 'error').toUpperCase()) + '</span>' +
            '<span class="diag-code">' + escapeHtml(d.code) + '</span>' +
            (d.asset ? '<span class="diag-asset">' + escapeHtml(d.asset) + '</span>' : '') +
            '<div class="diag-msg">' + escapeHtml(d.message) + '</div></div>';
    }
    return html;
}

/** Сводка по открытому проекту. */
export function projectPanel(project) {
    if (!project) return '<p class="empty">Проект не открыт. Укажите каталог проекта и нажмите «Открыть».</p>';
    return '<div class="kv"><span class="k">Каталог</span><span class="v">' + escapeHtml(project.dir) + '</span></div>' +
        '<div class="kv"><span class="k">Название</span><span class="v">' + escapeHtml(project.title || '—') + '</span></div>' +
        '<div class="kv"><span class="k">Версия</span><span class="v">' + escapeHtml(project.version || '—') + '</span></div>' +
        '<div class="kv"><span class="k">Окно</span><span class="v">' +
            (project.width && project.height ? project.width + '×' + project.height : 'по умолчанию') + '</span></div>' +
        '<div class="kv"><span class="k">main.js</span><span class="v">' + (project.hasMain ? 'есть' : 'нет') + '</span></div>' +
        '<div class="kv"><span class="k">project.json</span><span class="v">' + (project.hasManifest ? 'есть' : 'нет') + '</span></div>';
}

/** Список «последние проекты» и найденные проекты: клик по строке открывает. */
export function pathRows(list, emptyText) {
    if (!list || list.length === 0) return '<p class="empty">' + escapeHtml(emptyText) + '</p>';
    let html = '';
    for (const item of list) {
        const dir = typeof item === 'string' ? item : item.path;
        const title = typeof item === 'string' ? '' : item.title;
        html += '<div class="row" data-key="' + escapeHtml(dir) + '"><span class="row-name">' + escapeHtml(dir) + '</span>' +
            (title ? '<span class="row-dir">' + escapeHtml(title) + '</span>' : '') + '</div>';
    }
    return html;
}

/** Список документов. */
export function docRows(docs, selected) {
    let html = '';
    for (const d of docs) {
        html += '<div class="row' + (d.path === selected ? ' sel' : '') + '" data-key="' + escapeHtml(d.path) + '">' +
            '<span class="row-name">' + escapeHtml(d.title) + '</span><span class="row-dir">' + escapeHtml(d.path) + '</span></div>';
    }
    return html;
}

/** Фильтры типов ассетов: «все» + топ типов с счётчиками. */
export function typeFilters(counts, active) {
    const types = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || (a < b ? -1 : 1)).slice(0, 10);
    let html = '<span class="chip' + (!active ? ' on' : '') + '" data-key="">все</span>';
    for (const t of types) {
        html += '<span class="chip' + (t === active ? ' on' : '') + '" data-key="' + escapeHtml(t) + '">' +
            escapeHtml(assetTypeLabel(t)) + ' ' + counts[t] + '</span>';
    }
    return html;
}
