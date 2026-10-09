// ===========================================================================
// Чистая логика SDK-приложения: без движка и без UI (tests/js/sdk_app_test.mjs).
// ===========================================================================

/** Экранирование для RML: текст файлов и диагностик попадает в разметку. */
export function escapeHtml(value) {
    return String(value === undefined || value === null ? '' : value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function isAbsolutePath(path) {
    return /^([A-Za-z]:[\\/]|\/)/.test(String(path));
}

/** Склейка путей через «/» без двойных разделителей. */
export function joinPath(a, b) {
    if (!a) return String(b);
    if (!b) return String(a);
    return String(a).replace(/\/+$/, '') + '/' + String(b).replace(/^\/+/, '');
}

/** «  demos/ » → «demos»; корень «/» остаётся. */
export function normalizeDir(text) {
    let dir = String(text || '').trim().replace(/\\/g, '/');
    while (dir.length > 1 && dir.endsWith('/')) dir = dir.slice(0, -1);
    return dir;
}

/** Абсолютный путь для подпроцесса: относительные считаются от каталога запуска. */
export function absolutePath(base, path) {
    const p = normalizeDir(path);
    if (!p) return '';
    return isAbsolutePath(p) ? p : joinPath(base || '', p);
}

/** Последние проекты: без повторов, свежие первыми, не больше max. */
export function pushRecent(list, dir, max = 8) {
    const out = [dir];
    for (const item of list || []) {
        if (item !== dir && out.length < max) out.push(item);
    }
    return out;
}

/** Фильтр ассетов по подстроке пути и точному типу. Порядок входа сохраняется. */
export function filterAssets(entries, query, type) {
    const q = String(query || '').trim().toLowerCase();
    const t = String(type || '');
    const out = [];
    for (const e of entries || []) {
        if (t && e.type !== t) continue;
        if (q && !e.path.toLowerCase().includes(q)) continue;
        out.push(e);
    }
    return out;
}

/** { тип: количество } — для панели фильтров. */
export function countTypes(entries) {
    const counts = {};
    for (const e of entries || []) counts[e.type] = (counts[e.type] || 0) + 1;
    return counts;
}

const TYPE_LABELS = {
    'project': 'проект',
    'sdk.registry': 'реестр SDK',
    're2dsprite.character': 'Re2DSprite',
    're2dsprite.animations': 'Re2DSprite · анимации',
    're2d.surface': 'Re2D · поверхность',
    're2d.world': 'Re2D World',
    're2d.bake': 'Re2D · bake',
    'sprite.atlas': 'атлас спрайтов',
    'animation': 'анимация',
    'tilemap': 'тайлкарта',
    'particles': 'частицы',
    'rmlui.document': 'RML',
    'rmlui.style': 'RCSS',
    'image': 'картинка',
    'audio': 'звук',
    'script': 'скрипт',
    'json': 'JSON',
    'font': 'шрифт',
    'doc': 'документ',
    'data': 'данные',
    'model.glb': 'модель GLB',
    'model.gltf': 'модель glTF',
    'model.vrm': 'модель VRM',
    'model.obj': 'модель OBJ',
    'model.fbx': 'модель FBX',
    'replay': 'реплей',
    'file': 'файл',
};

export function assetTypeLabel(type) {
    return TYPE_LABELS[type] || String(type || 'файл');
}

/** Читаемая дата обновления из ISO 8601: «08.10.2026 18:00 (+03:00)». Некорректную не скрываем. */
export function formatUpdated(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.exec(String(iso || ''));
    if (!m) return String(iso || '—');
    return m[3] + '.' + m[2] + '.' + m[1] + ' ' + m[4] + ':' + m[5] + ' (' + (m[6] === 'Z' ? 'UTC' : m[6]) + ')';
}

/** Найти инструмент реестра по id или по entry. */
export function findTool(tools, key) {
    for (const t of tools || []) if (t.id === key) return t;
    for (const t of tools || []) if (t.entry === key) return t;
    return null;
}

/** Счётчики по списку диагностик. */
export function summarize(diags) {
    const sum = { errors: 0, warnings: 0, infos: 0 };
    for (const d of diags || []) {
        if (d.severity === 'warning') sum.warnings++;
        else if (d.severity === 'info') sum.infos++;
        else sum.errors++;
    }
    return sum;
}

/** Размер файла: 1.2 КБ. */
export function formatSize(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return n + ' Б';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' КБ';
    return (n / 1024 / 1024).toFixed(1) + ' МБ';
}

/** Каталог файла: «a/b/c.png» → «a/b». */
export function dirOf(path) {
    const i = String(path).lastIndexOf('/');
    return i < 0 ? '' : String(path).slice(0, i);
}
