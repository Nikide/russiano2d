#include "physics.h"

#include <SDL3/SDL.h>   // SDL_zero и прочие макросы ядра

#include <math.h>

// Пиксели ↔ метры.
#define R2D_TO_M(px) ((px) / R2D_PX_PER_M)
#define R2D_TO_PX(m) ((m) * R2D_PX_PER_M)

// ---------------------------------------------------------------------------
// §7. Ошибки физики: машиночитаемое кольцо
//
// Лог человека и ответ машине — разные вещи (§17): игра и агент должны
// видеть, ЧТО именно не создалось и почему, а не искать строку в stderr.
// Записи не теряются при нескольких ошибках подряд (кольцо на 16).
// ---------------------------------------------------------------------------

static void r2d__push_error(R2DPhysics *p, int code, int body, int shape,
                            float value, const char *detail)
{
    if (!p) return;
    if (p->error_count >= R2D_MAX_PHYSICS_ERRORS) p->error_overflow = true;
    R2DPhysicsError *e = &p->errors[p->error_head];
    p->error_head = (p->error_head + 1) % R2D_MAX_PHYSICS_ERRORS;
    if (p->error_count < R2D_MAX_PHYSICS_ERRORS) p->error_count++;
    p->error_total++;
    SDL_zerop(e);
    e->code = code;
    e->body = body;
    e->shape = shape;
    e->value = value;
    if (detail) {
        SDL_strlcpy(e->detail, detail, R2D_PHYSICS_DETAIL_MAX);
    }
}

int r2d_physics_errors(const R2DPhysics *p, R2DPhysicsError *out, int cap, bool *overflow)
{
    if (overflow) *overflow = p ? p->error_overflow : false;
    if (!p || !out || cap <= 0) return 0;
    const int total = p->error_count;
    const int n = total < cap ? total : cap;
    const int start = (p->error_head - total + R2D_MAX_PHYSICS_ERRORS) % R2D_MAX_PHYSICS_ERRORS;
    for (int i = 0; i < n; ++i) {
        out[i] = p->errors[(start + i) % R2D_MAX_PHYSICS_ERRORS];
    }
    return n;
}

void r2d_physics_clear_errors(R2DPhysics *p)
{
    if (!p) return;
    p->error_head = 0;
    p->error_count = 0;
    p->error_total = 0;
    p->error_overflow = false;
}

// ---------------------------------------------------------------------------
// Односторонние платформы
//
// Box2D не знает про «пройти сквозь снизу» — это делается на pre-solve:
// контакт разрешается, только если тело приближается с лицевой стороны
// платформы. Нормаль лицевой стороны хранится в системе тела, поэтому
// повёрнутая платформа работает правильно.
// ---------------------------------------------------------------------------

// Наш id тела по форме: кладём его в user data формы при создании.
// user data формы кодирует И тело, И номер формы: (id + 1) << 8 | index.
// Так у одного тела может быть несколько форм, и в событиях контакта видно,
// КАКАЯ форма столкнулась («попал в голову, а не в ногу»). Младшие 8 бит —
// индекс формы, поэтому форм на тело не больше 256 (нам хватает 16).
#define R2D__SHAPE_TAG(body_id, index) \
    ((void *)(intptr_t)((((intptr_t)(body_id) + 1) << 8) | ((index) & 0xff)))

static int r2d__body_id_of_shape(b2ShapeId shape)
{
    if (!b2Shape_IsValid(shape)) return -1;
    void *ud = b2Shape_GetUserData(shape);
    return (int)(((intptr_t)ud >> 8) - 1);
}

/** Номер формы в теле (0 — основная). -1, если форма не наша. */
static int r2d__shape_index_of_shape(b2ShapeId shape)
{
    if (!b2Shape_IsValid(shape)) return -1;
    void *ud = b2Shape_GetUserData(shape);
    if (!ud) return -1;
    return (int)((intptr_t)ud & 0xff);
}

static bool r2d__pre_solve(b2ShapeId shape_a, b2ShapeId shape_b,
                           b2Manifold *manifold, void *context)
{
    R2DPhysics *p = (R2DPhysics *)context;
    if (!p || !manifold || manifold->pointCount == 0) return true;

    const int id_a = r2d__body_id_of_shape(shape_a);
    const int id_b = r2d__body_id_of_shape(shape_b);

    const bool ow_a = (id_a >= 0 && id_a < R2D_MAX_BODIES && p->one_way[id_a]);
    const bool ow_b = (id_b >= 0 && id_b < R2D_MAX_BODIES && p->one_way[id_b]);
    if (!ow_a && !ow_b) return true;

    // Спрыгивание: тело, которому сейчас запрещено опираться на односторонние
    // платформы, не сталкивается с ними вовсе. Проверяем до нормалей — для
    // пропускаемой пары незачем считать поворот и скалярное произведение.
    if (ow_a && id_b >= 0 && id_b < R2D_MAX_BODIES && p->one_way_ignore[id_b]) return false;
    if (ow_b && id_a >= 0 && id_a < R2D_MAX_BODIES && p->one_way_ignore[id_a]) return false;

    // Нормаль манифолда направлена от A к B. Для платформы нужна её
    // мировая нормаль: поворачиваем локальную на угол тела.
    b2Vec2 n;
    if (ow_a) {
        const b2Rot rot = b2Body_GetRotation(b2Shape_GetBody(shape_a));
        n = b2RotateVector(rot, (b2Vec2){ p->one_way_nx[id_a], p->one_way_ny[id_a] });
    } else {
        const b2Rot rot = b2Body_GetRotation(b2Shape_GetBody(shape_b));
        n = b2RotateVector(rot, (b2Vec2){ p->one_way_nx[id_b], p->one_way_ny[id_b] });
    }

    // dot(нормаль_контакта, мировая_нормаль_платформы) > 0 — тело сверху.
    // Если платформа оказалась B, знак нормали контакта обратный.
    const b2Vec2 mn = manifold->normal;
    const float dot = mn.x * n.x + mn.y * n.y;
    const float side = ow_a ? dot : -dot;

    // Порог в 0.1 отсекает «касательные» контакты у самой кромки: иначе
    // игрок иногда цепляется за угол платформы, пролетая мимо снизу.
    return side > 0.1f;
}

void r2d_physics_init(R2DPhysics *p, float gravity_x, float gravity_y)
{
    SDL_zero(*p);

    b2WorldDef def = b2DefaultWorldDef();
    // Гравитация приходит в пикселях на секунду в квадрате.
    def.gravity = (b2Vec2){ R2D_TO_M(gravity_x), R2D_TO_M(gravity_y) };
    // Поднимаем лимит скорости: тела в мире измеряются метрами, а игрок
    // в платформере легко разгоняется до 10+ м/с.
    def.maximumLinearSpeed = 120.0f;
    // События контактов и pre-solve включаются на конкретной форме
    // (b2ShapeDef), а не на мире: платим только за нужные тела.
    p->world = b2CreateWorld(&def);
    // Ось сустава по умолчанию — вдоль X (для prismatic и wheel).
    p->joint_axis_x = 1.0f;
    p->joint_axis_y = 0.0f;
    p->world_valid = b2World_IsValid(p->world);

    if (!p->world_valid) {
        R2D_ERROR("не удалось создать мир Box2D");
        return;
    }

    b2World_SetPreSolveCallback(p->world, r2d__pre_solve, p);
}

void r2d_physics_shutdown(R2DPhysics *p)
{
    if (p->world_valid) {
        b2DestroyWorld(p->world);
    }
    SDL_zero(*p);
}

// ---------------------------------------------------------------------------
// §7. Служебное для событий контакта
// ---------------------------------------------------------------------------

/** Общие поля события: тела, формы, поколения, признак сенсора. */
static void r2d__event_bodies(R2DPhysics *p, R2DContactEvent *c,
                              b2ShapeId sa, b2ShapeId sb)
{
    c->a = r2d__body_id_of_shape(sa);
    c->b = r2d__body_id_of_shape(sb);
    c->shape_a = r2d__shape_index_of_shape(sa);
    c->shape_b = r2d__shape_index_of_shape(sb);
    c->gen_a = (c->a >= 0 && c->a < R2D_MAX_BODIES) ? p->generations[c->a] : 0;
    c->gen_b = (c->b >= 0 && c->b < R2D_MAX_BODIES) ? p->generations[c->b] : 0;
    c->sensor = (b2Shape_IsValid(sa) && b2Shape_IsSensor(sa))
             || (b2Shape_IsValid(sb) && b2Shape_IsSensor(sb));
}

/** Есть ли пара (a, b) в списке этого кадра. */
static bool r2d__pair_seen(const int *list, int count, int a, int b)
{
    for (int i = 0; i + 1 < count; i += 2) {
        if (list[i] == a && list[i + 1] == b) return true;
    }
    return false;
}

/** Запомнить пару (a, b) этого кадра. */
static void r2d__pair_add(int *list, int *count, int cap, int a, int b)
{
    if (list == NULL || count == NULL) return;
    if (*count + 2 > cap) return;
    if (r2d__pair_seen(list, *count, a, b)) return;
    list[*count] = a;
    list[*count + 1] = b;
    *count += 2;
}

/** Четвёрка (тело, форма) уже дала stay в этом кадре? Порядок пар не важен. */
static bool r2d__stay_seen(const R2DPhysics *p, int a, int sa, int b, int sb)
{
    for (int i = 0; i + 3 < p->stay_count; i += 4) {
        const bool same = p->stay_pairs[i] == a && p->stay_pairs[i + 1] == sa
                       && p->stay_pairs[i + 2] == b && p->stay_pairs[i + 3] == sb;
        const bool mirror = p->stay_pairs[i] == b && p->stay_pairs[i + 1] == sb
                         && p->stay_pairs[i + 2] == a && p->stay_pairs[i + 3] == sa;
        if (same || mirror) return true;
    }
    return false;
}

static void r2d__stay_add(R2DPhysics *p, int a, int sa, int b, int sb)
{
    if (p->stay_count + 4 > R2D_MAX_CONTACT_EVENTS * 4) return;
    p->stay_pairs[p->stay_count++] = a;
    p->stay_pairs[p->stay_count++] = sa;
    p->stay_pairs[p->stay_count++] = b;
    p->stay_pairs[p->stay_count++] = sb;
}

/**
 * §7. Фаза stay для тел, которые её запросили.
 *
 * Box2D присылает begin/end/hit, но не «всё ещё касаюсь»: это состояние
 * читается из текущих контактов тела. Обход делается ТОЛЬКО для тел с
 * включённым stay (r2d_physics_set_contact_stay) — иначе цена платилась бы
 * всеми динамическими телами каждый кадр.
 *
 * Касание, начавшееся в этом же кадре, пропускается: у него уже есть begin.
 * Один контакт, который видят оба участника, отправляется один раз.
 */
