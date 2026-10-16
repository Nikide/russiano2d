// ===========================================================================
// Пример §31-4 Спецификации: «Generated rooms».
//
// Roguelike-комната целиком строится на существующем `$`:
//   * seed -> layout на симплекс-шуме (`$.random.noise({algorithm:'simplex2d'})`,
//     §43) -> группировка платформ -> placement через поток `generation` ->
//     validation -> publish;
//   * validation ДО публикации: свободный спавн, запас высоты, достижимость
//     выхода (`$.grid.flood`), доля свободного места, опасная зона у спавна;
//   * ошибка -> ограниченный retry с derived seed, затем отказ; половина карты
//     не публикуется;
//   * бюджет генерации: `$.task.each` режет работу по времени (мс/кадр),
//     `$.time.duration` — жёсткий лимит тиков (§44), `maxSteps` — лимит шагов;
//   * checkpoint: `$.save` (разделы run/room, стабильные nid) сохраняет
//     пройденную комнату и прогресс; restore во время генерации отменяет её и
//     не публикует недоделанную карту поверх текущей.
//
// Ничего, кроме `$`: ни `engine.*`, ни импорта внутренностей движка.
//
// Запуск:
//   ./build/russiano2d --game demos/roguerooms
//   python3 tests/agent/roguerooms_test.py      // автоматическая проверка
//
// Клавиши: R — новая комната, C — checkpoint, V — restore, P — профиль.
// ===========================================================================

const TILE = 32;
const COLS = 72;
const ROWS = 40;
const CELLS = COLS * ROWS;
const DOOR_HALF = 1;                 // дверь в середине боковых стен: 3 клетки
const DANGER_SALT = 0x5bf03635;      // отдельное зерно для карты опасности

/** Профили комнат: тот же набор примитивов, разные пороги и правила. */
const PROFILES = {
    // Два пороговых профиля: одна функция, разные длины платформ.
    standard: { threshold: 0.74, dangerLimit: 0.62, spawnChance: 0.5 },
    dense: { threshold: 0.80, dangerLimit: 0.62, spawnChance: 0.5 },
    // Заведомо непригодный: порог выше диапазона шума — платформ не будет.
    broken: { threshold: 1.50, dangerLimit: 0.62, spawnChance: 0.5 },
};

const DEFAULTS = {
    profile: 'standard',
    budget: 1.0,                       // мс на кадр для $.task
    maxSteps: 3 * CELLS + 2 * ROWS + 1,   // потолок шагов конвейера
    maxTicks: 240,                     // лимит тиков симуляции на комнату (§44)
    maxAttempts: 3,
    slot: 'room',
    saveDir: 'saves',
};

// ---------------------------------------------------------------------------
// Чистые части генератора: одна и та же функция даёт клетку и при генерации,
// и при проверке hash'а из checkpoint (никакого ГПСЧ здесь нет).
// ---------------------------------------------------------------------------

/** Клетки дверей в боковых стенах: всегда открыты, это вход/выход. */
function doorCell(x, y) {
    return (x === 0 || x === COLS - 1) && Math.abs(y - (ROWS >> 1)) <= DOOR_HALF;
}

/** Границы комнаты: пол/потолок сплошные, в боковых стенах — дверь. */
function borderSolid(x, y) {
    if (y === 0 || y === ROWS - 1) return true;
    if (x === 0 || x === COLS - 1) return !doorCell(x, y);
    return false;
}

/** Контекст шума для зерна: layout и карта опасности — два разных потока. */
function makeContext($, seed, profile) {
    return {
        seed,
        profile,
        layoutNoise: $.random.noise({ algorithm: 'simplex2d', version: 1, seed: seed, frequency: 0.18 }),
        dangerNoise: $.random.noise({
            algorithm: 'simplex2d', version: 1, seed: (seed ^ DANGER_SALT) >>> 0, frequency: 0.09,
        }),
    };
}

/** Клетка комнаты: граница или порог шума. Шум — чистая функция координаты. */
function cellSolid(context, x, y) {
    if (doorCell(x, y)) return 0;
    if (borderSolid(x, y)) return 1;
    return context.layoutNoise.sample2D(x + 0.5, y + 0.5) > context.profile.threshold ? 1 : 0;
}

