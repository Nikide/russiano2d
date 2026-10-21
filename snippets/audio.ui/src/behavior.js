// UI-звуки на шине ui.
export default function uiAudio(node, config, $) {
    const hs = [['ui:hover', config.hover], ['ui:select', config.select], ['ui:deny', config.deny]].filter(([, s]) => s)
        .map(([ev, s]) => [ev, () => $.audio.play(s, { bus: 'ui' })]);
    for (const [ev, h] of hs) $.on(ev, h);
    return () => { for (const [ev, h] of hs) $.off(ev, h); };
}
