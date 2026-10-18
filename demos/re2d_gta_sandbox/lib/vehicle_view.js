// ===========================================================================
// Вид машины в обычной 2D-сцене: вращаемый спрайт поверх того же узла.
//
// Физика и картинка разделены данными: `createVehicle` создаёт узел+тело,
// `attachVehicleView` только ставит спрайт, pivot, scale, слой и глубину.
// Ни одного обращения к телу/скорости/углу физики здесь нет — вид читает
// `node.angle`, который и так пишется синком Box2D в `$.world.sync`.
//
// Важно: view НЕ меняет node.w/node.h — размер узла принадлежит коллайдеру
// (иначе «картинка чуть шире» молча меняла бы массу и хитбокс). Визуальный
// масштаб задаётся `.scale()`, а pivot считается от размера коллайдера.
//
// P0.3 (docs/gta/vehicle.md): произвольный угол, pivot и масштаб — штатные
// свойства обычного 2D-спрайта. Nearest — фильтр по умолчанию
// (`$.gfx.filter(false)`); view его не переключает, чтобы не менять кадр
// всей игры из библиотеки.
// ===========================================================================

/** Поставить/обновить картинку машины на её существующем узле. */
export function attachVehicleView($, vehicle, opts) {
    if (typeof $ !== 'function') throw new TypeError('attachVehicleView: нужен $ API');
    if (!vehicle || !vehicle.node || vehicle.node.removed) {
        throw new TypeError('attachVehicleView: нужна живая машина от createVehicle');
    }
    const o = opts || {};
    const node = vehicle.node;
    const view = $(node);

    if (o.src || o.sprite) view.sprite(o.src || o.sprite);

    // node.w/h — размер КОЛЛАЙДЕРА; визуальный размер — через scale.
    const baseW = node.w || (vehicle.config && vehicle.config.width) || 32;
    const baseH = node.h || (vehicle.config && vehicle.config.height) || 32;
    const wantW = o.width === undefined ? baseW : Number(o.width);
    const wantH = o.height === undefined ? baseH : Number(o.height);
    if (!(wantW > 0) || !(wantH > 0)) {
        throw new RangeError('attachVehicleView: width/height должны быть > 0');
    }
    const extra = o.scale === undefined ? 1 : Number(o.scale);
    if (!Number.isFinite(extra) || extra <= 0) {
        throw new RangeError('attachVehicleView: scale должен быть > 0');
    }
    view.scale((wantW / baseW) * extra, (wantH / baseH) * extra);

    // pivot: 'center' (по умолчанию), 'feet' или явные доли.
    let px = o.pivotX;
    let py = o.pivotY;
    if (o.pivot === 'feet') { px = 0.5; py = 1; }
    if (px === undefined) px = 0.5;
    if (py === undefined) py = 0.5;
    view.pivot(Number(px), Number(py));

    if (o.depth !== undefined) view.depth(Number(o.depth));
    if (o.layer !== undefined) view.layer(Number(o.layer));
    if (o.color) view.color(o.color);
    if (o.alpha !== undefined) view.alpha(Number(o.alpha));
    if (o.shadow) view.shadow(o.shadow);
    view.show();

    const handle = {
        node,
        sprite: o.src || o.sprite || null,
        refresh(next) {
            return attachVehicleView($, vehicle, Object.assign({}, o, next || {}));
        },
        detach() {
            view.hide();
            view.sprite(null);
            vehicle.view = null;
        },
    };
    vehicle.view = handle;
    return handle;
}

export default attachVehicleView;
