// ===========================================================================
// Универсальная top-down машина поверх существующего Box2D-тела.
//
// Это игровой сэмпл, а не нативный класс Vehicle: `createVehicle($, opts)`
// создаёт обычный узел `$` с динамическим телом и каждый кадр переводит
// управление в импульсы/скорости через публичный `$` API. Один и тот же
// контроллер работает в обычной 2D-сцене (без Re2D) и в Re2D World.
//
// Re2D участвует ТОЛЬКО как необязательный источник сцепления: если у
// `opts.world` есть `groundAt(x, y, {h})`, под машиной читаются теги
// поверхности и выбирается профиль сцепления. Нет `groundAt` — машина едет
// на обычном сцеплении, без BSP и без зависимостей от Re2D.
//
// Модель намеренно аркадная (bicycle + lateral grip):
//   * тяга/тормоз — импульс вдоль facing;
//   * боковая скорость гасится экспоненциально (сцепление), ручник его
//     ослабляет — машина уходит в скольжение;
//   * руль задаёт угловую скорость: vF / wheelbase * tan(steer), с
//     ограничением steerRate и подруливанием на малой скорости;
//   * знак продольной скорости переворачивает руль (reverse steering);
//   * drag гасит скорость, angularDrag — остаточное вращение;
//   * столкновения — обычные body/collider и layer/mask, второго мира нет.
//
// Единицы (как у Box2D-обёртки R2D): 32 px = 1 m, масса в кг, силы в
// kg·px/s², скорости в px/s, углы в радианах. `node.angle = 0` — facing +X,
// положительный угол поворачивает по часовой стрелке на экране (ось Y вниз).
// ===========================================================================

/** Пикселей в метре — та же константа, что R2D_PX_PER_M в физике движка. */
const PX_PER_M = 32;

/** Профили сцепления по тегам поверхности (только множитель сцепления). */
export const DEFAULT_SURFACE_GRIP = Object.freeze({
    road: 1.0,
    asphalt: 1.0,
    tarmac: 1.0,
    parking: 1.0,
    sidewalk: 0.85,
    crosswalk: 0.9,
    dirt: 0.62,
    gravel: 0.58,
    grass: 0.55,
    sand: 0.5,
    mud: 0.45,
    snow: 0.42,
    ice: 0.2,
    water: 0.35,
});

/**
 * Умолчания контроллера. Все числа можно переопределить через opts.
 * `mass` переводится в density тела по площади коробки (32 px = 1 m).
 */
export const VEHICLE_DEFAULTS = Object.freeze({
    width: 48,
    height: 26,
    mass: 1200,

    engineForce: 150000,      // kg·px/s²: при массе 1200 — 125 px/s² тяги
    brakeForce: 280000,       // ~233 px/s² торможения
    maxSpeed: 440,            // px/s
    reverseMaxSpeed: 150,     // px/s

    steerRate: 2.8,           // rad/s, предел угловой скорости
    steerSpeed: 0.55,         // rad, максимальный угол колёс (bicycle)
    wheelbase: 72,            // px между осями
    lowSpeed: 90,             // px/s, ниже — подруливание на месте
    lowSpeedAssist: 0.45,     // доля steerRate в подруливании
    steerResponse: 16,        // 1/s, скорость выхода на целевую угловую
    tractionRate: 50,         // 1/s, насколько быстро скорость следует за рулём
    handbrakeTurn: 1.25,      // множитель руля на ручнике

    grip: 1.0,                // общий множитель сцепления
    lateralGrip: 7.0,         // 1/s, гашение боковой скорости
    handbrakeGrip: 0.14,      // множитель lateralGrip на ручнике
    handbrakeBrake: 0.22,     // доля brakeForce, когда ручник тормозит
    handbrakeDrag: 0.8,       // 1/s, продольное сопротивление ручника
    drag: 0.12,               // 1/s, общее сопротивление
    angularDrag: 5.0,         // 1/s, гашение остаточного вращения

    friction: 0.4,            // Box2D friction тела
    restitution: 0.0,
    gravity: false,           // top-down: тело игнорирует гравитацию мира
    allowSleep: false,        // контроллер сам будит тело каждым тиком

    layer: 1,                 // collision layerBits
    mask: 0xffffffff,         // collision mask
    group: 0,
    depth: 0,
    visible: true,

    stopEps: 3,               // px/s: «машина стоит» для логики тормоз/реверс
    dtMax: 0.1,               // s: защита от гигантского шага
});

