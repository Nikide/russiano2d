// ===========================================================================
// Реплеи: запись ввода и воспроизведение — $.replay
//
// Зачем в движке: детерминизм уже есть (`--seed` + `--fixed-dt` + свои
// генераторы из `$.random`), но записать и проиграть сессию было нечем.
// Реплей превращает баг-репорт в одну строку данных, а регресс-тест — в
// «проиграй запись и проверь, что мир пришёл туда же».
//
//   $.replay.start();                        // начали запись
//   $.update(() => $.replay.record($.input.state()));   // каждый кадр
//   $.replay.stop();                          // записали
//   const text = $.replay.toText();           // сохранили в файл
//
//   $.replay.fromText(text);                  // загрузили
//   $.replay.play();                          // проигрываем
//   $.update(() => $.input.apply($.replay.tick()));     // ввод из записи
//
// ЧЕСТНО О ГРАНИЦАХ: реплей воспроизводит РОВНО то, что игра записала в
// `record()`. Если состояние зависит от чего-то, что не в записи (настенные
// часы, сеть, положение мыши), воспроизведение разойдётся — движок об этом
// предупреждает, а не молчит.
// ===========================================================================

import { ctx } from './core.js';

/** Предел записи: 10 минут при 60 к/с. Дальше предупреждаем и останавливаемся. */
export const MAX_FRAMES = 36000;
/** Предел размера одного кадра ввода: защита от записи всего мира в реплей. */
export const MAX_FRAME_BYTES = 4096;

/**
 * Чистое ядро реплея: запись, воспроизведение и текст.
 *
 * `header` — то, без чего воспроизведение не совпадёт: зерно генератора и шаг
 * времени. Игра может положить свои поля (уровень, сложность).
 */