/** Сколько ортогональных соседей твёрдые (для чистки одиночных клеток). */
function solidNeighbours(g, x, y) {
    let n = 0;
    if ($.grid.at(g, x - 1, y, 0) === 1) n++;
    if ($.grid.at(g, x + 1, y, 0) === 1) n++;
    if ($.grid.at(g, x, y - 1, 0) === 1) n++;
    if ($.grid.at(g, x, y + 1, 0) === 1) n++;
    return n;
}

/** Клетки комнаты без публикации: layout + чистка. Нужны для сверки hash'а. */
function deriveCells($, seed, profileName) {
    const context = makeContext($, seed >> 0, PROFILES[profileName] || PROFILES.standard);
    const g = $.grid.make({ cols: COLS, rows: ROWS, fill: 0 });
    for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) $.grid.set(g, x, y, cellSolid(context, x, y));
    }
    for (let y = 1; y < ROWS - 1; y++) {
        for (let x = 1; x < COLS - 1; x++) {
            if ($.grid.at(g, x, y, 0) === 1 && solidNeighbours(g, x, y) === 0) $.grid.set(g, x, y, 0);
        }
    }
    return g;
}

/** Зерно следующей комнаты: LCG от зерна прохождения и глубины. */
function nextSeed(runSeed, depth) {
    const mixed = (runSeed ^ Math.imul(depth + 1, 0x9e3779b1)) >>> 0;
    return (Math.imul(mixed, 1664525) + 1013904223) >>> 0;
}