/** Считать число опции или бросить RangeError с именем поля. */
function numOption(opts, key, fallback, min, max) {
    const raw = opts[key];
    if (raw === undefined || raw === null) return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value)) {
        throw new TypeError(`createVehicle: opts.${key} должно быть числом`);
    }
    if (min !== undefined && value < min) {
        throw new RangeError(`createVehicle: opts.${key} < ${min}`);
    }
    if (max !== undefined && value > max) {
        throw new RangeError(`createVehicle: opts.${key} > ${max}`);
    }
    return value;
}

function boolOption(opts, key, fallback) {
    const value = opts[key];
    if (value === undefined || value === null) return fallback;
    return value !== false;
}

/** Нормализованные настройки: умолчания + проверенные opts. */
function normalizeOptions(opts) {
    if (opts === undefined || opts === null) opts = {};
    if (typeof opts !== 'object' || Array.isArray(opts)) {
        throw new TypeError('createVehicle: opts должен быть объектом');
    }
    const o = Object.assign({}, VEHICLE_DEFAULTS, opts);
    o.width = numOption(opts, 'width', VEHICLE_DEFAULTS.width, 1, 4096);
    o.height = numOption(opts, 'height', VEHICLE_DEFAULTS.height, 1, 4096);
    o.mass = numOption(opts, 'mass', VEHICLE_DEFAULTS.mass, 0.001);
    for (const key of ['engineForce', 'brakeForce', 'maxSpeed', 'reverseMaxSpeed',
                       'steerRate', 'steerSpeed', 'wheelbase', 'lowSpeed',
                       'lowSpeedAssist', 'steerResponse', 'tractionRate', 'handbrakeTurn',
                       'grip', 'lateralGrip', 'handbrakeGrip', 'handbrakeBrake',
                       'handbrakeDrag', 'drag', 'angularDrag', 'friction',
                       'restitution', 'stopEps', 'dtMax']) {
        o[key] = numOption(opts, key, VEHICLE_DEFAULTS[key], 0);
    }
    if (o.wheelbase <= 0) throw new RangeError('createVehicle: opts.wheelbase должен быть > 0');
    o.layer = numOption(opts, 'layer', VEHICLE_DEFAULTS.layer, 0, 0xffffffff) >>> 0;
    o.mask = numOption(opts, 'mask', VEHICLE_DEFAULTS.mask, 0, 0xffffffff) >>> 0;
    o.group = (numOption(opts, 'group', VEHICLE_DEFAULTS.group) | 0);
    o.depth = numOption(opts, 'depth', VEHICLE_DEFAULTS.depth);
    o.angle = Number(opts.angle);
    if (!Number.isFinite(o.angle)) o.angle = 0;
    o.x = Number(opts.x);
    if (!Number.isFinite(o.x)) o.x = 0;
    o.y = Number(opts.y);
    if (!Number.isFinite(o.y)) o.y = 0;
    o.gravity = boolOption(opts, 'gravity', VEHICLE_DEFAULTS.gravity);
    o.allowSleep = boolOption(opts, 'allowSleep', VEHICLE_DEFAULTS.allowSleep);
    o.visible = boolOption(opts, 'visible', VEHICLE_DEFAULTS.visible);
    o.gripMap = Object.assign({}, DEFAULT_SURFACE_GRIP,
                              (opts.surfaceGrip && typeof opts.surfaceGrip === 'object')
                                  ? opts.surfaceGrip : {});
    o.world = opts.world || null;
    o.groundHeight = (opts.groundHeight === undefined || opts.groundHeight === null)
        ? undefined : Number(opts.groundHeight);
    if (o.groundHeight !== undefined && !Number.isFinite(o.groundHeight)) {
        throw new TypeError('createVehicle: opts.groundHeight должно быть числом');
    }
    // Масса → density: Box2D выводит массу из плотности и площади формы.
    const areaM2 = (o.width / PX_PER_M) * (o.height / PX_PER_M);
    o.density = o.mass / areaM2;
    return o;
}

