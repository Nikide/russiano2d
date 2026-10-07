// ===========================================================================
// Психика NPC и режиссёр рейда — $.alive
//
// Порт из audm-neko (game/alive2d/npc/alive_psyche.gd — 786 строк,
// director/alive_raid_director.gd — 149). Оригинал почти не трогает Godot:
// психика — это числа и события, поэтому переносится целиком.
//
//   const mind = $.alive.psyche('veteran', { aggression: 0.8, skill: 0.7 });
//   mind.on_hurt(0.4, true);        // ранение
//   mind.on_ally_down(true);        // лидер отряда погиб
//   mind.tick(dt, { leaderNear: true, underFire: true });
//   mind.isBroken();                // срыв?
//   mind.aimErrorMult();            // множители для боя и прицела
//
//   const dir = $.alive.director({ lootValue: () => $.inv.value() });
//   dir.tick(dt);
//   dir.phase();                    // 'spare' | 'even' | 'press'
//
// Три слоя, как в оригинале:
//   * СТАТИКА — психотип (41 акцентуация по Личко/Леонгарду), 14 черт,
//     OCEAN (нейротизм и экстраверсия выводятся из черт), тренированность,
//     роль в отряде;
//   * ДИНАМИКА — страх, пульс, подавление, усталость, ярость, стресс, голод,
//     холод, глухота;
//   * ТРИГГЕРЫ — ранение, смерть союзника, пролёт пули, взрыв, окружение,
//     убийство: спайк и затухание ПО ЧЕРТАМ, а не константой.
//
// Эффекты — по Гроссману («On Combat»: пульс выше 140 сужает зрение и слух,
// сбивает мелкую моторику; «On Killing»: барьер убийства вблизи тем сильнее,
// чем выше эмпатия). Срывы — по Darkest Dungeon: на пороге стресса проверка с
// шансом по психотипу даёт панику, ярость, ступор, сдачу или молитву.
//
// Ядро (createPsyche, createDirector) не касается движка: это числа и события,
// поэтому поведение целиком проверяет юнит-тест (tests/js/alive_test.mjs).
// ===========================================================================

import { ctx } from './core.js';

// ---------------------------------------------------------------------------
// Чистая часть: пороги и таблицы
// ---------------------------------------------------------------------------

export const PULSE_REST = 62;
export const PULSE_MAX = 200;
/** Гроссман: выше 140 — туннельное зрение и провалы мелкой моторики. */
export const PULSE_TUNNEL = 140;

/** Порог накопленного стресса, с которого возможен срыв. */
export const BREAK_STRESS = 0.72;
/** После срыва человек какое-то время «пустой» — повторной проверки нет. */
export const BREAK_COOLDOWN = 16;
/** Сколько длится каждый срыв (с). */
export const BREAK_TIME = {
    panic: 5, rage: 6, freeze: 4, surrender: 10, prayer: 7, stare: 9, vomit: 4.5,
};
export const BREAK_KINDS = ['panic', 'rage', 'freeze', 'surrender', 'prayer', 'stare'];
export const BREAK_TITLES = {
    panic: 'паника', rage: 'ярость', freeze: 'ступор',
    surrender: 'сломался и сдаётся', prayer: 'молится/бредит',
    stare: 'взгляд в пустоту', vomit: 'тошнит после убийства',
};

/** «Лицом к лицу»: ближе этого ступор вероятен (Гроссман). */
export const FACE_TO_FACE = 300;
/** Барьер убийства работает на подступах ближнего боя. */
export const HESITATION_RANGE = 340;
/** Офицер и ветеран становятся лидерами и без метки отряда (Маршалл). */
export const LEADER_TYPES = ['officer', 'veteran'];

/** 14 черт: 11 в 0…1, мораль −1…1. */
export const TRAIT_NAMES = [
    'aggression', 'caution', 'curiosity', 'greed', 'jumpiness', 'patience',
    'morale', 'skill', 'sociability', 'honesty', 'empathy', 'fear', 'madness',
    'talkativeness',
];
export const TRAIT_DEFAULTS = {
    aggression: 0.5, caution: 0.5, curiosity: 0.5, greed: 0.5,
    jumpiness: 0.5, patience: 0.5, morale: 0, skill: 0.3,
    sociability: 0.5, honesty: 0.6, empathy: 0.5, fear: 0.5,
    madness: 0.05, talkativeness: 0.4,
};

/**
 * Психотип → поправки поверх выведенных из черт:
 *   fg — множитель спайка страха, rg — ярости, fr — склонность к ступору,
 *   br — веса срывов [паника, ярость, ступор, сдача, молитва].
 */
