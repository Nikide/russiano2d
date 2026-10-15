// ===========================================================================
// Работа кусками — $.task
//
// Зачем. Долгая синхронная работа в игре вешает кадр: генерация карты, тёплый
// проход по сотне ассетов, сборка prefab'ов. Раньше был только `$.loading.run`,
// который выполняет ПО ОДНОМУ шагу за кадр — если шаг сам длинный, кадр всё
// равно замирает.
//
// Здесь работа делится по времени: колбэк вызывается столько раз, сколько
// помещается в бюджет, и между вызовами кадр рисуется.
//
//   // Разово: задача сама продлевается на следующие кадры.
//   $.task.chunked(({ i, n }) => buildTile(i), { total: 4000, budget: 4 });
//
//   // Со экраном загрузки и завершением:
//   $.task.chunked({
//       total: 4000,
//       label: 'деревья',
//       step: (i) => buildTile(i),
//       done: () => console.log('готово'),
//   });
//
//   // Цикл-генератор: сам решает, когда закончил.
//   $.task.each(function* () { for (const t of tiles) { yield; place(t); } });
//
// Модуль не касается `engine`: всё, что ему нужно, — обработчик кадра,
// который передаёт игра (`ctx.update`). Поэтому поведение проверяется
// юнит-тестом без движка (tests/js/task_test.mjs).
// ===========================================================================

import { ctx } from './core.js';

// ---------------------------------------------------------------------------
// Чистая часть: планировщик
// ---------------------------------------------------------------------------

/**
 * Создаёт шаговый планировщик: на каждом вызове `tick(dt)` тратит не больше
 * `budget` миллисекунд на работу `work(i, n)`.
 *
 * Возвращает объект с `tick`, `done` (закончил ли), `progress` (0..1),
 * `index` (сколько сделано) и `abort`.
 */
export function createScheduler(work, opts) {
    const spec = opts || {};
    const total = Math.max(0, Math.floor(spec.total === undefined ? 0 : spec.total));
    const budget = Math.max(0.05, Number(spec.budget) > 0 ? Number(spec.budget) : 4);
    const now = typeof spec.now === 'function' ? spec.now : () => Date.now();
    let index = 0;
    let finished = false;
    let aborted = false;
    // Первый тик приходит с dt=None: работа начинается в тот же кадр, когда
    // задачу поставили, а не со следующего.
    let first = true;

    const scheduler = {
        get index() { return index; },
        get total() { return total; },
        get finished() { return finished; },
        get aborted() { return aborted; },
        progress() { return total <= 0 ? (finished ? 1 : 0) : Math.min(1, index / total); },

        /** Один шаг планировщика: вернёт true, когда работа закончилась. */
        tick() {
            if (finished || aborted) return true;
            const started = now();
            let guard = 0;
            while (index < total) {
                try {
                    work(index, total);
                } catch (e) {
                    aborted = true;
                    return false;
                }
                index++;
                guard++;
                // Бюджет проверяем не на каждой итерации: вызов now() сам стоит
                // времени, и на мелких шагах он съел бы весь бюджет.
                if ((guard & 3) === 0 && now() - started >= budget) break;
            }
            if (index >= total) {
                finished = true;
                return true;
            }
            first = false;
            return false;
        },

        abort() { aborted = true; finished = true; },
    };
    void first;
    return scheduler;
}

/**
 * Планировщик для генератора: планировщик сам зовёт `next()` и считает шаги
 * по времени. Генератор решает, когда закончил (обычный `return`).
 */
export function createGeneratorScheduler(generator, opts) {
    // Принимаем и генераторную функцию, и готовый итератор. В QuickJS функция с
    // `yield` не отдаёт `.next` (это не обычный объект-итератор), поэтому вызов
    // функции — обязательный шаг, а не удобство.
    if (typeof generator === 'function') generator = generator();
    const spec = opts || {};
    const budget = Math.max(0.05, Number(spec.budget) > 0 ? Number(spec.budget) : 4);
    const now = typeof spec.now === 'function' ? spec.now : () => Date.now();
    let finished = false;
    let aborted = false;
    let ticks = 0;
    let error = null;

    const scheduler = {
        get index() { return ticks; },
        get total() { return 0; },
        get finished() { return finished; },
        get aborted() { return aborted; },
        get error() { return error; },
        progress() { return finished ? 1 : 0; },

        tick() {
            if (finished || aborted) return true;
            const started = now();
            while (!finished) {
                let result;
                try {
                    result = generator.next();
                } catch (e) {
                    aborted = true;
                    error = e;
                    return false;
                }
                ticks++;
                if (result.done) { finished = true; return true; }
                if (now() - started >= budget) break;
            }
            return finished;
        },

        abort() {
            aborted = true;
            finished = true;
            if (typeof generator.return === 'function') {
                try { generator.return(); } catch (e) { /* генератор уже мёртв */ }
            }
        },
    };
    return scheduler;
}

// ---------------------------------------------------------------------------
// Подсистема
// ---------------------------------------------------------------------------

/**
 * Задачи, которые ждут кадра. Список модульный: кадровый цикл api.js зовёт
 * tickTask(dt) один раз, а не ставит по хуку $.update на задачу. Раньше хук
 * никогда не снимался (`.update(fn)` не отдаёт отписку), поэтому `done`
 * вызывался каждый кадр после завершения, а список хуков рос с каждой задачей.
 */
