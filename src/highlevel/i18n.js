// ===========================================================================
// Локализация: $.i18n и $.tr.
//
// Словарь — обычный объект { 'menu.play': 'Играть' }. Значение может быть
// массивом форм для плюрализации: ['нет', 'один', '{n} штуки'].
//
//   $.i18n.add('ru', { 'menu.play': 'Играть' });
//   $.i18n.lang('ru');
//   $.tr('menu.play');                 // → 'Играть'
//   $.i18n.plural('kills', 3);         // → '3 штуки'
//
// Узлы с attrs.tr переводятся сами, если включён $.i18n.auto(true):
//   $('<ui.label>', { tr: 'menu.play' });
//
// Выбранный язык хранится в $.store под ключом 'i18n.lang' и восстанавливается
// при следующем installI18n(). Чистые помощники (format/pluralIndex/lookup)
// экспортируются наружу: их проверяет qjs-тест без движка.
// ===========================================================================

import { ctx, nodesWithFacet, engineOf } from './core.js';

const LANG_KEY = 'i18n.lang';

const state = {
    lang: 'ru',
    fallback: 'ru',
    dicts: new Map(),      // код языка → словарь
    auto: false,           // переводить ли узлы с attrs.tr автоматически
    warned: new Set(),     // ключи, о которых уже предупредили (не спамить)
    version: 0,            // растёт при смене словарей/языка
    node_version: -1,      // версия, уже применённая к узлам
    // WeakSet, а не Set: обычный набор держал бы уничтоженные узлы вечно —
    // чистился он только при смене языка, поэтому утечка была бесконечной.
    nodes: new WeakSet(),  // узлы с attrs.tr, которым текст уже подставлен
};

// ---------------------------------------------------------------------------
// Чистые помощники (без движка)
// ---------------------------------------------------------------------------

/**
 * Подстановка {name} в текст. Неизвестный параметр остаётся как есть —
 * так опечатка в шаблоне видна сразу, а не превращается в «undefined».
 */
export function format(text, params) {
    if (text === undefined || text === null) return '';
    const source = String(text);
    if (!params || typeof params !== 'object') return source;
    return source.replace(/\{(\w+)\}/g, (whole, name) => {
        const value = params[name];
        return value === undefined || value === null ? whole : String(value);
    });
}

/**
 * Индекс плюральной формы. Правила упрощены, но покрывают русские крайние
 * случаи (11–14 — всегда «штук», а не «штука»). Для 'en' форм две.
 */
export function pluralIndex(count, lang) {
    const n = Math.abs(Math.trunc(Number(count))) || 0;
    const code = String(lang || '').toLowerCase().split(/[-_]/)[0];
    if (code === 'en') return n === 1 ? 0 : 1;
    if (code === '') return n === 1 ? 0 : 1;
    // Русский и близкие: 1 / 2–4 / 5+ (с оговоркой 11–14).
    if (n % 10 === 1 && n % 100 !== 11) return 0;
    if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) return 1;
    return 2;
}

/**
 * Выбор КЛИПА — варианта одного текста.
 *
 * Локализация — это не только перевод: одну и ту же фразу в озвучке и в
 * субтитрах нужно уложить в разное время, а короткую подпись на кнопке взять
 * иначе, чем длинную в диалоге. Поэтому значением ключа может быть СПИСОК
 * вариантов, а не одна строка.
 *
 * `selector` — номер варианта или зерно: `clipIndex(seed, n)` превращает зерно
 * в стабильный индекс (одно и то же зерно → один и тот же вариант, иначе
 * реплика «дрожала» бы между кадрами).
 */
export function clipIndex(selector, count) {
    const n = Math.max(1, Math.floor(Number(count) || 1));
    if (n === 1) return 0;
    const value = Number(selector);
    if (!Number.isFinite(value)) return 0;
    if (Number.isInteger(value) && value >= 0 && value < n) return value;
    // Зерно перемешиваем: соседние значения иначе давали бы соседние варианты.
    //
    // ВАЖНО: Math.imul возвращает ЗНАКОВОЕ 32-битное число, поэтому после него
    // обязателен `>>> 0`. Без него `h % n` давал отрицательные индексы
    // (clipIndex(100, 3) → -2), и вариант выбирался за пределами списка —
    // нашлось тестом на достижимость всех вариантов.
    let h = Math.floor(value) >>> 0;
    h ^= h >>> 16;
    h = Math.imul(h, 0x7feb352d) >>> 0;
    h = (h ^ (h >>> 15)) >>> 0;
    return h % n;
}