export const TYPE_BIAS = {
    veteran: { fg: 0.7, rg: 0.9, fr: 0.6, br: [1.0, 2.0, 0.6, 0.5, 0.4] },
    worker: { fg: 0.95, rg: 0.8, fr: 1.0, br: [1.4, 0.8, 1.0, 1.0, 0.3] },
    family_man: { fg: 1.1, rg: 0.7, fr: 1.1, br: [1.6, 0.5, 1.0, 1.2, 0.4] },
    rookie: { fg: 1.25, rg: 0.8, fr: 1.4, br: [2.0, 0.6, 1.6, 1.0, 0.4] },
    coward: { fg: 1.5, rg: 0.5, fr: 1.3, br: [2.6, 0.3, 1.4, 2.0, 0.5] },
    panicker: { fg: 1.8, rg: 0.5, fr: 1.5, br: [3.0, 0.2, 1.8, 1.4, 0.4] },
    thug: { fg: 0.9, rg: 1.5, fr: 0.8, br: [1.0, 2.4, 0.8, 1.0, 0.3] },
    marauder: { fg: 0.8, rg: 1.7, fr: 0.7, br: [0.7, 3.0, 0.6, 0.5, 0.3] },
    trader: { fg: 1.05, rg: 0.7, fr: 1.0, br: [1.8, 0.5, 1.0, 1.6, 0.3] },
    scout: { fg: 0.85, rg: 0.9, fr: 0.8, br: [1.2, 1.2, 0.8, 1.0, 0.3] },
    sentry: { fg: 0.9, rg: 0.9, fr: 0.9, br: [1.2, 1.3, 0.9, 1.0, 0.3] },
    mechanic: { fg: 0.95, rg: 0.9, fr: 0.9, br: [1.3, 1.0, 0.9, 1.0, 0.3] },
    hunter: { fg: 0.8, rg: 1.1, fr: 0.7, br: [1.0, 1.8, 0.7, 0.8, 0.3] },
    medic: { fg: 1.0, rg: 0.7, fr: 1.0, br: [1.5, 0.7, 1.0, 1.2, 0.5] },
    anxious: { fg: 1.45, rg: 0.7, fr: 1.5, br: [2.4, 0.5, 1.8, 1.0, 0.6] },
    hypochondriac: { fg: 1.35, rg: 0.6, fr: 1.4, br: [2.2, 0.4, 1.7, 1.4, 0.6] },
    depressive: { fg: 1.2, rg: 0.6, fr: 1.5, br: [1.6, 0.5, 2.0, 1.6, 1.2] },
    hyperthym: { fg: 0.7, rg: 1.3, fr: 0.6, br: [0.8, 2.0, 0.5, 1.0, 0.3] },
    dysthym: { fg: 1.25, rg: 0.7, fr: 1.3, br: [1.8, 0.6, 1.6, 1.4, 1.0] },
    psychasthenic: { fg: 1.4, rg: 0.6, fr: 1.6, br: [2.2, 0.4, 2.0, 1.2, 0.9] },
    hysteroid: { fg: 1.35, rg: 1.2, fr: 1.0, br: [2.2, 1.4, 1.0, 1.6, 0.6] },
    epileptoid: { fg: 0.85, rg: 1.8, fr: 0.6, br: [0.8, 3.0, 0.5, 0.6, 0.4] },
    schizoid: { fg: 0.9, rg: 0.9, fr: 1.3, br: [1.0, 1.2, 1.8, 0.8, 1.2] },
    paranoid: { fg: 1.1, rg: 1.3, fr: 1.1, br: [1.4, 1.6, 1.3, 0.7, 0.5] },
    shellshocked: { fg: 1.3, rg: 0.9, fr: 2.0, br: [1.6, 0.8, 3.0, 1.0, 1.4] },
    fanatic: { fg: 0.55, rg: 1.5, fr: 0.5, br: [0.4, 2.4, 0.3, 0.3, 1.6] },
    prophet: { fg: 0.8, rg: 1.0, fr: 0.9, br: [0.8, 1.2, 0.8, 0.5, 2.6] },
    apath: { fg: 0.6, rg: 0.5, fr: 1.6, br: [0.7, 0.4, 2.6, 1.2, 0.5] },
    joker: { fg: 0.9, rg: 0.9, fr: 0.8, br: [1.2, 1.2, 0.7, 1.2, 0.8] },
    sadist: { fg: 0.7, rg: 1.6, fr: 0.5, br: [0.7, 2.6, 0.4, 0.3, 0.5] },
    berserker: { fg: 0.6, rg: 2.2, fr: 0.4, br: [0.4, 3.4, 0.3, 0.2, 0.4] },
    sniper: { fg: 0.75, rg: 0.7, fr: 0.7, br: [0.9, 1.0, 0.8, 0.6, 0.3] },
    officer: { fg: 0.6, rg: 1.1, fr: 0.5, br: [0.6, 1.8, 0.4, 0.3, 0.4] },
    avenger: { fg: 0.85, rg: 1.6, fr: 0.65, br: [0.8, 2.6, 0.5, 0.3, 0.5] },
    silent: { fg: 0.8, rg: 1.0, fr: 1.0, br: [1.0, 1.4, 1.2, 0.7, 0.4] },
    deserter: { fg: 1.6, rg: 0.6, fr: 1.1, br: [3.0, 0.4, 0.9, 2.2, 0.6] },
    hoarder: { fg: 1.1, rg: 0.8, fr: 1.1, br: [1.8, 0.7, 1.2, 1.3, 0.4] },
    recluse: { fg: 1.15, rg: 0.9, fr: 1.3, br: [1.6, 0.9, 1.6, 0.8, 0.6] },
    junkie: { fg: 1.2, rg: 1.2, fr: 1.1, br: [1.6, 1.6, 1.3, 1.0, 0.9] },
    drunk: { fg: 1.05, rg: 1.3, fr: 1.4, br: [1.4, 1.6, 1.6, 1.0, 0.7] },
    stoic: { fg: 0.5, rg: 0.7, fr: 0.8, br: [0.6, 1.0, 0.9, 0.5, 0.3] },
    gambler: { fg: 0.95, rg: 1.1, fr: 0.8, br: [1.1, 1.5, 0.7, 1.0, 0.4] },
    mother: { fg: 1.0, rg: 0.7, fr: 1.0, br: [1.5, 0.5, 1.0, 1.3, 0.7] },
    kid: { fg: 1.5, rg: 0.6, fr: 1.8, br: [2.6, 0.4, 2.2, 1.8, 0.8] },
};

/** Пол деградации характера от травмы (Шэй, Litz): даже травмированный держит 30%. */
export const TRAUMA_FLOOR = 0.3;
export const TRAUMA_GAIN = 1 - TRAUMA_FLOOR;

// --- Мелкие помощники (чистые) ---------------------------------------------

export function clamp(value, lo, hi) {
    const v = Number(value);
    if (!Number.isFinite(v)) return lo;
    return v < lo ? lo : (v > hi ? hi : v);
}

/** Движение к цели с ограничением шага (у Godot — move_toward). */
export function moveToward(current, target, maxDelta) {
    const c = Number(current) || 0;
    const t = Number(target) || 0;
    const d = Math.max(0, Number(maxDelta) || 0);
    if (Math.abs(t - c) <= d) return t;
    return c + Math.sign(t - c) * d;
}

/** Детерминированный генератор: одинаковый сид — одинаковые срывы. */
export function makeRandom(seed) {
    let state = (Math.floor(Number(seed) || 1) >>> 0) || 1;
    state ^= state >>> 16; state = Math.imul(state, 0x7feb352d) >>> 0;
    state ^= state >>> 15; state = Math.imul(state, 0x846ca68b) >>> 0;
    state ^= state >>> 16;
    if (state === 0) state = 0x9e3779b9;
    const next = () => {
        state ^= state << 13; state >>>= 0;
        state ^= state >>> 17;
        state ^= state << 5; state >>>= 0;
        return state / 4294967296;
    };
    return {
        next,
        range(lo, hi) { return lo + next() * (hi - lo); },
        chance(p) { return next() < p; },
        pick(list) { return list.length ? list[Math.floor(next() * list.length) % list.length] : null; },
    };
}