function clamp(value, min, max) {
    return value < min ? min : (value > max ? max : value);
}

/**
 * Сцепление под точкой. Возвращает данные для `state()` и множитель.
 * Нет `groundAt` — обычное сцепление, никакой ошибки и никакого Re2D.
 */
function readGrip(o, x, y) {
    const world = o.world;
    if (!world || typeof world.groundAt !== 'function') {
        return { source: 'plain', gripScale: o.grip, tags: null, surface: null,
                 height: null, error: null };
    }
    let info;
    try {
        info = (o.groundHeight === undefined)
            ? world.groundAt(x, y, {})
            : world.groundAt(x, y, { h: o.groundHeight });
    } catch (e) {
        // groundAt честно бросает RangeError на неоднозначном этаже. Машина
        // не должна падать из-за отсутствия h — едем на обычном сцеплении и
        // рассказываем об этом в state().surfaceError.
        return { source: 'error', gripScale: o.grip, tags: null, surface: null,
                 height: null, error: String((e && e.message) || e) };
    }
    if (!info) {
        // Точка вне пола: тегов нет, сцепление базовое (как в обычной 2D).
        return { source: 'groundAt', gripScale: o.grip, tags: [], surface: null,
                 height: null, error: null };
    }
    const tags = Array.isArray(info.tags) ? info.tags.map((t) => String(t)) : [];
    let surfaceGrip = 1.0;
    let matched = null;
    for (const tag of tags) {
        if (Object.prototype.hasOwnProperty.call(o.gripMap, tag)) {
            surfaceGrip = Number(o.gripMap[tag]);
            matched = tag;
            break;
        }
    }
    if (!Number.isFinite(surfaceGrip)) surfaceGrip = 1.0;
    return {
        source: 'groundAt',
        gripScale: o.grip * surfaceGrip,
        tags,
        surface: info.surface === undefined ? null : info.surface,
        height: info.height === undefined ? null : info.height,
        matchedTag: matched,
        error: null,
    };
}

/**
 * Создать машину: узел `$` с динамическим Box2D-телом и контроллером.
 *
 * @param {Function} $ публичный API игры
 * @param {object} opts настройки (см. VEHICLE_DEFAULTS и docs/gta/vehicle.md)
 * @returns {{node:object, body:number, control:Function, state:Function,
 *            config:object, view:object|null}}
 */