/** Список клипов из значения словаря (или null, если это не клипы). */
export function clipsOf(value) {
    if (value === undefined || value === null) return null;
    if (Array.isArray(value)) return value.length ? value : null;
    if (typeof value === 'object' && Array.isArray(value.clip)) {
        return value.clip.length ? value.clip : null;
    }
    return null;
}

/**
 * Значение ключа из словаря или цепочки словарей (первый, где ключ есть).
 * Принимает как один словарь, так и массив словарей — в порядке приоритета.
 */
export function lookup(dicts, key) {
    if (!dicts || key === undefined || key === null) return undefined;
    const name = String(key);
    const list = Array.isArray(dicts) ? dicts : [dicts];
    for (const dict of list) {
        if (dict && Object.prototype.hasOwnProperty.call(dict, name)) return dict[name];
    }
    return undefined;
}

// ---------------------------------------------------------------------------
// Внутреннее состояние
// ---------------------------------------------------------------------------

/** Код языка к нижнему регистру; 'ru-RU' и 'ru_RU' — один и тот же язык. */
function normalize(lang) {
    return String(lang === undefined || lang === null ? '' : lang).trim().toLowerCase().replace('_', '-');
}

/** Язык из имени файла: 'i18n/en.json' → 'en'. */
function guessLang(path) {
    const base = String(path || '').split(/[\\/]/).pop() || '';
    return normalize(base.replace(/\.[^.]+$/, ''));
}

/** Пометить словари изменёнными: tickI18n переприменит перевод к узлам. */
function bump() {
    state.version++;
}

/**
 * Словари в порядке поиска: текущий язык, затем запасной, затем все
 * остальные загруженные. Так игра работает до загрузки нужного словаря.
 */
function fallbackChain() {
    const out = [];
    const seen = new Set();
    const push = (lang) => {
        if (!lang || seen.has(lang)) return;
        const dict = state.dicts.get(lang);
        if (!dict) return;
        seen.add(lang);
        out.push(dict);
    };
    push(state.lang);
    push(state.fallback);
    for (const lang of state.dicts.keys()) push(lang);
    return out;
}

/** Сырое значение ключа (строка или массив форм). */
function resolve(key) {
    return lookup(fallbackChain(), key);
}

/** Предупреждаем о пропавшем ключе один раз: иначе лог превращается в поток. */
function warnMissing(key) {
    if (state.warned.has(key)) return;
    state.warned.add(key);
    ctx.log(`$.tr: нет перевода для "${key}" (язык "${state.lang}")`);
}

function translate(key, params, fallback) {
    const value = resolve(key);
    if (value === undefined) {
        warnMissing(key);
        return fallback === undefined ? key : fallback;
    }
    // У плюрального ключа без числа осмысленнее всего первая форма.
    return Array.isArray(value) ? format(value[0], params) : format(value, params);
}

/**
 * Перевод КЛИПОМ: из списка вариантов берётся один.
 * Выбор — `params.clip` или третий аргумент (номер или зерно).
 */
function translateClip(key, params, selector) {
    const value = resolve(key);
    if (value === undefined) {
        warnMissing(key);
        return { text: key, index: -1, total: 0 };
    }
    const list = clipsOf(value);
    if (!list) {
        const plain = Array.isArray(value) ? value[0] : value;
        return { text: format(plain, params), index: 0, total: 1 };
    }
    const pick = selector !== undefined ? selector
        : (params && params.clip !== undefined ? params.clip : 0);
    const index = clipIndex(pick, list.length);
    return { text: format(list[index], params), index, total: list.length };
}

/** Сколько клипов у ключа (0 — ключа нет или он не список). */
function clipCount(key) {
    const list = clipsOf(resolve(key));
    return list ? list.length : 0;
}