static void r2d__collect_stay(R2DPhysics *p)
{
    bool any = false;
    for (int i = 0; i < R2D_MAX_BODIES; ++i) {
        if (p->alive[i] && p->contact_stay[i]) { any = true; break; }
    }
    if (!any) return;

    b2ContactData data[R2D_MAX_SHAPES_PER_BODY * 4];
    const int cap = (int)(sizeof data / sizeof data[0]);
    for (int id = 0; id < R2D_MAX_BODIES; ++id) {
        if (!p->alive[id] || !p->contact_stay[id]) continue;
        const int n = b2Body_GetContactData(p->bodies[id], data, cap);
        for (int i = 0; i < n && p->contact_count < R2D_MAX_CONTACT_EVENTS; ++i) {
            if (data[i].manifold.pointCount == 0) continue;
            const int a = r2d__body_id_of_shape(data[i].shapeIdA);
            const int b = r2d__body_id_of_shape(data[i].shapeIdB);
            if (a < 0 || b < 0) continue;
            if (r2d__pair_seen(p->began_pairs, p->began_count, a, b)) continue;
            const int sa = r2d__shape_index_of_shape(data[i].shapeIdA);
            const int sb = r2d__shape_index_of_shape(data[i].shapeIdB);
            if (r2d__stay_seen(p, a, sa, b, sb)) continue;
            r2d__stay_add(p, a, sa, b, sb);

            R2DContactEvent *c = &p->contacts[p->contact_count++];
            SDL_zerop(c);
            c->kind = R2D_CONTACT_STAY;
            r2d__event_bodies(p, c, data[i].shapeIdA, data[i].shapeIdB);
            if (!c->sensor) {
                c->nx = data[i].manifold.normal.x;
                c->ny = data[i].manifold.normal.y;
                c->has_normal = true;
            }
            c->px = R2D_TO_PX(data[i].manifold.points[0].point.x);
            c->py = R2D_TO_PX(data[i].manifold.points[0].point.y);
            c->has_point = true;
        }
    }
}

void r2d_physics_step(R2DPhysics *p, float dt)
{
    if (!p->world_valid || dt <= 0.0f) return;
    // 4 подшага — стандартное значение Box2D для устойчивых стопок.
    b2World_Step(p->world, dt, 4);
    r2d_physics_sync(p);

    // События контактов: за кадр физика делает до пяти подшагов, а JS читает
    // буфер один раз. Поэтому за кадр буфер НЕ обнуляем (это делает
    // r2d_physics_begin_contacts), а копим события всех подшагов — иначе
    // выживали бы только события последнего и урон «через раз» терялся.
    if (!p->contact_accumulating) {
        p->contact_count = 0;
        p->began_count = 0;
        p->ended_count = 0;
        p->stay_count = 0;
    }
    if (!p->world_valid) return;
    const b2ContactEvents ev = b2World_GetContactEvents(p->world);

    // §7: пары этого кадра. begin нужен, чтобы stay не повторял уже
    // отправленный begin; end — чтобы один и тот же разрыв не пришёл дважды
    // (у пары может закончиться несколько форм подряд).
    for (int i = 0; i < ev.beginCount && p->contact_count < R2D_MAX_CONTACT_EVENTS; ++i) {
        const b2ContactBeginTouchEvent *e = &ev.beginEvents[i];
        R2DContactEvent *c = &p->contacts[p->contact_count++];
        SDL_zerop(c);
        c->kind = R2D_CONTACT_BEGIN;
        r2d__event_bodies(p, c, e->shapeIdA, e->shapeIdB);
        // Манифолд begin-события записан до солвера: точка есть, импульс нулевой.
        if (e->manifold.pointCount > 0) {
            c->px = R2D_TO_PX(e->manifold.points[0].point.x);
            c->py = R2D_TO_PX(e->manifold.points[0].point.y);
            c->has_point = true;
        }
        // У сенсора контактной нормали нет: Box2D отдаёт для него нулевой
        // манифолд, и «нормаль 0,0» была бы выдумкой (§7).
        if (!c->sensor) {
            c->nx = e->manifold.normal.x;
            c->ny = e->manifold.normal.y;
            c->has_normal = true;
        }
        r2d__pair_add(p->began_pairs, &p->began_count, R2D_MAX_CONTACT_EVENTS * 2, c->a, c->b);
    }
    for (int i = 0; i < ev.endCount && p->contact_count < R2D_MAX_CONTACT_EVENTS; ++i) {
        const b2ContactEndTouchEvent *e = &ev.endEvents[i];
        const int a = r2d__body_id_of_shape(e->shapeIdA);
        const int b = r2d__body_id_of_shape(e->shapeIdB);
        // Повторный end по той же паре тел в одном кадре не отправляем: у игры
        // на узле одно событие `separate`, и два подряд — это баг для неё.
        if (r2d__pair_seen(p->ended_pairs, p->ended_count, a, b)) continue;
        R2DContactEvent *c = &p->contacts[p->contact_count++];
        SDL_zerop(c);
        c->kind = R2D_CONTACT_END;
        r2d__event_bodies(p, c, e->shapeIdA, e->shapeIdB);
        r2d__pair_add(p->ended_pairs, &p->ended_count, R2D_MAX_CONTACT_EVENTS * 2, a, b);
    }
    for (int i = 0; i < ev.hitCount && p->contact_count < R2D_MAX_CONTACT_EVENTS; ++i) {
        const b2ContactHitEvent *e = &ev.hitEvents[i];
        R2DContactEvent *c = &p->contacts[p->contact_count++];
        SDL_zerop(c);
        c->kind = R2D_CONTACT_HIT;
        r2d__event_bodies(p, c, e->shapeIdA, e->shapeIdB);
        c->nx = e->normal.x;
        c->ny = e->normal.y;
        c->px = R2D_TO_PX(e->point.x);
        c->py = R2D_TO_PX(e->point.y);
        c->speed = R2D_TO_PX(e->approachSpeed);
        c->has_normal = true;
        c->has_point = true;
    }
    // §7: сенсоры. У Box2D для них ОТДЕЛЬНЫЙ поток событий: манифолда и
    // нормали нет вовсе, поэтому has_normal = has_point = false. «Нормаль 0,0»
    // для сенсора была бы выдумкой (hurtbox не имеет поверхности).
    const b2SensorEvents sev = b2World_GetSensorEvents(p->world);
    for (int i = 0; i < sev.beginCount && p->contact_count < R2D_MAX_CONTACT_EVENTS; ++i) {
        const b2SensorBeginTouchEvent *e = &sev.beginEvents[i];
        R2DContactEvent *c = &p->contacts[p->contact_count++];
        SDL_zerop(c);
        c->kind = R2D_CONTACT_BEGIN;
        r2d__event_bodies(p, c, e->sensorShapeId, e->visitorShapeId);
        c->sensor = true;
        r2d__pair_add(p->began_pairs, &p->began_count, R2D_MAX_CONTACT_EVENTS * 2, c->a, c->b);
    }
    for (int i = 0; i < sev.endCount && p->contact_count < R2D_MAX_CONTACT_EVENTS; ++i) {
        const b2SensorEndTouchEvent *e = &sev.endEvents[i];
        const int a = r2d__body_id_of_shape(e->sensorShapeId);
        const int b = r2d__body_id_of_shape(e->visitorShapeId);
        if (r2d__pair_seen(p->ended_pairs, p->ended_count, a, b)) continue;
        R2DContactEvent *c = &p->contacts[p->contact_count++];
        SDL_zerop(c);
        c->kind = R2D_CONTACT_END;
        r2d__event_bodies(p, c, e->sensorShapeId, e->visitorShapeId);
        c->sensor = true;
        r2d__pair_add(p->ended_pairs, &p->ended_count, R2D_MAX_CONTACT_EVENTS * 2, a, b);
    }
    // §7: фаза stay — для тел, которые её попросили. Касание, начавшееся в этом
    // же кадре, не дублируется: у него уже есть begin.
    r2d__collect_stay(p);
    if (p->contact_count >= R2D_MAX_CONTACT_EVENTS && !p->overflow_logged) {
        p->overflow_logged = true;
        R2D_WARN("события контакта: буфер переполнен, часть событий в кадре потеряна");
    }
}

const R2DContactEvent *r2d_physics_contacts(const R2DPhysics *p, int *count)
{
    if (count) *count = p ? p->contact_count : 0;
    return p ? p->contacts : NULL;
}

void r2d_physics_clear_contacts(R2DPhysics *p)
{
    if (p) {
        p->contact_count = 0;
        p->contact_accumulating = false;
        p->began_count = 0;
        p->ended_count = 0;
        p->stay_count = 0;
    }
}

void r2d_physics_begin_contacts(R2DPhysics *p)
{
    if (p) {
        p->contact_count = 0;
        p->contact_accumulating = true;
        // §7: пары кадра считаются заново — иначе end «прошлого» кадра
        // подавил бы законный end нового.
        p->began_count = 0;
        p->ended_count = 0;
        p->stay_count = 0;
    }
}

void r2d_physics_sync(R2DPhysics *p)
{
    if (!p->world_valid) return;
    for (int i = 0; i < R2D_MAX_BODIES; ++i) {
        if (!p->alive[i]) continue;
        const b2Vec2 pos = b2Body_GetPosition(p->bodies[i]);
        const float angle = b2Rot_GetAngle(b2Body_GetRotation(p->bodies[i]));
        // Наружу отдаём пиксели — рендер и игровой код живут в них.
        p->transforms[i * 3 + 0] = R2D_TO_PX(pos.x);
        p->transforms[i * 3 + 1] = R2D_TO_PX(pos.y);
        p->transforms[i * 3 + 2] = angle;
    }
}

// ---------------------------------------------------------------------------
// §7. Валидация формы ДО создания тела
//
// Раньше вырожденный полигон молча становился прямоугольником — игра получала
// не тот силуэт, о котором просила, и узнавала об этом только по странной
// физике. Теперь контур проверяется до b2CreateBody: при отказе тела НЕТ, а в
// кольце ошибок лежит код и причина, которые видит агент.
//
// Что считается корректным:
//   * полигон — 3..8 точек, все координаты конечные, площадь не ~0, соседние
//     точки не совпадают и Box2D строит из них выпуклый контур (hull >= 3);
//   * капсула — конечные half_h >= 0 и radius; radius <= 0 означает «взять из
//     half_w/16» (документированное умолчание), а не мусор;
//   * круг — конечный radius;
//   * прямоугольник — конечные неотрицательные полуразмеры (0 = умолчание 16).
// ---------------------------------------------------------------------------

