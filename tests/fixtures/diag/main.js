// Фикстура диагностики (§17 Спецификации).
//
// Игра намеренно ломается предсказуемым способом: обработчик кадра бросает
// исключение, сцена — тоже. Тест проверяет, что движок отдаёт машине
// структурированную запись (code/subsystem/operation/recoverable/source), а не
// только строку в stderr, и что повторные одинаковые ошибки считаются, но не
// заливают лог.

$.ready(($) => {
    $.world.gravity(0, 0).color('#101820');
    $('<rect>', { id: 'probe' }).at(10, 10).size(10, 10).appendTo($.world);

    // Устранимая ошибка кадрового хука: кадр продолжает жить.
    $.update(() => {
        if (globalThis.__throw_frame) throw new Error('нарочно сломанный кадр');
    });

    // Неустранимая: загрузка обязательного ассета провалилась. Такую ошибку
    // загрузчик обязан считать неуспехом, а не «подготовкой завершено» (§17).
    $.scene.add('broken', {
        enter() {
            if (globalThis.__throw_scene) {
                $.debug.reportError('$.scene.enter', new Error('нет обязательного ассета'),
                                    { fatal: true, assetPath: 'assets/nope.png', code: 'R2D_ASSET_MISSING' });
            }
        },
    });

    globalThis.__throw_frame = false;
    globalThis.__throw_scene = false;
});

$.agent.expose('error_codes', () => $.debug.errors().map((e) => e.code));
$.agent.expose('error_count', () => $.debug.report().total);
$.agent.expose('error_suppressed', () => $.debug.report().suppressed);
$.agent.expose('error_clean', () => $.debug.report().clean);