function translatePlural(key, count, params) {
    const value = resolve(key);
    if (value === undefined) {
        warnMissing(key);
        return key;
    }
    const merged = Object.assign({ n: count }, params || {});
    // Формы могут лежать отдельно от клипов: `{ plural: [...], clip: [...] }`.
    const forms = (value && !Array.isArray(value) && Array.isArray(value.plural))
        ? value.plural : value;
    if (Array.isArray(forms)) {
        let index = pluralIndex(count, state.lang);
        if (index >= forms.length) index = forms.length - 1;
        return format(forms[index], merged);
    }
    return format(forms, merged);
}

/** Прочитать JSON-словарь: через $.fs, а вне движка — напрямую движком. */
function readJSON(path) {
    const fs = ctx.fs || (ctx.$ && ctx.$.fs);
    if (fs && typeof fs.readJSON === 'function') return fs.readJSON(path, null);
    const text = engineOf().fs.readText(path);
    if (typeof text !== 'string' || text.length === 0) return null;
    try { return JSON.parse(text); }
    catch (e) {
        ctx.log(`$.i18n: не смог разобрать JSON "${path}": ${e}`);
        return null;
    }
}

function storeOf() {
    return ctx.store || (ctx.$ && ctx.$.store) || null;
}

/** Язык живёт в $.store: игра сама решает, когда писать store.save(). */
function persistLang() {
    const store = storeOf();
    if (store && typeof store.set === 'function') store.set(LANG_KEY, state.lang);
}

/** Подставить перевод в узел, помеченный attrs.tr. */
function applyToNode(node) {
    const tr = node && node.attrs ? node.attrs.tr : undefined;
    let key;
    let params;
    if (typeof tr === 'string') {
        key = tr;
    } else if (tr && typeof tr === 'object') {
        // { tr: { key: 'kills', n: 3 } } — параметры подстановки рядом с ключом.
        key = tr.key || tr.tr;
        params = tr.params || tr;
    }
    if (typeof key !== 'string' || key === '') return;
    const value = resolve(key);
    if (value === undefined) { warnMissing(key); return; }
    if (Array.isArray(value) && params && typeof params.n === 'number') {
        // { tr: { key: 'kills', n: 3 } } — плюральная форма по числу.
        node.text = translatePlural(key, params.n, params);
        return;
    }
    node.text = Array.isArray(value) ? format(value[0], params) : format(value, params);
}

// ---------------------------------------------------------------------------
// Публичное пространство $.i18n
// ---------------------------------------------------------------------------