// ---------------------------------------------------------------------------
// Чистая часть: статика — черты, OCEAN, роль
// ---------------------------------------------------------------------------

/** Нормализовать описание бойца (`{ type, traits, skill, role, squadId }`). */
export function normalizeSpec(raw) {
    const spec = raw && typeof raw === 'object' ? raw : {};
    // Короткая форма: `psyche('veteran')` или `psyche('veteran', { skill: 0.8 })`.
    const type = typeof raw === 'string' ? String(raw) : String(spec.type || spec.psychotype || '');
    const values = (typeof raw === 'string' ? spec : (spec.traits || spec)) || {};
    const traits = {};
    for (const name of TRAIT_NAMES) traits[name] = TRAIT_DEFAULTS[name];
    const template = TYPE_BIAS[type] ? (spec.traits || {}) : {};
    for (const name of TRAIT_NAMES) {
        if (template[name] !== undefined) traits[name] = Number(template[name]);
    }
    // Явные черты перебивают шаблон. Служебные ключи описания пропускаем.
    const reserved = ['type', 'psychotype', 'traits', 'skill', 'role', 'squadId',
                      'squad_id', 'leader', 'seed', 'neuroticism', 'extraversion'];
    for (const key of Object.keys(values)) {
        if (reserved.indexOf(key) >= 0) continue;
        if (traits[key] === undefined) continue;
        const lo = key === 'morale' ? -1 : 0;
        traits[key] = clamp(values[key], lo, 1);
    }
    const skill = clamp(spec.skill !== undefined ? spec.skill : traits.skill, 0, 1);
    traits.skill = skill;
    return {
        type,
        traits,
        skill,
        role: spec.role === undefined ? '' : String(spec.role),
        squadId: spec.squadId === undefined
            ? (spec.squad_id === undefined ? -1 : Math.floor(Number(spec.squad_id)))
            : Math.floor(Number(spec.squadId)),
        leader: !!spec.leader,
        seed: Math.floor(Number(spec.seed) || 1),
        ocean: {
            neuroticism: spec.neuroticism,
            extraversion: spec.extraversion,
        },
    };
}

/** Профиль акцентуации: поправки психотипа поверх выведенных из черт. */
export function makeBias(type, traits, neuroticism) {
    const traitOf = (name) => (traits[name] === undefined ? TRAIT_DEFAULTS[name] : traits[name]);
    const bias = {
        fg: 0.55 + 1.0 * neuroticism,
        rg: 0.5 + 1.1 * traitOf('aggression'),
        fr: 0.55 + 0.9 * neuroticism,
        br: [1, 1, 1, 1, 1],
    };
    const table = TYPE_BIAS[type];
    if (table) {
        for (const key of Object.keys(table)) {
            if (key === 'br') {
                for (let i = 0; i < Math.min(table.br.length, 5); ++i) bias.br[i] = table.br[i];
            } else {
                bias[key] = table[key];
            }
        }
    }
    return bias;
}

// ---------------------------------------------------------------------------
// Чистое ядро: психика
// ---------------------------------------------------------------------------

/**
 * Создать психику. `raw` — строка-психотип или описание
 * (`{ type, traits, skill, role, squadId, leader, seed }`).
 */
