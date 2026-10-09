// ===========================================================================
// Мост инструментов SDK: $.sdk.
//
// SDK — приложение R2D, а тяжёлые операции (валидация, импорт, bake, сборка)
// выполняет нативный CLI `r2d-sdk` (sdk/native, чистый C). Игре это не нужно,
// поэтому мост включается только проектом-инструментом: "toolHost": true в
// project.json. Без флага $.sdk.available() === false, а вызовы отклоняются
// понятной ошибкой.
//
//   const res = await $.sdk.tool(['validate', 'assets/hero.character.json']);
//   res.ok            // exitCode === 0 и json.ok !== false
//   res.json          // разобранный ответ CLI (структурные диагностики)
//
//   const game = $.sdk.launch(['--game', 'demos', '--scene', 'platformer']);
//   game.done.then(r => ...);   game.kill();
//
// Запускаются только `r2d-sdk` рядом с движком и сам движок, аргументы —
// массив строк без shell (src/sdk_host.h). Процесс идёт в фоне, Promise
// разрешается в tickSdk() по игровым кадрам.
//
// Модуль импортируется без движка: к engine обращаемся только внутри функций,
// а tests/js/sdk_test.mjs подставляет бэкенд через $.sdk._setBackend().
// ===========================================================================

import { engine } from './native.js';
import { ctx } from './core.js';

const DEFAULT_TIMEOUT_MS = 120000;

const START_ERRORS = {
    '-1': 'мост инструментов выключен: добавьте "toolHost": true в project.json проекта-инструмента',
    '-2': 'бинарник не найден рядом с движком: соберите проект (cmake --build build)',
    '-3': 'не удалось запустить процесс',
    '-4': 'слишком много одновременных процессов (максимум 16)',
    '-5': 'аргументы должны быть массивом строк (не больше 64, до 4096 символов)',
};

const state = {
    jobs: new Map(),      // id → запись { id, kind, resolve, elapsed, timeout }
    backend: null,        // подмена бэкенда для тестов
};

// ---------------------------------------------------------------------------
// Чистые помощники (tests/js/sdk_test.mjs)
// ---------------------------------------------------------------------------

/** Сообщение по коду ошибки engine.sdk.start (отрицательное число). */
export function describeStartError(code) {
    return START_ERRORS[String(code)] || ('неизвестная ошибка запуска (' + code + ')');
}

/**
 * Достаёт JSON-ответ CLI из вывода процесса. CLI печатает один объект на
 * строку; движок может писать логи рядом, поэтому берём последнюю строку,
 * которая разбирается как объект, а если её нет — весь текст целиком.
 */
export function extractJson(text) {
    const source = String(text || '').trim();
    if (!source) return null;
    const lines = source.split(/\r?\n/);
    for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (line[0] !== '{') continue;
        try {
            const value = JSON.parse(line);
            if (value && typeof value === 'object') return value;
        } catch (e) { /* строка не JSON — смотрим выше */ }
    }
    try {
        const value = JSON.parse(source);
        return value && typeof value === 'object' ? value : null;
    } catch (e) {
        return null;
    }
}

/** Итог процесса → объект результата для Promise. */
export function makeResult(kind, polled, error) {
    const output = polled && typeof polled.output === 'string' ? polled.output : '';
    const exit_code = polled && typeof polled.exitCode === 'number' ? polled.exitCode : null;
    const json = kind === 'tool' ? extractJson(output) : null;
    let ok = exit_code === 0 && !error;
    if (json && json.ok === false) ok = false;
    const result = {
        ok,
        exitCode: exit_code,
        output,
        truncated: !!(polled && polled.truncated),
        killed: !!(polled && polled.killed),
        json,
        error: error || null,
    };
    if (kind === 'tool' && !json && !error && exit_code !== null) {
        result.error = 'CLI не вернул JSON — смотрите output';
        result.ok = false;
    }
    return result;
}

// ---------------------------------------------------------------------------
// Бэкенд
// ---------------------------------------------------------------------------

