// ===========================================================================
// Формат `*.audio.json` (Audio Tools): шины, звуки и зоны акустики `$.audio`.
//
//   const f = $.fs.readJSON('mix.audio.json');
//   for (const n of Object.keys(f.buses || {})) $.audio.bus(n, f.buses[n]);
//   for (const z of f.zones || []) $.audio.zone(z.name, z);
//   $.audio.play(f.sounds.shot.path, { bus: f.sounds.shot.bus, volume: f.sounds.shot.volume });
//
// См. docs/highlevel/audiobus.md. Чистая логика без движка.
// ===========================================================================

import { isObj, isStr, isNum, inRange, err, warn, checkRoot } from '../kit.js';

export const ID = 'audio';
export const SUFFIX = '.audio.json';
export const PREFIX = 'SDK_AUDIO';
export const EFFECTS = ['none', 'lowpass', 'highpass', 'echo', 'tremolo', 'bitcrush', 'ringmod', 'reverb'];
const NAME_RE = /^[A-Za-z0-9_\-]{1,48}$/;

export function create() {
    return {
        version: 1,
        buses: { music: { volume: 0.6 }, sfx: { volume: 1 }, ui: { parent: 'sfx', volume: 0.5 } },
        sounds: {},
        zones: [],
    };
}

/** Эффективная громкость шины: произведение по цепочке родителей (как `$.audio.gain`, без mute/solo). */
export function gain(buses, name) {
    let g = 1, cur = name, guard = 0;
    while (cur && cur !== 'master' && isObj(buses[cur]) && guard++ < 32) {
        g *= isNum(buses[cur].volume) ? buses[cur].volume : 1;
        cur = buses[cur].parent || 'master';
    }
    return g;
}

export function validate(root) {
    const out = [];
    if (!checkRoot(PREFIX, root, out)) return out;
    const buses = root.buses === undefined ? {} : root.buses;
    if (!isObj(buses)) out.push(err(PREFIX + '_BUSES', 'buses — объект «имя → шина»', { field: 'buses' }));
    else {
        for (const name of Object.keys(buses)) {
            const b = buses[name];
            const loc = { bus: name };
            if (!NAME_RE.test(name) || name === 'master') out.push(err(PREFIX + '_BUS', 'Имя шины «' + name + '»: латиница, цифры, «_», «-», не «master»', loc));
            if (!isObj(b)) { out.push(err(PREFIX + '_BUS', 'Шина «' + name + '» должна быть объектом', loc)); continue; }
            if (b.volume !== undefined && !inRange(b.volume, 0, 1)) out.push(err(PREFIX + '_VOLUME', 'Шина «' + name + '»: volume 0..1', loc));
            for (const f of ['muted', 'solo']) if (b[f] !== undefined && typeof b[f] !== 'boolean') out.push(err(PREFIX + '_BUS', 'Шина «' + name + '»: ' + f + ' — true/false', loc));
            if (b.effect !== undefined && EFFECTS.indexOf(b.effect) < 0) out.push(err(PREFIX + '_EFFECT', 'Шина «' + name + '»: effect ' + EFFECTS.join(' | '), loc));
            if (b.effectParams !== undefined && !isObj(b.effectParams)) out.push(err(PREFIX + '_BUS', 'Шина «' + name + '»: effectParams — объект', loc));
            if (b.parent !== undefined) {
                if (!isStr(b.parent)) out.push(err(PREFIX + '_PARENT', 'Шина «' + name + '»: parent — строка', loc));
                else if (b.parent !== 'master' && !isObj(buses[b.parent])) out.push(err(PREFIX + '_PARENT', 'Шина «' + name + '»: родитель «' + b.parent + '» не объявлен', loc));
                else {
                    const seen = [name];
                    let cur = b.parent;
                    while (cur && cur !== 'master' && isObj(buses[cur])) {
                        if (seen.indexOf(cur) >= 0) { out.push(err(PREFIX + '_CYCLE', 'Шина «' + name + '»: цикл родителей через «' + cur + '»', loc)); break; }
                        seen.push(cur);
                        cur = buses[cur].parent;
                    }
                }
            }
        }
    }
    const sounds = root.sounds === undefined ? {} : root.sounds;
    if (!isObj(sounds)) out.push(err(PREFIX + '_SOUNDS', 'sounds — объект «имя → звук»', { field: 'sounds' }));
    else {
        for (const name of Object.keys(sounds)) {
            const s = sounds[name];
            const loc = { sound: name };
            if (!NAME_RE.test(name)) out.push(err(PREFIX + '_SOUND', 'Имя звука «' + name + '»: латиница, цифры, «_», «-»', loc));
            if (!isObj(s) || !isStr(s.path) || !s.path) { out.push(err(PREFIX + '_SOUND', 'Звук «' + name + '»: нужен path', loc)); continue; }
            if (s.volume !== undefined && !inRange(s.volume, 0, 1)) out.push(err(PREFIX + '_VOLUME', 'Звук «' + name + '»: volume 0..1', loc));
            if (s.pitch !== undefined && !inRange(s.pitch, 0.1, 4)) out.push(err(PREFIX + '_PITCH', 'Звук «' + name + '»: pitch 0.1..4', loc));
            if (s.loop !== undefined && typeof s.loop !== 'boolean') out.push(err(PREFIX + '_SOUND', 'Звук «' + name + '»: loop — true/false', loc));
            if (s.bus !== undefined) {
                if (!isStr(s.bus)) out.push(err(PREFIX + '_SOUND', 'Звук «' + name + '»: bus — строка', loc));
                else if (isObj(buses) && !isObj(buses[s.bus]) && s.bus !== 'sfx' && s.bus !== 'music') out.push(warn(PREFIX + '_BUS_MISSING', 'Звук «' + name + '»: шина «' + s.bus + '» не объявлена (рантайм создаст её с громкостью 1)', loc));
            }
        }
    }
    if (root.zones !== undefined) {
        if (!Array.isArray(root.zones) || root.zones.length > 256) out.push(err(PREFIX + '_ZONES', 'zones — массив до 256 зон', { field: 'zones' }));
        else {
            root.zones.forEach((z, i) => {
                const loc = { zone: i };
                if (!isObj(z) || !isStr(z.name) || !z.name) { out.push(err(PREFIX + '_ZONE', 'Зона ' + i + ': нужен name', loc)); return; }
                if (!(Array.isArray(z.rect) && z.rect.length === 4 && z.rect.every(isNum) && z.rect[2] > 0 && z.rect[3] > 0)) out.push(err(PREFIX + '_ZONE', 'Зона ' + i + ': rect — [x, y, w, h], w и h > 0', loc));
                if (z.height !== undefined && !inRange(z.height, 0.1, 1000)) out.push(err(PREFIX + '_ZONE', 'Зона ' + i + ': height 0.1..1000 (метры)', loc));
                if (z.material !== undefined && !isStr(z.material)) out.push(err(PREFIX + '_ZONE', 'Зона ' + i + ': material — строка', loc));
            });
        }
    }
    return out;
}

export function summary(root) {
    return 'шин ' + (isObj(root && root.buses) ? Object.keys(root.buses).length : 0) + ' · звуков ' +
        (isObj(root && root.sounds) ? Object.keys(root.sounds).length : 0) + ' · зон ' + (Array.isArray(root && root.zones) ? root.zones.length : 0);
}
export function snippet(rel) {
    return "const f = $.fs.readJSON('" + rel + "'); for (const n of Object.keys(f.buses || {})) $.audio.bus(n, f.buses[n]); for (const z of f.zones || []) $.audio.zone(z.name, z);";
}