export function createVehicle($, opts) {
    if (typeof $ !== 'function') {
        throw new TypeError('createVehicle: нужен публичный $ API');
    }
    const o = normalizeOptions(opts);
    const wrapper = $('<sprite>', {
        w: o.width,
        h: o.height,
        // density читается Box2D при создании тела; fixedRotation снимаем,
        // чтобы тело (и его коробка) реально поворачивалось вместе с рулём.
        density: o.density,
        friction: o.friction,
        restitution: o.restitution,
        fixedRotation: false,
        layerBits: o.layer,
        mask: o.mask,
        group: o.group,
    })
        .at(o.x, o.y)
        .angle(o.angle)
        .depth(o.depth)
        .appendTo($.world);
    if (opts && opts.id !== undefined) wrapper.attr('id', String(opts.id));
    // Тело создаётся ПОСЛЕ size/at/angle: все они уже записаны в узле.
    wrapper.body('dynamic');
    wrapper.allowSleep(o.allowSleep);
    wrapper.gravity(o.gravity);
    const node = wrapper.get(0);
    if (!node || node.body < 0) {
        throw new Error('createVehicle: движок не создал Box2D-тело');
    }
    if (!o.visible) wrapper.hide();

    const state = {
        tick: 0,
        throttle: 0, brake: 0, steer: 0, handbrake: false,
        grip: readGrip(o, node.x, node.y),
        braking: false, reversing: false,
    };

    function stateSnapshot() {
        const v = wrapper.velocity();
        const a = node.angle || 0;
        const cos = Math.cos(a);
        const sin = Math.sin(a);
        const forward = v.x * cos + v.y * sin;
        const lateral = -v.x * sin + v.y * cos;
        return {
            x: node.x,
            y: node.y,
            angle: a,
            vx: v.x,
            vy: v.y,
            forwardSpeed: forward,
            lateralSpeed: lateral,
            speed: Math.hypot(v.x, v.y),
            throttle: state.throttle,
            brake: state.brake,
            steer: state.steer,
            handbrake: state.handbrake,
            braking: state.braking,
            reversing: state.reversing,
            gripScale: state.grip.gripScale,
            surfaceSource: state.grip.source,
            tags: state.grip.tags ? state.grip.tags.slice() : null,
            surface: state.grip.surface,
            groundHeight: state.grip.height,
            matchedTag: state.grip.matchedTag || null,
            surfaceError: state.grip.error,
            mass: wrapper.mass(),
            maxSpeed: o.maxSpeed,
            reverseMaxSpeed: o.reverseMaxSpeed,
            angularVelocity: wrapper.angularVelocity(),
            body: node.body,
            tick: state.tick,
        };
    }

    /**
     * Один тик управления. dt — секунды (в детерминированном прогоне —
     * `--fixed-dt`). Возвращает снимок состояния.
     */
    function control(input, dt) {
        const inp = input || {};
        let throttle = Number(inp.throttle);
        if (!Number.isFinite(throttle)) throttle = 0;
        let brake = Number(inp.brake);
        if (!Number.isFinite(brake)) brake = 0;
        let steer = Number(inp.steer);
        if (!Number.isFinite(steer)) steer = 0;
        const handbrake = inp.handbrake === true;
        throttle = clamp(throttle, -1, 1);
        brake = clamp(brake, 0, 1);
        steer = clamp(steer, -1, 1);

        // Игровое время: нулевой/огромный dt не ломает физику.
        const step = Number(dt);
        if (!Number.isFinite(step) || step <= 0) {
            state.throttle = throttle;
            state.brake = brake;
            state.steer = steer;
            state.handbrake = handbrake;
            return stateSnapshot();
        }
        const h = Math.min(step, o.dtMax);

        const v = wrapper.velocity();
        let cos = Math.cos(node.angle || 0);
        let sin = Math.sin(node.angle || 0);
        let vF = v.x * cos + v.y * sin;

        // --- Продольная тяга / тормоз / реверс -------------------------------
        const engineAccel = o.engineForce / o.mass;
        const brakeAccel = o.brakeForce / o.mass;
        let drive = 0;
        let braking = false;
        let reversing = false;
        if (brake > 0) {
            if (vF > o.stopEps) {
                drive = -brakeAccel * brake;
                braking = true;
            } else {
                drive = -engineAccel * brake;   // стоим — тормоз становится реверсом
                reversing = true;
            }
        } else if (throttle > 0) {
            if (vF < -o.stopEps) {
                drive = brakeAccel * throttle;  // сначала погасить реверс
                braking = true;
            } else {
                drive = engineAccel * throttle;
            }
        } else if (throttle < 0) {
            if (vF > o.stopEps) {
                drive = -brakeAccel * (-throttle);
                braking = true;
            } else {
                drive = engineAccel * throttle; // throttle уже отрицательный
                reversing = true;
            }
        }

        // Сцепление поверхности масштабирует и тягу, и торможение: на траве
        // машина разгоняется хуже, на воде почти не тянет. Ни maxSpeed, ни
        // руль профиль не меняет — «меняется только сцепление».
        const grip = readGrip(o, node.x, node.y);
        const g = Math.max(0, grip.gripScale);
        if (handbrake) {
            // Ручник тормозит только когда водитель не просит тягу.
            if (throttle <= 0 && brake <= 0 && Math.abs(vF) > o.stopEps) {
                drive -= Math.sign(vF) * brakeAccel * o.handbrakeBrake;
            }
        }

        // Добавляем продольную скорость (эквивалент импульса force·dt).
        const vx0 = v.x + cos * drive * g * h;
        const vy0 = v.y + sin * drive * g * h;

        // --- Пределы и боковое сцепление ------------------------------------
        vF = vx0 * cos + vy0 * sin;
        let vR = -vx0 * sin + vy0 * cos;
        if (vF > o.maxSpeed) vF = o.maxSpeed;
        if (vF < -o.reverseMaxSpeed) vF = -o.reverseMaxSpeed;

        const lateralRate = o.lateralGrip * g * (handbrake ? o.handbrakeGrip : 1);
        vR *= Math.exp(-lateralRate * h);

        const drag = Math.exp(-o.drag * h);
        vF *= drag;
        vR *= drag;
        if (handbrake && throttle <= 0 && brake <= 0) {
            vF *= Math.exp(-o.handbrakeDrag * h);
        }

        // --- Руль -----------------------------------------------------------
        // Руление считается по СКОРОСТИ ПОСЛЕ тяги, поэтому на месте машина
        // не крутится; на малой скорости включается подруливание, а знак
        // продольной скорости переворачивает руль задним ходом.
        const steerAngle = steer * o.steerSpeed;
        let yawTarget = (vF / o.wheelbase) * Math.tan(steerAngle);
        const speedAbs = Math.abs(vF);
        const lowBlend = Math.max(0, 1 - speedAbs / Math.max(1, o.lowSpeed));
        const driveDir = vF > o.stopEps ? 1
            : (vF < -o.stopEps ? -1 : (drive > 0 ? 1 : (drive < 0 ? -1 : 0)));
        yawTarget += steer * o.steerRate * o.lowSpeedAssist * lowBlend * driveDir;
        if (handbrake) yawTarget *= o.handbrakeTurn;
        yawTarget = clamp(yawTarget, -o.steerRate, o.steerRate);

        const wNow = wrapper.angularVelocity();
        const response = Math.abs(steer) > 0.001 ? o.steerResponse : o.angularDrag;
        const wNext = wNow + (yawTarget - wNow) * (1 - Math.exp(-response * h));
        wrapper.angularVelocity(wNext);

        // Скорость следует за рулём не мгновенно: доля поворота, которую
        // получает вектор скорости, растёт со сцеплением. На асфальте машина
        // едет туда, куда смотрит; на траве/воде и с ручником вектор остаётся
        // прежним — появляется боковой снос, который гасит lateralGrip.
        // Без этого «повернуть корпус» означало бы мгновенно потерять скорость
        // в боковом гашении — машина останавливалась бы на каждом повороте.
        const alignRate = o.tractionRate * g * (handbrake ? o.handbrakeGrip : 1);
        const align = 1 - Math.exp(-alignRate * h);
        const rotate = wNext * h * align;
        const cr = Math.cos(rotate);
        const sr = Math.sin(rotate);
        const wx = cos * vF - sin * vR;
        const wy = sin * vF + cos * vR;
        const vx = wx * cr - wy * sr;
        const vy = wx * sr + wy * cr;
        wrapper.velocity(vx, vy);

        state.tick += 1;
        state.throttle = throttle;
        state.brake = brake;
        state.steer = steer;
        state.handbrake = handbrake;
        state.grip = grip;
        state.braking = braking;
        state.reversing = reversing;
        return stateSnapshot();
    }

    const vehicle = {
        node,
        control,
        state: stateSnapshot,
        config: o,
        surfaceAt(x, y) {
            return readGrip(o, x === undefined ? node.x : Number(x),
                            y === undefined ? node.y : Number(y));
        },
    };
    Object.defineProperty(vehicle, 'body', {
        enumerable: true,
        get() { return node.body; },
    });
    // Вид подключается отдельным модулем (data-only): сама машина остаётся
    // физикой, vehicle_view — только картинкой.
    vehicle.view = null;
    return vehicle;
}

export default createVehicle;
