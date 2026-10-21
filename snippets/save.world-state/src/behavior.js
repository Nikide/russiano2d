// Мир: по id узла — { exists, open, on, x, y }; при загрузке — удалить/применить.
export default function saveWorldState(node, config, $) {
    const write = () => {
        const out = {};
        for (const sel of config.track) $(sel).each((i, w) => { const id = w.attr('id'); if (id) out[id] = { open: !!w.data('open'), on: !!w.data('on'), x: w.pos().x, y: w.pos().y }; });
        const prev = $.save.get(config.key) || {};
        for (const id of Object.keys(prev)) if (!(id in out)) out[id] = { removed: true };
        $.save.set(config.key, out);
    };
    const read = () => {
        const d = $.save.get(config.key) || {};
        for (const [id, st] of Object.entries(d)) {
            const w = $('#' + id);
            if (!w.length) continue;
            if (st.removed) { w.remove(); continue; }
            w.data('open', st.open).data('on', st.on).at(st.x, st.y);
            if (st.open) w.alpha(0.25).sensor(true);
        }
    };
    $.on('save:before', write); $.on('saved', write); $.on('loaded', read);
    return () => { $.off('save:before', write); $.off('saved', write); $.off('loaded', read); };
}
