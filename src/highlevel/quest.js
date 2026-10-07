// ===========================================================================
// Задания — $.quest
//
// Порт из audm-neko (game/quests/quest_book.gd + quest_def.gd +
// quest_objective.gd). В Godot задание было .tres-ресурсом, который правится в
// инспекторе; здесь задание — обычный объект, который описывается на любом
// удобном языке (JSON-файл, код, текст сценария), а ядро остаётся чистым:
// состояния, прогресс, условия открытия и награды.
//
//   $.quest.define({
//       id: 'relay', title: 'Выключить ретранслятор', kind: 'story',
//       giver: 'kek', after: ['prologue'], order: 10,
//       objectives: [{ kind: 'object', object_id: 'relay_a', count: 2 }],
//       reward: { money: 500, items: { medkit: 1 }, trust: 2 },
//       flags: { accept: ['relay_started'], done: ['relay_off'] },
//   });
//
//   $.quest.status('relay');            // locked | available | active | ready | done
//   $.quest.accept('relay');
//   $.quest.onKill('RaidPgt');          // рейд сообщает событие
//   $.quest.turnIn('relay');            // сдать: выдать награду и флаги
//
// Ключевые правила оригинала, которые перенесены дословно:
//   * ВЗЯТОЕ задание не пропадает из журнала, даже если ветка-близнец сдана
//     раньше (правило QA: работу можно довести);
//   * `after` требует ВСЕХ, `after_any` — любого (развилка);
//   * `excludes` закрывает задание, если любое из перечисленных взято или сдано;
//   * `requires_flags` и `requires_scenes` не пускают задание до условий;
//   * «милосердные» флаги выбирают ветку задания при взятии (merciful_branch).
//
// Чистое ядро (createBook) не касается движка: библиотеку заданий, флаги и
// набор «просмотренных сцен» ему передаёт игра. Поэтому поведение целиком
// проверяется юнит-тестом (tests/js/quest_test.mjs).
// ===========================================================================

import { ctx } from './core.js';

// ---------------------------------------------------------------------------
// Чистое ядро
// ---------------------------------------------------------------------------

/**
 * Создать «книгу заданий»: реестр определений + состояния.
 *
 * `opts.flags` — объект флагов (обычно `$.story.flags`), `opts.seenScenes` —
 * массив просмотренных сцен, `opts.mercifulFlags` и `opts.mercifulThreshold` —
 * ветвление, `opts.onLog` — журнал.
 */
