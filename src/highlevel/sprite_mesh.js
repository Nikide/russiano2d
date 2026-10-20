// SpriteMesh cache reader and preview projection. Geometry is generated and
// serialized by the native SDK; this module only selects/projects baked data.
import { engine } from './native.js';

export function decodeSpriteMeshCache(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length < 48) throw new Error('SpriteMesh cache повреждён или усечён');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const magic = String.fromCharCode(...bytes.subarray(0, 8));
    if (magic !== 'R2DSMCH1' || view.getUint32(8, true) !== 3) throw new Error('Неподдерживаемая версия SpriteMesh cache');
    const count = view.getUint32(12, true);
    if (!count || count > 65535) throw new Error('Некорректное число кадров в SpriteMesh cache');
    const cache = { sourceHash: view.getBigUint64(16, true), layoutHash: view.getBigUint64(24, true),
        settingsHash: view.getBigUint64(32, true), depth: view.getFloat32(40, true),
        unitsPerPixel: view.getFloat32(44, true), frames: [] };
    let at = 48;
    for (let i = 0; i < count; i++) {
        if (at + 20 > bytes.length) throw new Error(`SpriteMesh cache: повреждён заголовок кадра ${i}`);
        const n = view.getUint32(at, true), opaquePixels = view.getUint32(at + 4, true);
        const width = view.getUint32(at + 8, true), height = view.getUint32(at + 12, true), page = view.getUint32(at + 16, true); at += 20;
        if (!width || !height || n % 3 || n > (bytes.length - at) / 32) throw new Error(`SpriteMesh cache: неверная геометрия кадра ${i}`);
        const littleEndian = new Uint8Array(new Uint32Array([0x01020304]).buffer)[0] === 4;
        let vertices;
        if (littleEndian && (bytes.byteOffset + at) % 4 === 0) {
            vertices = new Float32Array(bytes.buffer, bytes.byteOffset + at, n * 8);
            at += n * 32;
        } else {
            vertices = new Float32Array(n * 8);
            for (let k = 0; k < vertices.length; k++, at += 4) vertices[k] = view.getFloat32(at, true);
        }
        for (let k = 0; k < vertices.length; k++)
            if (!Number.isFinite(vertices[k])) throw new Error(`SpriteMesh cache: неконечная вершина кадра ${i}`);
        cache.frames.push({ vertices, opaquePixels, width, height, page, source_width: width, source_height: height });
    }
    if (at !== bytes.length) throw new Error('SpriteMesh cache: лишние данные в конце файла');
    return cache;
}

export function projectSpriteMesh(vertices, viewport, camera) {
    const v = viewport || {}, c = camera || {};
    const yaw = Number.isFinite(c.yaw) ? c.yaw : 0.55, pitch = Number.isFinite(c.pitch) ? c.pitch : 0.3;
    const zoom = Math.max(0.01, Number(c.zoom) || 1), cx = (Number(v.x) || 0) + (Number(v.w) || 0) / 2;
    const cy = (Number(v.y) || 0) + (Number(v.h) || 0) / 2;
    const cyaw = Math.cos(yaw), syaw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const out = new Float32Array(vertices.length);
    for (let i = 0; i < vertices.length; i += 8) {
        const x = vertices[i], y = vertices[i + 1], z = vertices[i + 2];
        const rx = x * cyaw + z * syaw, rz = -x * syaw + z * cyaw;
        const ry = y * cp - rz * sp, rz2 = y * sp + rz * cp;
        const persp = 1 / Math.max(0.2, 1 + rz2 * (Number(c.perspective) || 0.002));
        out[i] = cx + rx * zoom * persp; out[i + 1] = cy - ry * zoom * persp;
        out[i + 2] = Math.max(0, Math.min(1, 0.5 - rz2 * 0.001));
        out[i + 3] = vertices[i + 3]; out[i + 4] = vertices[i + 4];
        out[i + 5] = vertices[i + 5]; out[i + 6] = vertices[i + 6]; out[i + 7] = vertices[i + 7];
    }
    return out;
}

export function installSpriteMesh($) {
    let lastProjected = new Float32Array(0);
    return {
        loadCache(path) {
            if (!engine || typeof engine.readBytes !== 'function') throw new Error('Чтение SpriteMesh cache недоступно');
            const bytes = engine.readBytes(String(path));
            if (!bytes) throw new Error(`SpriteMesh cache не найден: ${path}`);
            const cache = decodeSpriteMeshCache(bytes);
            cache.bytes = bytes.byteLength;
            return cache;
        },
        project: projectSpriteMesh,
        draw(cache, frameIndex, texture, viewport, camera) {
            if (!cache || !Array.isArray(cache.frames) || !cache.frames.length) return 0;
            const i = Math.max(0, Math.min(cache.frames.length - 1, frameIndex | 0));
            const src = cache.frames[i].vertices;
            if (lastProjected.length < src.length) lastProjected = new Float32Array(src.length);
            const out = projectSpriteMeshInto(src, viewport, camera, lastProjected);
            return engine && typeof engine.submitMesh === 'function'
                ? engine.submitMesh(out, src.length / 8, Number(texture)) : 0;
        },
        cacheInfo(cache) { return cache ? { frames: cache.frames.length, sourceHash: String(cache.sourceHash),
            layoutHash: String(cache.layoutHash), settingsHash: String(cache.settingsHash), depth: cache.depth,
            unitsPerPixel: cache.unitsPerPixel } : null; },
    };
}

