// Фикстура нативного ядра Re2D (engine.re2d.*) — фаза 2 docs/RE2D.md.
//
// Игры здесь нет: тест кладёт в globalThis.__view (x, y, eye, yaw, pitch, fov)
// и globalThis.__mesh (Float32Array мировых вершин stride 8) — а один обработчик
// кадра ставит вид и отправляет меш. Обработчик один на весь тест, иначе
// $.update накопил бы по функции на каждый вызов eval.
globalThis.__view = [0, 0, 0, 0, 0, Math.PI / 2];
globalThis.__mesh = null;
globalThis.__flags = 0;
globalThis.__texture = -1;

$.ready(() => {
    $.world.gravity(0, 0).color('#000000');
});

$.update(() => {
    const v = globalThis.__view;
    engine.re2d.view(v[0], v[1], v[2], v[3], v[4], v[5], v[6] || 0, v[7] === undefined ? 0.25 : v[7]);
    const m = globalThis.__mesh;
    if (!m) return;
    engine.re2d.mesh(m, Math.floor(m.length / 8), globalThis.__texture, globalThis.__flags);
});