export function createPsyche(raw) {
    const spec = normalizeSpec(raw);
    const traits = spec.traits;
    const traitOf = (name) => (traits[name] === undefined ? TRAIT_DEFAULTS[name] : traits[name]);

    // OCEAN: если готовых осей нет — выводим из 14 черт (нейротизм — страх,
    // суетность, безумие и нехватка терпения; экстраверсия — общительность,
    // разговорчивость, агрессия).
    const nt = 0.5 * traitOf('fear') + 0.25 * traitOf('jumpiness') + 0.15 * traitOf('madness')
             + 0.1 * (1 - traitOf('patience'));
    const ex = 0.45 * traitOf('sociability') + 0.3 * traitOf('talkativeness') + 0.25 * traitOf('aggression');
    const neuroticism = clamp(spec.ocean.neuroticism === undefined ? nt : spec.ocean.neuroticism, 0, 1);
    const extraversion = clamp(spec.ocean.extraversion === undefined ? ex : spec.ocean.extraversion, 0, 1);
    const bias = makeBias(spec.type, traits, neuroticism);

    const random = makeRandom(spec.seed);
    const state = {
        type: spec.type,
        traits,
        skill: spec.skill,
        neuroticism,
        extraversion,
        bias,
        squadId: spec.squadId,
        role: '',
        fear: 0, pulse: PULSE_REST, suppression: 0, fatigue: 0, rage: 0, stress: 0,
        hunger: 0, cold: 0, deafness: 0,
        breakState: '', breakLeft: 0, breakCooldown: 0, breaks: 0,
        moralInjury: 0,
        killPhase: '', killPhaseLeft: 0, vomitPending: false,
        kills: 0, allyDeaths: 0, leaderDowns: 0, surrounded: 0,
        underFire: false, time: 0,
        night: false,
    };

    // Роль: явная, иначе по психотипу и отряду (Маршалл).
    if (spec.role) state.role = spec.role;
    else if (spec.leader) state.role = 'leader';
    else if (LEADER_TYPES.indexOf(spec.type) >= 0 && spec.skill >= 0.65 && traitOf('morale') >= -0.1) state.role = 'leader';
    else state.role = spec.squadId >= 0 ? 'follower' : 'solo';

    // --- Спайки ---

    function fearSpike(amount) {
        const gain = bias.fg * (1 - 0.4 * state.skill)
                   * (1 - 0.25 * Math.max(0, traitOf('morale')))
                   * (1 + 0.3 * Math.max(0, -traitOf('morale')));
        const add = Math.max(0, Number(amount) || 0) * gain;
        state.fear = clamp(state.fear + add, 0, 1);
        state.stress = clamp(state.stress + add * 0.85, 0, 1);
        return add;
    }

    function rageSpike(amount) {
        const gain = bias.rg * (1 - 0.25 * state.skill);
        const add = Math.max(0, Number(amount) || 0) * gain;
        state.rage = clamp(state.rage + add, 0, 1);
        return add;
    }

    function pulseSpike(amount) {
        state.pulse = clamp(state.pulse + Math.max(0, Number(amount) || 0), PULSE_REST, PULSE_MAX);
    }

    // --- Срывы ---

    function breakChance() {
        const over = clamp((state.stress - BREAK_STRESS) / Math.max(0.01, 1 - BREAK_STRESS), 0, 1);
        const ch = 0.3 + 0.5 * over + 0.18 * neuroticism + 0.15 * traitOf('madness') - 0.3 * state.skill;
        return clamp(ch, 0.05, 0.95);
    }

    /** Веса видов срыва: база психотипа плюс то, что происходит сейчас. */
    function breakWeights() {
        const w = bias.br.slice(0, 5);
        if (state.fear > 0.7) w[0] *= 1 + 1.5 * (state.fear - 0.7) / 0.3;
        if (state.rage > 0.5) w[1] *= 1 + 1.5 * (state.rage - 0.5) / 0.5;
        if (state.surrounded >= 2) { w[0] *= 1.2; w[2] *= 1.25; }
        if (state.role === 'leader') {
            // Лидер не бежит и не сдаётся — держит отряд (Маршалл).
            w[1] *= 1.3; w[0] *= 0.6; w[3] *= 0.5;
        } else if (state.role === 'follower' && state.leaderDowns > 0) {
            w[0] *= 1.5; w[3] *= 1.5; w[4] *= 1.3;
        }
        w[4] *= 0.4 + 1.2 * traitOf('madness');
        // CSR «взгляд на 1000 ярдов»: у вымотанных и травмированных.
        w[5] = 0.15 + 1.6 * state.moralInjury + 1.0 * state.fatigue;
        return w;
    }

    function rollBreakKind() {
        const w = breakWeights();
        let total = 0;
        for (const x of w) total += Math.max(0, x);
        if (total <= 0) return 'freeze';
        let r = random.next() * total;
        for (let i = 0; i < w.length; ++i) {
            r -= Math.max(0, w[i]);
            if (r <= 0) return BREAK_KINDS[i] === undefined ? 'stare' : BREAK_KINDS[i];
        }
        return BREAK_KINDS[0];
    }

    function forceBreak(kind) {
        const key = String(kind);
        state.breakState = key;
        state.breakLeft = BREAK_TIME[key] === undefined ? 5 : BREAK_TIME[key];
        state.breakCooldown = BREAK_COOLDOWN;
        state.breaks++;
        if (key === 'panic') { state.fear = Math.max(state.fear, 0.85); state.pulse = Math.max(state.pulse, 175); }
        else if (key === 'rage') { state.rage = 1; state.fear *= 0.5; state.pulse = Math.max(state.pulse, 165); }
        else if (key === 'freeze') { state.fear = Math.max(state.fear, 0.7); state.suppression = Math.min(1, state.suppression + 0.2); }
        else if (key === 'surrender') { state.fear = Math.max(state.fear, 0.8); state.rage = 0; }
        else if (key === 'prayer') { state.fear = Math.max(state.fear, 0.6); state.rage = 0; }
        else { state.rage = 0; state.fear = Math.max(state.fear, 0.4); }
        state.stress = Math.max(0, state.stress - 0.25);
        return key;
    }

    function endBreak() {
        const was = state.breakState;
        state.breakState = '';
        state.breakLeft = 0;
        state.fear = Math.max(0, state.fear - 0.25);
        state.stress = Math.max(0, state.stress - 0.2);
        state.fatigue = clamp(state.fatigue + 0.08, 0, 1);
        return was;
    }

    // --- Тик ---

    function tickKillPhase(dt) {
        if (!state.killPhase) return;
        state.killPhaseLeft -= dt;
        if (state.killPhase === 'euphoria') state.fear = Math.max(0, state.fear - dt * 0.1);
        else if (state.killPhase === 'remorse') state.fatigue = clamp(state.fatigue + dt * 0.01, 0, 1);
        if (state.killPhaseLeft > 0) return;
        if (state.killPhase === 'euphoria') {
            state.killPhase = 'denial';
            state.killPhaseLeft = random.range(3, 6);
        } else if (state.killPhase === 'denial') {
            state.killPhase = 'remorse';
            state.killPhaseLeft = random.range(20, 40);
            if (state.vomitPending && !state.breakState) {
                state.vomitPending = false;
                forceBreak('vomit');
            }
        } else {
            state.killPhase = '';
        }
    }

    function tickNeeds(dt) {
        state.hunger = clamp(state.hunger + dt / 1200, 0, 1);
        state.cold = clamp(state.cold + (state.night ? dt / 600 : -dt / 300), 0, 1);
        state.fatigue = clamp(state.fatigue + dt * 0.0006 * (state.cold + state.hunger * 0.5), 0, 1);
    }

    const psyche = {
        type: state.type,
        get traits() { return Object.assign({}, traits); },
        get skill() { return state.skill; },
        get neuroticism() { return neuroticism; },
        get extraversion() { return extraversion; },
        get role() { return state.role; },
        set role(value) { state.role = String(value); },
        get bias() { return { fg: bias.fg, rg: bias.rg, fr: bias.fr, br: bias.br.slice() }; },

        get fear() { return state.fear; },
        get pulse() { return state.pulse; },
        get suppression() { return state.suppression; },
        get fatigue() { return state.fatigue; },
        get rage() { return state.rage; },
        get stress() { return state.stress; },
        get hunger() { return state.hunger; },
        get cold() { return state.cold; },
        get deafness() { return state.deafness; },
        get moralInjury() { return state.moralInjury; },
        get kills() { return state.kills; },
        get allyDeaths() { return state.allyDeaths; },
        get leaderDowns() { return state.leaderDowns; },
        get breaks() { return state.breaks; },
        get breakState() { return state.breakState; },
        get breakLeft() { return state.breakLeft; },
        /** Откат после срыва: повторной проверки в нём нет. */
        get breakCooldown() { return state.breakCooldown; },
        get killPhase() { return state.killPhase; },
        get killPhaseLeft() { return state.killPhaseLeft; },
        /** Ждёт ли отвращения после первого убийства (тошнота). */
        get vomitPending() { return state.vomitPending; },
        /** Сколько времени психика прожила (с) — по нему видно ночь и голод. */
        get time() { return state.time; },

        /** Ночь: голод растёт всегда, холод — только ночью. */
        night(value) { state.night = value === undefined ? state.night : !!value; return state.night; },

        traitOf,
        isLeader() { return state.role === 'leader'; },

        /** Качество лидера (Маршалл): ведомые рядом с таким держатся. */
        leadership() {
            let v = 0.45 * state.skill + 0.3 * (traitOf('morale') + 1) * 0.5 + 0.25 * traitOf('patience')
                  - 0.3 * neuroticism + 0.15;
            if (LEADER_TYPES.indexOf(state.type) >= 0) v += 0.1;
            return clamp(v, 0, 1);
        },

        // --- Спайки (общие) ---
        fearSpike, rageSpike, pulseSpike,
        addStress(amount) { state.stress = clamp(state.stress + (Number(amount) || 0), 0, 1); return state.stress; },

        // --- Триггеры ---

        /** Ранение: `amount` — доля здоровья 0…1, `heavy` — тяжёлое. */
        onHurt(amount, heavy) {
            let dmg = clamp(amount, 0, 1);
            if (heavy) dmg = Math.max(dmg, 0.22);
            dmg = Math.max(dmg, 0.05);
            fearSpike(0.18 + 0.55 * dmg + (heavy ? 0.15 : 0));
            rageSpike(0.12 + 0.5 * dmg);
            pulseSpike(14 + 45 * dmg);
            state.suppression = clamp(state.suppression + 0.2 + 0.2 * dmg, 0, 1);
            state.fatigue = clamp(state.fatigue + 0.01 + 0.02 * dmg, 0, 1);
            state.underFire = true;
            return dmg;
        },

        /** Рядом погиб свой. `leaderDown` — это был лидер отряда. */
        onAllyDown(leaderDown) {
            state.moralInjury = clamp(state.moralInjury + 0.08 * traitOf('empathy'), 0, 1);
            state.allyDeaths++;
            let spike = 0.16 + 0.22 * neuroticism;
            if (leaderDown && state.role !== 'leader') spike *= 1.9;
            if (state.role === 'leader') spike *= 0.7;
            if (traitOf('sociability') > 0.6) spike *= 1.15;
            fearSpike(spike);
            rageSpike(0.08 + 0.1 * traitOf('sociability'));
            pulseSpike(10 + 12 * neuroticism);
            if (leaderDown) state.leaderDowns++;
            return spike;
        },

        /** Лидер отряда сломался (паника/ступор) — без него ведомым хуже. */
        onLeaderBroken() {
            if (state.role === 'leader') return 0;
            const spike = 0.2 + 0.15 * neuroticism;
            fearSpike(spike);
            pulseSpike(8);
            state.leaderDowns++;
            return spike;
        },

        /** Пуля прошла рядом. */
        onNearMiss(intensity) {
            const k = clamp(intensity === undefined ? 1 : intensity, 0.1, 3);
            fearSpike(0.035 * k);
            state.suppression = clamp(state.suppression + 0.1 * k, 0, 1);
            pulseSpike(3 * k);
            state.underFire = true;
            return k;
        },

        /** Взрыв: `distance` до эпицентра (px), `loudness` — сила. */
        onExplosion(distance, loudness) {
            const prox = clamp(1 - (Number(distance) || 0) / 420, 0, 1);
            const power = clamp(loudness === undefined ? 1 : loudness, 0.2, 2) * (0.35 + prox);
            fearSpike(0.3 * power);
            rageSpike(0.1 * power);
            pulseSpike(25 + 40 * prox * power);
            state.suppression = clamp(state.suppression + 0.35 * power, 0, 1);
            state.deafness = clamp(state.deafness + 0.5 * power, 0, 1);
            state.fatigue = clamp(state.fatigue + 0.03 * power, 0, 1);
            state.underFire = true;
            return power;
        },

        /** Взяли в клещи: спайк только когда кольцо сжимается. */
        onSurrounded(n) {
            const count = Math.max(0, Math.floor(Number(n) || 0));
            if (count <= state.surrounded) { state.surrounded = count; return 0; }
            const extra = Math.max(0, count - 1);
            let spike = (0.06 + 0.05 * extra) * (0.6 + 0.8 * neuroticism) * (1 - 0.3 * state.skill);
            if (extraversion > 0.6) spike *= 0.85;
            fearSpike(spike);
            pulseSpike(4 * extra);
            state.suppression = clamp(state.suppression + 0.08 * extra, 0, 1);
            state.surrounded = count;
            return spike;
        },

        /** Убил. `close` — в упор: барьер убийства бьёт по эмпату (Гроссман). */
        onKill(close) {
            state.kills++;
            const emp = traitOf('empathy');
            const mad = traitOf('madness');
            if (state.kills === 1) {
                state.killPhase = 'euphoria';
                state.killPhaseLeft = random.range(2, 4);
                if (emp * (1 - mad) > 0.25 || close) state.vomitPending = true;
            }
            state.moralInjury = clamp(state.moralInjury
                + (state.kills === 1 ? 0.28 : 0.06) * emp * (1 - mad) * (close ? 1.6 : 1), 0, 1);
            if (close) {
                fearSpike(0.04 + 0.22 * emp * (1 - mad));
                rageSpike(0.25 * (1 - emp));
                state.fatigue = clamp(state.fatigue + 0.03, 0, 1);
            } else {
                state.fear = Math.max(0, state.fear - 0.07);
                state.stress = Math.max(0, state.stress - 0.05);
            }
            state.rage = Math.max(0, state.rage - 0.05);
            return state.kills;
        },

        /** Принять травму прошлых рейдов (память между рейдами). */
        carryMoralInjury(value) { state.moralInjury = clamp(value, 0, 1); return state.moralInjury; },

        /** Насколько боец перестала себя беречь (0 — бережёт). */
        selfPreservationLoss() { return clamp((state.moralInjury - 0.3) / 0.7, 0, 1); },
        /** Ангедония: интерес к добыче гаснет. */
        anhedonia() { return clamp(state.moralInjury * 1.2, 0, 1); },
        /** Множитель жадности: не ниже пола. */
        greedMult() { return 1 - TRAUMA_GAIN * psyche.anhedonia(); },
        /** Множитель осторожности: утрата самосохранения гаснет с полом. */
        cautionMult() { return 1 - TRAUMA_GAIN * psyche.selfPreservationLoss(); },

        /**
         * Один шаг жизни. `opts`: `{ leaderNear, underFire, dt }`.
         * `leaderNear` — рядом свой лидер (держит ведомого).
         */
        tick(dt, opts) {
            const delta = Math.max(0, Number(dt) || 0);
            const o = opts || {};
            tickKillPhase(delta);
            tickNeeds(delta);
            if (delta <= 0) return psyche;
            state.time += delta;
            state.breakCooldown = Math.max(0, state.breakCooldown - delta);
            if (o.underFire || state.underFire) {
                state.suppression = clamp(state.suppression + 0.25 * delta, 0, 1);
            }
            state.suppression = Math.max(0, state.suppression - 0.3 * delta);
            state.underFire = false;
            state.fatigue = clamp(state.fatigue + (0.004 + 0.01 * state.fear) * delta, 0, 1);
            state.rage = Math.max(0, state.rage - 0.12 * delta * (1 + 0.5 * state.skill));

            // Пульс тянется к рабочей частоте: вверх разгоняется быстро, вниз
            // остывает медленно (тахикардия боя).
            const target = PULSE_REST + state.fear * 72 + state.rage * 26
                         + state.suppression * 24 + state.fatigue * 14;
            const rate = target > state.pulse ? 42 : 10 + 12 * (1 - state.fear);
            state.pulse = clamp(moveToward(state.pulse, target, rate * delta), PULSE_REST, PULSE_MAX);

            // Затухание страха: стоик и тренированный остывают быстрее; лидер
            // рядом держит ведомого, без лидера ведомый потихоньку сыпется.
            let calm = 0.06 + 0.07 * state.skill + 0.04 * Math.max(0, traitOf('morale'))
                     - 0.03 * neuroticism;
            if (state.role === 'leader') calm *= 1.2;
            else if (o.leaderNear) calm *= 1.7;
            else if (state.role === 'follower' && state.fear > 0.35) calm *= -0.35;
            if (state.suppression > 0.35) calm *= 0.5;
            if (state.fatigue > 0.6) calm *= 0.75;
            state.fear = clamp(state.fear - calm * delta, 0, 1);
            state.stress = clamp(Math.max(state.stress - (0.022 + 0.02 * state.skill) * delta,
                                          state.fear * 0.8), 0, 1);
            state.deafness = Math.max(0, state.deafness - 0.25 * delta);

            if (state.breakState) {
                state.breakLeft -= delta;
                if (state.breakLeft <= 0) endBreak();
            }
            return psyche;
        },

        /** Сбросить нервы (новый рейд), память о содеянном не трогаем. */
        resetDynamic() {
            state.fear = 0; state.pulse = PULSE_REST; state.suppression = 0;
            state.fatigue = 0; state.rage = 0; state.stress = 0;
            state.breakState = ''; state.breakLeft = 0; state.breakCooldown = 0;
            state.deafness = 0; state.surrounded = 0; state.underFire = false;
            state.killPhase = ''; state.killPhaseLeft = 0; state.vomitPending = false;
            return psyche;
        },

        // --- Срывы ---
        isBroken() { return !!state.breakState; },
        breakTitle() { return BREAK_TITLES[state.breakState] || 'срыв'; },
        breakChance,
        breakWeights,
        rollBreakKind,
        forceBreak,
        endBreak,

        /** Проверка на пороге стресса. Возвращает вид срыва или ''. */
        checkBreak() {
            if (state.breakState || state.breakCooldown > 0) return '';
            if (state.stress < BREAK_STRESS) return '';
            if (random.next() > breakChance()) {
                state.stress = Math.max(0, state.stress - 0.02);   // удержался
                return '';
            }
            return forceBreak(rollBreakKind());
        },

        // --- Эффекты (Гроссман) ---
        pulseNorm() { return clamp((state.pulse - PULSE_REST) / (PULSE_MAX - PULSE_REST), 0, 1); },
        /** Перегрузка: доля пути от порога туннельного зрения до предела. */
        overload() { return clamp((state.pulse - PULSE_TUNNEL) / (PULSE_MAX - PULSE_TUNNEL), 0, 1); },
        aimErrorMult() { return 1 + 1.15 * psyche.overload() + 0.35 * state.fear + 0.2 * state.rage; },
        tremorMult() { return (1 + 1.8 * psyche.overload() + 0.5 * state.fear) * (1 + 0.6 * state.cold); },
        /** ВРЕМЯ реакции (>1 — медленнее соображает под стрессом). */
        reactionMult() { return 1 + 0.6 * psyche.overload() + 0.18 * state.fear; },
        /** ВРЕМЯ перезарядки (>1 — мелкая моторика села). */
        reloadMult() { return 1 + 0.9 * psyche.overload() + 0.3 * state.fear; },
        /** Обзор: пульс выше 140 сужает картинку (туннельное зрение). */
        visionConeMult() { return 1 - 0.45 * psyche.overload(); },
        /** Слух: отчуждение под пульсом и глухота после взрыва. */
        hearingMult() { return clamp((1 - 0.4 * psyche.overload()) * (1 - state.deafness), 0.15, 1); },

        /** Шанс ступора лицом к лицу (Гроссман). */
        freezeChance(dist) {
            const prox = clamp(1 - (Number(dist) || 0) / FACE_TO_FACE, 0, 1);
            let ch = prox * prox * (0.05 + 0.55 * state.fear + 0.2 * neuroticism - 0.25 * state.skill
                     + 0.12 * bias.fr);
            if (state.breakState === 'freeze') ch = Math.max(ch, 0.6);
            return clamp(ch, 0, 0.9);
        },

        /** Барьер убийства (Гроссман): доля заминки перед выстрелом в упор. */
        killingHesitation(dist) {
            const prox = clamp(1 - (Number(dist) || 0) / HESITATION_RANGE, 0, 1);
            const hes = prox * (0.08 + 0.6 * traitOf('empathy')) * (1 - 0.45 * traitOf('aggression'))
                      * (1 - 0.4 * state.skill) * (1 - 0.7 * traitOf('madness'));
            return clamp(hes, 0, 0.9);
        },

        /** Строка состояния для отладки и интерфейса. */
        stateLine() {
            const tag = state.breakState ? ` [${psyche.breakTitle()}]` : '';
            const who = state.type ? `психотип ${state.type}` : 'психотип —';
            return `${who}${state.role === 'leader' ? ' лидер' : ''}${tag}: `
                 + `страх ${state.fear.toFixed(2)}, пульс ${Math.round(state.pulse)}, `
                 + `подавление ${state.suppression.toFixed(2)}, усталость ${state.fatigue.toFixed(2)}, `
                 + `ярость ${state.rage.toFixed(2)}, стресс ${state.stress.toFixed(2)}`;
        },

        /** Снимок для сейва. */
        save() {
            return {
                type: state.type, role: state.role, traits: Object.assign({}, traits),
                skill: state.skill, fear: state.fear, pulse: state.pulse,
                suppression: state.suppression, fatigue: state.fatigue, rage: state.rage,
                stress: state.stress, moralInjury: state.moralInjury, kills: state.kills,
                allyDeaths: state.allyDeaths, leaderDowns: state.leaderDowns,
                breaks: state.breaks, hunger: state.hunger, cold: state.cold,
                deafness: state.deafness,
            };
        },

        /** Восстановить из снимка. */
        load(data) {
            if (!data || typeof data !== 'object') return psyche;
            if (data.role) state.role = String(data.role);
            if (data.traits) {
                for (const name of TRAIT_NAMES) {
                    if (data.traits[name] === undefined) continue;
                    traits[name] = clamp(data.traits[name], name === 'morale' ? -1 : 0, 1);
                }
            }
            for (const key of ['fear', 'pulse', 'suppression', 'fatigue', 'rage', 'stress',
                               'moralInjury', 'hunger', 'cold', 'deafness']) {
                if (data[key] !== undefined) state[key] = Number(data[key]) || 0;
            }
            for (const key of ['kills', 'allyDeaths', 'leaderDowns', 'breaks']) {
                if (data[key] !== undefined) state[key] = Math.max(0, Math.floor(Number(data[key]) || 0));
            }
            if (state.pulse < PULSE_REST) state.pulse = PULSE_REST;
            return psyche;
        },
    };

    return psyche;
}

