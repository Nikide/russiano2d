// Фикстура тестов реплеев (tests/agent/highlevel_replay_test.py).
//
// Мир нарочно простой и ДЕТЕРМИНИРОВАННЫЙ: квадрат едет вправо ровно на
// `dx * SPEED * dt`. Ввод приходит из одного места — через реплей, поэтому
// записанная сессия обязана воспроизвестись в ту же позицию. Ничего, кроме
// ввода, на движение не влияет: ни время суток, ни случайность.
const SPEED = 100;

$.ready(() => {
    $.world.gravity(0, 0).color('#000000').bounds(0, 0, 640, 360);
    $('<box>', { id: 'hero', w: 16, h: 16 }).at(20, 180)
        .body('dynamic').gravity(false).appendTo($.world);

    // Ввод кадра: только горизонтальная ось. Больше ничего не влияет.
    globalThis.__input = () => ({ dx: $.input.down('right') ? 1 : 0 });

    // Применение ввода — ОДНА функция на запись и на проигрывание.
    globalThis.__apply = (in_) => {
        const step = (in_ && in_.dx ? in_.dx : 0) * SPEED * ($.time.delta() || 0);
        const hero = $('#hero');
        if (hero && step) hero.move(step, 0);
    };
});