export function createBook(opts) {
    const spec = opts || {};
    const definitions = new Map();
    const states = new Map();          // id → { status, progress: [], }
    const flags = spec.flags || {};
    const seenScenes = spec.seenScenes || [];
    const mercifulFlags = spec.mercifulFlags || [];
    const mercifulThreshold = spec.mercifulThreshold === undefined ? 4 : spec.mercifulThreshold;
    const onLog = typeof spec.onLog === 'function' ? spec.onLog : () => {};

    function state(id) {
        if (!states.has(id)) states.set(id, { status: 'new', progress: [], haul: [] });
        return states.get(id);
    }

    function flag(name) { return !!flags[name]; }

    function setFlag(name, on) {
        flags[name] = on === undefined ? true : !!on;
    }

    function mercifulCount() {
        let count = 0;
        for (const name of mercifulFlags) if (flag(name)) count++;
        return count;
    }

    /** Задание закрыто взаимоисключением: любое из `excludes` взято или сдано. */
    function excluded(def) {
        for (const other of def.excludes || []) {
            const status = String(state(other).status);
            if (status === 'done' || status === 'active') return true;
        }
        return false;
    }

    /** Прогресс цели: сколько сделано. */
    function goalOf(def, index) {
        const st = state(def.id);
        if (st.progress[index] === undefined) st.progress[index] = 0;
        return st.progress[index];
    }

    function setGoal(def, index, value) {
        const st = state(def.id);
        const objective = (def.objectives || [])[index] || {};
        const max = Math.max(1, Number(objective.count) || 1);
        st.progress[index] = Math.max(0, Math.min(Number(value) || 0, max));
    }

    /** Все цели выполнены? */
    function isReady(id) {
        const def = definitions.get(String(id));
        if (!def) return false;
        const objectives = def.objectives || [];
        for (let i = 0; i < objectives.length; ++i) {
            const objective = objectives[i];
            // У `haul` count — это ПОРОГ стоимости рюкзака, а не число
            // повторов: цель считается выполненной по отметке.
            if (objective.kind === 'haul') {
                if (!state(def.id).haul[i]) return false;
                continue;
            }
            const need = Math.max(1, Number(objective.count) || 1);
            if (goalOf(def, i) < need) return false;
        }
        return true;
    }

    const book = {
        /** Описать задание (повторный вызов перезаписывает). */
        define(raw) {
            if (!raw || !raw.id) { onLog('$.quest.define: нужно поле id'); return null; }
            const def = {
                id: String(raw.id),
                title: raw.title || raw.id,
                kind: raw.kind === 'story' ? 'story' : 'side',
                giver: raw.giver === undefined ? '' : String(raw.giver),
                after: (raw.after || []).map(String),
                after_any: (raw.after_any || []).map(String),
                order: Number(raw.order) || 0,
                brief: raw.brief || '',
                objectives: (raw.objectives || []).map((o) => ({
                    kind: String(o.kind || 'fetch'),
                    item: o.item === undefined ? '' : String(o.item),
                    count: Math.max(1, Number(o.count) || 1),
                    map: o.map === undefined ? '' : String(o.map),
                    text: o.text || '',
                    object_id: o.object_id === undefined ? '' : String(o.object_id),
                })),
                reward: raw.reward || {},
                flags: raw.flags || {},
                requires_flags: (raw.requires_flags || []).map(String),
                requires_scenes: (raw.requires_scenes || []).map(String),
                excludes: (raw.excludes || []).map(String),
                merciful_branch: (raw.merciful_branch || []).map(String),
                lines: raw.lines || {},
                voice: raw.voice || {},
            };
            definitions.set(def.id, def);
            state(def.id);
            return def;
        },

        /** Описание по id (или null). */
        def(id) { return definitions.get(String(id)) || null; },

        /** Все описания в порядке `order`. */
        all() {
            return [...definitions.values()].sort((a, b) => a.order - b.order);
        },

        /** Состояние: `locked | available | active | ready | done`. */
        status(id) {
            const def = definitions.get(String(id));
            if (!def) return 'locked';
            const st = state(def.id);
            if (st.status === 'done') return 'done';
            // Взятое задание не пропадает, даже если ветка-близнец сдана раньше.
            if (st.status === 'active') return isReady(def.id) ? 'ready' : 'active';
            if (excluded(def)) return 'locked';
            for (const pre of def.after) {
                if (String(state(pre).status) !== 'done') return 'locked';
            }
            if (def.after_any.length) {
                let any = false;
                for (const pre of def.after_any) {
                    if (String(state(pre).status) === 'done') { any = true; break; }
                }
                if (!any) return 'locked';
            }
            for (const name of def.requires_flags) if (!flag(name)) return 'locked';
            for (const scene of def.requires_scenes) if (!seenScenes.includes(String(scene))) return 'locked';
            return 'available';
        },

        /**
         * Взять задание. Ставит `accept`-флаги и, если задано ветвление,
         * выбирает ветку по числу «милосердных» флагов.
         */
        accept(id) {
            const def = definitions.get(String(id));
            if (!def) { onLog(`$.quest.accept: нет задания "${id}"`); return false; }
            const status = book.status(def.id);
            if (status !== 'available') return false;
            state(def.id).status = 'active';
            for (const name of (def.flags.accept || [])) setFlag(name, true);
            if (def.merciful_branch.length >= 2) {
                setFlag(def.merciful_branch[mercifulCount() >= mercifulThreshold ? 0 : 1], true);
            }
            onLog(`$.quest: взято «${def.title}»`);
            return true;
        },

        /** Прогресс цели (по индексу). */
        progress(id, index, value) {
            const def = definitions.get(String(id));
            if (!def) return 0;
            if (value !== undefined) setGoal(def, index, value);
            return goalOf(def, index);
        },

        /** Все цели выполнены? */
        isReady(id) { return isReady(String(id)); },

        /** Сколько единиц цели сделано: `$.quest.done('relay', 0)`. */
        done(id, index) { return book.progress(id, index); },

        /**
         * Сдать задание: выдать награду и поставить флаги. Возвращает
         * `{ ok, money, items, trust }` или `{ ok: false, reason }`.
         */
        turnIn(id) {
            const def = definitions.get(String(id));
            if (!def) return { ok: false, reason: 'нет задания' };
            if (String(state(def.id).status) !== 'active') return { ok: false, reason: 'задание не взято' };
            if (!isReady(def.id)) return { ok: false, reason: 'цели не выполнены' };
            state(def.id).status = 'done';
            for (const name of (def.flags.done || [])) setFlag(name, true);
            const reward = def.reward || {};
            onLog(`$.quest: сдано «${def.title}»`);
            return {
                ok: true,
                money: Number(reward.money) || 0,
                items: reward.items || {},
                trust: Number(reward.trust) || 0,
                flags: (def.flags.done || []).slice(),
            };
        },

        /** Отменить задание (ушло в ветку-близнец). */
        cancel(id) {
            const def = definitions.get(String(id));
            if (!def) return false;
            if (String(state(def.id).status) !== 'active') return false;
            state(def.id).status = 'new';
            state(def.id).progress = [];
            return true;
        },

        /** Задания выдающего со статусом available/active/ready. */
        forGiver(giver) {
            const key = String(giver);
            return book.all().filter((d) => d.giver === key
                && ['available', 'active', 'ready'].includes(book.status(d.id)));
        },

        // --- События -----------------------------------------------------------
        /** Убийство на карте: +1 всем подходящим целям kind = 'kill'. */
        onKill(map) { return bump('kill', map, 1); },

        /** Эвакуация: +1 к extract и haul (если рюкзак дороже порога). */
        onExtract(map, bagValue) {
            const ready = bump('extract', map, 1);
            for (const def of book.all()) {
                if (String(state(def.id).status) !== 'active') continue;
                (def.objectives || []).forEach((o, i) => {
                    if (o.kind === 'haul' && Number(bagValue) >= o.count) {
                        setGoal(def, i, 1);
                        state(def.id).haul[i] = true;
                    }
                });
            }
            return collectReady(ready);
        },

        /** Пощажённые: +n к целям kind = 'spare'. */
        onSpare(map, n) {
            if (!(n > 0)) return [];
            return bump('spare', map, n);
        },

        /** Объект выключен: +1 к целям kind = 'object' с таким object_id. */
        onObject(map, objectId) {
            const ready = [];
            for (const def of book.all()) {
                if (String(state(def.id).status) !== 'active') continue;
                (def.objectives || []).forEach((o, i) => {
                    if (o.kind !== 'object') return;
                    if (o.map && map && o.map !== map) return;
                    if (o.object_id && objectId && o.object_id !== String(objectId)) return;
                    setGoal(def, i, goalOf(def, i) + 1);
                });
                if (isReady(def.id)) ready.push(def.id);
            }
            return ready;
        },

        /** Принесено предметов: `$.quest.onFetch('medkit', 2)`. */
        onFetch(item, count) {
            const key = String(item);
            const ready = [];
            for (const def of book.all()) {
                if (String(state(def.id).status) !== 'active') continue;
                (def.objectives || []).forEach((o, i) => {
                    if (o.kind !== 'fetch' || o.item !== key) return;
                    setGoal(def, i, goalOf(def, i) + (Number(count) || 1));
                });
                if (isReady(def.id)) ready.push(def.id);
            }
            return ready;
        },

        /** Снимок состояния для сейва: `$.save` кладёт это как есть. */
        save() {
            const out = {};
            for (const [id, st] of states) {
                if (st.status === 'new' && st.progress.every((v) => !v)) continue;
                out[id] = { status: st.status, progress: st.progress.slice() };
            }
            return out;
        },

        /** Восстановить состояние из сейва. */
        load(data) {
            if (!data || typeof data !== 'object') return book;
            for (const id of Object.keys(data)) {
                const entry = data[id] || {};
                const st = state(id);
                st.status = entry.status === undefined ? 'new' : String(entry.status);
                st.progress = Array.isArray(entry.progress) ? entry.progress.slice() : [];
            }
            return book;
        },

        /** Подпись цели: своя `text` или собранная по виду. */
        describe(objective) {
            const o = objective || {};
            if (o.text) return String(o.text);
            const where = o.map ? ` (${o.map})` : '';
            switch (o.kind) {
                case 'fetch': return `Принести: ${o.item} × ${o.count}`;
                case 'kill': return `Убить одичалых: ${o.count}${where}`;
                case 'haul': return `Вынести рюкзак дороже ${o.count} руб.`;
                case 'extract': return `Эвакуироваться${where}: ${o.count} раз`;
                case 'spare': return `Пощадить сдавшихся: ${o.count}${where}`;
                case 'object': return `Выключить: ${o.count}${where}`;
                default: return String(o.kind || '');
            }
        },

        /** Строка журнала: «Принести: medkit × 2 — 1/2». */
        line(id) {
            const def = definitions.get(String(id));
            if (!def) return '';
            const parts = (def.objectives || []).map((o, i) => {
                const need = Math.max(1, Number(o.count) || 1);
                return `${book.describe(o)} — ${goalOf(def, i)}/${need}`;
            });
            return parts.join('; ');
        },

        /** Сбросить всё (новая игра). */
        reset() {
            states.clear();
            for (const id of definitions.keys()) state(id);
            return book;
        },

        /** Определения и состояния — для отладки и тестов. */
        definitions: () => [...definitions.values()],
        stateOf: (id) => state(String(id)),
    };

    /** Общая часть событий: +n всем активным целям нужного вида. */
    function bump(kind, map, n) {
        const ready = [];
        for (const def of book.all()) {
            if (String(state(def.id).status) !== 'active') continue;
            (def.objectives || []).forEach((o, i) => {
                if (o.kind !== kind) return;
                if (o.map && map && o.map !== map) return;
                // `map` цели задан, а событие без карты — не считаем.
                if (o.map && !map) return;
                setGoal(def, i, goalOf(def, i) + (Number(n) || 0));
            });
            if (isReady(def.id)) ready.push(def.id);
        }
        return ready;
    }

    /** Дополнить список готовых теми, кто стал готов после события. */
    function collectReady(ready) {
        const out = ready.slice();
        for (const def of book.all()) {
            if (String(state(def.id).status) !== 'active') continue;
            if (isReady(def.id) && !out.includes(def.id)) out.push(def.id);
        }
        return out;
    }

    return book;
}

