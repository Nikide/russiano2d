// Характеристики → .data(): «ключ=значение», число — числом.
export default function attributes(node, config, $) {
    for (const line of config.values) {
        const i = line.indexOf('=');
        if (i <= 0) continue;
        const key = line.slice(0, i).trim(), raw = line.slice(i + 1).trim();
        node.data(key, raw !== '' && Number.isFinite(Number(raw)) ? Number(raw) : raw);
    }
    return () => {};
}
