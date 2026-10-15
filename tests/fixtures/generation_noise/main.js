// Фикстура §43/§24: детерминированная генерация карты на симплекс-шуме.
//
// Что здесь доказывается агентским тестом
// (tests/agent/highlevel_random_test.py):
//   * три профиля (два пороговых на симплекс-шуме + регулярный безшумовой)
//     строятся ОДНИМ набором примитивов: layout -> группировка платформ ->
//     placement через именованный поток -> validation -> publish;
//   * validation выполняется ДО публикации: пока задача идёт, $.gen.cells ===
//     null; провал validation не публикует ничего;
//   * ошибка -> ограниченный retry с derived seed (report.attempts), затем
//     отказ;
//   * один seed при разном бюджете $.task даёт одинаковые клетки и hash.
//
// Эталонные hash лежат в tests/fixtures/generation_noise/reference_samples.json
// (раздел generation) — их печатает build-прототип тех же правил; тест
// сравнивает с ними.
//
// API фикстуры (всё — данные, без this/new/extends):
//   $.gen.build(name, { budget, seed })   — запустить генерацию (задача $.task)
//   $.gen.status                          — idle|building|published|rejected|error
//   $.gen.ready                           — задача завершена (published|rejected)
//   $.gen.cells / $.gen.hash              — опубликованная карта (иначе null)
//   $.gen.platforms / $.gen.spawn / $.gen.exit
//   $.gen.report                          — профиль, попытки, validation, publish
//   $.gen.progress()                      — 0..1

const COLS = 32;
const ROWS = 16;
const CELL = 16;
const MAX_ATTEMPTS = 3;

const PROFILES = {
    // Два пороговых профиля симплекс-шума: та же функция, разные пороги —
    // разные длины платформ и свободное место.
    A: { noise: true, seed: 7, frequency: 0.25, threshold: 0.74, spawnChance: 0.3 },
    B: { noise: true, seed: 7, frequency: 0.25, threshold: 0.76, spawnChance: 0.3 },
    // Регулярный профиль без шума и без ГПСЧ: те же примитивы, hash не зависит
    // от seed. Колонка 0 свободна — коридор связности.
    regular: { noise: false, seed: 7, frequency: 1, threshold: 0, spawnChance: 0 },
    // Заведомо невалидный: порог выше диапазона шума, платформ не будет.
    broken: { noise: true, seed: 7, frequency: 0.25, threshold: 1.5, spawnChance: 0.3 },
};

function regularCell(x, y) {
    return (y % 4 === 3 && x !== 0) ? 1 : 0;
}