// ---------------------------------------------------------------------------
// Подсистема
// ---------------------------------------------------------------------------

export function installQuest($) {
    const book = createBook({
        flags: ($.story && $.story.flags) || {},
        seenScenes: [],
        onLog: (message) => ctx.log(message),
    });

    /** Подписка на игровые события: рейд зовёт `$.quest.onKill` и подобные. */
    const quest = Object.assign(Object.create(null), {
        define(def) { return book.define(def); },
        definitions() { return book.all(); },
        def(id) { return book.def(id); },
        status(id) { return book.status(id); },
        accept(id) { return book.accept(id); },
        cancel(id) { return book.cancel(id); },
        turnIn(id) { return book.turnIn(id); },
        isReady(id) { return book.isReady(id); },
        progress(id, index, value) { return book.progress(id, index, value); },
        line(id) { return book.line(id); },
        describe(objective) { return book.describe(objective); },
        forGiver(giver) { return book.forGiver(giver); },
        onKill(map) { return book.onKill(map); },
        onExtract(map, bag) { return book.onExtract(map, bag); },
        onSpare(map, n) { return book.onSpare(map, n); },
        onObject(map, objectId) { return book.onObject(map, objectId); },
        onFetch(item, count) { return book.onFetch(item, count); },
        save() { return book.save(); },
        load(data) { return book.load(data); },
        reset() { return book.reset(); },

        /**
         * Загрузить пачку заданий из JSON: `$.quest.load('quests.json')` или
         * `$.quest.load([{...}, {...}])`. Поддерживает `{ quests: [...] }`.
         */
        loadFile(source) {
            let data = source;
            if (typeof source === 'string') {
                const fs = $.fs || ctx.fs;
                if (!fs || typeof fs.readJSON !== 'function') {
                    ctx.log('$.quest.loadFile: нет $.fs — передайте данные как объект');
                    return 0;
                }
                const from = source.indexOf('{') === 0 ? source : null;
                data = from ? JSON.parse(from) : fs.readJSON(source, null);
                if (!data) {
                    ctx.log(`$.quest.loadFile: не удалось прочитать «${source}»`);
                    return 0;
                }
            }
            const list = Array.isArray(data) ? data : (data && data.quests) || [];
            let count = 0;
            for (const def of list) if (book.define(def)) count++;
            return count;
        },

        /** Ядро без движка: для тестов и своих хранилищ. */
        createBook,
    });

    $.quest = quest;
    ctx.quest = quest;
    return quest;
}