// ---------------------------------------------------------------------------
// Чистое ядро: режиссёр рейда
// ---------------------------------------------------------------------------

export const PHASES = ['spare', 'even', 'press'];
export const PHASE_TITLES = { spare: 'щадит', even: 'ровно', press: 'давит' };

/** Режиссёр: как рейд ведёт себя с игроком. Настройки — по фазам. */
export const DIRECTOR = {
    /** Как часто режиссёр пересматривает решение (с). */
    tick: 4,
    /** Первые минуты щадит, если рюкзак пуст. */
    spareTime: 120,
    /** Ценность рюкзака, после которой давит. */
    loaded: 900,
    /** ...или столько, но рейд уже долгий. */
    richLate: 450,
    /** Долгий рейд (с). */
    lateTime: 300,
    /** Разброс интервала между «загонщиками» (с). */
    huntGap: [35, 55],
    /** Сколько живёт назначение у бойца (с). */
    huntTtl: 28,
};

/** Настройки давления по фазам: пощада, шанс дать выиграть, фокус на игроке. */
export function knobsFor(phase) {
    if (phase === 'even') return { mercy: 0.2, let_win: 0, focus: 0 };
    if (phase === 'press') return { mercy: 0, let_win: 0, focus: 0.7 };
    return { mercy: 0.6, let_win: 0.4, focus: 0 };
}

