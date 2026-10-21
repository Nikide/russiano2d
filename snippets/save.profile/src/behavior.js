// Профиль: значения по умолчанию пишутся, только если ключа ещё нет.
export default function saveProfile(node, config, $) {
    const p = $.save.profile();
    if (p.get('name') === undefined) p.set('name', config.name);
    for (const s of config.defaults) { const [k, v] = s.split('='); if (k && v !== undefined && p.get(k.trim()) === undefined) p.set(k.trim(), v.trim()); }
    $.emit('profile', { name: p.get('name') });
    return () => {};
}
