// Фикстура §15: контексты ввода, перепривязка, захват ввода и политика устройств.
//
// Игра намеренно маленькая: одно и то же действие `confirm` объявлено в
// контекстах menu/dialogue/gameplay, чтобы тест проверил, что нажатие достаётся
// ровно одному из них, а не всем сразу. Никаких импортов модулей движка:
// игра видит только `$`.

$.ready(($) => {
    $.world.color('#0b1018').bounds(0, 0, 960, 540);

    // Базовые действия: то, что игра объявляет всегда.
    $.input.bind('confirm', ['space', 'enter', 'gamepad.a']);
    $.input.bind('attack', ['j', 'gamepad.x']);
    $.input.bind('pause', ['escape', 'gamepad.start']);
    $.input.bind('left', ['a']);
    $.input.markDefaults();

    // Контексты: меню приоритетнее диалога, диалог — игрового.
    $.input.context('menu', { active: false, priority: 20, binds: { confirm: ['space', 'enter'] } });
    $.input.context('dialogue', { active: false, priority: 10, binds: { confirm: ['space'] } });
    $.input.context('gameplay', { active: true, priority: 0, binds: { confirm: ['space'], attack: ['j'] } });
    $.input.context('loading', { active: false, priority: 30, binds: {} });

    // Журнал: что игра увидела в этом кадре. Тест читает его, а не догадывается.
    const log = [];
    // Массив отдаём НАПРЯМУЮ (а не функцией): снимок сериализует значение,
    // поэтому тест видит те же строки, что игра, и сам их чистит.
    $.agent.expose('log', () => log);
    // Проба «что игра видит прямо сейчас». Контексты решаются в момент чтения,
    // поэтому журнал можно не обновлять — достаточно спросить действие.
    // `$.agent.expose` вызывает функцию БЕЗ аргументов, поэтому на каждое
    // действие своя проба, а не одна параметризованная.
    // `$.agent.expose` вызывает функцию без аргументов, поэтому на каждое
    // действие своя проба. Функция именованная: безымянная стрелка, читающая
    // внешнюю переменную, падала с «TypeError: not a function».
    function pressNow(action) {
        return {
            pressed: input().pressed(action),
            down: input().down(action),
            released: input().released(action),
        };
    }
    function input() { return $.input; }
    // Проба действий прямо сейчас. Имена действий передаются строкой, чтобы
    // стрелка не зависела от замкнутой переменной цикла.
    $.agent.expose('confirm_now', function () { return pressNow('confirm'); });
    $.agent.expose('attack_now', function () { return pressNow('attack'); });
    $.agent.expose('pause_now', function () { return pressNow('pause'); });
    $.agent.expose('ctxList', () => $.input.context());
    $.agent.expose('conflicts', (action, keys) => $.input.conflicts(action, keys));
    $.agent.expose('glyphs', (action) => $.input.glyphs(action));
    $.agent.expose('stuck', () => $.input.stuck());
    $.agent.expose('held', (slot) => $.input.device(slot).held());
    $.agent.expose('devicePlayer', (slot) => $.input.device(slot).player());
    $.agent.expose('consumed', () => $.input.consumed());

    $.update(() => {
        const seen = [];
        for (const a of ['confirm', 'attack', 'pause']) {
            if ($.input.pressed(a)) seen.push(a);
            if ($.input.down(a)) seen.push(a + ':down');
        }
        if (seen.length) log.push({ frame: $.time.frame(), seen });
    });

    $('<rect>', { id: 'dot' }).at(20, 20).size(8, 8).color('#7fd1ff').appendTo($.world);
});
