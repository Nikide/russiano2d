// ===========================================================================
// Реестр студий Editor (каркас — editor/lib/studio_kit.js). Порядок важен:
// первая студия, чей match() подходит к файлу, открывает его по умолчанию;
// also() — «Открыть как…».
// ===========================================================================

import * as atlas from './atlas.js';

const MODULES = [atlas];

export const NATIVE = MODULES.map((m) => Object.assign({ native: true, module: m }, m.meta));

export function nativeFor(path) {
    const p = String(path || '');
    return NATIVE.find((st) => st.match(p)) || null;
}

export function nativeById(id) {
    return NATIVE.find((st) => st.id === id) || null;
}

export function nativeAlso(path) {
    const p = String(path || '');
    return NATIVE.filter((st) => st.match(p) || (st.also && st.also(p)));
}