const i18n = {
    /** Добавить или дополнить словарь языка. */
    add(lang, dict) {
        const code = normalize(lang);
        if (!code) { ctx.log('$.i18n.add: нужен код языка, например "ru"'); return i18n; }
        if (!dict || typeof dict !== 'object' || Array.isArray(dict)) {
            ctx.log(`$.i18n.add("${code}"): словарь должен быть объектом { ключ: текст }`);
            return i18n;
        }
        const target = state.dicts.get(code) || {};
        for (const key of Object.keys(dict)) target[key] = dict[key];
        state.dicts.set(code, target);
        bump();
        return i18n;
    },

    /**
     * Загрузить словарь из файла: load('en', 'i18n/en.json'). Если код языка
     * не передан — берём его из имени файла. Вместо пути можно передать
     * готовый объект словаря.
     */
    load(lang, urlOrPath) {
        if (urlOrPath === undefined) { urlOrPath = lang; lang = guessLang(urlOrPath); }
        if (urlOrPath && typeof urlOrPath === 'object') return i18n.add(lang, urlOrPath);
        const data = readJSON(String(urlOrPath));
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
            ctx.log(`$.i18n.load: не смог прочитать словарь "${urlOrPath}"`);
            return i18n;
        }
        return i18n.add(lang || state.lang, data);
    },

    /** Текущий язык: $.i18n.lang() — геттер, $.i18n.lang('en') — сеттер. */
    lang(code) {
        if (code === undefined) return state.lang;
        const next = normalize(code);
        if (!next) { ctx.log('$.i18n.lang: пустой код языка'); return i18n; }
        if (next !== state.lang) { state.lang = next; bump(); }
        persistLang();
        return i18n;
    },

    /** Запасной язык, если в текущем нет ключа. */
    fallback(code) {
        if (code === undefined) return state.fallback;
        state.fallback = normalize(code) || state.fallback;
        bump();
        return i18n;
    },

    /** Коды всех загруженных языков (по алфавиту). */
    langs() { return [...state.dicts.keys()].sort(); },

    /** Есть ли перевод ключа в текущем языке (или в запасе). */
    has(key) { return resolve(key) !== undefined; },

    /** Перевод (обычный или плюральный): $.i18n.tr('item', 3, { n: 3 }). */
    tr(key, count, params) {
        return count === undefined ? translate(key, params)
                                   : translatePlural(key, count, params);
    },

    /** Плюральная форма: $.i18n.plural('item', 3). */
    plural(key, count, params) { return translatePlural(key, count, params); },

    /**
     * КЛИП: варианты одного текста.
     *
     *   $.i18n.add('ru', { 'npc.greet': ['Привет!', 'Здорово!', 'Ага.'] });
     *   $.i18n.clip('npc.greet', 0)   // → 'Привет!'
     *   $.i18n.clip('npc.greet', 7)   // → вариант по зерну 7 (всегда тот же)
     *
     * Возвращает `{ text, index, total }`: игры часто хотят знать, какой
     * вариант выпал (озвучка идёт вместе с текстом), поэтому отдаём не только
     * строку. Для текста — `.text`, для диагностики — остальное.
     */
    clip(key, selector, params) { return translateClip(key, selector, params); },

    /** Сколько вариантов-клипов у ключа (0 — ключа нет или он не список). */
    clipCount(key) { return clipCount(key); },

    /**
     * Автоподстановка текста в узлы с attrs.tr. Без аргумента — геттер.
     * Сама подстановка происходит в tickI18n() каждый кадр.
     */
    auto(flag) {
        if (flag === undefined) return state.auto;
        state.auto = flag !== false;
        if (state.auto) bump();     // следующий tick применит перевод заново
        return i18n;
    },

    /** Перевод ключа с подстановкой параметров. */
    tr(key, params, fallback) { return translate(key, params, fallback); },

    /** Плюральная форма по числу: ['нет', 'один', '{n} штуки']. */
    plural(key, count, params) { return translatePlural(key, count, params); },
};

// ---------------------------------------------------------------------------
// Установка и кадровый шаг
// ---------------------------------------------------------------------------

export function installI18n($) {
    // Язык прошлой сессии: store уже установлен (installStore идёт раньше).
    const store = ctx.store || ($ && $.store) || null;
    if (store && typeof store.get === 'function') {
        const saved = store.get(LANG_KEY, null);
        if (typeof saved === 'string' && saved.trim()) state.lang = normalize(saved);
    }
    ctx.i18n = i18n;
    if ($) {
        $.i18n = i18n;
        $.tr = (key, params, fallback) => translate(key, params, fallback);
        $.tr.plural = (key, count, params) => translatePlural(key, count, params);
        // Клипы: текст варианта и НОМЕР варианта тоже — озвучка идёт вместе с
        // текстом, игре нужно знать, какой файл проигрывать.
        $.tr.clip = (key, selector, params) => translateClip(key, selector, params).text;
        $.tr.clipInfo = (key, selector, params) => translateClip(key, selector, params);
    }
    return i18n;
}

/**
 * Кадровый шаг: поддерживает тексты узлов с attrs.tr в актуальном переводе.
 * Новые узлы подхватываются на следующем кадре, смена языка/словаря —
 * переприменяется ко всем сразу (по счётчику version).
 */
export function tickI18n() {
    if (!state.auto) return;
    // Срез узлов с переводом держит индекс реестра: ни счётчика, ни обхода
    // всего мира здесь больше нет (§5, P2 отчёта).
    const nodes = nodesWithFacet('tr');
    if (nodes.length === 0) return;
    const fresh = state.node_version !== state.version;
    if (fresh) {
        state.nodes = new WeakSet();   // у WeakSet нет clear()
        state.node_version = state.version;
    }
    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        if (!fresh && state.nodes.has(node)) continue;
        state.nodes.add(node);
        applyToNode(node);
    }
}
