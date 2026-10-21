
// «id=число» → [[id, число], …]
function counts(list) {
    return list.map((s) => s.split('=')).filter((p) => p.length >= 2 && p[0].trim() && Number.isFinite(Number(p[1])))
        .map((p) => [p[0].trim(), Number(p[1])]);
}

// Миграции — данные, а не выражения: шаг N переименовывает ключи пространства.
export default function saveMigration(node, config, $) {
    const steps = {};
    for (const s of config.renames) { const m = /^(\d+):([\w-]+)=([\w-]+)$/.exec(s.trim()); if (m) (steps[Number(m[1]) - 1] || (steps[Number(m[1]) - 1] = [])).push([m[2], m[3]]); }
    const migrate = {};
    for (const [from, pairs] of Object.entries(steps)) migrate[from] = (doc) => {
        const ns = doc.namespaces && doc.namespaces[config.namespace] && doc.namespaces[config.namespace].data;
        if (ns) for (const [a, b] of pairs) if (a in ns) { ns[b] = ns[a]; delete ns[a]; }
        return doc;
    };
    const defaults = { namespaces: { [config.namespace]: { data: Object.fromEntries(counts(config.defaults)) } } };
    $.save.schema({ version: config.version, migrate, defaults });
    return () => $.save.schema(null);
}
