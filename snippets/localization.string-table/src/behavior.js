// Строки: $.i18n.add по языкам; язык — $.store lang или значение по умолчанию.
export default function stringTable(node, config, $) {
    const data = $.fs.readJSON(config.table, null);
    if (!data) { $.emit('i18n:missing', { table: config.table }); return () => {}; }
    for (const [lang, strings] of Object.entries(data)) if (strings && typeof strings === 'object') $.i18n.add(lang, strings);
    $.i18n.lang($.store.get('lang', config.lang));
    return () => {};
}
