// Фикстура для tests/agent/vfx_*_test.py: тихий мир и клип из ДВУХ листов.
$.ready(() => {
    $.world.gravity(0, 0).color('#101820').bounds(0, 0, 800, 600);

    $('<rect>', { id: 'anchor' }).at(120, 160).size(24, 24).appendTo($.world);

    // Кадры с разных листов — то, что проверяет милстоун M5 (clip.<имя>).
    $.clip.define('vfx.twoSheets', {
        frames: [
            { src: 'assets/a.png', x: 0, y: 0, w: 16, h: 16 },
            { src: 'assets/b.png', x: 0, y: 0, w: 16, h: 16 },
        ],
        fps: 10,
        loop: true,
    });
});
