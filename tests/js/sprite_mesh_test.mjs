import { test, eq, near, truthy, finish } from './_harness.mjs';
import { decodeSpriteMeshCache, projectSpriteMesh, installSpriteMesh, drawNodeSpriteMesh }
    from '../../src/highlevel/sprite_mesh.js';

function cacheBytes() {
    const bytes = new Uint8Array(48 + 20 + 3 * 32);
    const d = new DataView(bytes.buffer);
    for (let i = 0; i < 8; i++) bytes[i] = 'R2DSMCH1'.charCodeAt(i);
    d.setUint32(8, 3, true); d.setUint32(12, 1, true);
    d.setBigUint64(16, 11n, true); d.setBigUint64(24, 22n, true); d.setBigUint64(32, 33n, true);
    d.setFloat32(40, .08, true); d.setFloat32(44, 1 / 32, true);
    d.setUint32(48, 3, true); d.setUint32(52, 1, true); d.setUint32(56, 4, true); d.setUint32(60, 2, true); d.setUint32(64, 1, true);
    const vals = [0,0,0,0,0,255,255,255, 1,0,0,1,0,255,255,255, 0,1,0,0,1,255,255,255];
    vals.forEach((v, i) => d.setFloat32(68 + i * 4, v, true));
    return bytes;
}

test('cache reader сохраняет метаданные и baked-вершины', () => {
    const c = decodeSpriteMeshCache(cacheBytes());
    eq(c.frames.length, 1); eq(c.frames[0].vertices.length, 24);
    eq(c.frames[0].width, 4); eq(c.frames[0].height, 2); eq(c.frames[0].page, 1); near(c.depth, .08, 1e-6);
    eq(String(c.sourceHash), '11');
});

test('cache reader отклоняет неизвестную версию и усечённый payload', () => {
    const b = cacheBytes();
    const badVersion = b.slice(); new DataView(badVersion.buffer).setUint32(8, 9, true);
    let rejected = false; try { decodeSpriteMeshCache(badVersion); } catch (_) { rejected = true; }
    truthy(rejected);
    rejected = false; try { decodeSpriteMeshCache(b.slice(0, b.length - 1)); } catch (_) { rejected = true; }
    truthy(rejected);
});

test('projection rotates the depth axis and keeps UV/color attributes', () => {
    const src = new Float32Array([0,0,.5,.2,.3,255,128,64]);
    const out = projectSpriteMesh(src, { x: 10, y: 20, w: 100, h: 80 }, { yaw: Math.PI / 2, pitch: 0, zoom: 2 });
    near(out[0], 60 + 1, 1e-5); // z contributes to orbit projection
    near(out[1], 60, 1e-5); near(out[3], .2, 1e-6); near(out[4], .3, 1e-6); eq(out[5], 255);
});

test('$.spriteMesh cache loader uses native bytes; baked draw delegates without rebuild', () => {
    let submits = 0;
    globalThis.engine.readBytes = () => cacheBytes();
    globalThis.engine.submitMesh = (_v, n, tex) => { submits++; eq(n, 3); eq(tex, 7); return n; };
    const api = installSpriteMesh({ mesh: { drawBaked: (v, t) => globalThis.engine.submitMesh(v, v.length / 8, t) } });
    const cache = api.loadCache('test.cache'); eq(cache.frames.length, 1);
    eq(api.draw(cache, 0, 7, { x: 0, y: 0, w: 10, h: 10 }, { zoom: 1 }), 3);
    eq(submits, 1);
});

test('ordinary Sprite frame switch submits the matching prebuilt mesh', () => {
    let submitted = null;
    globalThis.engine.submitMesh = (v, n, tex) => { submitted = { x: v[0], n, tex }; return n; };
    const tri = x => new Float32Array([x,0,0,0,0,255,255,255, x+1,0,0,1,0,255,255,255, x,1,0,0,1,255,255,255]);
    const node = { frame_index: 0, sprite_mesh: { enabled: true, texture: 7,
        options: { unitsPerPixel: 1 }, frameMap: [1,0], cache: { depth: 1, unitsPerPixel: 1,
            frames: [{ vertices: tri(10), source_width: 1, source_height: 1 },
                     { vertices: tri(20), source_width: 1, source_height: 1 }] } } };
    truthy(drawNodeSpriteMesh(node, { x: 50, y: 50, w: 1, h: 1 }, 0xffffffff));
    near(submitted.x, 50 + 20 * Math.cos(.35), 1e-5); eq(submitted.n, 3); eq(submitted.tex, 7);
    node.frame_index = 1;
    truthy(drawNodeSpriteMesh(node, { x: 50, y: 50, w: 1, h: 1 }, 0xffffffff));
    near(submitted.x, 50 + 10 * Math.cos(.35), 1e-5);
});

finish();
