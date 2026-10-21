// ===========================================================================
// Пример §31-7 Спецификации: «Recovery».
//
// Четыре сбоя, которые игра обязана переживать, и что именно видит игрок и
// машина после каждого:
//
//   1. save failure   — запись не удалась: `$.save.save()` вернул false,
//                       `stats().last_failure.code` назвал стадию, запись
//                       ушла в `$.debug.errors()`, последний корректный слот
//                       не тронут;
//   2. corrupted slot — основной файл слота испорчен: `$.save.load()` берёт
//                       `.bak`, `stats().recovered` растёт, `$.save.recover()`
//                       лечит основной файл (побайтово равен копии);
//   3. corrupted asset — битый JSON ассета: `$.reload.reload()` возвращает
//                       `{ ok:false, code:'R2D_RELOAD_PARSE' }`, игра работает
//                       на last-known-good; после починки reload применяется
//                       без перезапуска;
//   4. replay divergence — запись прогона и проигрывание со внесённым сдвигом:
//                       `$.replay.divergence()` называет первый расходящийся
//                       tick, поля (`nid.x`) и ID; чистый прогон даёт null.
//
// Ничего, кроме `$`: ни `engine.*`, ни импорта внутренностей. Тот же набор
// операций доступен человеку (кнопки RmlUi) и агенту (`$.recoveryApp`).
//
// Запуск:
//   ./build/russiano2d --game demos/recovery
//   python3 tests/agent/recovery_test.py
// ===========================================================================

//: Каталог слотов: writable и вне дерева ассетов игры.
const SAVE_DIR = 'build/recovery-saves';
//: Путь «внутри файла VERSION» — такой каталог создать нельзя, поэтому
//: запись обязана провалиться на стадии temp. Это и есть «save failure» без
//: chmod и без платформенных различий в правах.
const BAD_SAVE_DIR = 'VERSION/saves';
const SLOT = 'run';
const PROFILE_SLOT = 'profile';
//: Ассет под наблюдением `$.reload`: живой JSON, который правит автор.
const ASSET = 'assets/panel.json';

const SEED = 4242;                 // зерно симуляции: запись и проигрывание
const START = { x: 220, y: 420 };
const SPEED = 260;                 // px/с
const RUN_FRAMES = 24;             // кадров в прогоне по умолчанию
const CHECK_EVERY = 10;            // checkpoint state hash каждые 10 ticks

//: Сценарий ввода: запись и проигрывание обязаны получить один и тот же ввод,
//: поэтому «игрок» здесь — детерминированная функция номера кадра.
const SCRIPT = [
    'right', 'right', 'right', 'right', 'right',
    'jump', 'right', 'right', 'right', 'right',
    'right', 'left', 'right', 'right', 'jump',
    'right', 'right', 'right', 'left', 'right',
    'right', 'jump', 'right', 'right',
];

