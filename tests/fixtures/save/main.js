// ===========================================================================
// Фикстура тестов сохранений ($.save).
//
// Строит маленький мир (герой с ребёнком-шляпой и летящая пуля), пишет слот
// целиком, ломает состояние и возвращает его из слота, гоняет export/import
// строкой, частичные снимки, миграцию старого формата, битый JSON, автосейв.
// Все наблюдения складываются в $.store (в конце, потому что load/import
// заменяют данные $.store целиком) — их читает
// tests/agent/highlevel_save_test.py.
// ===========================================================================

$.ready(() => {
    const probe = {};                       // то, что прочитает Python-тест

    $.world.gravity(0, 0).color('#101820');
    // Пишем в build/, чтобы не затирать save.json игры.
    $.store.file('build/test_save_store.json');
    $.save.dir('build/test_saves');

    // Слоты прошлого прогона не должны путать тест.
    for (const slot of $.save.list({ meta: false })) $.save.remove(slot.slot);

    // --- Мир: герой с ребёнком-шляпой и летящая пуля ------------------------
    const hero = $('<rect>', { id: 'hero', class: 'hero' })
        .at(100, 200).size(30, 40).appendTo($.world);
    hero.hp(100);
    $('<rect>', { id: 'hat', class: 'hat' }).at(0, -25).size(20, 10).appendTo(hero);
    const ball = $('<bullet>', { id: 'ball' }).at(400, 300).appendTo($.world);
    ball.velocity(120, -30);

    // --- Данные игры: счёт и счётчик ---------------------------------------
    $.store.set('score', 500);
    $.save.counter('kills', 2);

    // --- Слот 1: снимок целиком ---------------------------------------------
    // Считаем узлы до и после загрузки: так проверка не зависит от служебных
    // узлов, которые движок мог завести сам.
    probe.worldCountBeforeSave = $.world.count();
    probe.saveOk = $.save.slot(1).save();
    probe.slotExists = $.save.exists(1);
    probe.slotPath = $.save.path(1);
    probe.slotVersion = $.save.info(1).version;
    probe.slotKeys = $.save.info(1).store_keys;
    probe.slotNodes = $.save.info(1).world_nodes;
    probe.slotHasWorld = $.save.info(1).has_world;
    probe.slotLegacy = $.save.info(1).legacy;
    probe.slotSize = $.save.info(1).size;
    probe.slotScene = $.save.info(1).scene;

    // --- Ломаем состояние и возвращаем слот ---------------------------------
    hero.at(700, 500);
    ball.at(50, 50);
    $('<rect>', { id: 'junk' }).at(0, 0).appendTo($.world);
    $.store.set('score', 0);
    $.store.set('junk', 'мусор');
    probe.loadOk = $.save.load(1);
    probe.scoreAfterLoad = $.store.get('score');
    probe.junkAfterLoad = $.store.has('junk');
    probe.heroX = $('#hero').pos().x;
    probe.heroHp = $('#hero').hp();
    probe.hatCount = $('#hat').length;
    probe.ballCount = $('#ball').length;
    probe.worldCount = $.world.count();
    const speed = $('#ball').velocity();
    probe.ballVx = speed.x;
    probe.ballVy = speed.y;
    probe.kills = $.save.counter('kills');

    // --- Строки: export/import ----------------------------------------------
    const text = $.save.export();
    const head = JSON.parse(text);
    probe.exportIsString = typeof text === 'string';
    probe.exportFormat = head.format;
    probe.exportVersion = head.version;
    // §14: данные лежат в разделах; плоских зеркал в файле нет.
    probe.exportRoots = head.namespaces.room.world.length;
    probe.exportSpeeds = head.namespaces.room.speeds.length;
    probe.exportHasFlatStore = head.store !== undefined;
    probe.exportNamespaces = Object.keys(head.namespaces).sort().join(',');
    $('#hero').at(1, 1);
    $.store.set('score', -1);
    probe.importOk = $.save.import(text);
    probe.heroXAfterImport = $('#hero').pos().x;
    probe.scoreAfterImport = $.store.get('score');
    probe.importBroken = $.save.import('{ сломано');
    probe.importError = $.save.stats().last_error;
    probe.importFuture = $.save.import(JSON.stringify({ format: 'r2d.save', version: 99, store: {} }));

    // --- Частичные слоты: 2 — только данные, 3 — только мир -----------------
    probe.saveNoWorld = $.save.slot(2).save({ world: false });
    probe.slot2HasWorld = $.save.info(2).has_world;
    probe.slot2Keys = $.save.info(2).store_keys;
    probe.saveNoStore = $.save.slot(3).save({ store: false });
    probe.slot3Keys = $.save.info(3).store_keys;
    probe.slot3Nodes = $.save.info(3).world_nodes;
    // --- Мир, который был до загрузки, восстановлен, а не удвоен -------------
    $.save.slot(1);
    probe.heroCountAfter = $('#hero').length;
    probe.junkAfterClear = $('#junk').length;

    // --- Миграция старого формата и битые файлы -----------------------------
    $.fs.write('build/test_saves/slot-legacy.json',
               JSON.stringify({ version: 1, saved_frame: 3, data: { legacyKey: 'ок' } }));
    const legacy = $.save.read('legacy');
    probe.legacyKey = legacy.store.legacyKey;
    probe.legacyFrom = legacy.migrated_from;
    probe.legacyInfo = $.save.info('legacy').legacy;
    probe.legacyVersion = $.save.info('legacy').version;

    $.fs.write('build/test_saves/slot-broken.json', '{ это не json');
    probe.brokenRead = $.save.read('broken');
    probe.brokenError = $.save.stats().last_error;

    $.fs.write('build/test_saves/slot-future.json',
               JSON.stringify({ format: 'r2d.save', version: 99, store: {} }));
    probe.futureRead = $.save.read('future');
    probe.futureInfo = $.save.info('future');

    probe.missingLoad = $.save.load(9);
    probe.missingRemove = $.save.remove(9);
    probe.missingInfo = $.save.info(9);

    // --- Список слотов -------------------------------------------------------
    probe.slots = $.save.list().map((s) => s.slot);
    probe.slotsCheap = $.save.list({ meta: false }).length;

    // --- Автосейв: пишет в служебный слот, текущий слот не трогает ----------
    probe.autosaveId = $.save.autosave(100, 'auto');
    probe.autosaveMs = $.save.stats().autosave_ms;
    probe.slotBeforeAutosave = $.save.slot();
    probe.slotAfterAutosave = $.save.slot();
    probe.autosaveSlotExists = $.save.exists('auto');

    // --- §14: разделы, состояние по nid, транзакционный restore -------------
    // Профиль (input/audio/язык) не сбрасывается при перезапуске прохождения.
    $.save.profile().set('lang', 'ru').set('volume', 0.4);
    $.save.presentation().set('overlay', false);
    $.save.ns('run').set('coins', 3);

    // Фабрика поведения: логика в коде, в слот уходят только данные.
    // Внутри фабрик узел — сырой Node (не обёртка), поэтому поля читаются как есть.
    $.save.behavior('.hero', {
        save(node) { return { hp: node.cur_hp, cooldown: node.attrs.cooldown || 0 }; },
        load(node, data) { node.cur_hp = data.hp; node.attrs.cooldown = data.cooldown; },
    });
    $('#hero').attr('cooldown', 0.7);           // hp уже 100 у героя
    probe.save14 = $.save.slot('s14').save();
    const s14 = $.save.slot('s14').read();
    const heroNid = $('#hero').nid();
    probe.heroNid = heroNid;
    probe.nodeStateHero = !!(s14.namespaces.room.nodes[heroNid]
        && s14.namespaces.room.nodes[heroNid].p
        && s14.namespaces.room.nodes[heroNid].p['.hero']);
    probe.nodeStateCooldown = s14.namespaces.room.nodes[heroNid].p['.hero'].cooldown;
    probe.nodeStateHp = s14.namespaces.room.nodes[heroNid].p['.hero'].hp;
    probe.slot14Version = s14.version;
    probe.profileInSlot = s14.namespaces.profile.data.lang;
    probe.presentationInSlot = s14.namespaces.presentation.data.overlay;
    probe.runInSlot = s14.namespaces.run.data.coins;
    probe.rngInSlot = !!s14.namespaces.run.rng;
    probe.slot14HasSpeeds = Array.isArray(s14.namespaces.room.speeds);

    // «Загрузка во время действия»: hp и cooldown сбиты — restore возвращает.
    $('#hero').hp(5).attr('cooldown', 0);
    probe.restore14 = $.save.load('s14');
    probe.hpAfterRestore = $('#hero').hp();
    probe.cooldownAfterRestore = $('#hero').attr('cooldown');
    probe.heroNidAfterRestore = $('#hero').nid();
    probe.stats14 = $.save.stats();

    // Ошибка до commit не уничтожает рабочее состояние.
    const broken = $.save.slot('s14').read();
    broken.namespaces.room.nodes = { n999999: { v: [0, 0] } };
    const beforeNodes = $.world.count();
    const failed = $.save.restore(broken);
    probe.restoreFailedStage = failed.stage;
    probe.restoreFailedMissing = failed.missing.join(',');
    probe.restoreFailedDelta = $.world.count() - beforeNodes;
    probe.heroAliveAfterFail = $('#hero').length;
    probe.heroHpAfterFail = $('#hero').hp();
    probe.lastFailureCode = $.save.lastFailure().code;

    // Профиль переживает restartRun, run/room — сбрасываются.
    $.save.restartRun();
    probe.profileAfterRestart = $.save.profile().get('lang');
    probe.presentationAfterRestart = $.save.presentation().get('overlay');
    probe.coinsAfterRestart = $.save.ns('run').get('coins');
    probe.worldAfterRestart = $.world.count();

    // Пробы уходят в $.store последними: load/import выше заменяли его целиком.
    $.store.setAll(probe);
});
