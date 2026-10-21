// Переключатель: $.input.synthDown/synthRelease эмулируют удержание.
export default function holdAlternative(node, config, $) {
    const held = new Set();
    const stop = $.updateFor(node, () => {
        if (!$.store.get('holdToggle', true)) return;
        for (const k of config.keys) {
            if (!$.input.rawPressed(k)) continue;
            if (held.has(k)) { held.delete(k); $.input.synthRelease(k); } else { held.add(k); $.input.synthDown(k); }
        }
    });
    return () => { stop(); for (const k of held) $.input.synthRelease(k); };
}
