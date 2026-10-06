#include "physics.h"

#include <SDL3/SDL.h>   // SDL_zero и прочие макросы ядра

#include <math.h>

// Пиксели ↔ метры.
#define R2D_TO_M(px) ((px) / R2D_PX_PER_M)
#define R2D_TO_PX(m) ((m) * R2D_PX_PER_M)

// ---------------------------------------------------------------------------
// Односторонние платформы
//
// Box2D не знает про «пройти сквозь снизу» — это делается на pre-solve:
// контакт разрешается, только если тело приближается с лицевой стороны
// платформы. Нормаль лицевой стороны хранится в системе тела, поэтому
// повёрнутая платформа работает правильно.
// ---------------------------------------------------------------------------

// Наш id тела по форме: кладём его в user data формы при создании.
static int r2d__body_id_of_shape(b2ShapeId shape)
{
    if (!b2Shape_IsValid(shape)) return -1;
    void *ud = b2Shape_GetUserData(shape);
    return (int)(intptr_t)ud - 1;
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

void r2d_physics_step(R2DPhysics *p, float dt)
{
    if (!p->world_valid || dt <= 0.0f) return;
    // 4 подшага — стандартное значение Box2D для устойчивых стопок.
    b2World_Step(p->world, dt, 4);
    r2d_physics_sync(p);

    // События контактов живут один шаг: переносим во внутренний буфер,
    // откуда их забирает JS (engine.contacts()).
    p->contact_count = 0;
    if (!p->world_valid) return;
    const b2ContactEvents ev = b2World_GetContactEvents(p->world);

    for (int i = 0; i < ev.beginCount && p->contact_count < R2D_MAX_CONTACT_EVENTS; ++i) {
        const b2ContactBeginTouchEvent *e = &ev.beginEvents[i];
        R2DContactEvent *c = &p->contacts[p->contact_count++];
        c->kind = R2D_CONTACT_BEGIN;
        c->a = r2d__body_id_of_shape(e->shapeIdA);
        c->b = r2d__body_id_of_shape(e->shapeIdB);
        c->nx = e->manifold.normal.x;
        c->ny = e->manifold.normal.y;
        // Манифолд begin-события записан до солвера: точка есть, импульс нулевой.
        if (e->manifold.pointCount > 0) {
            c->px = R2D_TO_PX(e->manifold.points[0].point.x);
            c->py = R2D_TO_PX(e->manifold.points[0].point.y);
        } else {
            c->px = c->py = 0.0f;
        }
        c->speed = 0.0f;
    }
    for (int i = 0; i < ev.endCount && p->contact_count < R2D_MAX_CONTACT_EVENTS; ++i) {
        const b2ContactEndTouchEvent *e = &ev.endEvents[i];
        R2DContactEvent *c = &p->contacts[p->contact_count++];
        c->kind = R2D_CONTACT_END;
        c->a = r2d__body_id_of_shape(e->shapeIdA);
        c->b = r2d__body_id_of_shape(e->shapeIdB);
        c->nx = c->ny = c->px = c->py = c->speed = 0.0f;
    }
    for (int i = 0; i < ev.hitCount && p->contact_count < R2D_MAX_CONTACT_EVENTS; ++i) {
        const b2ContactHitEvent *e = &ev.hitEvents[i];
        R2DContactEvent *c = &p->contacts[p->contact_count++];
        c->kind = R2D_CONTACT_HIT;
        c->a = r2d__body_id_of_shape(e->shapeIdA);
        c->b = r2d__body_id_of_shape(e->shapeIdB);
        c->nx = e->normal.x;
        c->ny = e->normal.y;
        c->px = R2D_TO_PX(e->point.x);
        c->py = R2D_TO_PX(e->point.y);
        c->speed = R2D_TO_PX(e->approachSpeed);
    }
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
    if (p) p->contact_count = 0;
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

int r2d_physics_create(R2DPhysics *p, const R2DBodyDesc *d)
{
    if (!p->world_valid || !d) return -1;

    int id = -1;
    for (int i = 0; i < R2D_MAX_BODIES; ++i) {
        if (!p->alive[i]) { id = i; break; }
    }
    if (id < 0) {
        R2D_ERROR("достигнут лимит физических тел (%d)", R2D_MAX_BODIES);
        return -1;
    }

    b2BodyDef def = b2DefaultBodyDef();
    switch (d->type) {
    case R2D_BODY_STATIC:    def.type = b2_staticBody;    break;
    case R2D_BODY_KINEMATIC: def.type = b2_kinematicBody; break;
    default:                  def.type = b2_dynamicBody;    break;
    }
    def.position      = (b2Vec2){ R2D_TO_M(d->x), R2D_TO_M(d->y) };
    def.rotation      = b2MakeRot(d->angle);
    def.fixedRotation = d->fixed_rotation;

    b2BodyId body = b2CreateBody(p->world, &def);
    if (!b2Body_IsValid(body)) {
        R2D_ERROR("b2CreateBody вернул невалидное тело");
        return -1;
    }

    b2ShapeDef sd = b2DefaultShapeDef();
    sd.density = d->density > 0.0f ? d->density : 1.0f;
    sd.material.friction    = d->friction;
    sd.material.restitution = d->restitution;
    sd.isSensor = d->sensor;
    sd.enableContactEvents = d->contacts || d->one_way;
    sd.enableHitEvents     = d->contacts;
    // Pre-solve нужен только односторонним платформам: он вызывается
    // и для пары, где хотя бы одна форма его просила.
    sd.enablePreSolveEvents = d->one_way;

    b2ShapeId shape;
    switch (d->shape) {
    case R2D_SHAPE_CIRCLE: {
        const b2Circle c = { { 0.0f, 0.0f },
                             R2D_TO_M(d->radius > 0.0f ? d->radius : 16.0f) };
        shape = b2CreateCircleShape(body, &sd, &c);
        break;
    }
    case R2D_SHAPE_CAPSULE: {
        // Капсула растёт вдоль оси Y: half_h — половина отрезка, radius — скругление.
        const float hh = R2D_TO_M(d->half_h);
        const float r  = R2D_TO_M(d->radius > 0.0f ? d->radius : (d->half_w > 0.0f ? d->half_w : 16.0f));
        const b2Capsule cap = { { 0.0f, -hh }, { 0.0f, hh }, r };
        shape = b2CreateCapsuleShape(body, &sd, &cap);
        break;
    }
    case R2D_SHAPE_POLYGON: {
        const int n = d->point_count < 3 ? 0
                     : (d->point_count > R2D_MAX_POLY_POINTS ? R2D_MAX_POLY_POINTS : d->point_count);
        if (n >= 3) {
            b2Vec2 pts[R2D_MAX_POLY_POINTS];
            for (int i = 0; i < n; ++i) {
                pts[i] = (b2Vec2){ R2D_TO_M(d->points[i * 2]), R2D_TO_M(d->points[i * 2 + 1]) };
            }
            const b2Hull hull = b2ComputeHull(pts, n);
            if (hull.count >= 3) {
                const b2Polygon poly = b2MakePolygon(&hull, R2D_TO_M(d->poly_radius));
                shape = b2CreatePolygonShape(body, &sd, &poly);
                break;
            }
            R2D_WARN("полигон вырожден (точек %d) — тело создано прямоугольником", n);
        }
        const b2Polygon box = b2MakeBox(R2D_TO_M(d->half_w > 0.0f ? d->half_w : 16.0f),
                                        R2D_TO_M(d->half_h > 0.0f ? d->half_h : 16.0f));
        shape = b2CreatePolygonShape(body, &sd, &box);
        break;
    }
    default: {
        const b2Polygon box = b2MakeBox(R2D_TO_M(d->half_w > 0.0f ? d->half_w : 16.0f),
                                        R2D_TO_M(d->half_h > 0.0f ? d->half_h : 16.0f));
        shape = b2CreatePolygonShape(body, &sd, &box);
        break;
    }
    }

    if (!b2Shape_IsValid(shape)) {
        R2D_ERROR("не удалось создать форму тела (kind=%d)", d->shape);
        b2DestroyBody(body);
        return -1;
    }

    // user data = id + 1: 0 означает «формы нет», а id 0 — валидное тело.
    b2Shape_SetUserData(shape, (void *)(intptr_t)(id + 1));

    p->one_way[id]  = d->one_way;
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
    p->live_count++;
    p->transforms[id * 3 + 0] = d->x;
    p->transforms[id * 3 + 1] = d->y;
    p->transforms[id * 3 + 2] = d->angle;
    return id;
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
                         const int *ignore, int ignore_count, R2DRayHit *out)
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
    const b2QueryFilter filter = b2DefaultQueryFilter();
    b2World_CastRay(p->world, origin, translation, filter, r2d__on_ray, &ctx);
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
                           int *ids, int max_ids)
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

    b2World_OverlapAABB(p->world, aabb, b2DefaultQueryFilter(), r2d__on_overlap, &q);
    return q.count;
}

int r2d_physics_query_point(const R2DPhysics *p, float x, float y, int *ids, int max_ids)
{
    // Точка — вырожденный прямоугольник; Box2D честно вернёт накрывающие формы.
    return r2d__query_aabb(p, x, y, 0.5f, 0.5f, ids, max_ids);
}

int r2d_physics_query_box(const R2DPhysics *p, float x, float y, float w, float h,
                          int *ids, int max_ids)
{
    return r2d__query_aabb(p, x, y, w * 0.5f, h * 0.5f, ids, max_ids);
}

// ---------------------------------------------------------------------------
// Суставы
//
// Точки крепления приходят в мировых пикселях — так их удобно задавать из
// игры. В Box2D они локальные, поэтому пересчитываем через
// b2Body_GetLocalPoint.
// ---------------------------------------------------------------------------

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