static bool r2d__finite(float v) { return isfinite(v) != 0; }

static bool r2d__validate_desc(R2DPhysics *p, const R2DBodyDesc *d, int body, int shape_index)
{
    if (!r2d__finite(d->half_w) || !r2d__finite(d->half_h) || !r2d__finite(d->radius)
        || !r2d__finite(d->poly_radius)) {
        r2d__push_error(p, R2D_PERR_SHAPE_INVALID, body, shape_index, 0.0f,
                        "размер формы не число (NaN/Inf)");
        R2D_ERROR("форма тела: размер не число (NaN/Inf)");
        return false;
    }
    switch (d->shape) {
    case R2D_SHAPE_POLYGON: {
        if (d->point_count < 3) {
            r2d__push_error(p, R2D_PERR_SHAPE_INVALID, body, shape_index, (float)d->point_count,
                            "полигон: нужно не меньше 3 точек");
            R2D_ERROR("полигон: точек %d, нужно >= 3 — тело не создано", d->point_count);
            return false;
        }
        if (d->point_count > R2D_MAX_POLY_POINTS) {
            r2d__push_error(p, R2D_PERR_SHAPE_INVALID, body, shape_index, (float)d->point_count,
                            "полигон: больше 8 точек");
            R2D_ERROR("полигон: точек %d, максимум %d — тело не создано",
                      d->point_count, R2D_MAX_POLY_POINTS);
            return false;
        }
        b2Vec2 pts[R2D_MAX_POLY_POINTS];
        for (int i = 0; i < d->point_count; ++i) {
            const float x = d->points[i * 2];
            const float y = d->points[i * 2 + 1];
            if (!r2d__finite(x) || !r2d__finite(y)) {
                r2d__push_error(p, R2D_PERR_SHAPE_INVALID, body, shape_index, (float)i,
                                "полигон: координата не число (NaN/Inf)");
                R2D_ERROR("полигон: точка %d не число — тело не создано", i);
                return false;
            }
            pts[i] = (b2Vec2){ R2D_TO_M(x), R2D_TO_M(y) };
        }
        // Площадь по формуле шнурковки: ноль — контур вырожден (линия/точка).
        double area2 = 0.0;
        for (int i = 0; i < d->point_count; ++i) {
            const b2Vec2 a = pts[i];
            const b2Vec2 b = pts[(i + 1) % d->point_count];
            area2 += (double)a.x * (double)b.y - (double)b.x * (double)a.y;
            const float dx = b.x - a.x, dy = b.y - a.y;
            if (sqrtf(dx * dx + dy * dy) < 1e-4f) {
                r2d__push_error(p, R2D_PERR_SHAPE_INVALID, body, shape_index, (float)i,
                                "полигон: соседние точки совпадают");
                R2D_ERROR("полигон: точки %d и %d совпадают — тело не создано", i,
                          (i + 1) % d->point_count);
                return false;
            }
        }
        if (fabs(area2) < 1e-6) {
            r2d__push_error(p, R2D_PERR_SHAPE_INVALID, body, shape_index, (float)fabs(area2),
                            "полигон: площадь ~0 (контур вырожден)");
            R2D_ERROR("полигон вырожден (площадь ~0) — тело не создано");
            return false;
        }
        const b2Hull hull = b2ComputeHull(pts, d->point_count);
        if (hull.count < 3) {
            r2d__push_error(p, R2D_PERR_SHAPE_INVALID, body, shape_index, (float)hull.count,
                            "полигон: Box2D не построил контур");
            R2D_ERROR("полигон: выпуклый контур не построен — тело не создано");
            return false;
        }
        return true;
    }
    case R2D_SHAPE_CAPSULE:
        if (!r2d__finite(d->half_h) || d->half_h < 0.0f) {
            r2d__push_error(p, R2D_PERR_SHAPE_INVALID, body, shape_index, d->half_h,
                            "капсула: half_h < 0");
            R2D_ERROR("капсула: half_h = %g — тело не создано", (double)d->half_h);
            return false;
        }
        return true;
    case R2D_SHAPE_CIRCLE:
        if (!r2d__finite(d->radius) || d->radius < 0.0f) {
            r2d__push_error(p, R2D_PERR_SHAPE_INVALID, body, shape_index, d->radius,
                            "круг: отрицательный радиус");
            R2D_ERROR("круг: radius = %g — тело не создано", (double)d->radius);
            return false;
        }
        return true;
    default:
        if (d->half_w < 0.0f || d->half_h < 0.0f) {
            r2d__push_error(p, R2D_PERR_SHAPE_INVALID, body, shape_index,
                            d->half_w < 0.0f ? d->half_w : d->half_h,
                            "прямоугольник: отрицательный полуразмер");
            R2D_ERROR("прямоугольник: отрицательный полуразмер — тело не создано");
            return false;
        }
        return true;
    }
}

// Создать форму по описанию. Общий код для основной формы тела и добавочных:
// так «голова» и «нога» описываются одним и тем же R2DBodyDesc.
//
// `dx`/`dy` — смещение формы от центра тела, `angle` — её собственный поворот
// (радианы). У основной формы тела поворот всегда 0: её вращает само тело.
// Собственный угол нужен областям (§40): прямоугольник оружия наклонён
// относительно тела и пересобирается при смене прицела.
//
// Вызывается ТОЛЬКО после r2d__validate_desc: вырожденного полигона здесь уже
// не бывает, и прямоугольной подмены тоже (см. §7).
static b2ShapeId r2d__make_shape(b2BodyId body, const b2ShapeDef *sd, const R2DBodyDesc *d,
                                 float dx, float dy, float angle)
{
    const b2Rot rot = b2MakeRot(angle);
    const b2Vec2 offset = { R2D_TO_M(dx), R2D_TO_M(dy) };
    b2ShapeId shape;
    switch (d->shape) {
    case R2D_SHAPE_CIRCLE: {
        const b2Circle c = { offset,
                             R2D_TO_M(d->radius > 0.0f ? d->radius : 16.0f) };
        shape = b2CreateCircleShape(body, sd, &c);
        break;
    }
    case R2D_SHAPE_CAPSULE: {
        // Капсула растёт вдоль оси Y: half_h — половина отрезка, radius — скругление.
        const float hh = R2D_TO_M(d->half_h);
        const b2Vec2 axis = b2RotateVector(rot, (b2Vec2){ 0.0f, hh });
        const b2Capsule cap = { { offset.x - axis.x, offset.y - axis.y },
                                { offset.x + axis.x, offset.y + axis.y },
                                R2D_TO_M(d->radius > 0.0f ? d->radius : (d->half_w > 0.0f ? d->half_w : 16.0f)) };
        shape = b2CreateCapsuleShape(body, sd, &cap);
        break;
    }
    case R2D_SHAPE_POLYGON: {
        const int n = d->point_count < 3 ? 0
                     : (d->point_count > R2D_MAX_POLY_POINTS ? R2D_MAX_POLY_POINTS : d->point_count);
        if (n >= 3) {
            b2Vec2 pts[R2D_MAX_POLY_POINTS];
            for (int i = 0; i < n; ++i) {
                const b2Vec2 local = b2RotateVector(rot,
                    (b2Vec2){ R2D_TO_M(d->points[i * 2]), R2D_TO_M(d->points[i * 2 + 1]) });
                pts[i] = (b2Vec2){ local.x + offset.x, local.y + offset.y };
            }
            const b2Hull hull = b2ComputeHull(pts, n);
            if (hull.count >= 3) {
                const b2Polygon poly = b2MakePolygon(&hull, R2D_TO_M(d->poly_radius));
                shape = b2CreatePolygonShape(body, sd, &poly);
                break;
            }
            // Сюда попасть нельзя: контур проверен r2d__validate_desc до
            // создания тела. Молчаливой подмены прямоугольником больше нет —
            // если инвариант нарушен, форма не создаётся вовсе (§7).
            R2D_ERROR("полигон прошёл валидацию, но Box2D не построил контур");
            return b2_nullShapeId;
        }
        R2D_ERROR("полигон: точек %d, нужно >= 3 (валидация не сработала)", n);
        return b2_nullShapeId;
    }
    default: {
        // Смещение задаёт зону: «голова» выше центра, «ноги» ниже.
        const float hx = R2D_TO_M(d->half_w > 0.0f ? d->half_w : 16.0f);
        const float hy = R2D_TO_M(d->half_h > 0.0f ? d->half_h : 16.0f);
        const b2Polygon box = (dx != 0.0f || dy != 0.0f || angle != 0.0f)
            ? b2MakeOffsetBox(hx, hy, offset, rot)
            : b2MakeBox(hx, hy);
        shape = b2CreatePolygonShape(body, sd, &box);
        break;
    }
    }
    return shape;
}

/** Найти форму тела по НАШЕМУ индексу (0 — основная, дальше добавленные). */
static b2ShapeId r2d__shape_at(const R2DPhysics *p, int id, int index)
{
    if (!p || id < 0 || id >= R2D_MAX_BODIES || !p->alive[id]) return b2_nullShapeId;
    b2ShapeId shapes[R2D_MAX_SHAPES_PER_BODY];
    const int count = b2Body_GetShapes(p->bodies[id], shapes,
                                       (int)(sizeof shapes / sizeof shapes[0]));
    for (int i = 0; i < count; ++i) {
        if (r2d__shape_index_of_shape(shapes[i]) == index) return shapes[i];
    }
    return b2_nullShapeId;
}

/** Фильтр и события формы по описанию (общий код создания и пересборки). */
static b2ShapeDef r2d__shape_def(const R2DBodyDesc *d)
{
    b2ShapeDef sd = b2DefaultShapeDef();
    sd.density = d->density > 0.0f ? d->density : 1.0f;
    // Плотность 0 — «форма не участвует в массе тела»: так области §40 не
    // меняют массу и инерцию владельца (внутреннее представление не должно
    // менять gameplay). У основной формы тела плотность > 0.
    sd.updateBodyMass = d->density > 0.0f;
    sd.material.friction    = d->friction;
    sd.material.restitution = d->restitution;
    sd.isSensor = d->sensor;
    sd.enableContactEvents = d->contacts || d->one_way;
    sd.enableHitEvents     = d->contacts;
    sd.enablePreSolveEvents = d->one_way;
    // §7: у сенсора своя пара событий (b2SensorEvents) — манифолда и нормали у
    // неё нет, и придумывать их нельзя. Box2D v3 проверяет флаг у ОБЕИХ форм
    // пары (sensor.c: `otherShape->enableSensorEvents == false` — пропуск),
    // поэтому его получают: сенсор, тело с событиями контакта и любое
    // динамическое тело (обычная цель hurtbox). Статичная стена без contacts
    // сенсором не находится — это осознанно и записано в docs/highlevel/collision.md.
    sd.enableSensorEvents = d->sensor || d->contacts || d->type == R2D_BODY_DYNAMIC;
    sd.filter.categoryBits = d->filter_set ? d->category_bits : R2D_FILTER_DEFAULT_CATEGORY;
    sd.filter.maskBits     = d->filter_set ? d->mask_bits     : R2D_FILTER_DEFAULT_MASK;
    sd.filter.groupIndex   = d->filter_set ? d->group_index   : R2D_FILTER_GROUP_NONE;
    return sd;
}


