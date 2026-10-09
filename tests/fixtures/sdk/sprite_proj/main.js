// Проверочная игра для SDK (Phase 2): читает атлас hero.atlas.json обычным
// `$.atlas` и играет тег idle обычной спрайт-анимацией. SDK в этом цикле не
// участвует: игра читает данные так же, как без SDK.
//
// Каждый запуск скрипта дописывает hero_state.json: счётчик загрузок и то,
// что прочитал рантайм. По счётчику тест видит, что движок сам перезапустил
// игру после правки *.atlas.json (hot reload), а по полям — что игра увидела
// новые данные.
$.ready(() => {
    $.gfx.color('#101820');
    const sheet = $.atlas.load('hero', 'hero.atlas.json');
    const node = $('<sprite>', { id: 'hero' }).at(200, 200).size(64, 64).appendTo($.world);
    if (sheet && sheet.tag('idle').length) {
        const ids = sheet.tagSprites('idle');
        node.frames(ids).frame(0).animate({
            from: 0, to: ids.length - 1, speed: 1000 / (sheet.tagInterval('idle') || 100), loop: true,
        });
    }
    const info = () => ({
        loaded: !!sheet,
        frames: sheet ? sheet.frames() : [],
        tags: sheet ? sheet.tags() : [],
        idle: sheet ? sheet.tag('idle') : [],
        interval: sheet ? sheet.tagInterval('idle') : 0,
        slices: sheet ? sheet.sliceNames() : [],
        pivot: sheet && sheet.sliceNames().length ? sheet.slice(sheet.sliceNames()[0]) : null,
    });
    const prev = $.fs.readJSON('hero_state.json', { loads: 0 });
    $.fs.writeJSON('hero_state.json', Object.assign({ loads: prev.loads + 1 }, info()));
    $.agent.expose('hero', info);
});