export default function install($) {
    const state = {
        message: 'готов',
        detail: 'всё в порядке',
        runLeft: null,          // сколько кадров осталось текущему прогону
        mismatchAfter: null,    // намеренный сдвиг при проигрывании
        replayText: null,
        counterInstalled: false,
    };
    let doc = null;

    // Поток gameplay-RNG: он входит в state hash, поэтому запись и
    // проигрывание обязаны потребить его одинаково (см. apply()).
    const gameplay = $.random.stream('gameplay');
    $.random.seed(SEED);

    const hero = () => $('#hero');

    // --- Экран ---------------------------------------------------------------
    function setMessage(message, detail) {
        state.message = String(message === undefined ? '' : message);
        state.detail = String(detail === undefined ? '' : detail);
        updateDoc();
    }

    function updateDoc() {
        if (!doc) return;
        doc.text('rec-status', state.message);
        doc.text('rec-detail', state.detail);
        doc.text('rec-slot', 'слот: ' + $.save.path(SLOT) + ' · ассет: v' + $.reload.version('panel'));
    }

    function wireButtons() {
        doc.on('btn-retry', 'click', () => retry());
        doc.on('btn-restore', 'click', () => restoreBackup());
        doc.on('btn-reset', 'click', () => reset());
        doc.on('btn-bad-save', 'click', () => { attemptBadSave(); });
        doc.on('btn-future-slot', 'click', () => { attemptFutureSlotSave(); });
        doc.on('btn-reload', 'click', () => { reloadAsset(); });
        doc.on('btn-record', 'click', () => { recordRun(RUN_FRAMES); });
        doc.on('btn-play', 'click', () => { playRun({}); });
        doc.on('btn-play-shift', 'click', () => { playRun({ mismatchAfter: 7 }); });
    }

    // --- 1. Слоты: запись, копия .bak, восстановление -------------------------
    function saveGood() {
        $.save.dir(SAVE_DIR);
        $.save.run().set('score', $.store.get('score', 0));
        $.save.profile().set('lang', 'ru').set('volume', 0.5);
        const ok = $.save.save(SLOT) && $.save.save(PROFILE_SLOT);
        const st = $.save.stats();
        setMessage(ok ? 'сохранено' : 'сохранение не удалось',
                   ok ? 'слоты run/profile записаны; копий .bak: ' + st.backups
                      : (st.last_error || ''));
        return ok;
    }

    /**
     * Проверить, что ядро само записало провал обязательной операции.
     *
     * Работает потому, что `$.save.save(slot, { fatal: true })` пробрасывает
     * `fatal` на ВСЕ стадии записи (temp/replace/verify) и в `$.debug.errors`
     * попадает код вида `R2D_SAVE_TEMP`. Раньше обход жил в примере; теперь
     * отказ проверяется по факту, а не подменяется своим кодом.
     */
    function saveFailureReported(beforeCount) {
        const errors = $.debug && typeof $.debug.errors === 'function' ? $.debug.errors() : [];
        return errors.length > beforeCount;
    }

    /**
     * Запись в заведомо недоступный каталог: провал стадии temp.
     */
    function attemptBadSave() {
        const good = $.save.dir();
        const errorsBefore = ($.debug.errors ? $.debug.errors().length : 0);
        $.save.dir(BAD_SAVE_DIR);
        const ok = $.save.save('probe', { fatal: true });
        const st = $.save.stats();
        const failure = st.last_failure || { ok: false, stage: 'temp', code: null };
        // Ядро обязано и оставить структуру, и сообщить машине (§17).
        const reported = saveFailureReported(errorsBefore);
        $.save.dir(good);
        const result = {
            ok,
            stage: failure.stage,
            code: failure.code,
            error: st.last_error,
            machine: reported,
        };
        setMessage(ok ? 'неожиданно записалось' : 'запись не удалась',
                   (result.code ? result.code + ': ' : '') + (result.error || ''));
        return result;
    }

    /**
     * Слот «из будущего»: ядро отказывается его перезаписывать — структурный
     * отказ `R2D_SAVE_FUTURE` без правки файла (§14).
     */
    function attemptFutureSlotSave() {
        const errorsBefore = ($.debug.errors ? $.debug.errors().length : 0);
        const path = $.save.path('future');
        $.fs.write(path, JSON.stringify({ format: 'r2d.save', version: 999, saved_at: 0 }));
        const before = $.fs.readText(path);
        const ok = $.save.save('future', { fatal: true });
        const after = $.fs.readText(path);
        const st = $.save.stats();
        const failure = st.last_failure || null;
        const reported = saveFailureReported(errorsBefore);
        const result = {
            ok,
            code: failure ? failure.code : null,
            stage: failure ? failure.stage : null,
            untouched: before === after,
            rejectedFuture: st.rejected_future,
            error: st.last_error,
            machine: reported,
        };
        setMessage(ok ? 'слот из будущего перезаписан' : 'слот из будущего отклонён',
                   (result.code ? result.code + ': ' : '') + (result.error || 'файл не изменён'));
        return result;
    }

    function retry() {
        $.save.dir(SAVE_DIR);
        const ok = $.save.load(SLOT);
        const st = $.save.stats();
        setMessage(ok ? 'слот восстановлен' : 'слот не восстановлен',
                   (st.recovered ? 'использована копия .bak. ' : '')
                   + (st.last_error || 'данные применены'));
        return ok;
    }

    function restoreBackup() {
        const ok = $.save.recover(SLOT);
        setMessage(ok ? 'копия .bak применена' : 'копия .bak недоступна',
                   ok ? 'основной файл вылечен из копии' : ($.save.stats().last_error || ''));
        return ok;
    }

    function reset() {
        $.save.restartRun();
        hero().at(START.x, START.y);
        $.store.set('score', 0);
        setMessage('прохождение сброшено', 'профиль (язык, звук) не тронут — §14');
        return true;
    }

    // --- 2. Ассет под наблюдением --------------------------------------------
    function panelValid(data) {
        if (!data || typeof data !== 'object' || Array.isArray(data)) return 'panel.json: нужен объект';
        if (data.version !== 1) return 'panel.json: version должен быть 1';
        if (typeof data.title !== 'string' || data.title === '') return 'panel.json: нужен title';
        return true;
    }

    function reloadAsset() {
        const r = $.reload.reload('panel');
        setMessage(r.ok ? 'ассет перезагружен' : 'ассет отклонён',
                   (r.code ? r.code + ': ' : '') + (r.error || ('версия ' + r.version)));
        updateDoc();
        // Наружу — только JSON-совместимые факты, без native-хэндлов.
        return {
            ok: r.ok, stage: r.stage, code: r.code, error: r.error,
            version: r.version, changed: r.changed,
        };
    }

    // --- 3. Прогон: запись и проигрывание -------------------------------------
    // Одна и та же пара sampler/apply при записи и проигрывании: иначе реплей
    // разойдётся, и виноват будет не движок (docs/highlevel/replay.md).
    function sampler() {
        return [SCRIPT[$.replay.length() % SCRIPT.length]];
    }

    function apply(input) {
        const actions = input && Array.isArray(input.actions) ? input.actions : [];
        const dir = actions.includes('right') ? 1 : (actions.includes('left') ? -1 : 0);
        const wind = gameplay.range(-2, 2);          // gameplay-RNG входит в hash
        const p = hero().pos();
        hero().at(p.x + dir * SPEED * $.time.delta() + wind,
                  p.y + (actions.includes('jump') ? -2 : 0));
    }

    /** Проигрывание с намеренным сдвигом: симуляция уходит в сторону. */
    function playApply(frame) {
        apply(frame);
        if (state.mismatchAfter !== null && $.replay.position() >= state.mismatchAfter) {
            const p = hero().pos();
            hero().at(p.x + 5, p.y);
        }
    }

    function resetRun() {
        $.replay.stop();
        $.replay.clear();
        state.runLeft = null;
        state.mismatchAfter = null;
        $.random.seed(SEED);              // и default, и все потоки (§26)
        hero().at(START.x, START.y);
    }

    function installCounter() {
        if (state.counterInstalled) return;
        state.counterInstalled = true;
        // Хук ставится ПОСЛЕ хука реплея, поэтому кадр сначала записывается
        // или проигрывается, а уже потом считается в лимит прогона.
        $.update(() => {
            if (state.runLeft === null) return;
            state.runLeft -= 1;
            if (state.runLeft <= 0) stop();
        });
    }

    function recordRun(frames) {
        resetRun();
        $.replay.actions(['left', 'right', 'jump'], 'recovery/v1');
        $.replay.checkpoints({ every: CHECK_EVERY });
        $.replay.record(sampler, apply);
        state.runLeft = Math.max(1, Math.floor(Number(frames) || RUN_FRAMES));
        installCounter();
        setMessage('запись', 'идёт запись ' + state.runLeft + ' кадров');
        return true;
    }

    function playRun(opts) {
        const o = opts || {};
        if (!state.replayText) {
            setMessage('нет записи', 'сначала запишите прогон');
            return false;
        }
        resetRun();
        state.mismatchAfter = (o.mismatchAfter === undefined || o.mismatchAfter === null)
            ? null : Number(o.mismatchAfter);
        $.replay.load(state.replayText);
        state.runLeft = $.replay.length();
        $.replay.play(playApply);
        installCounter();
        setMessage('проигрывание', 'кадров: ' + state.runLeft
                   + (state.mismatchAfter === null ? '' : ', сдвиг после ' + state.mismatchAfter));
        return true;
    }

    function stop() {
        state.runLeft = null;
        if ($.replay.isRecording()) state.replayText = $.replay.toText();
        $.replay.stop();
        updateDoc();
        return true;
    }

    function divergence() {
        return $.replay.divergence();
    }

    // --- Снимок для агента и теста -------------------------------------------
    function snapshot() {
        const st = $.save.stats();
        const errors = $.debug && typeof $.debug.errors === 'function' ? $.debug.errors() : [];
        return {
            message: state.message,
            detail: state.detail,
            score: $.store.get('score', 0),
            heroX: hero().pos().x,
            saveDir: $.save.dir(),
            slotPath: $.save.path(SLOT),
            profilePath: $.save.path(PROFILE_SLOT),
            saves: st.saves,
            backups: st.backups,
            recovered: st.recovered,
            lastError: st.last_error,
            lastFailure: st.last_failure,
            debugCodes: errors.map((e) => e.code),
            assetVersion: $.reload.version('panel'),
            assetValue: $.reload.value('panel') || null,
            replayFrames: $.replay.length(),
            replayMode: $.replay.mode(),
            divergence: $.replay.divergence(),
            frame: $.time.frame(),
        };
    }

    // --- Сцена ----------------------------------------------------------------
    $.scene.add('recovery', {
        enter($) {
            $.world.gravity(0, 0).color('#0d1117');
            $.world.bounds(-200, -200, 2000, 1200);
            $('<wall>', { class: 'ground' }).at(640, 560).size(1600, 40).appendTo($.world);
            $('<wall>', { id: 'hero', class: 'runner' }).at(START.x, START.y).size(24, 24)
                .appendTo($.world);
            $.store.set('score', 0);

            $.save.dir(SAVE_DIR);
            $.replay.identity({ version: 'example', build: 'demos/recovery' });

            // Наблюдение за живым ассетом: первая загрузка — тоже reload.
            $.reload.watch('panel', {
                kind: 'json',
                path: ASSET,
                validate: panelValid,
                apply: (value) => { $.store.set('panel', value); },
            });
            const first = $.reload.reload('panel');
            if (!first.ok) setMessage('ассет не прочитан', first.code + ': ' + first.error);

            doc = $.ui.doc('rml/recovery.rml').show();
            wireButtons();
            updateDoc();
        },
    });

    // Агент и человек видят одни и те же операции.
    $.recoveryApp = {
        snapshot, setMessage,
        saveGood, attemptBadSave, attemptFutureSlotSave, retry, restoreBackup, reset,
        reloadAsset,
        recordRun, playRun, stop, divergence,
        replayText: () => state.replayText,
        heroX: () => hero().pos().x,
    };
    return $.recoveryApp;
}
