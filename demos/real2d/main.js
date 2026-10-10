// ===========================================================================
// real2d — демо Real2D v4 (стадия A): голова из авторских компонентов.
//
// Показывает ровно то, что реализовано: полный круг yaw, pitch = 0, двенадцать
// геометрических anchors, серия Фурье K=3 и растеризация реальных texels шита.
// Полнотелого персонажа и pitch здесь нет, и демо это не выдаёт за них.
//
// Запуск:
//   ./build/russiano2d --game demos/real2d
//   ./build/russiano2d --game demos/real2d --seconds 5 --screenshot /tmp/real2d.png
//
// Интерфейс — RmlUi-документ real2d.rml (закон UI: UI_RMLUI_LAW.md).
// Контейнер перечитывается клавишей R после `tools/bake_real2d.py` — это и есть
// цикл правки авторинга: bake → R → смотрим.
// ===========================================================================

const CONTAINER = 'assets/head_real2d_v4.r2d4';
const DOC = 'real2d.rml';
const SPIN = 0.9;                  // рад/с в автоповороте

let head = null;
let doc = null;
let yaw = 0;
let auto = false;
let readoutTimer = 0;
let snapshotPixels = null;
let snapshotMap = null;

function assetId() {
    // head — обёртка; модель живёт на узле (методы обёртки идут через eachNode).
    const node = head && head.get(0);
    return node && node.real2d ? node.real2d.id : -1;
}

function applyYaw(value) {
    yaw = $.real2d.yaw(value);
    head.real2dYaw(yaw);
}

function setAuto(on) {
    auto = !!on;
    head.real2dSpin(auto ? SPIN : 0);
    return auto;
}

// Короткая сводка кадра: тесты и отчёт видят то же, что глаз на экране.
function measure() {
    const id = assetId();
    const info = $.real2d.info(id);
    const px = $.real2d.pixels(id);
    let hash = 2166136261;
    let opaque = 0, partial = 0, empty = 0, sumAlpha = 0;
    let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
    for (let i = 0; i < px.length; i += 4) {
        const a = px[i + 3];
        hash ^= (px[i] + a * 7) & 0xff;
        hash = Math.imul(hash, 16777619) >>> 0;
        if (a === 0) { empty++; continue; }
        sumAlpha += a;
        if (a > 250) opaque++; else partial++;
        const pixel = i >> 2;
        const x = pixel % info.canvas, y = (pixel / info.canvas) | 0;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
    }
    return {
        hash, opaque, partial, empty,
        mean_alpha: opaque + partial ? sumAlpha / (opaque + partial) : 0,
        bbox: maxX < 0 ? null : [minX, minY, maxX, maxY],
        yaw, auto,
        canvas: info.canvas,
        patches_drawn: info.patches_drawn,
        triangles_drawn: info.triangles_drawn,
        fold_rejects: info.fold_rejects,
        max_coverage: info.max_coverage,
        atlas_mutated: info.atlas_mutated,
        ok: info.ok,
        last_error: info.last_error,
    };
}

// Рендер конкретного угла: и для кнопок-углов, и для доказательных сравнений.
function renderAtAngle(radians, opts) {
    $.real2d.frame(assetId(), { ...(opts || {}), yaw: radians });
    yaw = $.real2d.yaw(radians);
    return $.real2d.pixels(assetId());
}

function updateReadout() {
    if (!doc || assetId() < 0) return;
    const info = $.real2d.info(assetId());
    const degrees = (yaw * 180 / Math.PI + 360) % 360;
    doc.text('yaw-line', `yaw: ${degrees.toFixed(1)}°`);
    doc.text('stage-line', `стадия A · голова · pitch 0 · ${auto ? 'автоповорот' : 'вручную'}`);
    doc.text('stats-line',
        `патчей ${info.patches_drawn} · треугольников ${info.triangles_drawn} · ` +
        `rank ${info.rank} · ${info.ok ? 'кадр собран' : 'ОШИБКА: ' + info.last_error}`);
}

