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

import { ctx, nodesWithFacet } from './core.js';

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

function translatePlural(key, count, params) {
    const value = resolve(key);
    if (value === undefined) {
        warnMissing(key);
        return key;
    }
    const merged = Object.assign({ n: count }, params || {});
    if (Array.isArray(value)) {
        let index = pluralIndex(count, state.lang);
        if (index >= value.length) index = value.length - 1;
        return format(value[index], merged);
    }
    return format(value, merged);
}

/** Прочитать JSON-словарь: через $.fs, а вне движка — напрямую движком. */
function readJSON(path) {
    const fs = ctx.fs || (ctx.$ && ctx.$.fs);
    if (fs && typeof fs.readJSON === 'function') return fs.readJSON(path, null);
    const text = engine.fs.readText(path);
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

    /** Есть ли перевод ключа в текущем языке (или в запасном). */
    has(key) { return resolve(key) !== undefined; },

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