int r2d_physics_create(R2DPhysics *p, const R2DBodyDesc *d)
{
    if (!p->world_valid || !d) return -1;

    int id = -1;
    for (int i = 0; i < R2D_MAX_BODIES; ++i) {
        if (!p->alive[i]) { id = i; break; }
    }
    if (id < 0) {
        // Лимит тел — не «тихий отказ»: ошибка уходит и в лог, и в кольцо для
        // машины. Игра по ней понимает, что часть карты осталась без коллизии.
        r2d__push_error(p, R2D_PERR_BODY_LIMIT, -1, -1, (float)R2D_MAX_BODIES,
                        "достигнут лимит тел: тело не создано");
        R2D_ERROR("достигнут лимит физических тел (%d)", R2D_MAX_BODIES);
        return -1;
    }

    // §7: форма проверяется ДО b2CreateBody — некорректный контур не должен
    // тихо превратиться в другое тело.
    if (!r2d__validate_desc(p, d, id, 0)) return -1;

    b2BodyDef def = b2DefaultBodyDef();
    switch (d->type) {
    case R2D_BODY_STATIC:    def.type = b2_staticBody;    break;
    case R2D_BODY_KINEMATIC: def.type = b2_kinematicBody; break;
    default:                  def.type = b2_dynamicBody;    break;
    }
    def.position      = (b2Vec2){ R2D_TO_M(d->x), R2D_TO_M(d->y) };
    def.rotation      = b2MakeRot(d->angle);
    def.fixedRotation = d->fixed_rotation;
    // CCD: Box2D проверяет такое тело непрерывно, поэтому быстрая пуля не
    // проскакивает тонкую стену между подшагами.
    def.isBullet = d->bullet;

    b2BodyId body = b2CreateBody(p->world, &def);
    if (!b2Body_IsValid(body)) {
        R2D_ERROR("b2CreateBody вернул невалидное тело");
        return -1;
    }

    b2ShapeDef sd = r2d__shape_def(d);
    if (sd.filter.categoryBits == 0) {
        // Тело вне всех слоёв не сталкивается ни с кем и не находится
        // запросами — это почти всегда опечатка, а не замысел.
        R2D_WARN("тело создано с categoryBits = 0 (вне всех слоёв) — оно ни с чем не столкнётся");
    }

    // Собственный угол формы основной формы тела всегда 0: её вращает тело
    // (см. r2d__make_shape). Свой угол есть только у областей (§40).
    b2ShapeId shape = r2d__make_shape(body, &sd, d, 0.0f, 0.0f, 0.0f);
    if (!b2Shape_IsValid(shape)) {
        R2D_ERROR("не удалось создать форму тела (kind=%d)", d->shape);
        b2DestroyBody(body);
        return -1;
    }
    b2Shape_SetUserData(shape, R2D__SHAPE_TAG(id, 0));

    p->one_way[id]  = d->one_way;
    p->one_way[id]  = d->one_way;
    // Новое тело не наследует «спрыгивание» от прежнего владельца id.
    p->one_way_ignore[id] = false;
    if (d->one_way) {
        // Лицевая нормаль в системе тела: из мировой поворачиваем на -angle.
        const b2Rot inv = b2MakeRot(-d->angle);
        const float a = d->one_way_angle == 0.0f ? -1.57079633f : d->one_way_angle;
        const b2Vec2 n = b2RotateVector(inv, (b2Vec2){ cosf(a), sinf(a) });
        p->one_way_nx[id] = n.x;
        p->one_way_ny[id] = n.y;
    } else {
        p->one_way_nx[id] = 0.0f;
        p->one_way_ny[id] = -1.0f;
    }

    p->bodies[id] = body;
    p->alive[id]  = true;
    // §7: поколение растёт при каждом создании. Событие контакта несёт его, и
    // JS отличает «то же тело» от «новый узел на том же id».
    p->generations[id]++;
    p->contact_stay[id] = false;
    p->live_count++;
    p->transforms[id * 3 + 0] = d->x;
    p->transforms[id * 3 + 1] = d->y;
    p->transforms[id * 3 + 2] = d->angle;
    return id;
}

/**
 * Добавить телу ЕЩЁ ОДНУ форму.
 *
 * Зачем: у тела может быть несколько зон — «голова» сверху, «тело» посередине,
 * «ноги» снизу. Тогда в событиях контакта видно, КУДА попали: индекс формы
 * приходит в `contactBetween`/`contactsOf` и в полях события.
 *
 * Описание — тот же `R2DBodyDesc`: важны только поля формы (`shape`, размеры,
 * точки, `sensor`). Возвращает индекс новой формы или -1.
 */
int r2d_physics_add_shape(R2DPhysics *p, int id, const R2DBodyDesc *d, float dx, float dy)
{
    if (!p || !p->world_valid || !d) return -1;
    if (id < 0 || id >= R2D_MAX_BODIES || !p->alive[id]) return -1;

    const int index = b2Body_GetShapeCount(p->bodies[id]);
    if (index >= R2D_MAX_SHAPES_PER_BODY) {
        static bool logged = false;
        if (!logged) {
            logged = true;
            R2D_WARN("у тела уже %d форм — лишние не добавляются (R2D_MAX_SHAPES_PER_BODY)",
                     R2D_MAX_SHAPES_PER_BODY);
        }
        r2d__push_error(p, R2D_PERR_SHAPE_INDEX, id, index, (float)R2D_MAX_SHAPES_PER_BODY,
                        "лимит форм тела: форма не добавлена");
        return -1;
    }

    // §7: та же проверка, что при создании тела: область с вырожденным
    // контуром не должна появиться «наполовину».
    if (!r2d__validate_desc(p, d, id, index)) return -1;

    b2ShapeDef sd = b2DefaultShapeDef();
    sd.density = d->density > 0.0f ? d->density : 1.0f;
    // Нулевая плотность = «не пересчитывать массу»: области §40 не меняют
    // массу владельца, зоны $.world.zone плотность не задают (как раньше).
    sd.updateBodyMass = d->density > 0.0f;
    sd.material.friction    = d->friction    >= 0.0f ? d->friction    : 0.2f;
    sd.material.restitution = d->restitution >= 0.0f ? d->restitution : 0.0f;
    sd.isSensor = d->sensor;
    sd.enableContactEvents = d->contacts;
    // §7: сенсор-область (hurtbox/interaction) подписывается на свою пару
    // событий — с манифолдом и нормалью у неё ничего нет.
    // §7: сенсор-область (hurtbox/interaction) и её цели — см. r2d__shape_def.
    sd.enableSensorEvents = d->sensor || d->contacts || d->type == R2D_BODY_DYNAMIC;
    sd.filter.categoryBits = d->filter_set ? d->category_bits : R2D_FILTER_DEFAULT_CATEGORY;
    sd.filter.maskBits     = d->filter_set ? d->mask_bits     : R2D_FILTER_DEFAULT_MASK;
    sd.filter.groupIndex   = d->filter_set ? d->group_index   : R2D_FILTER_GROUP_NONE;

    b2ShapeId shape = r2d__make_shape(p->bodies[id], &sd, d, dx, dy, d->angle);
    if (!b2Shape_IsValid(shape)) {
        R2D_WARN("не удалось добавить форму телу %d (kind=%d)", id, d->shape);
        return -1;
    }
    b2Shape_SetUserData(shape, R2D__SHAPE_TAG(id, index));
    return index;
}

/**
 * §40. Пересобрать ОБЛАСТЬ тела: форму с нашим индексом уничтожить и создать
 * заново по описанию (смещение, угол, размеры, слои, сенсорность).
 *
 * Форма пересобирается, а не двигается: Box2D v3 меняет геометрию формы только
 * через b2Shape_Set*, а проще и надёжнее собрать её тем же кодом, что и при
 * создании. Индекс сохраняется в user data, поэтому маршрутизация контактов
 * (shapeA/shapeB) и область в игре остаются теми же — меняется только
 * native handle, которого игровой код не видит.
 *
 * Возвращает индекс формы или -1.
 */
int r2d_physics_shape_set(R2DPhysics *p, int id, int index, const R2DBodyDesc *d,
                          float dx, float dy, float angle)
{
    if (!p || !p->world_valid || !d) return -1;
    if (id < 0 || id >= R2D_MAX_BODIES || !p->alive[id]) return -1;
    const b2ShapeId old = r2d__shape_at(p, id, index);
    if (!b2Shape_IsValid(old)) {
        r2d__push_error(p, R2D_PERR_SHAPE_INDEX, id, index, -1.0f,
                        "форма с таким индексом не найдена");
        return -1;
    }
    // §7: сначала проверяем НОВОЕ описание, потом уничтожаем старое — иначе
    // отказ оставлял бы тело без формы вовсе.
    if (!r2d__validate_desc(p, d, id, index)) return -1;

    b2ShapeDef sd = r2d__shape_def(d);
    b2DestroyShape(old, true);
    const b2ShapeId shape = r2d__make_shape(p->bodies[id], &sd, d, dx, dy, angle);
    if (!b2Shape_IsValid(shape)) {
        R2D_WARN("не удалось пересобрать форму %d тела %d (kind=%d)", index, id, d->shape);
        return -1;
    }
    b2Shape_SetUserData(shape, R2D__SHAPE_TAG(id, index));
    b2Body_SetAwake(p->bodies[id], true);
    return index;
}

/** Форма включена: фильтр не обнулён (см. r2d_physics_set_shape_enabled). */
static bool r2d__shape_filter_enabled(b2ShapeId shape)
{
    if (!b2Shape_IsValid(shape)) return false;
    const b2Filter f = b2Shape_GetFilter(shape);
    return f.categoryBits != 0 || f.maskBits != 0;
}

/** §40: включена ли форма (false — выключена или формы нет). */
bool r2d_physics_shape_is_enabled(const R2DPhysics *p, int id, int index)
{
    const b2ShapeId shape = r2d__shape_at(p, id, index);
    if (!b2Shape_IsValid(shape)) return false;
    return r2d__shape_filter_enabled(shape);
}

