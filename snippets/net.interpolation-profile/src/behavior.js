// Интерполяция: встроенная; задаются буфер и частота.
export default function interpolationProfile(node, config, $) {
    $.net.interpolationDelay(config.delay);
    $.net.syncRate(config.syncRate);
    return () => {};
}