/** Render-path adapter for a normal Sprite node. It selects the cache frame by
 * the node's existing frame_index and only projects already baked vertices. */
export function drawNodeSpriteMesh(node, transform, tint, viewport) {
    const state = node && node.sprite_mesh;
    const cache = state && state.cache;
    if (!state || !state.enabled || !cache || !cache.frames.length) return false;
    const localIndex = node.frame_index === undefined ? 0 : node.frame_index | 0;
    const index = state.frameMap && state.frameMap[localIndex] !== undefined
        ? state.frameMap[localIndex] : localIndex;
    const frame = cache.frames[index];
    if (!frame || !(frame.source_width > 0) || !(frame.source_height > 0)) return false;
    const src = frame.vertices;
    if (!node.__sprite_mesh_projected || node.__sprite_mesh_projected.length < src.length)
        node.__sprite_mesh_projected = new Float32Array(src.length);
    const out = node.__sprite_mesh_projected;
    const unitsPerPixel = Number(state.options.unitsPerPixel) > 0
        ? Number(state.options.unitsPerPixel) : cache.unitsPerPixel;
    const sx = transform.w / (frame.source_width * unitsPerPixel);
    const sy = transform.h / (frame.source_height * unitsPerPixel);
    const angle = Number(node.angle) || 0, ca = Math.cos(angle), sa = Math.sin(angle);
    const yaw = Number.isFinite(state.yaw) ? state.yaw : .35, pitch = Number.isFinite(state.pitch) ? state.pitch : .2;
    const cy = Math.cos(yaw), ys = Math.sin(yaw), cp = Math.cos(pitch), ps = Math.sin(pitch);
    const depthScale = (Math.abs(sx) + Math.abs(sy)) * .5;
    const depthRatio = Number(state.options.depth) >= 0 && cache.depth > 0
        ? Number(state.options.depth) / cache.depth : 1;
    const cr = tint & 255, cg = (tint >>> 8) & 255, cb = (tint >>> 16) & 255;
    for (let i = 0; i < src.length; i += 8) {
        const x = src[i] * sx, y = -src[i + 1] * sy, z = src[i + 2] * depthScale * depthRatio;
        const ax = x * cy + z * ys, az = -x * ys + z * cy;
        const ay = y * cp - az * ps, az2 = y * ps + az * cp;
        const rx = ax * ca - ay * sa, ry = ax * sa + ay * ca;
        out[i] = transform.x + rx; out[i + 1] = transform.y + ry;
        out[i + 2] = Math.max(0, Math.min(1, .5 + az2 * .001));
        out[i + 3] = src[i + 3]; out[i + 4] = src[i + 4];
        out[i + 5] = src[i + 5] * cr / 255; out[i + 6] = src[i + 6] * cg / 255; out[i + 7] = src[i + 7] * cb / 255;
    }
    const texture = state.frameTextures && state.frameTextures[localIndex] !== undefined
        ? state.frameTextures[localIndex] : state.texture;
    if (engine && typeof engine.submitMesh === 'function') engine.submitMesh(out, src.length / 8, texture);
    return true;
}

function projectSpriteMeshInto(vertices, viewport, camera, out) {
    const v = viewport || {}, c = camera || {};
    const yaw = Number.isFinite(c.yaw) ? c.yaw : 0.55, pitch = Number.isFinite(c.pitch) ? c.pitch : 0.3;
    const zoom = Math.max(0.01, Number(c.zoom) || 1), cx = (Number(v.x) || 0) + (Number(v.w) || 0) / 2;
    const cy = (Number(v.y) || 0) + (Number(v.h) || 0) / 2;
    const cyaw = Math.cos(yaw), syaw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    for (let i = 0; i < vertices.length; i += 8) {
        const x = vertices[i], y = vertices[i + 1], z = vertices[i + 2];
        const rx = x * cyaw + z * syaw, rz = -x * syaw + z * cyaw;
        const ry = y * cp - rz * sp, rz2 = y * sp + rz * cp;
        const persp = 1 / Math.max(0.2, 1 + rz2 * (Number(c.perspective) || 0.002));
        out[i] = cx + rx * zoom * persp; out[i + 1] = cy - ry * zoom * persp;
        out[i + 2] = Math.max(0, Math.min(1, 0.5 - rz2 * 0.001));
        out[i + 3] = vertices[i + 3]; out[i + 4] = vertices[i + 4];
        out[i + 5] = vertices[i + 5]; out[i + 6] = vertices[i + 6]; out[i + 7] = vertices[i + 7];
    }
    return out;
}
