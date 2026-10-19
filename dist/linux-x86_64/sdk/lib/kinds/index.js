// Реестр форматов студий данных: id → модуль (чистая логика). Студия берёт
// формат отсюда; список файлов и сопоставление с инструментами — в sdk_tools.json.
import * as tilemap from './tilemap.js';
import * as particles from './particles.js';
import * as collision from './collision.js';
import * as layers from './layers.js';
import * as fonts from './fonts.js';
import * as audio from './audio.js';
import * as input from './input.js';

export const KINDS = { tilemap, particles, collision, layers, fonts, audio, input };

export function kindForPath(path) {
    const p = String(path || '').toLowerCase();
    for (const id of Object.keys(KINDS)) if (p.endsWith(KINDS[id].SUFFIX)) return KINDS[id];
    return null;
}