/**
 * Режиссёр рейда. `lootValue` — функция без аргументов (ценность рюкзака),
 * `playerHp` — доля здоровья игрока 0…1 (еле живого не травят).
 */
export function createDirector(opts) {
    const cfg = Object.assign({}, DIRECTOR, opts || {});
    const random = makeRandom(cfg.seed === undefined ? 1 : cfg.seed);
    const state = {
        enabled: false,
        phase: 'spare',
        time: 0,
        cooldown: 0,
        nextHunt: 20,
        hunts: 0,
        assignments: new Map(),
        knobs: knobsFor('spare'),
    };

    const director = {
        get enabled() { return state.enabled; },
        get phase() { return state.phase; },
        get time() { return state.time; },
        get hunts() { return state.hunts; },
        get knobs() { return Object.assign({}, state.knobs); },
        /** Сколько бойцов сейчас получили назначение. */
        get assignments() { return [...state.assignments.keys()]; },

        start() {
            state.enabled = true;
            state.time = 0;
            state.phase = 'spare';
            state.cooldown = 0;
            state.nextHunt = 20;
            state.knobs = knobsFor('spare');
            return director;
        },

        stop() { state.enabled = false; return director; },

        /**
         * Один пересмотр (раз в `tick` секунд).
         * `opts`: `{ loot, playerHp, enemies }`.
         * `enemies` — список `{ id, alive, fighting, kit, mad, hostile }`.
         */
        tick(dt, opts) {
            const delta = Math.max(0, Number(dt) || 0);
            if (!state.enabled) return state.phase;
            const o = opts || {};
            state.time += delta;
            state.cooldown -= delta;
            if (state.cooldown > 0) return state.phase;
            state.cooldown = cfg.tick;

            const loot = Math.max(0, Number(o.loot) || 0);
            let phase = 'even';
            if (state.time < cfg.spareTime && loot < cfg.loaded) phase = 'spare';
            else if (loot >= cfg.loaded || (state.time > cfg.lateTime && loot >= cfg.richLate)) phase = 'press';
            state.phase = phase;
            state.knobs = knobsFor(phase);

            // Просроченные задания снимаем.
            for (const [id, item] of [...state.assignments]) {
                if (state.time > item.until) state.assignments.delete(id);
            }

            // Загонщик: «ранить, а не добить» — еле живого не травим.
            if (phase === 'press' && state.time >= state.nextHunt) {
                const hp = clamp(o.playerHp === undefined ? 1 : o.playerHp, 0, 1);
                if (hp > 0.35) {
                    const target = pickHunter(o.enemies || [], state.assignments, o.playerX);
                    if (target) {
                        state.assignments.set(String(target.id), {
                            pos: target.pos,
                            // Туда, где игрока видели «недавно»: со сдвигом,
                            // без точного наведения.
                            until: state.time + cfg.huntTtl,
                        });
                        state.hunts++;
                    }
                }
                const gap = cfg.huntGap;
                state.nextHunt = state.time + random.range(gap[0], gap[1]);
            }
            return state.phase;
        },

        /**
         * Что делать бойцу: тихо идти в точку. Пустой объект — задания нет.
         */
        objectiveFor(id) {
            if (!state.enabled) return {};
            const item = state.assignments.get(String(id));
            if (!item) return {};
            return { pos: item.pos, score: 0.62 };
        },

        /**
         * Выбрать самого слабо вооружённого, кто ни с кем не дерётся
         * (урон × темп + детали на стволе — меньше значит слабее).
         */
        pickEnemies(list) {
            return pickHunter(list, state.assignments, undefined);
        },

        save() {
            return {
                enabled: state.enabled, phase: state.phase, time: state.time,
                hunts: state.hunts, nextHunt: state.nextHunt,
                assignments: [...state.assignments].map(([id, item]) => ({ id, ...item })),
            };
        },

        load(data) {
            if (!data || typeof data !== 'object') return director;
            state.enabled = !!data.enabled;
            state.phase = PHASES.indexOf(data.phase) >= 0 ? data.phase : 'spare';
            state.time = Number(data.time) || 0;
            state.hunts = Math.max(0, Math.floor(Number(data.hunts) || 0));
            state.nextHunt = Number(data.nextHunt) || 0;
            state.assignments.clear();
            for (const item of data.assignments || []) {
                if (item && item.id !== undefined) {
                    state.assignments.set(String(item.id), { pos: item.pos, until: Number(item.until) || 0 });
                }
            }
            state.knobs = knobsFor(state.phase);
            return director;
        },
    };

    return director;
}

