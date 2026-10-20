// ===========================================================================
// Реестр студий Editor (каркас — editor/lib/studio_kit.js). Порядок важен:
// первая студия, чей match() подходит к файлу, открывает его по умолчанию;
// also() — «Открыть как…».
// ===========================================================================

import * as atlas from './atlas.js';
import * as hammer from './hammer.js';
import * as narrative from './narrative.js';
import * as spriteMesh from './sprite_mesh.js';
import * as tilemap from './tilemap.js';
import * as particles from './particles.js';
import * as collision from './collision.js';
import * as parallax from './parallax.js';
import * as fonts from './fonts.js';
import * as audio from './audio.js';

const MODULES = [atlas, hammer, narrative, spriteMesh, tilemap, particles, collision, parallax, fonts, audio];

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