/**
 * §40. Включить/выключить ОБЛАСТЬ, не удаляя её.
 *
 * Выключенная форма получает нулевой фильтр (ни с кем не сталкивается и не
 * находится запросами) и перестаёт присылать события; игровой владелец при
 * этом жив. Включение возвращает фильтр области — он приходит из JS вместе с
 * описанием, потому что описания областей живут на узле и переживают
 * пересоздание тела.
 *
 * События сенсоров здесь не переключаются: движок их не читает, пересечения
 * сенсора считаются явным запросом (r2d_physics_shape_overlaps).
 */
bool r2d_physics_set_shape_enabled(R2DPhysics *p, int id, int index, bool enabled,
                                   uint64_t category_bits, uint64_t mask_bits, int group_index)
{
    if (!p || !p->world_valid) return false;
    const b2ShapeId shape = r2d__shape_at(p, id, index);
    if (!b2Shape_IsValid(shape)) return false;

    b2Filter f = b2Shape_GetFilter(shape);
    if (enabled) {
        f.categoryBits = category_bits == 0 ? R2D_FILTER_DEFAULT_CATEGORY : category_bits;
        f.maskBits     = mask_bits;
        f.groupIndex   = group_index;
    } else {
        f.categoryBits = 0;
        f.maskBits     = 0;
        f.groupIndex   = 0;
    }
    b2Shape_SetFilter(shape, f);
    if (enabled) {
        b2Shape_EnableContactEvents(shape, true);
        b2Shape_EnableHitEvents(shape, true);
        // §7: включение сенсора даёт документированную пару begin/end — для
        // этого у сенсора нужно включить его собственный поток событий.
        b2Shape_EnableSensorEvents(shape, b2Shape_IsSensor(shape));
    } else {
        b2Shape_EnableContactEvents(shape, false);
        b2Shape_EnableHitEvents(shape, false);
        b2Shape_EnableSensorEvents(shape, false);
    }
    b2Body_SetAwake(p->bodies[id], true);
    return true;
}

// Контекст запроса пересечений формы с миром (§40).
typedef struct R2DShapeOverlapCtx {
    int self_body;
    int self_index;
    int *bodies;
    int *shapes;
    int  cap;
    int  count;
} R2DShapeOverlapCtx;

static bool r2d__overlap_cb(b2ShapeId shape, void *context)
{
    R2DShapeOverlapCtx *c = (R2DShapeOverlapCtx *)context;
    const int body = r2d__body_id_of_shape(shape);
    // Своё тело пропускаем: формы одного тела не сталкиваются между собой, и
    // область не должна «находить» владельца.
    if (body < 0 || body == c->self_body) return true;
    if (c->count >= c->cap) return false;
    c->bodies[c->count] = body;
    c->shapes[c->count] = r2d__shape_index_of_shape(shape);
    c->count++;
    return true;
}

/**
 * §40. Кто пересекается с областью ПРЯМО СЕЙЧАС.
 *
 * Это явный геометрический запрос (b2World_OverlapShape), а не история
 * событий: цель, уже стоящая внутри области в момент открытия окна атаки,
 * обнаруживается сразу, без ожидания нового движения. Форма берётся в её
 * текущем мировом положении (трансформ тела + собственное смещение/угол),
 * фильтр — слои области.
 *
 * Возвращает число записанных пар (тело, индекс формы) или -1.
 */
int r2d_physics_shape_overlaps(R2DPhysics *p, int id, int index,
                               uint64_t category_bits, uint64_t mask_bits,
                               int *bodies, int *shapes, int cap)
{
    if (!p || !p->world_valid || !bodies || !shapes || cap <= 0) return -1;
    const b2ShapeId shape = r2d__shape_at(p, id, index);
    if (!b2Shape_IsValid(shape)) return -1;
    // Выключенная область (нулевой фильтр) не участвует в запросах — это
    // единственный источник истины о её состоянии: кто бы её ни выключил
    // (движок §40 или внешний драйвер через setShapeEnabled), результат один.
    if (!r2d__shape_filter_enabled(shape)) return 0;

    // Мировая геометрия формы: точки формы + трансформ тела.
    const b2Transform xf = b2Body_GetTransform(p->bodies[id]);
    b2Vec2 points[B2_MAX_POLYGON_VERTICES];
    int count = 0;
    float radius = 0.0f;
    switch (b2Shape_GetType(shape)) {
    case b2_circleShape: {
        const b2Circle c = b2Shape_GetCircle(shape);
        points[0] = b2TransformPoint(xf, c.center);
        count = 1;
        radius = c.radius;
        break;
    }
    case b2_capsuleShape: {
        const b2Capsule c = b2Shape_GetCapsule(shape);
        points[0] = b2TransformPoint(xf, c.center1);
        points[1] = b2TransformPoint(xf, c.center2);
        count = 2;
        radius = c.radius;
        break;
    }
    case b2_polygonShape: {
        const b2Polygon poly = b2Shape_GetPolygon(shape);
        count = poly.count;
        if (count > B2_MAX_POLYGON_VERTICES) count = B2_MAX_POLYGON_VERTICES;
        for (int i = 0; i < count; ++i) points[i] = b2TransformPoint(xf, poly.vertices[i]);
        radius = poly.radius;
        break;
    }
    default:
        return -1;
    }

    b2ShapeProxy proxy = b2MakeProxy(points, count, radius);
    b2QueryFilter filter;
    filter.categoryBits = category_bits == 0 ? R2D_FILTER_DEFAULT_CATEGORY : category_bits;
    filter.maskBits = mask_bits == 0 ? R2D_FILTER_DEFAULT_MASK : mask_bits;

    R2DShapeOverlapCtx ctx = { id, index, bodies, shapes, cap, 0 };
    b2World_OverlapShape(p->world, &proxy, filter, r2d__overlap_cb, &ctx);
    return ctx.count;
}

/** Сколько форм у тела (0 — тела нет). */
int r2d_physics_shape_count(const R2DPhysics *p, int id)
{
    if (!p || id < 0 || id >= R2D_MAX_BODIES || !p->alive[id]) return 0;
    return b2Body_GetShapeCount(p->bodies[id]);
}

int r2d_physics_create_box(R2DPhysics *p, float x, float y, float half_w, float half_h,
                            float angle, int type, float density, float friction,
                            float restitution, bool fixed_rotation)
{
    R2DBodyDesc d;
    SDL_zero(d);
    d.x = x; d.y = y; d.angle = angle;
    d.type = type;
    d.density = density; d.friction = friction; d.restitution = restitution;
    d.fixed_rotation = fixed_rotation;
    d.shape = R2D_SHAPE_BOX;
    d.half_w = half_w; d.half_h = half_h;
    return r2d_physics_create(p, &d);
}

void r2d_physics_destroy(R2DPhysics *p, int id)
{
    if (!p->world_valid || id < 0 || id >= R2D_MAX_BODIES || !p->alive[id]) return;
    // Суставы, державшиеся за это тело, Box2D уничтожит вместе с ним —
    // помечаем их мёртвыми, чтобы JS не дёргал невалидные id.
    for (int i = 0; i < R2D_MAX_JOINTS; ++i) {
        if (!p->joint_alive[i]) continue;
        const b2BodyId ba = b2Joint_GetBodyA(p->joints[i]);
        const b2BodyId bb = b2Joint_GetBodyB(p->joints[i]);
        if (B2_ID_EQUALS(ba, p->bodies[id]) || B2_ID_EQUALS(bb, p->bodies[id])) {
            p->joint_alive[i] = false;
        }
    }
    b2DestroyBody(p->bodies[id]);
    p->alive[id] = false;
    p->one_way[id] = false;
    // Флаг живёт на теле: новый владелец этого id не должен унаследовать
    // «спрыгивание» от прошлого.
    p->one_way_ignore[id] = false;
    // §7: stay-события снимаются вместе с телом. Поколение НЕ сбрасываем — оно
    // как раз и отличает события уничтоженного тела от нового владельца id.
    p->contact_stay[id] = false;
    p->live_count--;
}

bool r2d_physics_is_alive(const R2DPhysics *p, int id)
{
    if (id < 0 || id >= R2D_MAX_BODIES) return false;
    if (!p->alive[id]) return false;
    return p->world_valid && b2Body_IsValid(p->bodies[id]);
}

int r2d_physics_live_count(const R2DPhysics *p)
{
    return p->live_count;
}

void r2d_physics_set_velocity(R2DPhysics *p, int id, float vx, float vy)
{
    if (!r2d_physics_is_alive(p, id)) return;
    // БУДИМ тело. Box2D засыпает неподвижные тела, а у спящего
    // b2Body_SetLinearVelocity меняет скорость в структуре, но НЕ оживляет
    // тело: мир его не двигает, и игра видит «setVelocity перестал работать»
    // после нескольких секунд покоя. Именно так замирало перетаскивание на
    // x = 628 из 700, а прямой engine.setVelocity(body, 500, 0) давал 0.0009 px
    // за кадр — тело просто спало (engine.isAwake() возвращал false).
    b2Body_SetAwake(p->bodies[id], true);
    b2Body_SetLinearVelocity(p->bodies[id], (b2Vec2){ R2D_TO_M(vx), R2D_TO_M(vy) });
}

void r2d_physics_get_velocity(const R2DPhysics *p, int id, float *vx, float *vy)
{
    if (vx) *vx = 0.0f;
    if (vy) *vy = 0.0f;
    if (!r2d_physics_is_alive(p, id)) return;
    const b2Vec2 v = b2Body_GetLinearVelocity(p->bodies[id]);
    if (vx) *vx = R2D_TO_PX(v.x);
    if (vy) *vy = R2D_TO_PX(v.y);
}

void r2d_physics_set_angular_velocity(R2DPhysics *p, int id, float w)
{
    if (!r2d_physics_is_alive(p, id)) return;
    b2Body_SetAngularVelocity(p->bodies[id], w);
}

float r2d_physics_get_angular_velocity(const R2DPhysics *p, int id)
{
    if (!r2d_physics_is_alive(p, id)) return 0.0f;
    return b2Body_GetAngularVelocity(p->bodies[id]);
}

void r2d_physics_set_position(R2DPhysics *p, int id, float x, float y, float angle)
{
    if (!r2d_physics_is_alive(p, id)) return;
    b2Body_SetTransform(p->bodies[id], (b2Vec2){ R2D_TO_M(x), R2D_TO_M(y) }, b2MakeRot(angle));
    p->transforms[id * 3 + 0] = x;
    p->transforms[id * 3 + 1] = y;
    p->transforms[id * 3 + 2] = angle;
    // Тело, которому задают позицию, тоже обязано проснуться.
    b2Body_SetAwake(p->bodies[id], true);
}