let active = new Set();

/** Одна задача: шаг планировщика и ОДНО завершение. */
function stepTask(item, dt) {
    if (!item || item.done_called) return;
    const scheduler = item.scheduler;
    const finished = scheduler.tick(dt);
    if (item.label && item.loading && typeof item.loading.progress === 'function') {
        item.loading.progress(scheduler.progress(), item.label);
    }
    if (finished || scheduler.aborted) item.finish(scheduler.aborted);
}

/**
 * Кадровый шаг всех задач. Вызывается из api.js (`tickTask(dt)`).
 * Возвращает число задач, которые ещё в работе.
 */
export function tickTask(dt) {
    if (active.size === 0) return 0;
    for (const item of Array.from(active)) stepTask(item, dt);
    return active.size;
}

/** Сколько задач сейчас идёт (для тестов и отладки). */
export function runningTasks() { return active.size; }

/** Причина, по которой scope закрывает задачи (для журнала и onDone). */
function scopeOf(explicit) {
    if (explicit && typeof explicit === 'object' && typeof explicit.own === 'function') return explicit;
    if (typeof ctx.scopeGet === 'function') {
        const found = explicit === undefined || explicit === null ? null : ctx.scopeGet(explicit);
        if (found) return found;
    }
    return ctx.scope_current || null;
}

export function installTask($) {
    active = new Set();

    /** Ставит задачу на кадровый шаг tickTask. Возвращает задачу. */
    function schedule(scheduler, opts) {
        const spec = opts || {};
        const label = spec.label || '';
        const onDone = typeof spec.done === 'function' ? spec.done : null;
        const loading = ctx.loading || ($ && $.loading) || null;
        if (label && loading && typeof loading.show === 'function') loading.show({ title: label });

        const task = {
            scheduler,
            label,
            loading,
            done_called: false,
            aborted: false,
            /** Отменить: работа не докрутится до конца, `done` придёт один раз. */
            abort() {
                if (task.done_called) return false;
                task.aborted = true;
                scheduler.abort();
                task.finish(true);
                return true;
            },
            get progress() { return scheduler.progress(); },
            get finished() { return scheduler.finished; },
        };

        /** Единственная точка завершения: снимает задачу и зовёт done один раз. */
        task.finish = (aborted) => {
            if (task.done_called) return;
            task.done_called = true;
            active.delete(task);
            if (typeof onDone === 'function') onDone(aborted === true);
        };
        task.tick = (dt) => stepTask(task, dt);

        active.add(task);
        const scope = scopeOf(spec.scope);
        if (scope && typeof scope.own === 'function') {
            scope.own('task', task, () => task.abort(), spec);
        }
        // Первый шаг делает кадровый цикл в тот же кадр: tickTask(dt) идёт
        // после логики игры, поэтому задача не «замирает» до следующего кадра.
        return task;
    }

    const task = {
        /**
         * Работа кусками. Принимает `step` (или `work`) и `total`:
         *   $.task.chunked({ total: 500, step: (i) => build(i), budget: 4 });
         * Либо просто функцию и число:
         *   $.task.chunked((i) => build(i), 500);
         */
        chunked(stepOrSpec, totalOrOpts) {
            let spec;
            if (typeof stepOrSpec === 'function') {
                spec = Object.assign({}, typeof totalOrOpts === 'number' ? { total: totalOrOpts } : (totalOrOpts || {}));
                spec.step = stepOrSpec;
            } else {
                spec = Object.assign({}, stepOrSpec || {});
            }
            const work = typeof spec.step === 'function' ? spec.step
                : (typeof spec.work === 'function' ? spec.work : null);
            if (!work) { ctx.log('$.task.chunked: нужен step или work'); return null; }
            if (!(spec.total > 0)) {
                ctx.log('$.task.chunked: укажите total — сколько шагов');
                return null;
            }
            const scheduler = createScheduler(work, spec);
            return schedule(scheduler, spec);
        },

        /** Работа циклом-генератором: `yield` — отдать кадр. */
        each(generatorOrSpec, opts) {
            let spec = opts || {};
            let generator = generatorOrSpec;
            if (generatorOrSpec && typeof generatorOrSpec === 'object' && !generatorOrSpec.next) {
                spec = generatorOrSpec;
                generator = spec.generator || spec.each;
            }
            if (typeof generator === 'function') generator = generator();
            if (!generator || typeof generator.next !== 'function') {
                ctx.log('$.task.each: нужен генератор или генераторная функция');
                return null;
            }
            return schedule(createGeneratorScheduler(generator, spec), spec);
        },

        /**
         * Разбить список на порции по времени и выполнить. Возвращает задачу;
         * `done` получит признак отмены.
         */
        list(items, each, opts) {
            const list = (items || []).slice();
            const spec = Object.assign({ label: '', budget: 4 }, opts || {});
            return task.chunked({
                total: list.length,
                budget: spec.budget,
                label: spec.label,
                done: spec.done,
                scope: spec.scope,
                step: (i) => each(list[i], i, list.length),
            });
        },

        /** Сколько задач сейчас идёт. */
        running() { return active.size; },

        /** Отменить все задачи. */
        abortAll() {
            const count = active.size;
            for (const item of [...active]) item.abort();
            active.clear();
            return count;
        },
    };

    $.task = task;
    ctx.task = task;
    return task;
}
