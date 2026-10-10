// ===========================================================================
// Real2D v4 — вычисляемый layered warp-рендер персонажа (стадия A, head-only).
//
// Чем это НЕ является (чтобы не плодить вторую подсистему того же смысла):
// Re2DSprite v2/v3 ($.re2dSprite, тег <rotsprite>) синтезирует кадр из ОДНОЙ
// большой развёртки, где попиксельно закодированы part-ID, скининг и
// перспектива. Здесь вход другой по существу: контейнер `.r2d4` несёт
// отдельные семантические RGBA-компоненты (лицо, глаза, нос, рот, волосы),
// cage с барицентрическими привязками, манифолд q(θ)=μ+B·a(θ) и гейты
// видимости. Рантайм собирает ЛЮБОЙ угол из реальных texels атласа — готовых
// полнофигурных ракурсов в контейнере нет и не будет (спека §1, §17).
//
// Стадия A: голова, полный круг yaw, pitch = 0. Полное тело и pitch ±30° —
// отдельные стадии; выдавать head-only за full-body запрещено.
//
// Модуль даёт:
//   $.real2d.load/.frame/.pixels/.info/.provenance/.debugSetAtlas/.dispose
//   тег <real2d> с методами .real2dSrc/.real2dPose/.real2dYaw/.real2dSize/
//   .real2dInfo/.real2dReload/.real2dSpin
// ===========================================================================
import { engine } from './native.js';
import { TAGS, def, defGet, withAlpha, nodesByTag } from './core.js';
import { registerNodeRenderer } from './render.js';

let api = null;
const handles = new Map();   // путь → { id, users }

function native() {
    // `engine` из native.js — объект биндингов, а не функция: engine.real2d.*
    if (!engine || !engine.real2d) {
        throw new Error('$.real2d: в сборке нет нативного real2d (нужен src/real2d4.c)');
    }
    return engine.real2d;
}

function modelOf(node) {
    if (!node || !node.real2d) {
        throw new TypeError('real2d: у узла нет модели — вызовите .real2dSrc(path)');
    }
    return node.real2d;
}

/** Приводит угол к (-π, π]: одинаковые углы дают один и тот же кадр. */
export function normalizeReal2dYaw(yaw = 0) {
    if (typeof yaw !== 'number' || !Number.isFinite(yaw)) {
        throw new RangeError('$.real2d: yaw должен быть конечным числом (радианы)');
    }
    const twoPi = Math.PI * 2;
    let value = ((yaw % twoPi) + twoPi) % twoPi;
    if (value > Math.PI) value -= twoPi;
    return value;
}

/** Сжимает состояние в [0,1] — то же, что ждёт нативный evaluate. */
export function normalizeReal2dState(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.max(0, Math.min(1, number));
}

function renderNode(node) {
    const m = modelOf(node);
    m.sprite = native().render(m.id, {
        yaw: m.yaw, blink: m.blink, mouth: m.mouth, scale: m.size,
    });
    m.frame += 1;
    return m.sprite;
}

