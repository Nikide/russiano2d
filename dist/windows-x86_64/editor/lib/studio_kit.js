// ===========================================================================
// Каркас студий Editor (docs/EDITOR.md §4).
//
// Студия — модуль editor/studios/<id>.js:
//
//   export const meta = { id, title, icon, match(path), also?(path) };
//   export function create(host) → {
//       doc,                         // свой RmlUi-документ (kit.studioDoc)
//       open(abs) → Promise,         // загрузить файл
//       update(dt),                  // кадр: только у активной вкладки
//       layout(), onActive(on),      // документ встал/сменил место; вкладка ушла/вернулась
//       save() → Promise<bool>, undo(), redo(), dirty() → bool,
//       diagnostics() → [diag], snapshot() → {...}, commands?() → [{label, run}],
//       close(),
//   }
//
// host — то, что Editor даёт студии: $, файлы проекта, backend r2d, запуск
// игры, статус, журнал, «изменилось» (вкладка/Problems), «открыть как», и
// флаг typing (идёт набор текста — горячие клавиши студии молчат).
//
// Экземпляр на вкладку: документ создаётся из разметки ($.ui.markup) под
// уникальным именем, поэтому две карты или два атласа открыты одновременно.
// ===========================================================================

let docCounter = 0;

export const esc = (s) => String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Документ студии из editor/ui/studios/<file>.rml: свой экземпляр на вкладку. */
export function studioDoc($, file) {
    const src = 'ui/studios/' + file + '.rml';
    const rml = $.fs.readText(src);
    if (rml === null || rml === undefined) throw new Error('нет разметки студии: editor/' + src);
    // Имя — в том же каталоге, чтобы <link href> считались от ui/studios/.
    return $.ui.markup('ui/studios/' + file + '.' + (++docCounter) + '.rml', rml);
}

/** Пиксели RmlUi ↔ логические точки окна (мышь, мир при камере «мир = экран»). */
export function uiScale($) {
    const px = $.window.pixels(), pt = $.window.size();
    return pt && pt.w ? px.w / pt.w : 1;
}

/** Мышь в пикселях RmlUi (координаты doc.rect). */
export function mousePx($) {
    const k = uiScale($), m = $.input.mouse();
    return { x: m.x * k, y: m.y * k };
}

export function inside(p, r) {
    return !!r && p.x >= r.x && p.y >= r.y && p.x < r.x + r.w && p.y < r.y + r.h;
}

/** Камера «мир = экран»: мировые координаты узлов превью равны логическим точкам окна. */
export function screenCamera($) {
    const size = $.gfx.size();
    $.camera.at(size.w / 2, size.h / 2).zoom(1);
}

/** Диагностика backend/студии → единая форма Problems. */
export function diag(code, severity, message, extra) {
    return Object.assign({ code, severity, asset: null, location: null, message: String(message), details: null }, extra || {});
}

/**
 * Кнопки-фронты для студии: клавиша срабатывает один раз в кадр нажатия и не
 * срабатывает, пока идёт набор текста (поле инспектора) или зажат Cmd/Ctrl
 * (сочетания принадлежат Editor).
 */
export function keys($, host) {
    const mod = () => $.input.ctrlDown() || $.input.down('cmd') || $.input.down('rcmd');
    return {
        pressed(name) { return !host.typing() && !mod() && $.input.pressed(name); },
        down(name) { return !host.typing() && $.input.down(name); },
        shift() { return $.input.shiftDown(); },
        mod,
    };
}

/** Число из поля: значение или null (пусто/не число). */
export function numberOf(doc, id) {
    const raw = String(doc.value(id) === null ? '' : doc.value(id)).trim();
    if (raw === '') return null;
    const v = Number(raw);
    return Number.isFinite(v) ? v : null;
}

/** HTML строки списка с data-key. */
export function row(key, html, cls) {
    return '<div class="st-row' + (cls ? ' ' + cls : '') + '" data-key="' + esc(key) + '">' + html + '</div>';
}

// --- Системные окна выбора файла ($.fs.pickFile / saveFile) ----------------

export const FILTERS = {
    image: [{ name: 'Картинки', ext: 'png;jpg;jpeg;webp;bmp;gif' }],
    audio: [{ name: 'Звук', ext: 'ogg;wav;mp3;flac' }],
    font: [{ name: 'Шрифты', ext: 'ttf;otf' }],
    scene: [{ name: 'Сцена', ext: 'scene' }],
};

// Путь относительно корня проекта или null, если файл вне проекта.
export function projectRelative(root, abs) {
    const r = String(root || '').replace(/\/+$/, '');
    const p = String(abs || '');
    return r && p.startsWith(r + '/') ? p.slice(r.length + 1) : null;
}

// Окно ОС «выбрать файл проекта». → { rel } | { cancelled } | { error }.
// Ассеты обязаны лежать в проекте: файл снаружи — понятная ошибка, не тихий путь.
export async function pickProjectFile($, root, opts) {
    const o = opts || {};
    let picked;
    try {
        picked = await (o.save ? $.fs.saveFile : $.fs.pickFile)({ title: o.title, path: o.path || root, filters: o.filters });
    } catch (e) {
        return { error: (e && e.message) || String(e) };
    }
    if (!picked) return { cancelled: true };
    const rel = projectRelative(root, picked);
    if (rel === null) return { error: 'Файл вне проекта: ' + picked + '. Положите его в папку проекта (' + root + ').' };
    return { rel };
}