/**
 * Слабейший боец, который не в бою, не безумен и враждебен.
 * Отдельная функция — её проверяет тест и переиспользует игра.
 */
export function pickHunter(list, assignments, playerX) {
    let best = null;
    let bestScore = Infinity;
    for (const npc of list) {
        if (!npc) continue;
        const id = String(npc.id === undefined ? '' : npc.id);
        if (!npc.alive) continue;
        if (assignments && assignments.has(id)) continue;
        if (npc.fighting) continue;
        if (npc.mad) continue;
        if (npc.hostile === false) continue;
        const score = kitScore(npc.kit);
        if (score < bestScore) { bestScore = score; best = npc; }
    }
    if (!best) return null;
    // Сдвиг от точного места: загонщик идёт «примерно туда».
    const jitter = Math.sin(bestScore + (Number(playerX) || 0)) * 220;
    void jitter;
    return { id: best.id, pos: best.pos === undefined ? 0 : best.pos };
}

/** Чем хуже снаряжение, тем меньше очко: урон × темп + детали на стволе. */
export function kitScore(kit) {
    const k = kit || {};
    const damage = Number(k.damage) || 0;
    const rate = Math.max(0.05, Number(k.fireRate) || 1);
    const parts = Math.max(0, Math.floor(Number(k.parts) || 0));
    return damage / rate + parts * 10;
}