export function installReal2d($) {
    api = $;
    TAGS.real2d = { w: 512, h: 512, body: null };

    function loadHandle(path) {
        if (typeof path !== 'string' || !path) {
            throw new TypeError('$.real2d: нужен путь к контейнеру .r2d4');
        }
        const cached = handles.get(path);
        if (cached) { cached.users += 1; return cached.id; }
        const id = native().load(path);
        handles.set(path, { id, users: 1 });
        return id;
    }

    function releaseHandle(path) {
        const cached = handles.get(path);
        if (!cached) return;
        cached.users -= 1;
        if (cached.users <= 0) {
            native().dispose(cached.id);
            handles.delete(path);
        }
    }

    def('real2dSrc', function (path) {
        return this.eachNode((i, node) => {
            if (node.tag !== 'real2d') throw new TypeError('real2dSrc: нужен узел <real2d>');
            const id = loadHandle(path);
            if (node.real2d) releaseHandle(node.real2d.path);
            node.real2d = { id, path, sprite: -1, yaw: 0, blink: 0, mouth: 0,
                            size: 512, spin: 0, frame: 0 };
            if (!node.real2d_cleanup) {
                node.real2d_cleanup = true;
                node.on('remove', () => {
                    if (node.real2d) releaseHandle(node.real2d.path);
                    node.real2d = null;
                });
            }
            renderNode(node);
        });
    });

    def('real2dPose', function (yaw, opts = {}) {
        return this.eachNode((i, node) => {
            const m = modelOf(node);
            m.yaw = normalizeReal2dYaw(yaw);
            if (opts.blink !== undefined) m.blink = normalizeReal2dState(opts.blink);
            if (opts.mouth !== undefined) m.mouth = normalizeReal2dState(opts.mouth);
            renderNode(node);
        });
    });

    def('real2dYaw', function (yaw) {
        return this.eachNode((i, node) => {
            const m = modelOf(node);
            m.yaw = normalizeReal2dYaw(yaw);
            renderNode(node);
        });
    });

    def('real2dSpin', function (radiansPerSecond) {
        return this.eachNode((i, node) => {
            const m = modelOf(node);
            const value = Number(radiansPerSecond);
            m.spin = Number.isFinite(value) ? value : 0;
        });
    });

    def('real2dSize', function (size) {
        return this.eachNode((i, node) => {
            const m = modelOf(node);
            const value = Math.round(Number(size));
            if (!Number.isFinite(value) || value < 128 || value > 1024) {
                throw new RangeError('real2dSize: размер растра 128..1024');
            }
            m.size = value;
            renderNode(node);
        });
    });

    defGet('real2dInfo', function () {
        const node = this.get(0);
        const m = node && node.real2d;
        if (!m) return null;
        return { ...native().info(m.id), asset_id: m.id, yaw: m.yaw,
                 blink: m.blink, mouth: m.mouth, size: m.size, frames: m.frame };
    });

    def('real2dReload', function () {
        return this.eachNode((i, node) => {
            const m = modelOf(node);
            const path = m.path;
            native().dispose(m.id);
            handles.delete(path);
            const id = native().load(path);
            handles.set(path, { id, users: 1 });
            node.real2d = { ...m, id, frame: m.frame };
            renderNode(node);
        });
    });

    $.real2d = {
        /** Путь → id контейнера; повторный вызов возвращает тот же id. */
        load: (path) => loadHandle(path),
        /** Вычисляет кадр для угла и возвращает id спрайта в общем батче. */
        frame: (id, opts) => native().render(id, opts || {}),
        /** Пиксели последнего кадра (RGBA8, sRGB straight alpha) — для проверок. */
        pixels: (id) => new Uint8Array(native().pixels(id)),
        /** Структурные факты ассета и последнего кадра (правило 8). */
        info: (id) => native().info(id),
        /** Цепочка patch → triangle → UV для конкретного пикселя (спека §17). */
        provenance: (id, x, y) => native().provenance(id, x, y),
        /** Что решил движок для каждого патча на этом угле: gate, перенос, масштаб. */
        patchWeights: (id, yaw) => native().patchWeights(id, yaw),
        /** Карта provenance целиком: индекс патча+1 на пиксель (нужен рендер с provenance). */
        provenanceMap: (id) => new Uint16Array(native().provenanceMap(id)),
        /** Копия атласа (или подменённого) — для доказательных мутаций источника. */
        atlasPixels: (id) => new Uint8Array(native().atlasPixels(id)),
        /** Мутация источника для доказательных тестов: подмена атласа целиком. */
        debugSetAtlas: (id, bytes) => native().debugSetAtlas(id, bytes || null),
        dispose: (id) => {
            for (const [path, entry] of handles) {
                if (entry.id === id) handles.delete(path);
            }
            return native().dispose(id);
        },
        handles: () => new Map(handles),
        yaw: normalizeReal2dYaw,
    };

    registerNodeRenderer('real2d', (node, t, cam) => {
        const m = node.real2d;
        if (!m || m.sprite < 0) return;
        if (t.x + t.w / 2 < 0 || t.y + t.h / 2 < 0 ||
            t.x - t.w / 2 > cam.w || t.y - t.h / 2 > cam.h) return;
        $.gfx.push.sprite(m.sprite, t.x, t.y, t.w, t.h, 0,
                          withAlpha(node.color, node.alpha), node.blend_mode);
    });
}

export function tickReal2d(dt) {
    if (!api) return;
    const nodes = nodesByTag('real2d');
    if (nodes.length === 0) return;
    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        const m = node.real2d;
        if (!m || !m.spin) continue;
        m.yaw = normalizeReal2dYaw(m.yaw + m.spin * dt);
        renderNode(node);
    }
}
