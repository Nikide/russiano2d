// ===========================================================================
// Фикстура тестов реестра ресурсов ($.resource).
//
// Ассетов-картинок здесь нет намеренно: в headless-прогоне проверяем то, что
// не зависит от GPU, — ресурсы-данные (value/build), json и text через $.fs,
// ленивость, кэш по имени, счётчик ссылок, выгрузку, preload и stats.
// Наблюдения складываются в $.store и читаются
// tests/agent/highlevel_resource_test.py.
// ===========================================================================

$.ready(() => {
    const probe = {};
    $.store.file('build/test_resource_store.json');

    // --- Данные из кода: value и ленивый build() -----------------------------
    probe.value = $.resource.load('tuning', { kind: 'data', value: { jump: 640 } }).jump;
    $.resource.free('tuning');                     // ссылку не держим: preload согреет снова

    let builds = 0;
    $.resource.define('wave', { kind: 'data', build: () => { builds++; return { size: 3 }; } });
    probe.builtBeforeGet = builds;                 // 0: define ничего не считает
    probe.waveSize = $.resource.get('wave').size;
    probe.builtAfterGet = builds;                  // 1
    $.resource.get('wave');
    probe.builtAfterSecondGet = builds;            // 1: значение из кэша

    // --- json и text через $.fs (файлы пишем сами, ассеты не нужны) ---------
    $.fs.write('build/test_resource/data.json', JSON.stringify({ speed: 42 }));
    $.fs.write('build/test_resource/notes.txt', 'привет');
    probe.jsonSpeed = $.resource.load('config', { kind: 'json', path: 'build/test_resource/data.json' }).speed;
    probe.text = $.resource.load('notes', { kind: 'text', path: 'build/test_resource/notes.txt' });
    $.resource.free('notes');                      // текст прочитан — ссылку не держим
    probe.configKind = $.resource.info('config').kind;
    probe.configState = $.resource.info('config').state;

    $.resource.define('missing', { kind: 'json', path: 'build/test_resource/nope.json' });
    probe.missingValue = $.resource.get('missing', 'запас');
    probe.missingError = $.resource.error('missing');
    probe.missingState = $.resource.info('missing').state;

    // --- Счётчик ссылок: load → free → выгрузка → ленивая загрузка снова ---
    $.resource.load('config');                     // вторая ссылка на тот же ресурс
    probe.refsAfterSecondLoad = $.resource.info('config').refs;
    probe.freedOne = $.resource.free('config');
    probe.freedTwo = $.resource.free('config');
    probe.stateAfterFree = $.resource.info('config').state;      // defined
    probe.speedAfterFree = $.resource.get('config').speed;       // 42, загрузился снова
    probe.stateAfterGet = $.resource.info('config').state;       // ready
    probe.refsWithoutGet = $.resource.info('config').refs;       // get ссылку не держит

    // --- preload, list, stats, remove, clear --------------------------------
    const pre = $.resource.preload();
    probe.preload = [pre.loaded, pre.failed, pre.total];
    probe.statsReady = $.resource.stats().ready;
    probe.statsRefs = $.resource.stats().refs;
    probe.kinds = $.resource.stats().kinds;
    probe.names = $.resource.names();
    probe.hasTuning = $.resource.has('tuning');
    probe.removed = $.resource.remove('tuning');
    probe.stillHasTuning = $.resource.has('tuning');
    probe.listLength = $.resource.list().length;
    probe.cleared = $.resource.clear();
    probe.totalAfterClear = $.resource.stats().total;

    $.store.setAll(probe);
});