export default function install($) {
    const state = {
        status: 'idle',            // idle|generating|published|rejected|restored|error|drift
        reason: '',
        runSeed: 0,
        seed: 0,
        derived: 0,
        depth: 0,
        profile: DEFAULTS.profile,
        spec: PROFILES[DEFAULTS.profile],
        hash: null,
        cellsData: null,
        cells: 0,
        platforms: 0,
        longest: 0,
        spawn: null,
        exit: null,
        freeFraction: 0,
        // бюджеты и замеры
        budget: DEFAULTS.budget,
        maxSteps: DEFAULTS.maxSteps,
        maxTicks: DEFAULTS.maxTicks,
        maxAttempts: DEFAULTS.maxAttempts,
        steps: 0,
        frames: 0,
        ticks: 0,
        maxStepsPerFrame: 0,
        totalMs: 0,
        // задача и попытки
        task: null,
        token: 0,
        attempt: 0,
        attempts: [],
        report: null,
        validation: null,
        generating: false,
        published: false,
        aborted: false,
        abandoned: 0,
        slot: DEFAULTS.slot,
        saveDir: DEFAULTS.saveDir,
        // замер кадра
        frame: 0,
        stepsAtFrameStart: 0,
        startedAt: 0,
        life: null,
        stream: null,
        danger: null,
        reasons: [],
    };

    const KEYS = { next: 'r', checkpoint: 'c', restore: 'v', profile: 'p' };

    // --- служба шага: бюджет шагов/тиков и замер кадра ---------------------
    function guard(st) {
        st.steps++;
        if (st.abort) { st.status = 'rejected'; st.reason = 'генерация отменена'; return false; }
        if (st.life && st.life.expired()) {
            st.reason = 'бюджет тиков исчерпан (' + st.maxTicks + ')';
            st.status = 'rejected';
            return false;
        }
        if (st.steps > st.maxSteps) {
            st.reason = 'бюджет шагов исчерпан (' + st.maxSteps + ')';
            st.status = 'rejected';
            return false;
        }
        bumpFrame(st);
        return true;
    }

    /**
     * Сколько шагов генерации пришлось на кадр: видно, что $.task режет работу
     * по кадрам, а не делает всю комнату одним куском.
     */
    function bumpFrame(st) {
        const frame = $.time.frame();
        if (frame !== st.frame) {
            const inFrame = st.steps - st.stepsAtFrameStart;
            if (inFrame > st.maxStepsPerFrame) st.maxStepsPerFrame = inFrame;
            st.stepsAtFrameStart = st.steps;
            st.frame = frame;
            st.frames++;
        }
    }

    function closeFrame(st) {
        const inFrame = st.steps - st.stepsAtFrameStart;
        if (inFrame > st.maxStepsPerFrame) st.maxStepsPerFrame = inFrame;
        st.stepsAtFrameStart = st.steps;
    }

    // --- фазы конвейера (генераторы: yield = можно отдать кадр) ------------

    function* layoutPass(st, context, g) {
        for (let y = 0; y < ROWS; y++) {
            for (let x = 0; x < COLS; x++) {
                if (!guard(st)) { st.aborted = true; return false; }
                const i = y * COLS + x;
                st.danger[i] = context.dangerNoise.fbm2D(x + 0.5, y + 0.5, { octaves: 4 });
                $.grid.set(g, x, y, cellSolid(context, x, y));
                yield;
            }
        }
        return true;
    }

    function* cleanupPass(st, g) {
        for (let y = 1; y < ROWS - 1; y++) {
            for (let x = 1; x < COLS - 1; x++) {
                if (!guard(st)) { st.aborted = true; return false; }
                if ($.grid.at(g, x, y, 0) === 1 && solidNeighbours(g, x, y) === 0) $.grid.set(g, x, y, 0);
                yield;
            }
        }
        return true;
    }

    function* groupPass(st, g) {
        const platforms = [];
        for (let y = 0; y < ROWS; y++) {
            if (!guard(st)) { st.aborted = true; return null; }
            let start = -1;
            for (let x = 0; x <= COLS; x++) {
                const solid = x < COLS && $.grid.at(g, x, y, 0) === 1;
                if (solid && start < 0) start = x;
                if (!solid && start >= 0) {
                    platforms.push({ cx: start, cy: y, len: x - start });
                    start = -1;
                }
            }
            yield;
        }
        return platforms;
    }

    function* placePass(st, g, platforms) {
        const candidates = [];
        for (let p = 0; p < platforms.length; p++) {
            if (!guard(st)) { st.aborted = true; return null; }
            const platform = platforms[p];
            if (platform.len >= 2 && platform.cy >= 4) {
                // Поток generation: порядок вызовов задан индексом платформы,
                // поэтому бюджет $.task не влияет на результат.
                if (st.stream.next() < st.spec.spawnChance) {
                    const cx = platform.cx + (platform.len >> 1);
                    if ($.grid.at(g, cx, platform.cy - 1, 1) === 0 &&
                        $.grid.at(g, cx, platform.cy - 2, 1) === 0 &&
                        $.grid.at(g, cx, platform.cy - 3, 1) === 0) {
                        candidates.push({
                            cx, cy: platform.cy - 1,
                            danger: st.danger[platform.cy * COLS + cx],
                        });
                    }
                }
            }
            yield;
        }
        return candidates;
    }

    /** Validation (§24): до публикации, с причинами отказа. */
    function validate(st, g, platforms, spawn) {
        const reasons = [];
        let solid = 0;
        for (let i = 0; i < g.data.length; i++) if (g.data[i]) solid++;
        const freeFraction = (g.data.length - solid) / g.data.length;

        if (platforms.length < 2) reasons.push('меньше двух платформ');
        if (freeFraction < 0.25) reasons.push('мало свободного места: ' + freeFraction.toFixed(3));
        if (freeFraction > 0.92) reasons.push('много свободного места: ' + freeFraction.toFixed(3));

        if (!spawn) reasons.push('нет свободной клетки для спавна');
        else {
            if ($.grid.at(g, spawn.cx, spawn.cy, 1) !== 0) reasons.push('спавн внутри стены');
            if ($.grid.at(g, spawn.cx, spawn.cy - 1, 1) !== 0 || $.grid.at(g, spawn.cx, spawn.cy - 2, 1) !== 0) {
                reasons.push('над спавном нет запаса высоты 2');
            }
            if ($.grid.at(g, spawn.cx, spawn.cy + 1, 0) !== 1) reasons.push('под спавном нет опоры');
            if (spawn.danger > st.spec.dangerLimit) {
                reasons.push('спавн в опасной зоне: ' + spawn.danger.toFixed(3));
            }
        }

        const exit = { cx: COLS - 1, cy: ROWS >> 1 };   // правая дверь
        if ($.grid.at(g, exit.cx, exit.cy, 1) !== 0) reasons.push('дверь-выход заложена');

        let reachable = false;
        if (spawn) {
            const copy = $.grid.make({ cols: COLS, rows: ROWS, fill: 0 });
            for (let i = 0; i < g.data.length; i++) copy.data[i] = g.data[i];
            $.grid.flood(copy, spawn.cx, spawn.cy, 9);
            reachable = $.grid.at(copy, exit.cx, exit.cy, 0) === 9;
            if (!reachable) reasons.push('выход недостижим из спавна');
        }

        let freeSquares = 0;
        for (let y = 1; y + 1 < ROWS - 1; y++) {
            for (let x = 1; x + 1 < COLS - 1; x++) {
                if ($.grid.at(g, x, y, 1) === 0 && $.grid.at(g, x + 1, y, 1) === 0 &&
                    $.grid.at(g, x, y + 1, 1) === 0 && $.grid.at(g, x + 1, y + 1, 1) === 0) freeSquares++;
            }
        }
        if (freeSquares < 8) reasons.push('мало свободных квадратов 2x2: ' + freeSquares);

        let longest = 0;
        for (const p of platforms) if (p.len > longest) longest = p.len;

        return {
            ok: reasons.length === 0,
            reasons,
            spawn: spawn || null,
            exit,
            reachable,
            freeFraction,
            freeSquares,
            platforms: platforms.length,
            longest,
        };
    }

    // --- публикация: только целая комната, никогда по частям ---------------
    function publish(st, g, platforms, validation) {
        $('.room-wall').each((i, wall) => wall.remove());

        for (const platform of platforms) {
            $('<wall>', { class: 'room-wall' })
                .at(platform.cx * TILE + platform.len * TILE / 2, platform.cy * TILE + TILE / 2)
                .size(platform.len * TILE, TILE)
                .appendTo($.world);
        }

        const spawn = validation.spawn;
        $('#hero').at(spawn.cx * TILE + TILE / 2, spawn.cy * TILE + TILE / 2).velocity(0, 0);
        $('#exit').at(validation.exit.cx * TILE + TILE / 2, validation.exit.cy * TILE + TILE / 2);

        st.hash = $.random.hashCells(g.data);
        st.cellsData = g.data.slice();
        st.cells = g.data.length;
        st.platforms = platforms.length;
        st.longest = validation.longest;
        st.spawn = spawn;
        st.exit = validation.exit;
        st.freeFraction = validation.freeFraction;
        st.report = {
            validation,
            attempts: st.attempts.slice(),
            steps: st.steps,
            frames: st.frames,
            ticks: st.ticks,
            maxStepsPerFrame: st.maxStepsPerFrame,
            totalMs: st.totalMs,
            budget: st.budget,
            maxSteps: st.maxSteps,
            maxTicks: st.maxTicks,
            derivedSeed: st.derived,
        };
        st.status = 'published';
        st.published = true;
        st.generating = false;
        st.reason = '';
        $.store.set('rooms.cleared', st.depth);
    }

    // --- задача генерации: одна попытка ------------------------------------
    function* job(st, context) {
        st.generating = true;
        st.published = false;
        st.aborted = false;
        st.reasons = [];
        st.steps = 0;
        st.frames = 0;
        st.maxStepsPerFrame = 0;
        st.danger = new Array(CELLS);
        st.frame = $.time.frame();
        st.stepsAtFrameStart = 0;
        st.startedAt = Date.now();
        // §44: жёсткий лимит тиков симуляции на комнату (0 — отказ сразу).
        st.life = $.time.duration(st.maxTicks);
        $.random.seed(st.derived);
        st.stream = $.random.stream('generation');

        try {
            const g = $.grid.make({ cols: COLS, rows: ROWS, fill: 0 });
            if (!(yield* layoutPass(st, context, g))) return;
            if (!(yield* cleanupPass(st, g))) return;
            const platforms = yield* groupPass(st, g);
            if (!platforms) return;
            const candidates = yield* placePass(st, g, platforms);
            if (!candidates) return;

            if (!guard(st)) return;
            const spawn = candidates.length > 0 ? candidates[0] : null;
            const validation = validate(st, g, platforms, spawn);
            st.validation = validation;
            if (!validation.ok) {
                st.reasons = validation.reasons;
                st.reason = validation.reasons.join('; ');
                return;                       // попытка не удалась: публикации нет
            }
            st.ticks = st.life.elapsed();
            st.totalMs = Date.now() - st.startedAt;
            publish(st, g, platforms, validation);
        } finally {
            closeFrame(st);
            if (!st.published) {
                st.ticks = st.life ? st.life.elapsed() : 0;
                st.totalMs = Date.now() - st.startedAt;
            }
            // Жизнь-лимит не должна висеть в $.time после завершения комнаты.
            if (st.life) st.life.cancel();
            st.generating = false;
            st.life = null;
            st.task = null;          // завершённая задача больше не «идёт»
        }
    }

    function startAttempt(st) {
        st.attempt++;
        st.derived = ((st.seed >>> 0) + (st.attempt - 1) * 0x9e3779b1) >>> 0;
        st.token++;
        const token = st.token;
        st.status = 'generating';
        st.reason = '';
        st.generating = true;
        const profile = PROFILES[st.profile] || PROFILES.standard;
        st.spec = profile;
        const context = makeContext($, st.derived, profile);
        st.task = $.task.each(job(st, context), {
            budget: st.budget,
            done: (cancelled) => onAttemptDone(st, token, cancelled),
        });
        return st.task;
    }

    /**
     * Задача завершилась: успех уже опубликован, иначе — retry с derived seed
     * или отказ. `done` у $.task зовётся и после финиша, поэтому токен попытки
     * отсекает «хвосты» старых задач.
     */
    function onAttemptDone(st, token, cancelled) {
        if (token !== st.token) return;
        if (st.status !== 'generating') return;
        if (cancelled || st.published) return;
        const reasons = st.reasons.length > 0 ? st.reasons : ['нет валидной комнаты'];
        st.attempts.push({ attempt: st.attempt, derivedSeed: st.derived, reasons });
        if (st.attempt < st.maxAttempts) {
            startAttempt(st);
            return;
        }
        st.status = 'rejected';
        st.generating = false;
        st.reason = reasons.join('; ');
        st.report = {
            validation: st.validation || { ok: false, reasons },
            attempts: st.attempts.slice(),
            steps: st.steps,
            frames: st.frames,
            ticks: st.ticks,
            maxStepsPerFrame: st.maxStepsPerFrame,
            totalMs: st.totalMs,
            budget: st.budget,
            maxSteps: st.maxSteps,
            maxTicks: st.maxTicks,
            derivedSeed: st.derived,
        };
    }

    function abortGeneration() {
        if (state.task) {
            state.abort = true;
            state.task.abort();
            state.task = null;
            state.abandoned++;
        }
        state.generating = false;
        state.abort = false;
    }

    // --- checkpoints --------------------------------------------------------

    function checkpoint(slot) {
        if (!state.hash) return false;
        const ns = $.save.run();
        ns.set('rooms.runSeed', state.runSeed);
        ns.set('rooms.seed', state.seed);
        ns.set('rooms.derived', state.derived);
        ns.set('rooms.depth', state.depth);
        ns.set('rooms.profile', state.profile);
        ns.set('rooms.hash', state.hash);
        ns.set('rooms.platforms', state.platforms);
        ns.set('rooms.spawn', state.spawn);
        ns.set('rooms.exit', state.exit);
        ns.set('rooms.steps', state.steps);
        $.store.set('rooms.progress', state.depth);
        return $.save.slot(slot || state.slot).save({ meta: { room: state.hash, depth: state.depth } });
    }

    /**
     * Восстановление: отменяет генерацию (недоделанная карта не публикуется),
     * грузит слот и сверяет комнату из seed с сохранённым hash'ем. Дрейф
     * контента — отказ, а не тихая подмена.
     */
    function restore(slot) {
        abortGeneration();
        const target = slot || state.slot;
        if (!$.save.slot(target).load()) {
            state.status = 'error';
            state.reason = 'слот не загрузился';
            return false;
        }
        const ns = $.save.run();
        const seed = ns.get('rooms.seed');
        const savedHash = ns.get('rooms.hash');
        const profile = ns.get('rooms.profile');
        if (seed === undefined || !savedHash) {
            state.status = 'error';
            state.reason = 'в слоте нет комнаты';
            return false;
        }
        // Комната могла родиться из derived seed после retry — сверяем именно его.
        const savedDerived = ns.get('rooms.derived');
        const derivedSeed = (savedDerived === undefined || savedDerived === null)
            ? (seed >>> 0) : (savedDerived >>> 0);
        const cells = deriveCells($, derivedSeed, profile);
        const derivedHash = $.random.hashCells(cells.data);
        if (derivedHash !== savedHash) {
            state.status = 'drift';
            state.reason = 'hash комнаты не совпал: слот ' + savedHash
                + ', из seed ' + derivedSeed + ' — ' + derivedHash;
            return false;
        }
        state.seed = seed;
        state.derived = derivedSeed;
        const runSeed = ns.get('rooms.runSeed');
        if (runSeed !== undefined && runSeed !== null) state.runSeed = runSeed >>> 0;
        state.depth = ns.get('rooms.depth') || 0;
        state.profile = profile || state.profile;
        state.hash = savedHash;
        state.cells = cells.data.length;
        state.platforms = ns.get('rooms.platforms') || 0;
        state.spawn = ns.get('rooms.spawn') || null;
        state.exit = ns.get('rooms.exit') || null;
        state.status = 'restored';
        state.reason = '';
        state.generating = false;
        state.abort = false;
        state.published = true;
        state.attempts = [];
        state.report = null;
        return true;
    }

    // --- сцена --------------------------------------------------------------

    $.scene.add('roguerooms', {
        enter($) {
            $.world.gravity(0, 1800).color('#0b1017')
                .bounds(0, 0, COLS * TILE, ROWS * TILE);

            $('<player>', { id: 'hero' }).at(TILE * 3, TILE * 3).size(26, 30)
                .health(100)
                .controls({ axis: 'both', coyote: 110, jumpBuffer: 130, jumpCut: 0.45 })
                .collision(26, 30)
                .attr({ jumpForce: 700 })
                .appendTo($.world);

            $('<rect>', { id: 'exit', class: 'exit' }).at(COLS * TILE - TILE / 2, ROWS * TILE / 2)
                .size(TILE, TILE * (DOOR_HALF * 2 + 1)).color('#39d98a').appendTo($.world);

            $.camera.follow('#hero', { smooth: 0.18, deadzone: [60, 40], lookahead: 90, offset: [0, -20] });
            $.camera.zoom(0.55);
            $.camera.limits(0, 0, COLS * TILE, ROWS * TILE);

            buildHud($);
            $.input.bind('room.next', [KEYS.next]);
            $.input.bind('room.checkpoint', [KEYS.checkpoint]);
            $.input.bind('room.restore', [KEYS.restore]);
            $.input.bind('room.profile', [KEYS.profile]);

            $.save.dir(state.saveDir);
            state.runSeed = $.random.seed() >>> 0;
            state.depth = 0;
            startRoom(state.runSeed);
        },

        update(dt, $) {
            if ($.input.pressed('room.next')) {
                state.depth++;
                startRoom(nextSeed(state.runSeed, state.depth));
            }
            if ($.input.pressed('room.checkpoint')) checkpoint();
            if ($.input.pressed('room.restore')) restore();
            if ($.input.pressed('room.profile')) {
                const names = Object.keys(PROFILES);
                state.profile = names[(names.indexOf(state.profile) + 1) % names.length];
                state.spec = PROFILES[state.profile];
                startRoom(state.seed);
            }
            hud($);
        },
    });

    /** Запустить комнату: отменяет предыдущую задачу и стартует новую. */
    function startRoom(seed) {
        abortGeneration();
        state.seed = seed >>> 0;
        state.derived = state.seed;
        state.attempt = 0;
        state.attempts = [];
        state.aborted = false;
        state.published = false;
        state.steps = 0;
        state.frames = 0;
        state.ticks = 0;
        state.maxStepsPerFrame = 0;
        state.totalMs = 0;
        state.validation = null;
        state.report = null;
        state.reason = '';
        startAttempt(state);
        return state.status;
    }

    // --- HUD ----------------------------------------------------------------

    function buildHud($) {
        $('<ui.panel>', { id: 'hud-bg' }).at(250, 74).size(480, 148)
            .color('#0d1220cc').appendTo($.ui);
        $('<ui.label>', { id: 'hud-room', size: 16, color: '#ffd54a' }).at(24, 12).appendTo($.ui);
        $('<ui.label>', { id: 'hud-gen', size: 15, color: '#e8f0ff' }).at(24, 38).appendTo($.ui);
        $('<ui.label>', { id: 'hud-budget', size: 15, color: '#9fe8c0' }).at(24, 62).appendTo($.ui);
        $('<ui.label>', { id: 'hud-valid', size: 15, color: '#cfe0f5' }).at(24, 86).appendTo($.ui);
        $('<ui.label>', { id: 'hud-keys', size: 14, color: '#8ea3bd' }).at(24, 112).appendTo($.ui);
    }

    function hud($) {
        const st = state;
        $('#hud-room').text('Комната ' + (st.depth + 1) + ' · seed ' + st.seed + ' · ' + st.profile
            + ' · ' + st.status);
        $('#hud-gen').text('hash ' + (st.hash || '—') + ' · платформ ' + st.platforms
            + ' · шагов ' + st.steps + '/' + st.maxSteps + ' · попыток ' + (st.attempt || 1));
        $('#hud-budget').text('бюджет ' + st.budget.toFixed(2) + ' мс/кадр · кадров ' + st.frames
            + ' · максимум ' + st.maxStepsPerFrame + ' шагов/кадр · всего ' + st.totalMs + ' мс'
            + ' · тиков ' + st.ticks + '/' + st.maxTicks);
        const validation = st.report ? st.report.validation : null;
        $('#hud-valid').text(validation
            ? (validation.ok ? 'validation: ok · выход достижим' : 'validation: ' + validation.reasons[0])
            : ('validation: ' + (st.reason || 'ожидание')));
        $('#hud-keys').text('R — новая комната · C — checkpoint · V — restore · P — профиль');
    }

    // --- публичный namespace ------------------------------------------------

    $.rooms = {
        version: 1,
        profiles: Object.keys(PROFILES),
        config(opts) {
            const spec = opts || {};
            if (spec.profile !== undefined) {
                state.profile = spec.profile;
                state.spec = PROFILES[spec.profile] || PROFILES.standard;
            }
            if (Number(spec.budget) > 0) state.budget = Number(spec.budget);
            if (Number(spec.maxSteps) > 0) state.maxSteps = Math.floor(Number(spec.maxSteps));
            if (Number(spec.maxTicks) >= 0) state.maxTicks = Math.floor(Number(spec.maxTicks));
            if (Number(spec.maxAttempts) > 0) state.maxAttempts = Math.floor(Number(spec.maxAttempts));
            if (spec.slot) state.slot = String(spec.slot);
            return stats();
        },
        dir(path, opts) {
            state.saveDir = String(path);
            $.save.dir(state.saveDir);
            if (opts && opts.clear) {
                for (const slot of $.save.list({ meta: false })) $.save.remove(slot.slot);
            }
            return state.saveDir;
        },
        start(seed, opts) {
            if (opts) $.rooms.config(opts);
            return startRoom(seed === undefined ? state.seed : seed);
        },
        next() {
            state.depth++;
            return startRoom(nextSeed(state.runSeed, state.depth));
        },
        checkpoint(slot) { return checkpoint(slot); },
        restore(slot) { return restore(slot); },
        /** Хеш комнаты, выведенной из seed, без публикации (проверка дрейфа). */
        verify(seed, profileName) {
            return $.random.hashCells(deriveCells($, seed >>> 0, profileName || state.profile).data);
        },
        /** Опубликованные клетки комнаты (копия) — для проверок и отладки. */
        cells() { return state.cellsData ? state.cellsData.slice() : null; },
        room() {
            return {
                hash: state.hash, seed: state.seed, depth: state.depth, profile: state.profile,
                platforms: state.platforms, spawn: state.spawn, exit: state.exit,
            };
        },
        stats() { return stats(); },
    };

    function stats() {
        return {
            status: state.status,
            reason: state.reason,
            runSeed: state.runSeed,
            seed: state.seed,
            derivedSeed: state.derived,
            depth: state.depth,
            profile: state.profile,
            dangerLimit: state.spec ? state.spec.dangerLimit : 0,
            hash: state.hash,
            cells: state.cells,
            cols: COLS,
            rows: ROWS,
            platforms: state.platforms,
            longest: state.longest,
            spawn: state.spawn,
            exit: state.exit,
            freeFraction: state.freeFraction,
            budget: state.budget,
            maxSteps: state.maxSteps,
            maxTicks: state.maxTicks,
            steps: state.steps,
            frames: state.frames,
            ticks: state.ticks,
            maxStepsPerFrame: state.maxStepsPerFrame,
            totalMs: state.totalMs,
            attempt: state.attempt,
            attempts: state.attempts.length,
            attemptSeeds: state.attempts.map((a) => a.derivedSeed),
            attemptLog: state.attempts.slice(),
            reasons: state.reasons.slice(),
            generating: state.generating,
            abandoned: state.abandoned,
        };
    }
}