$.ready(() => {
    $.world.gravity(0, 0).color('#0e1420');
    $.camera.at(800, 450);

    head = $('<real2d>', { id: 'head' }).at(800, 470).size(720, 720);
    head.appendTo($.world);
    try {
        head.real2dSrc(CONTAINER);
    } catch (error) {
        $.log('real2d: контейнер не загрузился: ' + error);
    }

    doc = $.ui.doc(DOC).show();
    doc.on('front', 'click', () => applyYaw(0))
        .on('q45', 'click', () => applyYaw(-Math.PI / 4))
        .on('p45', 'click', () => applyYaw(Math.PI / 4))
        .on('profile', 'click', () => applyYaw(Math.PI / 2))
        .on('back', 'click', () => applyYaw(Math.PI))
        .on('auto', 'click', () => setAuto(!auto))
        .on('reload', 'click', () => head.real2dReload());
    updateReadout();

    // Хуки для агентского теста: те же вызовы, что у кнопок.
    globalThis.real2dDemo = {
        head: () => head,
        info: () => $.real2d.info(assetId()),
        measure: () => measure(),
        setYaw: (radians) => applyYaw(radians),
        auto: (on) => setAuto(on),
        provenance: (x, y) => $.real2d.provenance(assetId(), x, y),
        mutateAtlas: (bytes) => $.real2d.debugSetAtlas(assetId(), bytes),
        render: (opts) => $.real2d.frame(assetId(), opts || {}),
        renderAt: (radians, opts) => renderAtAngle(radians, opts),
        // --- доказательный набор стадии A ---------------------------------
        // Каждый хук возвращает маленькие числа: тест не должен тащить через
        // агентский протокол мегабайты пикселей.
        info: () => $.real2d.info(assetId()),
        measure: () => measure(),
        compare: (radA, radB) => {
            const first = renderAtAngle(radA), second = renderAtAngle(radB);
            let max = 0, sum = 0, big = 0;
            for (let i = 0; i < first.length; i++) {
                const d = Math.abs(first[i] - second[i]);
                if (d > max) max = d;
                if (d > 8) big++;          // «скачок» жёсткой кромки, а не мягкого поля
                sum += d;
            }
            const total = first.length;
            return { max, big, total, big_share: total ? big / total : 0,
                     mean: total ? sum / total : 0, bytes: total };
        },
        provenanceAt: (x, y) => {
            $.real2d.frame(assetId(), { yaw, provenance: true });
            return $.real2d.provenance(assetId(), x, y);
        },
        snapshot: () => {
            $.real2d.frame(assetId(), { yaw, provenance: true });
            snapshotPixels = $.real2d.pixels(assetId());
            snapshotMap = $.real2d.provenanceMap(assetId());
            return snapshotPixels.length;
        },
        diffSnapshot: () => {
            if (!snapshotPixels || !snapshotMap) throw new Error('diffSnapshot: сначала snapshot()');
            // Карта provenance берётся у ТЕКУЩЕГО кадра: пиксель, который после
            // мутации принадлежит патчу, и должен считаться его изменением.
            $.real2d.frame(assetId(), { yaw, provenance: true });
            const now = $.real2d.pixels(assetId());
            const map = $.real2d.provenanceMap(assetId());
            const ids = $.real2d.info(assetId()).patch_ids;
            const byPatch = {};
            let changed = 0, unowned = 0, faint = 0;
            for (let p = 0; p < snapshotMap.length; p++) {
                const i = p * 4;
                const dr = Math.abs(snapshotPixels[i] - now[i]);
                const dg = Math.abs(snapshotPixels[i + 1] - now[i + 1]);
                const db = Math.abs(snapshotPixels[i + 2] - now[i + 2]);
                const da = Math.abs(snapshotPixels[i + 3] - now[i + 3]);
                const delta = Math.max(dr, dg, db, da);
                if (delta === 0) continue;
                // Порог видимости: младший бит меняется от пересчёта alpha или
                // от подмешивания цвета прозрачных текселов при билинейной
                // выборке — это не «изменение картинки».
                if (delta <= 4) { faint++; continue; }
                changed++;
                const index = map[p];
                if (index === 0) { unowned++; continue; }
                const id = ids[index - 1];
                byPatch[id] = (byPatch[id] || 0) + 1;
            }
            return { changed, faint, unowned, by_patch: byPatch };
        },
        zeroAtlas: () => {
            const info = $.real2d.info(assetId());
            const bytes = new Uint8Array(info.atlas_w * info.atlas_h * 4);
            return $.real2d.debugSetAtlas(assetId(), bytes);
        },
        tintPatch: (patchId, rgb) => {
            const info = $.real2d.info(assetId());
            const rect = info.patch_rects[patchId];
            if (!rect) throw new Error('tintPatch: нет патча ' + patchId);
            const bytes = new Uint8Array($.real2d.atlasPixels(assetId()));
            for (let y = rect[1]; y < rect[3]; y++) {
                for (let x = rect[0]; x < rect[2]; x++) {
                    const i = (y * info.atlas_w + x) * 4;
                    bytes[i] = rgb[0]; bytes[i + 1] = rgb[1]; bytes[i + 2] = rgb[2];
                }
            }
            return $.real2d.debugSetAtlas(assetId(), bytes);
        },
        restoreAtlas: () => $.real2d.debugSetAtlas(assetId(), null),
        // Замер кадра: сколько миллисекунд занимает evaluate+растеризация+композит.
        // Первые 20 кадров — прогрев (аллокации, кэш текстур), в отчёт не идут.
        bench: (frames, size) => {
            const id = assetId();
            const pixels = size || 512;
            for (let i = 0; i < 20; i++) $.real2d.frame(id, { yaw: i * 0.1, scale: pixels });
            const started = $.time.perfNow();
            for (let i = 0; i < frames; i++) {
                $.real2d.frame(id, { yaw: (i % 720) * (Math.PI * 2 / 720), scale: pixels });
            }
            const total = $.time.perfNow() - started;
            return { frames, size: pixels, ms_total: total, ms_per_frame: total / frames };
        },
    };
    $.log('real2d: демо готово, контейнер ' + CONTAINER);
});

$.update(dt => {
    if (assetId() < 0) return;
    if ($.input.down('left')) applyYaw(yaw - dt * 1.8);
    if ($.input.down('right')) applyYaw(yaw + dt * 1.8);
    if ($.input.pressed('space')) setAuto(!auto);
    if ($.input.pressed('r')) head.real2dReload();
    if ($.input.pressed('escape')) $.quit();

    readoutTimer += dt;
    if (readoutTimer > 0.2) {
        readoutTimer = 0;
        updateReadout();
    }
});