void r2d_physics_apply_impulse(R2DPhysics *p, int id, float ix, float iy)
{
    if (!r2d_physics_is_alive(p, id)) return;
    // Импульс в JS задаётся в «пиксельных» единицах: кг·(пиксель/с).
    b2Body_ApplyLinearImpulseToCenter(p->bodies[id],
                                      (b2Vec2){ R2D_TO_M(ix), R2D_TO_M(iy) }, true);
}

void r2d_physics_set_gravity(R2DPhysics *p, float gx, float gy)
{
    if (!p->world_valid) return;
    b2World_SetGravity(p->world, (b2Vec2){ R2D_TO_M(gx), R2D_TO_M(gy) });
}

void r2d_physics_get_gravity(const R2DPhysics *p, float *gx, float *gy)
{
    if (gx) *gx = 0.0f;
    if (gy) *gy = 0.0f;
    if (!p->world_valid) return;
    const b2Vec2 g = b2World_GetGravity(p->world);
    if (gx) *gx = R2D_TO_PX(g.x);
    if (gy) *gy = R2D_TO_PX(g.y);
}

void r2d_physics_set_awake(R2DPhysics *p, int id, bool awake)
{
    if (!r2d_physics_is_alive(p, id)) return;
    b2Body_SetAwake(p->bodies[id], awake);
}

void r2d_physics_set_sleeping(R2DPhysics *p, int id, bool sleeping)
{
    if (!r2d_physics_is_alive(p, id)) return;
    // Выключенный сон означает «тело всегда бодрое»: его двигает не только
    // импульс, но и прямое управление скоростью из игры (перетаскивание,
    // конвейер, скриптовый телекинез). Проснувшееся тело Box2D усыпит снова
    // через накопленный покой, и setVelocity перестанет действовать — это
    // нашлось тестом: тело замирало ровно там, где уснуло.
    b2Body_EnableSleep(p->bodies[id], !sleeping);
    if (!sleeping) b2Body_SetAwake(p->bodies[id], true);
}

bool r2d_physics_is_sleeping_enabled(const R2DPhysics *p, int id)
{
    if (!r2d_physics_is_alive(p, id)) return true;
    return b2Body_IsSleepEnabled(p->bodies[id]);
}

void r2d_physics_set_enabled(R2DPhysics *p, int id, bool enabled)
{
    if (!r2d_physics_is_alive(p, id)) return;
    if (b2Body_IsEnabled(p->bodies[id]) == enabled) return;
    if (enabled) b2Body_Enable(p->bodies[id]);
    else b2Body_Disable(p->bodies[id]);
}

bool r2d_physics_is_enabled(const R2DPhysics *p, int id)
{
    if (!r2d_physics_is_alive(p, id)) return false;
    return b2Body_IsEnabled(p->bodies[id]);
}

void r2d_physics_set_gravity_scale(R2DPhysics *p, int id, float scale)
{
    if (!r2d_physics_is_alive(p, id)) return;
    b2Body_SetGravityScale(p->bodies[id], scale);
}

void r2d_physics_set_bullet(R2DPhysics *p, int id, bool bullet)
{
    if (!r2d_physics_is_alive(p, id)) return;
    b2Body_SetBullet(p->bodies[id], bullet);
}

bool r2d_physics_is_bullet(const R2DPhysics *p, int id)
{
    if (!r2d_physics_is_alive(p, id)) return false;
    return b2Body_IsBullet(p->bodies[id]);
}

// Спрыгивание вниз с односторонней платформы. Флаг не трогает саму платформу:
// на ней может стоять несколько тел, и «провалиться» должно только то, кому
// это велели. Формально это не выключение столкновений, а их запрет в
// preSolve — так тело не отталкивается от платформы, но остальные пары
// (стены, пол, враги) продолжают работать как обычно.
void r2d_physics_set_one_way_ignore(R2DPhysics *p, int id, bool on)
{
    if (!r2d_physics_is_alive(p, id)) return;
    p->one_way_ignore[id] = on;
}

bool r2d_physics_one_way_ignore(const R2DPhysics *p, int id)
{
    if (id < 0 || id >= R2D_MAX_BODIES) return false;
    return p->one_way_ignore[id];
}

// --- §7. Надёжность: stay-события и поколение тел --------------------------

void r2d_physics_set_contact_stay(R2DPhysics *p, int id, bool on)
{
    if (!r2d_physics_is_alive(p, id)) return;
    p->contact_stay[id] = on;
}

bool r2d_physics_contact_stay(const R2DPhysics *p, int id)
{
    if (id < 0 || id >= R2D_MAX_BODIES) return false;
    return p->contact_stay[id];
}

uint32_t r2d_physics_generation(const R2DPhysics *p, int id)
{
    if (!p || id < 0 || id >= R2D_MAX_BODIES) return 0;
    return p->generations[id];
}

// --- Контакты: импульс, точки, «касаются ли сейчас» -----------------------

/** Манифолд между двумя телами прямо сейчас: импульс, точки, нормаль. */
static bool r2d__contact_between(const R2DPhysics *p, int a, int b,
                                 float *out_impulse, int *out_points,
                                 float *out_nx, float *out_ny,
                                 int *out_shape_a, int *out_shape_b)
{
    if (!p || !p->world_valid) return false;
    if (!r2d_physics_is_alive(p, a)) return false;
    // `b` < 0 — «с кем угодно»: нужен для contacts_of.
    if (b >= 0 && !r2d_physics_is_alive(p, b)) return false;

    b2ContactData data[16];
    const int n = b2Body_GetContactData(p->bodies[a], data, 16);
    for (int i = 0; i < n; ++i) {
        const int other = r2d__body_id_of_shape(data[i].shapeIdB);
        const int self = r2d__body_id_of_shape(data[i].shapeIdA);
        const int peer = (self == a) ? other : self;
        if (b >= 0 && peer != b) continue;

        // Импульс: солвер пишет его на точках манифолда. Берём НАИБОЛЬШИЙ —
        // «сила удара» это удар, а не сумма касаний.
        float best = 0.0f;
        for (int k = 0; k < data[i].manifold.pointCount; ++k) {
            const float imp = data[i].manifold.points[k].normalImpulse;
            if (imp > best) best = imp;
        }
        if (out_impulse) *out_impulse = best;
        if (out_points) *out_points = data[i].manifold.pointCount;
        if (out_nx) *out_nx = data[i].manifold.normal.x;
        if (out_ny) *out_ny = data[i].manifold.normal.y;
        // Какая ИМЕННО форма столкнулась: по ней игра понимает «попал в
        // голову, а не в ногу».
        if (out_shape_a) *out_shape_a = r2d__shape_index_of_shape(data[i].shapeIdA);
        if (out_shape_b) *out_shape_b = r2d__shape_index_of_shape(data[i].shapeIdB);
        return true;
    }
    return false;
}

bool r2d_physics_contact_between(const R2DPhysics *p, int a, int b,
                                 float *out_impulse, int *out_points,
                                 float *out_normal_x, float *out_normal_y,
                                 int *out_shape_a, int *out_shape_b)
{
    return r2d__contact_between(p, a, b, out_impulse, out_points,
                                out_normal_x, out_normal_y, out_shape_a, out_shape_b);
}

int r2d_physics_contacts_of(const R2DPhysics *p, int id, int *others,
                            float *impulses, int *points,
                            int *shape_self, int *shape_other, int cap)
{
    if (!p || !p->world_valid || !r2d_physics_is_alive(p, id) || cap <= 0) return 0;
    b2ContactData data[16];
    const int n = b2Body_GetContactData(p->bodies[id], data, 16);
    int out = 0;
    for (int i = 0; i < n && out < cap; ++i) {
        const int other = r2d__body_id_of_shape(data[i].shapeIdB);
        const int self = r2d__body_id_of_shape(data[i].shapeIdA);
        const int peer = (self == id) ? other : self;
        if (peer < 0) continue;
        float best = 0.0f;
        for (int k = 0; k < data[i].manifold.pointCount; ++k) {
            const float imp = data[i].manifold.points[k].normalImpulse;
            if (imp > best) best = imp;
        }
        if (others) others[out] = peer;
        if (impulses) impulses[out] = best;
        if (points) points[out] = data[i].manifold.pointCount;
        // Форма на НАШЕМ теле и форма на чужом: «щит коснулся шипа».
        const int idx_a = r2d__shape_index_of_shape(data[i].shapeIdA);
        const int idx_b = r2d__shape_index_of_shape(data[i].shapeIdB);
        if (shape_self)  shape_self[out]  = (self == id) ? idx_a : idx_b;
        if (shape_other) shape_other[out] = (self == id) ? idx_b : idx_a;
        out++;
    }
    return out;
}

bool r2d_physics_is_awake(const R2DPhysics *p, int id)
{
    if (!r2d_physics_is_alive(p, id)) return false;
    return b2Body_IsAwake(p->bodies[id]);
}

float r2d_physics_get_mass(const R2DPhysics *p, int id)
{
    if (!r2d_physics_is_alive(p, id)) return 0.0f;
    return b2Body_GetMass(p->bodies[id]);
}

// --- Слои и маски коллизий ---------------------------------------------------

bool r2d_physics_set_filter(R2DPhysics *p, int id, uint64_t category_bits,
                            uint64_t mask_bits, int group_index)
{
    if (!r2d_physics_is_alive(p, id)) return false;

    b2ShapeId shapes[8];
    // У тела движка ровно одна форма, но API Box2D возвращает список: читаем
    // столько, сколько влезет, — если форма когда-нибудь станет составной,
    // фильтр доедет до всех частей.
    const int count = b2Body_GetShapes(p->bodies[id], shapes, (int)(sizeof shapes / sizeof shapes[0]));
    if (count <= 0) return false;

    for (int i = 0; i < count; ++i) {
        b2Filter f = b2Shape_GetFilter(shapes[i]);
        f.categoryBits = category_bits;
        f.maskBits     = mask_bits;
        f.groupIndex   = group_index;
        b2Shape_SetFilter(shapes[i], f);
    }
    // Смена фильтра — это смена набора пар: разбуженное тело немедленно
    // пересчитает контакты, спящее может «проспать» пропажу пары.
    b2Body_SetAwake(p->bodies[id], true);
    return true;
}

