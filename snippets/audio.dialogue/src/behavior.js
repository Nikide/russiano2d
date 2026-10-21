// Реплика: voice — файл, text — показывается в $.dialog одной страницей.
export default function dialogueAudio(node, config, $) {
    const on = (e) => {
        const d = e.data || {};
        if (d.voice) $.audio.play(d.voice, { bus: 'voice' });
        if (d.text) { $.dialog.define('_say', { nodes: { start: { speaker: d.speaker || config.speaker, text: d.text, to: null } } }); $.dialog.play('_say'); }
    };
    node.on('say', on);
    return () => node.off('say', on);
}