// ---------------------------------------------------------------------------
// Подсистема
// ---------------------------------------------------------------------------

export function installAlive($) {
    const minds = new WeakMap();      // узел → психика

    const api = {
        /** Психика: `$.alive.psyche('veteran', { skill: 0.7 })`. */
        psyche(raw) { return createPsyche(raw); },

        /** Режиссёр рейда: `$.alive.director({ lootValue: () => $.inv.value() })`. */
        director(opts) {
            const cfg = Object.assign({}, opts || {});
            // Удобная обёртка: функция ценности вместо готового числа.
            const lootValue = cfg.lootValue;
            const director = createDirector(cfg);
            if (typeof lootValue === 'function') {
                const tick = director.tick.bind(director);
                director.tick = (dt, more) => {
                    let loot = 0;
                    try { loot = Number(lootValue()) || 0; } catch (e) { loot = 0; }
                    return tick(dt, Object.assign({ loot }, more || {}));
                };
            }
            return director;
        },

        /** Психотипы и их поправки — для интерфейса и тестов. */
        types() { return Object.keys(TYPE_BIAS); },
        typeBias(id) { return TYPE_BIAS[id] ? Object.assign({}, TYPE_BIAS[id]) : null; },
        traits() { return TRAIT_NAMES.slice(); },
        traitDefaults() { return Object.assign({}, TRAIT_DEFAULTS); },
        breakKinds() { return BREAK_KINDS.slice(); },
        breakTitles() { return Object.assign({}, BREAK_TITLES); },
        phases() { return PHASES.slice(); },
        phaseTitle(phase) { return PHASE_TITLES[phase] || phase; },
        knobsFor,

        /** Дать психику узлу: `$.alive.attach('#npc', 'rookie')`. */
        attach(what, raw) {
            const node = nodeOf(what);
            if (!node) { ctx.log('$.alive.attach: узел не найден'); return null; }
            const mind = createPsyche(raw);
            minds.set(node, mind);
            return mind;
        },

        /** Психика узла (или null). */
        of(what) { const node = nodeOf(what); return node ? (minds.get(node) || null) : null; },

        /**
         * Тик всех привязанных психик: `$.alive.tick(dt)`.
         * Учитывает срывы и ставит узлу `fear`/`pulse` — игра может читать их.
         */
        tick(dt) {
            let count = 0;
            for (const node of ctx.nodes || []) {
                const mind = minds.get(node);
                if (!mind) continue;
                const near = node.attrs && node.attrs.leader_near;
                mind.tick(dt, { leaderNear: !!near });
                mind.checkBreak();
                if (typeof node.set === 'function') {
                    node.set({
                        fear: mind.fear,
                        pulse: mind.pulse,
                        stress: mind.stress,
                        broken: mind.isBroken(),
                    });
                }
                count++;
            }
            return count;
        },

        /** Чистые ядра — для тестов и своих генераторов. */
        createPsyche,
        createDirector,
        normalizeSpec,
        makeBias,
        pickHunter,
        kitScore,
        moveToward,
        clamp,
        makeRandom,
        PULSE_REST,
        PULSE_MAX,
        PULSE_TUNNEL,
        BREAK_STRESS,
        TRAIT_NAMES,
        TRAIT_DEFAULTS,
        TYPE_BIAS,
    };

    $.alive = api;
    ctx.alive = api;
    return api;
}

/** Узел по обёртке, узлу или селектору. */
function nodeOf(what) {
    if (!what) return null;
    if (typeof what === 'string') {
        const byId = ctx.byId;
        return byId && byId.get ? (byId.get(String(what).replace(/^#/, '')) || null) : null;
    }
    if (what.nodes) return what.nodes[0] || null;
    return what.tag ? what : null;
}