bool r2d_physics_get_filter(const R2DPhysics *p, int id, uint64_t *category_bits,
                            uint64_t *mask_bits, int *group_index)
{
    if (!r2d_physics_is_alive(p, id)) return false;

    b2ShapeId shapes[8];
    const int count = b2Body_GetShapes(p->bodies[id], shapes, (int)(sizeof shapes / sizeof shapes[0]));
    if (count <= 0) return false;

    const b2Filter f = b2Shape_GetFilter(shapes[0]);
    if (category_bits) *category_bits = f.categoryBits;
    if (mask_bits)     *mask_bits     = f.maskBits;
    if (group_index)   *group_index   = f.groupIndex;
    return true;
}

// ---------------------------------------------------------------------------
// Запросы к миру
//
// Box2D отдаёт b2ShapeId, а игровой код работает с нашими числовыми id.
// Мост между ними — линейный поиск по таблице тел: её размер (8192) и частота
// запросов (единицы на кадр) делают поиск дешевле любой хеш-таблицы, зато
// нет второй структуры, которую надо держать в согласии с первой.
// ---------------------------------------------------------------------------

static int r2d__body_of_shape(const R2DPhysics *p, b2ShapeId shape)
{
    if (!b2Shape_IsValid(shape)) return -1;
    const b2BodyId body = b2Shape_GetBody(shape);
    for (int i = 0; i < R2D_MAX_BODIES; ++i) {
        if (!p->alive[i]) continue;
        if (B2_ID_EQUALS(p->bodies[i], body)) return i;
    }
    return -1;
}

typedef struct R2DRayCtx {
    const R2DPhysics *p;
    R2DRayHit        *out;
    const int        *ignore;        // тела, которые луч пропускает
    int               ignore_count;
} R2DRayCtx;

// Колбэк луча: сенсоры (триггеры, зоны, подбираемые предметы) и явно
// указанные тела пропускаем, ближайшее настоящее препятствие запоминаем и
// обрезаем луч до него.
//
// b2World_CastRayClosest этого не умеет: Box2D v3 не исключает сенсоры ни в
// b2DefaultQueryFilter, ни в своём RayCastCallback, поэтому зона-триггер
// останавливала луч и блокировала линию видимости и проверку «стою на земле».
// Фильтр запроса. Свой слой запроса — «все слои»: у луча нет слоя, поэтому
// решает только его маска (collision_mask у RayCast2D в Godot). mask == 0
// означает «любой слой»: ноль — это значение по умолчанию у необязательного
// аргумента, и трактовать его как «не принимать ничего» было бы ловушкой.
static b2QueryFilter r2d__query_filter(uint64_t mask)
{
    b2QueryFilter f = b2DefaultQueryFilter();
    f.categoryBits = R2D_FILTER_DEFAULT_MASK;
    f.maskBits = mask == 0 ? R2D_FILTER_DEFAULT_MASK : mask;
    return f;
}

static float r2d__on_ray(b2ShapeId shape, b2Vec2 point, b2Vec2 normal,
                         float fraction, void *context)
{
    R2DRayCtx *ctx = (R2DRayCtx *)context;
    if (b2Shape_IsSensor(shape)) return -1.0f;   // не препятствие — идём дальше
    // Начальное перекрытие игнорируем — ровно как встроенный
    // b2RayCastClosestFcn. Иначе луч, пущенный из центра узла, попадал бы в
    // собственное тело (fraction == 0), и onFloor()/onWall() всегда были бы
    // false: игрок не прыгал бы и не цеплялся за стены.
    if (fraction == 0.0f) return -1.0f;

    const int body = r2d__body_of_shape(ctx->p, shape);
    for (int i = 0; i < ctx->ignore_count; ++i) {
        if (ctx->ignore[i] == body) return -1.0f;   // это тело не считаем
    }

    R2DRayHit *out = ctx->out;
    out->hit = true;
    out->body = body;
    out->x = R2D_TO_PX(point.x);
    out->y = R2D_TO_PX(point.y);
    out->nx = normal.x;
    out->ny = normal.y;
    out->fraction = fraction;
    return fraction;   // обрезаем: следующее попадание должно быть ближе
}

bool r2d_physics_raycast(const R2DPhysics *p, float x1, float y1, float x2, float y2,
                         const int *ignore, int ignore_count, uint64_t mask, R2DRayHit *out)
{
    if (!out) return false;
    out->hit = false;
    out->body = -1;
    out->x = out->y = out->nx = out->ny = out->fraction = 0.0f;
    if (!p->world_valid) return false;

    const b2Vec2 origin = { R2D_TO_M(x1), R2D_TO_M(y1) };
    const b2Vec2 translation = { R2D_TO_M(x2 - x1), R2D_TO_M(y2 - y1) };
    // Датчики (триггеры) не должны останавливать лучи: они не препятствия.
    R2DRayCtx ctx = { p, out, ignore, ignore_count };
    const b2QueryFilter filter = r2d__query_filter(mask);
    b2World_CastRay(p->world, origin, translation, filter, r2d__on_ray, &ctx);
    return out->hit;
}

// ---------------------------------------------------------------------------
// Свип формы (аналог ShapeCast2D)
//
// Луч отвечает на вопрос «что на линии», свип — «пролезет ли объём». Box2D
// даёт для этого b2World_CastShape: облако точек с радиусом едет по миру и
// сообщает первое касание. Круг — одна точка с радиусом, капсула — две,
// прямоугольник — четыре угла без радиуса.
// ---------------------------------------------------------------------------

typedef struct R2DCastCtx {
    const R2DPhysics *p;
    R2DCastShape *out;
    const int *ignore;
    int ignore_count;
} R2DCastCtx;

static float r2d__on_cast(b2ShapeId shape, b2Vec2 point, b2Vec2 normal,
                          float fraction, void *context)
{
    R2DCastCtx *c = (R2DCastCtx *)context;
    if (b2Shape_IsSensor(shape)) return -1.0f;   // зона — не препятствие

    const int body = r2d__body_of_shape(c->p, shape);
    for (int i = 0; i < c->ignore_count; ++i) {
        if (c->ignore[i] == body) return -1.0f;   // это тело не считаем
    }

    R2DCastShape *out = c->out;
    out->hit = true;
    out->body = body;
    out->x = R2D_TO_PX(point.x);
    out->y = R2D_TO_PX(point.y);
    out->nx = normal.x;
    out->ny = normal.y;
    out->fraction = fraction;
    return fraction;   // обрезаем: следующее касание должно быть ближе
}

bool r2d_physics_cast_shape(const R2DPhysics *p, int shape,
                            float half_w, float half_h, float radius,
                            float x1, float y1, float x2, float y2, float angle,
                            const int *ignore, int ignore_count, uint64_t mask,
                            R2DCastShape *out)
{
    if (!out) return false;
    out->hit = false;
    out->body = -1;
    out->x = out->y = out->nx = out->ny = out->fraction = 0.0f;
    if (!p->world_valid) return false;

    b2Vec2 pts[B2_MAX_POLYGON_VERTICES];
    int count = 0;
    float proxy_radius = 0.0f;

    switch (shape) {
    case R2D_SHAPE_CIRCLE: {
        const float r = radius > 0.0f ? radius : (half_w > 0.0f ? half_w : 16.0f);
        pts[0] = (b2Vec2){ 0.0f, 0.0f };
        count = 1;
        proxy_radius = R2D_TO_M(r);
        break;
    }
    case R2D_SHAPE_CAPSULE: {
        const float hh = half_h > 0.0f ? half_h : 0.0f;
        const float r = radius > 0.0f ? radius : (half_w > 0.0f ? half_w : 16.0f);
        pts[0] = (b2Vec2){ 0.0f, -R2D_TO_M(hh) };
        pts[1] = (b2Vec2){ 0.0f,  R2D_TO_M(hh) };
        count = 2;
        proxy_radius = R2D_TO_M(r);
        break;
    }
    default: {
        const float hw = R2D_TO_M(half_w > 0.0f ? half_w : 16.0f);
        const float hh = R2D_TO_M(half_h > 0.0f ? half_h : 16.0f);
        const float c = cosf(angle), s = sinf(angle);
        const b2Vec2 corners[4] = { { -hw, -hh }, { hw, -hh }, { hw, hh }, { -hw, hh } };
        for (int i = 0; i < 4; ++i) {
            pts[i] = (b2Vec2){ c * corners[i].x - s * corners[i].y,
                               s * corners[i].x + c * corners[i].y };
        }
        count = 4;
        proxy_radius = 0.0f;
        break;
    }
    }

    const b2ShapeProxy proxy = b2MakeProxy(pts, count, proxy_radius);
    const b2Vec2 translation = { R2D_TO_M(x2 - x1), R2D_TO_M(y2 - y1) };
    R2DCastCtx c = { p, out, ignore, ignore_count };
    // Начальная точка — центр формы в мире: b2World_CastShape принимает
    // облако точек в мировых координатах, а не в локальных.
    b2ShapeProxy world_proxy = proxy;
    for (int i = 0; i < count; ++i) {
        world_proxy.points[i].x += R2D_TO_M(x1);
        world_proxy.points[i].y += R2D_TO_M(y1);
    }
    b2World_CastShape(p->world, &world_proxy, translation, r2d__query_filter(mask),
                      r2d__on_cast, &c);
    return out->hit;
}

typedef struct R2DQueryCtx {
    const R2DPhysics *p;
    int *ids;
    int  max_ids;
    int  count;
} R2DQueryCtx;

static bool r2d__on_overlap(b2ShapeId shape, void *context)
{
    R2DQueryCtx *q = (R2DQueryCtx *)context;
    if (q->count >= q->max_ids) return false;   // дальше не нужно

    const int id = r2d__body_of_shape(q->p, shape);
    if (id < 0) return true;

    // Одно тело может пересечься несколькими формами — не дублируем.
    for (int i = 0; i < q->count; ++i) {
        if (q->ids[i] == id) return true;
    }
    q->ids[q->count++] = id;
    return true;
}

static int r2d__query_aabb(const R2DPhysics *p, float cx, float cy, float hw, float hh,
                           uint64_t mask, int *ids, int max_ids)
{
    if (!p->world_valid || !ids || max_ids <= 0) return 0;

    R2DQueryCtx q;
    q.p = p;
    q.ids = ids;
    q.max_ids = max_ids;
    q.count = 0;

    b2AABB aabb;
    aabb.lowerBound = (b2Vec2){ R2D_TO_M(cx - hw), R2D_TO_M(cy - hh) };
    aabb.upperBound = (b2Vec2){ R2D_TO_M(cx + hw), R2D_TO_M(cy + hh) };

    b2World_OverlapAABB(p->world, aabb, r2d__query_filter(mask), r2d__on_overlap, &q);
    return q.count;
}