$.ready(() => {
    $.world.gravity(0, 0).color('#101820').bounds(0, 0, COLS * CELL, ROWS * CELL);
    $('<rect>', { id: 'sky' }).at(COLS * CELL / 2, ROWS * CELL / 2)
        .size(COLS * CELL, ROWS * CELL).color('#101820').appendTo($.world);

    const state = {
        status: 'idle',
        ready: false,
        error: null,
        profile: null,
        spec: null,
        source: null,
        stream: null,
        draft: null,
        platforms: [],
        candidates: [],
        cells: null,
        spawn: null,
        exit: null,
        hash: null,
        report: null,
        baseSeed: 0,
        derived: 0,
        attempt: 0,
        budget: 4,
        index: 0,
        total: 0,
        token: 0,
        result: null,
        task: null,
    };

    // --- layout: клетки из именованного алгоритма шума --------------------
    function layoutStep(i) {
        const x = i % COLS;
        const y = (i - x) / COLS;
        let solid = 0;
        if (state.spec.noise) {
            solid = state.source.sample2D(x + 0.5, y + 0.5) > state.spec.threshold ? 1 : 0;
        } else {
            solid = regularCell(x, y);
        }
        $.grid.set(state.draft, x, y, solid);
    }

    // --- группировка горизонтальных платформ по длине ---------------------
    function groupStep(row) {
        let start = -1;
        for (let x = 0; x <= COLS; x++) {
            const solid = x < COLS && $.grid.at(state.draft, x, row, 0) === 1;
            if (solid && start < 0) start = x;
            if (!solid && start >= 0) {
                state.platforms.push({ cx: start, cy: row, len: x - start });
                start = -1;
            }
        }
    }

    // --- placement: кандидаты спавна через поток generation ---------------
    function placeStep(p) {
        const platform = state.platforms[p];
        if (!platform) return;                       // шаг-заглушка: ГПСЧ не трогаем
        const want = state.spec.noise
            ? state.stream.next() < state.spec.spawnChance
            : (p % 4 === 1);
        // cy >= 3: над клеткой спавна нужен запас высоты 2.
        if (!want || platform.cy < 3) return;
        const cx = platform.cx + (platform.len >> 1);
        if ($.grid.at(state.draft, cx, platform.cy - 1, 1) !== 0) return;
        if ($.grid.at(state.draft, cx, platform.cy - 2, 1) !== 0) return;
        if ($.grid.at(state.draft, cx, platform.cy - 3, 1) !== 0) return;
        state.candidates.push({ cx, cy: platform.cy - 1 });
    }

    // --- validation: проверки до публикации -------------------------------
    function validate() {
        const reasons = [];
        const g = state.draft;
        const platforms = state.platforms;
        let solid = 0;
        for (let i = 0; i < g.data.length; i++) if (g.data[i]) solid++;
        const freeFraction = (g.data.length - solid) / g.data.length;

        if (platforms.length === 0) reasons.push('нет ни одной горизонтальной платформы');
        if (freeFraction < 0.2) reasons.push('слишком мало свободного места: ' + freeFraction.toFixed(3));
        if (freeFraction > 0.9) reasons.push('слишком много свободного места: ' + freeFraction.toFixed(3));

        const spawn = state.candidates.length > 0 ? state.candidates[0] : null;
        if (!spawn) reasons.push('нет свободной клетки для спавна');
        else {
            if ($.grid.at(g, spawn.cx, spawn.cy, 1) !== 0) reasons.push('спавн внутри стены');
            if ($.grid.at(g, spawn.cx, spawn.cy - 1, 1) !== 0 ||
                $.grid.at(g, spawn.cx, spawn.cy - 2, 1) !== 0) {
                reasons.push('над спавном нет запаса высоты 2');
            }
            if ($.grid.at(g, spawn.cx, spawn.cy + 1, 0) !== 1) reasons.push('под спавном нет опоры');
        }

        let exit = null;
        for (let y = 0; y < ROWS && !exit; y++) {
            for (let x = COLS - 1; x >= 0; x--) {
                if ($.grid.at(g, x, y, 1) === 0) { exit = { cx: x, cy: y }; break; }
            }
        }
        if (!exit) reasons.push('нет свободной клетки для выхода');

        let reachable = false;
        if (spawn && exit) {
            const copy = $.grid.make({ cols: COLS, rows: ROWS, fill: 0 });
            for (let i = 0; i < g.data.length; i++) copy.data[i] = g.data[i];
            $.grid.flood(copy, spawn.cx, spawn.cy, 9);
            reachable = $.grid.at(copy, exit.cx, exit.cy, 0) === 9;
            if (!reachable) reasons.push('выход недостижим из спавна');
        }

        let freeSquares = 0;
        for (let y = 0; y + 1 < ROWS; y++) {
            for (let x = 0; x + 1 < COLS; x++) {
                if ($.grid.at(g, x, y, 1) === 0 && $.grid.at(g, x + 1, y, 1) === 0 &&
                    $.grid.at(g, x, y + 1, 1) === 0 && $.grid.at(g, x + 1, y + 1, 1) === 0) {
                    freeSquares++;
                }
            }
        }
        if (freeSquares < 4) reasons.push('мало свободных квадратов 2x2: ' + freeSquares);

        const lengths = {};
        let longest = 0;
        for (const platform of platforms) {
            lengths[platform.len] = (lengths[platform.len] || 0) + 1;
            if (platform.len > longest) longest = platform.len;
        }

        return {
            ok: reasons.length === 0,
            reasons,
            spawn: spawn,
            exit: exit,
            reachable: reachable,
            freeFraction: freeFraction,
            freeSquares: freeSquares,
            platforms: platforms.length,
            longest: longest,
            lengths: lengths,
        };
    }

    // --- publish: только после успешной validation ------------------------
    function publish(validation) {
        state.cells = state.draft.data.slice();
        state.spawn = validation.spawn;
        state.exit = validation.exit;
        state.hash = $.random.hashCells(state.cells);
        state.report.validation = validation;
        state.report.published = {
            profile: state.profile,
            seed: state.baseSeed,
            derivedSeed: state.derived,
            attempt: state.attempt,
            cells: state.cells.length,
            platforms: validation.platforms,
            longest: validation.longest,
            freeFraction: validation.freeFraction,
            freeSquares: validation.freeSquares,
            spawn: validation.spawn,
            exit: validation.exit,
            hash: state.hash,
        };
        state.status = 'published';
        state.ready = true;
    }

    // --- один шаг конвейера: индекс решает фазу, порядок фиксирован --------
    function step(i) {
        state.index = i + 1;
        const layout = COLS * ROWS;
        if (i < layout) { layoutStep(i); return; }
        if (i < layout + ROWS) { groupStep(i - layout); return; }
        if (i < layout + ROWS + layout) { placeStep(i - layout - ROWS); return; }
        const validation = validate();
        state.report.validation = validation;
        if (validation.ok) { publish(validation); return; }
        state.result = validation;
    }

    function startAttempt() {
        const profile = state.spec;
        const derived = (state.baseSeed + state.attempt * 0x9e3779b1) >>> 0;
        state.derived = derived;
        state.source = profile.noise
            ? $.random.noise({
                algorithm: 'simplex2d', version: 1, seed: derived, frequency: profile.frequency,
            })
            : null;
        // Именованный поток генерации: seed() разворачивает его из derived,
        // presentation его не касается.
        $.random.seed(derived);
        state.stream = $.random.stream('generation');
        state.draft = $.grid.make({ cols: COLS, rows: ROWS, fill: 0 });
        state.platforms = [];
        state.candidates = [];
        state.index = 0;
        state.result = null;
        state.total = COLS * ROWS + ROWS + COLS * ROWS + 1;
        // $.update не отдаёт функцию снятия, поэтому законченная задача ещё
        // долго тикает вхолостую и повторно зовёт done. Токен попытки
        // отсекает такие «хвосты»: иначе старая задача портит следующую.
        state.token++;
        const token = state.token;
        state.task = $.task.chunked({
            total: state.total,
            budget: state.budget,
            step: step,
            done: (aborted) => onAttemptDone(token, aborted),
        });
    }

    function onAttemptDone(token, aborted) {
        if (token !== state.token) return;     // хвост старой задачи
        if (state.status !== 'building') return;
        if (aborted) return;
        const validation = state.result || { reasons: ['задача завершилась без validation'] };
        state.report.attempts.push({
            attempt: state.attempt,
            seed: state.baseSeed,
            derivedSeed: state.derived,
            reasons: validation.reasons,
        });
        if (state.attempt + 1 < MAX_ATTEMPTS) {
            state.attempt++;
            startAttempt();
            return;
        }
        state.status = 'rejected';
        state.ready = true;
    }

    $.gen = {
        version: 1,
        cols: COLS,
        rows: ROWS,
        maxAttempts: MAX_ATTEMPTS,
        profiles: PROFILES,

        build(name, opts) {
            const options = opts || {};
            const profile = PROFILES[name];
            if (!profile) {
                state.status = 'error';
                state.error = 'нет профиля ' + name;
                state.ready = true;
                return null;
            }
            if (state.task) { state.task.abort(); state.task = null; }
            state.profile = name;
            state.spec = profile;
            state.baseSeed = options.seed === undefined ? profile.seed : (Number(options.seed) >>> 0);
            state.budget = Number(options.budget) > 0 ? Number(options.budget) : 4;
            state.attempt = 0;
            state.status = 'building';
            state.ready = false;
            state.cells = null;
            state.spawn = null;
            state.exit = null;
            state.hash = null;
            state.error = null;
            state.report = {
                profile: name,
                seed: state.baseSeed,
                attempts: [],
                validation: null,
                published: null,
            };
            startAttempt();
            return state.task;
        },

        progress() { return state.total > 0 ? state.index / state.total : 0; },

        get status() { return state.status; },
        get ready() { return state.ready; },
        get error() { return state.error; },
        get cells() { return state.cells; },
        get hash() { return state.hash; },
        get platforms() { return state.platforms; },
        get spawn() { return state.spawn; },
        get exit() { return state.exit; },
        get derivedSeed() { return state.derived; },
        get report() { return state.report; },
    };
});