function host() {
    if (state.backend) return state.backend;
    const sdk = typeof engine === 'undefined' || !engine ? null : engine.sdk;
    // Мок engine из qjs-харнесса отдаёт no-op вместо методов: проверяем start.
    return sdk && typeof sdk.start === 'function' ? sdk : null;
}

function beginJob(kind, args, timeout) {
    const backend = host();
    if (!backend || !backend.available()) {
        throw new Error('$.sdk: ' + describeStartError(-1));
    }
    const list = Array.isArray(args) ? args.map(String) : null;
    if (!list) throw new Error('$.sdk: ' + describeStartError(-5));

    const id = backend.start(kind, list);
    if (typeof id !== 'number' || id < 0) {
        throw new Error('$.sdk: ' + describeStartError(id));
    }
    const promise = new Promise((resolve) => {
        state.jobs.set(id, { id, kind, resolve, elapsed: 0, timeout: timeout || DEFAULT_TIMEOUT_MS });
    });
    return { id, promise };
}

function startJob(kind, args, timeout) {
    try {
        return beginJob(kind, args, timeout).promise;
    } catch (e) {
        return Promise.reject(e);
    }
}

function finish(record, polled, error) {
    const backend = host();
    state.jobs.delete(record.id);
    if (backend) backend.release(record.id);
    record.resolve(makeResult(record.kind, polled, error));
}

/**
 * Продвинуть процессы. Зовётся из api.js раз в кадр. Каждый процесс
 * завершается: кодом выхода, убийством или таймаутом — Promise не висит.
 */
export function tickSdk(dt) {
    if (state.jobs.size === 0) return;
    const backend = host();
    if (!backend) return;
    const dt_ms = (Number(dt) || 0) * 1000;
    for (const record of [...state.jobs.values()]) {
        const polled = backend.poll(record.id);
        if (!polled) { state.jobs.delete(record.id); record.resolve(makeResult(record.kind, null, 'процесс потерян')); continue; }
        if (!polled.running) { finish(record, polled, null); continue; }
        record.elapsed += dt_ms;
        if (record.timeout > 0 && record.elapsed >= record.timeout) {
            backend.kill(record.id);
            const last = backend.poll(record.id) || polled;
            finish(record, last, 'таймаут процесса (' + record.timeout + ' мс)');
        }
    }
}

// ---------------------------------------------------------------------------
// $.sdk
// ---------------------------------------------------------------------------

export function installSdk($) {
    $.sdk = {
        /** Мост включён проектом (project.json: "toolHost": true). */
        available() {
            const backend = host();
            return !!(backend && backend.available());
        },

        /** Пути бинарников: { tool, toolFound, engine, exeDir }. */
        paths() {
            const backend = host();
            return backend && typeof backend.paths === 'function' ? backend.paths() : null;
        },

        /**
         * Запустить `r2d-sdk <args…>`. Promise<{ ok, exitCode, json, output, error }>.
         * `json` — разобранный ответ CLI с диагностиками; ok=false при ненулевом
         * коде выхода или `json.ok === false`.
         */
        tool(args, opts) {
            return startJob('tool', args, opts && opts.timeout);
        },

        /**
         * Запустить сам движок с аргументами (игра, сборка). Возвращает
         * { id, done, kill() }: `done` — Promise результата, `kill()` завершает
         * процесс.
         */
        launch(args, opts) {
            const job = beginJob('engine', args, opts && opts.timeout !== undefined ? opts.timeout : 0);
            const backend = host();
            return {
                id: job.id,
                done: job.promise,
                kill() { return backend ? backend.kill(job.id) : false; },
                /** Текущее состояние без ожидания конца: { running, exitCode, output, … } или null. */
                peek() { return backend ? backend.poll(job.id) : null; },
            };
        },

        /** Сколько процессов сейчас отслеживается. */
        active() { return state.jobs.size; },

        /** Только для тестов: подставить бэкенд вместо engine.sdk. */
        _setBackend(backend) { state.backend = backend || null; },
    };
    return $.sdk;
}
