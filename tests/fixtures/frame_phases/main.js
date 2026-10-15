// Фикстура проверки фаз кадра (tests/agent/frame_phases_test.py).
//
// Игра намеренно крошечная: узел, который удаляется из обработчика контакта,
// статичная платформа и падающее на неё тело. По журналу, который ведёт сама
// фикстура, проверяется документированный порядок фаз (docs/FRAME_PHASES.md) и
// то, что удалённый узел не получает кадровых вызовов.
//
// Мир строится в `enter` сцены: смена сцены очищает мир, поэтому узлы,
// созданные в `$.ready`, до кадра сцены не доживают.
//
// Журнал живёт в globalThis.__phases: агент читает его одним eval.

globalThis.__phases = [];
const note = (what) => globalThis.__phases.push(what);

$.ready(($) => {
    note('ready');
    $.world.gravity(0, 1200).color('#101820');

    $.scene.add('probe', {
        enter($) {
            note('scene_enter');

            $('<rect>', { id: 'platform' }).at(200, 200).size(64, 16).body('static').appendTo($.world);
            $('<rect>', { id: 'mover' }).at(200, 150).size(12, 12).body('dynamic').appendTo($.world);

            // §4.3/§7: удаление участника внутри callback безопасно, а сам
            // удалённый узел не должен получать события после этого.
            $('#mover').on('collide', (e) => {
                // §13: событие несёт устойчивые ID (nid, source_id, target_id),
                // а не только обёртки — по ним строится трассировка.
                note('collide:' + e.source_id + '>' + e.target_id);
                if ($('#gone').length) return;
                $('<rect>', { id: 'gone' }).at(400, 400).size(8, 8).body('dynamic').appendTo($.world);
                $('#gone').on('collide', () => { globalThis.__goneHits = (globalThis.__goneHits || 0) + 1; });
                $('#gone').remove();
                note('removed-in-callback');
            });

            globalThis.__nids = {
                mover: $('#mover').nid(),
                platform: $('#platform').nid(),
            };
            globalThis.__tempAlive = 0;
            $.trace.on(true);

            // Узел, который сам себя удаляет на втором кадре (см. $.update).
            $('<rect>', { id: 'temp' }).at(50, 50).size(10, 10).appendTo($.world);
        },

        // Фаза 6 (обновление сцены) — раньше хуков $.update (фаза 7).
        update() { note('scene_update'); },
    });

    $.scene.load('probe', { transition: 'none' });

    // Узел, который удаляется из своего же обработчика кадра: после удаления
    // он не должен получать ни одного вызова (§4.3: удалённый узел не
    // продолжает получать callbacks).
    $.update(() => {
        const t = $('#temp');
        if (t.length) {
            globalThis.__tempAlive++;
            if (globalThis.__tempAlive === 2) t.remove();
        }
        note('game_update');
    });
    $.update(() => note('game_update_2'));
});

$.agent.expose('phases', () => globalThis.__phases);
$.agent.expose('nids', () => globalThis.__nids);
// Журнал отдаётся строками: снапшот агента не тащит ссылки на узлы, а тест
// видит ровно то, что описано контрактом (§13: цепочка source→target).
$.agent.expose('trace_entries', () => $.trace.list().map((e) => e.kind + ':' + e.source + '>' + e.target));
$.agent.expose('trace_dropped', () => $.trace.dropped());