int r2d_physics_query_point(const R2DPhysics *p, float x, float y, uint64_t mask,
                            int *ids, int max_ids)
{
    // Точка — вырожденный прямоугольник; Box2D честно вернёт накрывающие формы.
    return r2d__query_aabb(p, x, y, 0.5f, 0.5f, mask, ids, max_ids);
}

int r2d_physics_query_box(const R2DPhysics *p, float x, float y, float w, float h,
                          uint64_t mask, int *ids, int max_ids)
{
    return r2d__query_aabb(p, x, y, w * 0.5f, h * 0.5f, mask, ids, max_ids);
}

// Тела в радиусе от точки: broadphase даёт кандидатов, расстояние между
// центрами отсеивает лишних. Порядок — по расстоянию, при равенстве по id:
// результат запроса должен быть воспроизводим (реплеи и тесты), а обход
// broadphase такого порядка не обещает.
int r2d_physics_query_circle(const R2DPhysics *p, float x, float y, float radius,
                             uint64_t mask, int *ids, int max_ids, int *candidates)
{
    if (candidates) *candidates = 0;
    if (!p->world_valid || !ids || max_ids <= 0 || !(radius > 0.0f)) return 0;

    int cand[R2D_MAX_QUERY];
    const int cap = max_ids < R2D_MAX_QUERY ? max_ids : R2D_MAX_QUERY;
    const int n = r2d__query_aabb(p, x, y, radius, radius, mask, cand, cap);
    if (candidates) *candidates = n;

    const float r2 = radius * radius;
    float dist[R2D_MAX_QUERY];
    int m = 0;
    for (int i = 0; i < n; ++i) {
        const int id = cand[i];
        if (id < 0 || id >= R2D_MAX_BODIES) continue;
        if (!b2Body_IsValid(p->bodies[id])) continue;

        const b2Vec2 center = b2Body_GetPosition(p->bodies[id]);
        const float dx = center.x * R2D_PX_PER_M - x;
        const float dy = center.y * R2D_PX_PER_M - y;
        const float d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;

        // Сортировка вставками: список короткий (лимит запроса), зато результат
        // детерминирован и не зависит от порядка обхода broadphase.
        int at = m;
        while (at > 0 && (dist[at - 1] > d2 || (dist[at - 1] == d2 && ids[at - 1] > id))) {
            ids[at] = ids[at - 1];
            dist[at] = dist[at - 1];
            --at;
        }
        ids[at] = id;
        dist[at] = d2;
        ++m;
    }
    return m;
}

// ---------------------------------------------------------------------------
// Суставы
//
// Точки крепления приходят в мировых пикселях — так их удобно задавать из
// игры. В Box2D они локальные, поэтому пересчитываем через
// b2Body_GetLocalPoint.
// ---------------------------------------------------------------------------

void r2d_physics_set_joint_axis(R2DPhysics *p, float ax, float ay)
{
    if (!p) return;
    // Нулевая ось недопустима: Box2D требует единичный вектор.
    const float len = SDL_sqrtf(ax * ax + ay * ay);
    if (len < 1e-6f) { p->joint_axis_x = 1.0f; p->joint_axis_y = 0.0f; return; }
    p->joint_axis_x = ax / len;
    p->joint_axis_y = ay / len;
}

int r2d_physics_create_joint(R2DPhysics *p, int type, int a, int b,
                             float ax, float ay, float bx, float by,
                             bool collide_connected, float length,
                             bool enable_limit, float lower_angle, float upper_angle,
                             bool enable_motor, float motor_speed, float max_motor_torque)
{
    if (!p->world_valid) return -1;
    if (a < 0 || b < 0 || a >= R2D_MAX_BODIES || b >= R2D_MAX_BODIES) return -1;
    if (!p->alive[a] || !p->alive[b]) {
        R2D_WARN("сустав: тело %d или %d не существует", a, b);
        return -1;
    }

    int id = -1;
    for (int i = 0; i < R2D_MAX_JOINTS; ++i) {
        if (!p->joint_alive[i]) { id = i; break; }
    }
    if (id < 0) {
        R2D_ERROR("достигнут лимит суставов (%d)", R2D_MAX_JOINTS);
        return -1;
    }

    const b2Vec2 wa = { R2D_TO_M(ax), R2D_TO_M(ay) };
    const b2Vec2 wb = { R2D_TO_M(bx), R2D_TO_M(by) };
    b2JointId joint;

    switch (type) {
    case R2D_JOINT_DISTANCE: {
        b2DistanceJointDef d = b2DefaultDistanceJointDef();
        d.bodyIdA = p->bodies[a];
        d.bodyIdB = p->bodies[b];
        d.localAnchorA = b2Body_GetLocalPoint(p->bodies[a], wa);
        d.localAnchorB = b2Body_GetLocalPoint(p->bodies[b], wb);
        // length = 0 означает «взять текущее расстояние»: иначе Box2D
        // оставил бы дефолтный метр и стержень мгновенно стянуло бы.
        d.length = length > 0.0f ? R2D_TO_M(length) : b2Distance(wa, wb);
        d.collideConnected = collide_connected;
        if (enable_limit) {
            d.enableLimit = true;
            d.minLength = R2D_TO_M(lower_angle);   // для distance — границы длины
            d.maxLength = R2D_TO_M(upper_angle);
        }
        if (enable_motor) {
            d.enableMotor = true;
            d.motorSpeed = motor_speed;
            d.maxMotorForce = max_motor_torque;
        }
        joint = b2CreateDistanceJoint(p->world, &d);
        break;
    }
    case R2D_JOINT_PRISMATIC: {
        b2PrismaticJointDef d = b2DefaultPrismaticJointDef();
        d.bodyIdA = p->bodies[a];
        d.bodyIdB = p->bodies[b];
        d.localAnchorA = b2Body_GetLocalPoint(p->bodies[a], wa);
        d.localAnchorB = b2Body_GetLocalPoint(p->bodies[b], wb);
        // Ось — в системе тела A: переводим мировую ось в локальную.
        b2Vec2 axis = b2Body_GetLocalVector(p->bodies[a],
                                            (b2Vec2){ p->joint_axis_x, p->joint_axis_y });
        d.localAxisA = axis;
        d.collideConnected = collide_connected;
        if (enable_limit) {
            d.enableLimit = true;
            d.lowerTranslation = R2D_TO_M(lower_angle);
            d.upperTranslation = R2D_TO_M(upper_angle);
        }
        if (enable_motor) {
            d.enableMotor = true;
            d.motorSpeed = motor_speed;
            d.maxMotorForce = max_motor_torque;
        }
        joint = b2CreatePrismaticJoint(p->world, &d);
        break;
    }
    case R2D_JOINT_FILTER: {
        b2FilterJointDef d = b2DefaultFilterJointDef();
        d.bodyIdA = p->bodies[a];
        d.bodyIdB = p->bodies[b];
        joint = b2CreateFilterJoint(p->world, &d);
        break;
    }
    case R2D_JOINT_WHEEL: {
        b2WheelJointDef d = b2DefaultWheelJointDef();
        d.bodyIdA = p->bodies[a];
        d.bodyIdB = p->bodies[b];
        d.localAnchorA = b2Body_GetLocalPoint(p->bodies[a], wa);
        d.localAnchorB = b2Body_GetLocalPoint(p->bodies[b], wb);
        b2Vec2 axis = b2Body_GetLocalVector(p->bodies[a],
                                            (b2Vec2){ p->joint_axis_x, p->joint_axis_y });
        d.localAxisA = axis;
        d.collideConnected = collide_connected;
        if (enable_limit) {
            d.enableLimit = true;
            d.lowerTranslation = R2D_TO_M(lower_angle);
            d.upperTranslation = R2D_TO_M(upper_angle);
        }
        if (enable_motor) {
            d.enableMotor = true;
            d.motorSpeed = motor_speed;
            d.maxMotorTorque = max_motor_torque;
        }
        joint = b2CreateWheelJoint(p->world, &d);
        break;
    }
    case R2D_JOINT_WELD: {
        b2WeldJointDef d = b2DefaultWeldJointDef();
        d.bodyIdA = p->bodies[a];
        d.bodyIdB = p->bodies[b];
        d.localAnchorA = b2Body_GetLocalPoint(p->bodies[a], wa);
        d.localAnchorB = b2Body_GetLocalPoint(p->bodies[b], wb);
        d.collideConnected = collide_connected;
        joint = b2CreateWeldJoint(p->world, &d);
        break;
    }
    default: {
        b2RevoluteJointDef d = b2DefaultRevoluteJointDef();
        d.bodyIdA = p->bodies[a];
        d.bodyIdB = p->bodies[b];
        d.localAnchorA = b2Body_GetLocalPoint(p->bodies[a], wa);
        d.localAnchorB = b2Body_GetLocalPoint(p->bodies[b], wb);
        d.collideConnected = collide_connected;
        if (enable_limit) {
            d.enableLimit = true;
            d.lowerAngle = lower_angle;
            d.upperAngle = upper_angle;
        }
        if (enable_motor) {
            d.enableMotor = true;
            d.motorSpeed = motor_speed;
            d.maxMotorTorque = max_motor_torque;
        }
        joint = b2CreateRevoluteJoint(p->world, &d);
        break;
    }
    }

    if (!b2Joint_IsValid(joint)) {
        R2D_ERROR("не удалось создать сустав (type=%d)", type);
        return -1;
    }

    // Сустав НЕ будит уснувшие тела сам (Box2D v3), поэтому только что
    // созданный сустав не действовал: тело спало и стояло на месте. Это
    // нашлось тестом на mouse-сустав («тело тянется к цели» — не тянулось) и
    // касается всех видов: игра вправе ждать, что новый сустав заработает
    // сразу. Для этого у Box2D есть штатный вызов.
    b2Joint_WakeBodies(joint);

    p->joints[id] = joint;
    p->joint_alive[id] = true;
    return id;
}

void r2d_physics_destroy_joint(R2DPhysics *p, int id)
{
    if (!p->world_valid || id < 0 || id >= R2D_MAX_JOINTS || !p->joint_alive[id]) return;
    if (b2Joint_IsValid(p->joints[id])) {
        b2DestroyJoint(p->joints[id]);
    }
    p->joint_alive[id] = false;
}

bool r2d_physics_joint_alive(const R2DPhysics *p, int id)
{
    if (!p || id < 0 || id >= R2D_MAX_JOINTS) return false;
    return p->joint_alive[id] && b2Joint_IsValid(p->joints[id]);
}

int r2d_physics_joint_count(const R2DPhysics *p)
{
    if (!p) return 0;
    int n = 0;
    for (int i = 0; i < R2D_MAX_JOINTS; ++i) {
        if (p->joint_alive[i] && b2Joint_IsValid(p->joints[i])) n++;
    }
    return n;
}