export function createReplay(header) {
    let head = Object.assign({ seed: 0, dt: 0, frame: 0 }, header || {});
    const frames = [];              // [{ f, d }] — по возрастанию номера кадра
    let mode = 'idle';              // idle | recording | playing
    let cursor = 0;                 // сколько кадров уже проиграно
    let dropped = 0;                // сколько кадров не записали (переполнение/размер)
    let lastFrame = -1;

    function dataOf(value) {
        if (value === undefined || value === null) return null;
        if (typeof value === 'string') return value;
        try {
            const text = JSON.stringify(value);
            if (text && text.length > MAX_FRAME_BYTES) return null;   // слишком жирно
            return text;
        } catch (e) {
            return null;                 // циклический объект — записать нельзя
        }
    }

    const replay = {
        /** Начать запись: старый реплей стирается. */
        start(extra) {
            head = Object.assign({ seed: 0, dt: 0, frame: 0 }, header || {}, extra || {});
            frames.length = 0;
            dropped = 0;
            cursor = 0;
            lastFrame = -1;
            mode = 'recording';
            return replay;
        },

        /** Остановить запись или воспроизведение. */
        stop() {
            if (mode === 'recording') head.frames = frames.length;
            mode = 'idle';
            return replay;
        },

        /**
         * Записать ввод кадра. `frame` по умолчанию — номер кадра движка
         * (`engine.frame`), но его можно задать явно (тесты, свои часы).
         */
        record(value, frame) {
            if (mode !== 'recording') return false;
            const f = Math.floor(Number(frame !== undefined ? frame
                                                          : (ctx.engineFrame ? ctx.engineFrame() : 0)) || 0);
            if (frames.length >= MAX_FRAMES) {
                dropped++;
                if (dropped === 1) ctx.log('$.replay: запись достигла предела ' + MAX_FRAMES + ' кадров');
                return false;
            }
            const d = dataOf(value);
            // Пустой кадр тоже надо записать: пропуск сломает соответствие
            // «кадр записи ↔ кадр проигрывания».
            frames.push({ f, d });
            replay._index = null;
            lastFrame = f;
            return true;
        },

        /** Загрузить реплей из структуры (или текста). */
        load(data) {
            let obj = data;
            if (typeof data === 'string') {
                try { obj = JSON.parse(data); } catch (e) {
                    ctx.log('$.replay.load: не разобрал JSON — ' + e);
                    return false;
                }
            }
            if (!obj || !Array.isArray(obj.frames)) {
                ctx.log('$.replay.load: нужен объект с полем frames');
                return false;
            }
            head = Object.assign({ seed: 0, dt: 0, frame: 0 }, obj.header || {});
            frames.length = 0;
            for (const item of obj.frames) {
                if (Array.isArray(item)) frames.push({ f: item[0] | 0, d: item[1] === undefined ? null : item[1] });
                else frames.push({ f: item.f | 0, d: item.d === undefined ? null : item.d });
            }
            dropped = 0;
            cursor = 0;
            replay._index = null;
            mode = 'idle';
            return true;
        },

        /** Начать воспроизведение. `from` — кадр, с которого начать. */
        play(from) {
            cursor = Math.max(0, Math.floor(Number(from) || 0));
            mode = frames.length ? 'playing' : 'idle';
            return replay;
        },

        /**
         * Кадр воспроизведения: вернуть ввод текущего кадра и перейти к
         * следующему. Возвращает `null`, когда запись кончилась (или разбор
         * уже закончен — тогда режим снимается сам).
         */
        tick() {
            if (mode !== 'playing') return null;
            if (cursor >= frames.length) {
                mode = 'idle';
                if (typeof replay.onEnd === 'function') replay.onEnd();
                return null;
            }
            const item = frames[cursor++];
            if (cursor >= frames.length) {
                // Последний кадр отдаём и сразу закрываем режим.
                queueMicrotask(() => {
                    if (mode === 'playing' && cursor >= frames.length) {
                        mode = 'idle';
                        if (typeof replay.onEnd === 'function') replay.onEnd();
                    }
                });
            }
            return item.d === null ? null : item.d;
        },

        /** Пропустить `count` кадров (перемотка вперёд без проигрывания). */
        skip(count) {
            cursor = Math.min(frames.length, cursor + Math.max(0, Math.floor(Number(count) || 0)));
            return cursor;
        },

        /** Текущий режим: 'idle' | 'recording' | 'playing'. */
        mode() { return mode; },
        isRecording() { return mode === 'recording'; },
        isPlaying() { return mode === 'playing'; },

        /** Сколько кадров в записи. */
        length() { return frames.length; },
        /** Сколько кадров проиграно (курсор). */
        position() { return cursor; },
        /** Сколько кадров не записались (переполнение или слишком большой ввод). */
        dropped() { return dropped; },
        /** Заголовок записи: зерно, шаг времени и поля игры. */
        header() { return Object.assign({}, head); },

        /** Кадр по индексу записи: `{ f, d }` (или null). */
        at(index) {
            const i = Math.floor(Number(index) || 0);
            return i >= 0 && i < frames.length ? { f: frames[i].f, d: frames[i].d } : null;
        },

        /** Кадры (копия) — для своих форматов и проверок. */
        frames() { return frames.map((x) => ({ f: x.f, d: x.d })); },

        /** Текст для файла: компактный JSON. */
        toText() {
            return JSON.stringify({
                header: Object.assign({}, head, { frames: frames.length }),
                frames: frames.map((x) => [x.f, x.d]),
            });
        },

        /** Сколько байт займёт текст (прикидка для сохранения). */
        size() { return replay.toText().length; },

        clear() {
            frames.length = 0;
            cursor = 0;
            dropped = 0;
            mode = 'idle';
            replay._index = null;
            return replay;
        },
    };
    return replay;
}

/**
 * Сравнить две записи: совпадают ли кадры (для проверки «реплей воспроизвёлся»).
 * Возвращает `{ same, count, first }` — номер первого расхождения или -1.
 */
export function compareReplays(a, b) {
    const fa = a && typeof a.frames === 'function' ? a.frames() : [];
    const fb = b && typeof b.frames === 'function' ? b.frames() : [];
    const count = Math.min(fa.length, fb.length);
    for (let i = 0; i < count; ++i) {
        if (fa[i].f !== fb[i].f || fa[i].d !== fb[i].d) return { same: false, count, first: i };
    }
    return { same: fa.length === fb.length, count, first: fa.length === fb.length ? -1 : count };
}

/** Подсистема `$.replay`. */
export function installReplay($) {
    const replay = createReplay({
        seed: (typeof engine !== 'undefined' && engine && engine.seed) || 0,
        dt: (typeof engine !== 'undefined' && engine && engine.fixedDt) || 0,
    });

    // Номер кадра движка нужен ядру: без него оно бы зависело от ctx напрямую.
    ctx.engineFrame = () => (typeof engine !== 'undefined' && engine ? engine.frame : 0);

    // Заголовок обновляем при старте записи: игру интересует зерно ЗАПУСКА.
    const baseStart = replay.start.bind(replay);
    replay.start = (extra) => baseStart(Object.assign({
        seed: (typeof engine !== 'undefined' && engine ? engine.seed : 0),
        dt: (typeof engine !== 'undefined' && engine ? engine.fixedDt : 0),
    }, extra || {}));

    $.replay = replay;
    return replay;
}
