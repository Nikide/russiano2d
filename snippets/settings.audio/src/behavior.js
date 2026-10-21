// Звук: сохранённые значения важнее значений по умолчанию.
export default function settingsAudio(node, config, $) {
    const apply = () => {
        $.audio.masterVolume($.store.get('volume.master', config.master));
        $.audio.musicVolume($.store.get('volume.music', config.music));
        $.audio.sfxVolume($.store.get('volume.sfx', config.sfx));
    };
    apply();
    const on = (e) => { const d = e.data || {}; if (['master', 'music', 'sfx'].includes(d.kind)) { $.store.set('volume.' + d.kind, Math.max(0, Math.min(1, Number(d.value) || 0))); apply(); } };
    $.on('audio:set', on);
    return () => $.off('audio:set', on);
}
