#include "physics.h"

#include <SDL3/SDL.h>   // SDL_zero и прочие макросы ядра

#include <math.h>

// Пиксели ↔ метры.
#define R2D_TO_M(px) ((px) / R2D_PX_PER_M)
#define R2D_TO_PX(m) ((m) * R2D_PX_PER_M)

// ---------------------------------------------------------------------------
// §36. Проверяемый рост реестров тел/суставов/событий
//
// Раньше тела, суставы и события контакта лежали в массивах фиксированного
// размера: создание тела сканировало всю ёмкость, sync/stay обходили ВСЕ слоты,
// а 129-е событие за кадр молча терялось. Теперь ёмкость — стартовое значение,
// дальше массивы удваиваются. Рост проверяет required <= UINT32_MAX и
// capacity * sizeof(T) <= SIZE_MAX; при отказе аллокатора данные не меняются,
// а вызывающий получает false (и обязан сообщить об ошибке, а не «потерять»).
// ---------------------------------------------------------------------------

/** realloc с проверкой переполнения: false — памяти нет, *data не тронут. */
static bool r2d__grow_bytes(void **data, size_t element_size, uint32_t capacity,
                            size_t multiplier)
{
    if (!data || element_size == 0 || multiplier == 0) return false;
    if ((size_t)capacity > SIZE_MAX / element_size) return false;
    size_t bytes = (size_t)capacity * element_size;
    if (multiplier > 1) {
        if (bytes > SIZE_MAX / multiplier) return false;
        bytes *= multiplier;
    }
    void *grown = realloc(*data, bytes);
    if (!grown) return false;
    *data = grown;
    return true;
}

/**
 * Довести ёмкость массивов тел до required.
 *
 * Все массивы индексируются слотом, поэтому растут согласованно: при отказе
 * любого realloc ранее выросшие массивы остаются валидными (realloc сохраняет
 * данные), а body_capacity не увеличивается — повторный вызов просто повторит
 * рост. Утечки нет: указатели принадлежат структуре и освобождаются в shutdown.
 */
static bool r2d__reserve_body_arrays(R2DPhysics *p, uint32_t required)
{
    if (!p) return false;
    if (required <= p->body_capacity) return true;
    if (required < R2D_INITIAL_BODIES) required = R2D_INITIAL_BODIES;

    uint32_t next = p->body_capacity ? p->body_capacity : R2D_INITIAL_BODIES;
    while (next < required) {
        if (next > UINT32_MAX / 2u) { next = required; break; }
        next *= 2u;
    }
    if (next < required) return false;
    // transforms — три float на слот: отдельная проверка умножения.
    if ((size_t)next > SIZE_MAX / (sizeof(float) * 3u)) return false;

    if (!r2d__grow_bytes((void **)&p->bodies, sizeof(b2BodyId), next, 1)) return false;
    if (!r2d__grow_bytes((void **)&p->transforms, sizeof(float), next, 3)) return false;
    if (!r2d__grow_bytes((void **)&p->one_way, sizeof(bool), next, 1)) return false;
    if (!r2d__grow_bytes((void **)&p->one_way_nx, sizeof(float), next, 1)) return false;
    if (!r2d__grow_bytes((void **)&p->one_way_ny, sizeof(float), next, 1)) return false;
    if (!r2d__grow_bytes((void **)&p->one_way_ignore, sizeof(bool), next, 1)) return false;
    if (!r2d__grow_bytes((void **)&p->contact_stay, sizeof(bool), next, 1)) return false;
    p->body_capacity = next;
    return true;
}

/**
 * Выдать слот тела. O(1): freelist пула. Когда свободных слотов нет, пул
 * удваивает ёмкость, а следом растут slot-массивы. R2D_SLOT_NONE — память
 * кончилась (вызывающий пишет ошибку и не создаёт тело).
 */
static uint32_t r2d__body_slot_alloc(R2DPhysics *p)
{
    if (!p) return R2D_SLOT_NONE;
    // Ёмкость пула могла вырасти в прошлый раз, а массивы — не успеть.
    if (p->body_capacity < p->body_pool.slot_capacity
        && !r2d__reserve_body_arrays(p, p->body_pool.slot_capacity)) {
        return R2D_SLOT_NONE;
    }
    if (p->body_pool.free_head == R2D_SLOT_NONE) {
        if (p->body_pool.slot_capacity == UINT32_MAX) return R2D_SLOT_NONE;
        const uint32_t need = p->body_pool.slot_capacity + 1u;
        if (!r2d_slot_pool_reserve(&p->body_pool, need)) return R2D_SLOT_NONE;
        if (!r2d__reserve_body_arrays(p, p->body_pool.slot_capacity)) return R2D_SLOT_NONE;
    }
    return r2d_slot_pool_alloc(&p->body_pool);
}

/** Довести ёмкость массивов суставов до required (см. тела выше). */
static bool r2d__reserve_joint_arrays(R2DPhysics *p, uint32_t required)
{
    if (!p) return false;
    if (required <= p->joint_capacity) return true;
    if (required < R2D_INITIAL_JOINTS) required = R2D_INITIAL_JOINTS;

    uint32_t next = p->joint_capacity ? p->joint_capacity : R2D_INITIAL_JOINTS;
    while (next < required) {
        if (next > UINT32_MAX / 2u) { next = required; break; }
        next *= 2u;
    }
    if (next < required) return false;
    if (!r2d__grow_bytes((void **)&p->joints, sizeof(b2JointId), next, 1)) return false;
    p->joint_capacity = next;
    return true;
}

/** Выдать слот сустава (тот же freelist-пул, что у тел). */
static uint32_t r2d__joint_slot_alloc(R2DPhysics *p)
{
    if (!p) return R2D_SLOT_NONE;
    if (p->joint_capacity < p->joint_pool.slot_capacity
        && !r2d__reserve_joint_arrays(p, p->joint_pool.slot_capacity)) {
        return R2D_SLOT_NONE;
    }
    if (p->joint_pool.free_head == R2D_SLOT_NONE) {
        if (p->joint_pool.slot_capacity == UINT32_MAX) return R2D_SLOT_NONE;
        const uint32_t need = p->joint_pool.slot_capacity + 1u;
        if (!r2d_slot_pool_reserve(&p->joint_pool, need)) return R2D_SLOT_NONE;
        if (!r2d__reserve_joint_arrays(p, p->joint_pool.slot_capacity)) return R2D_SLOT_NONE;
    }
    return r2d_slot_pool_alloc(&p->joint_pool);
}

/** Есть ли слот в пределах массивов (id пришёл из внешнего кода). */
static bool r2d__body_slot_bounds(const R2DPhysics *p, int id)
{
    return p && id >= 0 && (uint32_t)id < p->body_capacity
        && (uint32_t)id < p->body_pool.slot_capacity;
}

/** Довести буфер событий до required. false — память кончилась. */
static bool r2d__contact_reserve(R2DPhysics *p, uint32_t required)
{
    if (!p) return false;
    if (required <= p->contacts.capacity) return true;
    if (required == 0) return true;

    uint32_t next = p->contacts.capacity ? p->contacts.capacity : R2D_INITIAL_CONTACT_EVENTS;
    while (next < required) {
        if (next > UINT32_MAX / 2u) { next = required; break; }
        next *= 2u;
    }
    if (next < required) return false;
    if ((size_t)next > SIZE_MAX / sizeof(R2DContactEvent)) return false;

    R2DContactEvent *items = (R2DContactEvent *)realloc(
        p->contacts.items, (size_t)next * sizeof(R2DContactEvent));
    if (!items) return false;
    p->contacts.items = items;
    p->contacts.capacity = next;
    return true;
}

/**
 * Новый элемент буфера событий. NULL — память кончилась: вызывающий обязан
 * прекратить сбор, а флаг contact_oom и R2D_ERROR уже выставлены (событие не
 * «потеряно молча»).
 */
static R2DContactEvent *r2d__contact_push(R2DPhysics *p)
{
    if (!p) return NULL;
    if (p->contacts.count == UINT32_MAX) {
        if (!p->contact_oom) {
            p->contact_oom = true;
            R2D_ERROR("события контакта: счётчик достиг UINT32_MAX — новые события не записаны");
        }
        return NULL;
    }
    if (!r2d__contact_reserve(p, p->contacts.count + 1u)) {
        if (!p->contact_oom) {
            p->contact_oom = true;
            R2D_ERROR("события контакта: нет памяти под буфер (count=%u) — события не записаны",
                      p->contacts.count);
        }
        return NULL;
    }
    R2DContactEvent *c = &p->contacts.items[p->contacts.count++];
    if (p->contacts.count > p->contacts.peak) p->contacts.peak = p->contacts.count;
    SDL_zerop(c);
    return c;
}

/** Довести вектор int до required (пары began/ended/stay). */
static bool r2d__intvec_reserve(R2DPhysics *p, R2DIntVec *v, uint32_t required,
                                const char *what)
{
    if (!p || !v) return false;
    if (required <= v->capacity) return true;
    if (required == 0) return true;

    uint32_t next = v->capacity ? v->capacity : R2D_INITIAL_CONTACT_EVENTS;
    while (next < required) {
        if (next > UINT32_MAX / 2u) { next = required; break; }
        next *= 2u;
    }
    if (next < required || (size_t)next > SIZE_MAX / sizeof(int)) {
        if (!p->contact_oom) {
            p->contact_oom = true;
            R2D_ERROR("события контакта: переполнение вектора %s", what ? what : "пар");
        }
        return false;
    }
    int *items = (int *)realloc(v->items, (size_t)next * sizeof(int));
    if (!items) {
        if (!p->contact_oom) {
            p->contact_oom = true;
            R2D_ERROR("события контакта: нет памяти под вектор %s", what ? what : "пар");
        }
        return false;
    }
    v->items = items;
    v->capacity = next;
    return true;
}


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

    const bool ow_a = (r2d__body_slot_bounds(p, id_a) && p->one_way[id_a]);
    const bool ow_b = (r2d__body_slot_bounds(p, id_b) && p->one_way[id_b]);
    if (!ow_a && !ow_b) return true;

    // Спрыгивание: тело, которому сейчас запрещено опираться на односторонние
    // платформы, не сталкивается с ними вовсе. Проверяем до нормалей — для
    // пропускаемой пары незачем считать поворот и скалярное произведение.
    if (ow_a && r2d__body_slot_bounds(p, id_b) && p->one_way_ignore[id_b]) return false;
    if (ow_b && r2d__body_slot_bounds(p, id_a) && p->one_way_ignore[id_a]) return false;

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

/** Освободить все динамические реестры (без обращения к Box2D). */
static void r2d__physics_free_storage(R2DPhysics *p)
{
    if (!p) return;
    r2d_slot_pool_shutdown(&p->body_pool);
    r2d_slot_pool_shutdown(&p->joint_pool);
    free(p->bodies);             p->bodies = NULL;
    free(p->transforms);         p->transforms = NULL;
    free(p->one_way);            p->one_way = NULL;
    free(p->one_way_nx);         p->one_way_nx = NULL;
    free(p->one_way_ny);         p->one_way_ny = NULL;
    free(p->one_way_ignore);     p->one_way_ignore = NULL;
    free(p->contact_stay);       p->contact_stay = NULL;
    free(p->contacts.items);     p->contacts.items = NULL;
    free(p->began_pairs.items);  p->began_pairs.items = NULL;
    free(p->ended_pairs.items);  p->ended_pairs.items = NULL;
    free(p->stay_pairs.items);   p->stay_pairs.items = NULL;
    free(p->joints);             p->joints = NULL;
    p->body_capacity = 0;
    p->joint_capacity = 0;
    p->contacts.capacity = 0;
    p->began_pairs.capacity = 0;
    p->ended_pairs.capacity = 0;
    p->stay_pairs.capacity = 0;
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

    // Стартовые ёмкости реестров: дальше они растут сами. Если памяти нет,
    // физика не притворяется рабочей: мир уничтожается, world_valid = false,
    // игра получает явную ошибку вместо падения на первом create.
    bool ok = r2d_slot_pool_init(&p->body_pool, R2D_INITIAL_BODIES)
           && r2d__reserve_body_arrays(p, R2D_INITIAL_BODIES)
           && r2d_slot_pool_init(&p->joint_pool, R2D_INITIAL_JOINTS)
           && r2d__reserve_joint_arrays(p, R2D_INITIAL_JOINTS)
           && r2d__contact_reserve(p, R2D_INITIAL_CONTACT_EVENTS);
    if (!ok) {
        R2D_ERROR("физика: не хватило памяти на стартовые реестры "
                  "(тел %u, суставов %u, контактов %u)",
                  (unsigned)R2D_INITIAL_BODIES, (unsigned)R2D_INITIAL_JOINTS,
                  (unsigned)R2D_INITIAL_CONTACT_EVENTS);
        b2DestroyWorld(p->world);
        r2d__physics_free_storage(p);
        SDL_zero(*p);
        p->world_valid = false;
        return;
    }
    p->body_capacity = p->body_pool.slot_capacity;
    p->joint_capacity = p->joint_pool.slot_capacity;
}

void r2d_physics_shutdown(R2DPhysics *p)
{
    if (!p) return;
    if (p->world_valid) {
        b2DestroyWorld(p->world);
    }
    // Указатели на массивы — не часть мира Box2D: без явного free они утекали
    // бы при каждом перезапуске сцены/игры.
    r2d__physics_free_storage(p);
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
    c->gen_a = r2d__body_slot_bounds(p, c->a) ? r2d_slot_pool_generation(&p->body_pool, (uint32_t)c->a) : 0;
    c->gen_b = r2d__body_slot_bounds(p, c->b) ? r2d_slot_pool_generation(&p->body_pool, (uint32_t)c->b) : 0;
    c->sensor = (b2Shape_IsValid(sa) && b2Shape_IsSensor(sa))
             || (b2Shape_IsValid(sb) && b2Shape_IsSensor(sb));
}

/** Есть ли пара (a, b) в списке этого кадра. */
static bool r2d__pair_seen(const R2DIntVec *v, int a, int b)
{
    for (uint32_t i = 0; i + 1 < v->count; i += 2) {
        if (v->items[i] == a && v->items[i + 1] == b) return true;
    }
    return false;
}

/** Запомнить пару (a, b) этого кадра. false — память кончилась. */
static bool r2d__pair_add(R2DPhysics *p, R2DIntVec *v, int a, int b,
                          const char *what)
{
    if (!p || !v) return false;
    if (r2d__pair_seen(v, a, b)) return true;
    if (v->count > UINT32_MAX - 2u) return false;
    if (!r2d__intvec_reserve(p, v, v->count + 2u, what)) return false;
    v->items[v->count++] = a;
    v->items[v->count++] = b;
    return true;
}

/** Четвёрка (тело, форма) уже дала stay в этом кадре? Порядок пар не важен. */
static bool r2d__stay_seen(const R2DPhysics *p, int a, int sa, int b, int sb)
{
    const R2DIntVec *v = &p->stay_pairs;
    for (uint32_t i = 0; i + 3 < v->count; i += 4) {
        const bool same = v->items[i] == a && v->items[i + 1] == sa
                       && v->items[i + 2] == b && v->items[i + 3] == sb;
        const bool mirror = v->items[i] == b && v->items[i + 1] == sb
                         && v->items[i + 2] == a && v->items[i + 3] == sa;
        if (same || mirror) return true;
    }
    return false;
}

static bool r2d__stay_add(R2DPhysics *p, int a, int sa, int b, int sb)
{
    R2DIntVec *v = &p->stay_pairs;
    if (v->count > UINT32_MAX - 4u) return false;
    if (!r2d__intvec_reserve(p, v, v->count + 4u, "stay")) return false;
    v->items[v->count++] = a;
    v->items[v->count++] = sa;
    v->items[v->count++] = b;
    v->items[v->count++] = sb;
    return true;
}

/**
 * §7. Фаза stay для тел, которые её запросили.
 *
 * Box2D присылает begin/end/hit, но не «всё ещё касаюсь»: это состояние
 * читается из текущих контактов тела. Обход идёт по DENSE-списку живых тел
 * (а не по всей ёмкости реестра), и только для тел с включённым stay — иначе
 * цена платилась бы всеми динамическими телами каждый кадр.
 *
 * Касание, начавшееся в этом же кадре, пропускается: у него уже есть begin.
 * Один контакт, который видят оба участника, отправляется один раз.
 */
static void r2d__collect_stay(R2DPhysics *p)
{
    bool any = false;
    for (uint32_t k = 0; k < p->body_pool.alive_count; ++k) {
        const uint32_t id = p->body_pool.dense[k];
        if (p->contact_stay[id]) { any = true; break; }
    }
    if (!any) return;

    b2ContactData data[R2D_MAX_SHAPES_PER_BODY * 4];
    const int cap = (int)(sizeof data / sizeof data[0]);
    for (uint32_t k = 0; k < p->body_pool.alive_count; ++k) {
        const uint32_t id = p->body_pool.dense[k];
        if (!p->contact_stay[id]) continue;
        const int n = b2Body_GetContactData(p->bodies[id], data, cap);
        for (int i = 0; i < n; ++i) {
            if (data[i].manifold.pointCount == 0) continue;
            const int a = r2d__body_id_of_shape(data[i].shapeIdA);
            const int b = r2d__body_id_of_shape(data[i].shapeIdB);
            if (a < 0 || b < 0) continue;
            if (r2d__pair_seen(&p->began_pairs, a, b)) continue;
            const int sa = r2d__shape_index_of_shape(data[i].shapeIdA);
            const int sb = r2d__shape_index_of_shape(data[i].shapeIdB);
            if (r2d__stay_seen(p, a, sa, b, sb)) continue;
            if (!r2d__stay_add(p, a, sa, b, sb)) return;
            R2DContactEvent *c = r2d__contact_push(p);
            if (!c) return;
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
        p->contacts.count = 0;
        p->began_pairs.count = 0;
        p->ended_pairs.count = 0;
        p->stay_pairs.count = 0;
    }
    if (!p->world_valid) return;
    const b2ContactEvents ev = b2World_GetContactEvents(p->world);

    // §7: пары этого кадра. begin нужен, чтобы stay не повторял уже
    // отправленный begin; end — чтобы один и тот же разрыв не пришёл дважды
    // (у пары может закончиться несколько форм подряд).
    for (int i = 0; i < ev.beginCount; ++i) {
        const b2ContactBeginTouchEvent *e = &ev.beginEvents[i];
        R2DContactEvent *c = r2d__contact_push(p);
        if (!c) break;
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
        r2d__pair_add(p, &p->began_pairs, c->a, c->b, "began");
    }
    for (int i = 0; i < ev.endCount; ++i) {
        const b2ContactEndTouchEvent *e = &ev.endEvents[i];
        const int a = r2d__body_id_of_shape(e->shapeIdA);
        const int b = r2d__body_id_of_shape(e->shapeIdB);
        // Повторный end по той же паре тел в одном кадре не отправляем: у игры
        // на узле одно событие `separate`, и два подряд — это баг для неё.
        if (r2d__pair_seen(&p->ended_pairs, a, b)) continue;
        R2DContactEvent *c = r2d__contact_push(p);
        if (!c) break;
        c->kind = R2D_CONTACT_END;
        r2d__event_bodies(p, c, e->shapeIdA, e->shapeIdB);
        r2d__pair_add(p, &p->ended_pairs, a, b, "ended");
    }
    for (int i = 0; i < ev.hitCount; ++i) {
        const b2ContactHitEvent *e = &ev.hitEvents[i];
        R2DContactEvent *c = r2d__contact_push(p);
        if (!c) break;
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
    for (int i = 0; i < sev.beginCount; ++i) {
        const b2SensorBeginTouchEvent *e = &sev.beginEvents[i];
        R2DContactEvent *c = r2d__contact_push(p);
        if (!c) break;
        c->kind = R2D_CONTACT_BEGIN;
        r2d__event_bodies(p, c, e->sensorShapeId, e->visitorShapeId);
        c->sensor = true;
        r2d__pair_add(p, &p->began_pairs, c->a, c->b, "began");
    }
    for (int i = 0; i < sev.endCount; ++i) {
        const b2SensorEndTouchEvent *e = &sev.endEvents[i];
        const int a = r2d__body_id_of_shape(e->sensorShapeId);
        const int b = r2d__body_id_of_shape(e->visitorShapeId);
        if (r2d__pair_seen(&p->ended_pairs, a, b)) continue;
        R2DContactEvent *c = r2d__contact_push(p);
        if (!c) break;
        c->kind = R2D_CONTACT_END;
        r2d__event_bodies(p, c, e->sensorShapeId, e->visitorShapeId);
        c->sensor = true;
        r2d__pair_add(p, &p->ended_pairs, a, b, "ended");
    }
    // §7: фаза stay — для тел, которые её попросили. Касание, начавшееся в этом
    // же кадре, не дублируется: у него уже есть begin.
    r2d__collect_stay(p);
    // Совместимость с прямым чтением script.c (см. physics.h).
    p->contact_count = (int)p->contacts.count;
}

const R2DContactEvent *r2d_physics_contacts(const R2DPhysics *p, int *count)
{
    if (count) *count = p ? (int)p->contacts.count : 0;
    return p ? p->contacts.items : NULL;
}

void r2d_physics_clear_contacts(R2DPhysics *p)
{
    if (p) {
        p->contacts.count = 0;
        p->contact_count = 0;
        p->contact_accumulating = false;
        p->began_pairs.count = 0;
        p->ended_pairs.count = 0;
        p->stay_pairs.count = 0;
    }
}

void r2d_physics_begin_contacts(R2DPhysics *p)
{
    if (p) {
        p->contacts.count = 0;
        p->contact_count = 0;
        p->contact_accumulating = true;
        // §7: пары кадра считаются заново — иначе end «прошлого» кадра
        // подавил бы законный end нового.
        p->began_pairs.count = 0;
        p->ended_pairs.count = 0;
        p->stay_pairs.count = 0;
    }
}

// --- Диагностика ёмкостей (debug-страница) ----------------------------------

void r2d_physics_stats(const R2DPhysics *p, R2DPhysicsStats *out)
{
    if (!out) return;
    SDL_zero(*out);
    if (!p) return;
    out->bodies_live = p->body_pool.alive_count;
    out->bodies_capacity = p->body_capacity;
    out->bodies_peak = p->body_peak;
    out->joints_live = p->joint_pool.alive_count;
    out->joints_capacity = p->joint_capacity;
    out->joints_peak = p->joint_peak;
    out->contacts_count = p->contacts.count;
    out->contacts_capacity = p->contacts.capacity;
    out->contacts_peak = p->contacts.peak;
    out->contact_oom = p->contact_oom;
}

uint32_t r2d_physics_body_capacity(const R2DPhysics *p) { return p ? p->body_capacity : 0; }
uint32_t r2d_physics_body_peak(const R2DPhysics *p) { return p ? p->body_peak : 0; }
uint32_t r2d_physics_joint_capacity(const R2DPhysics *p) { return p ? p->joint_capacity : 0; }
uint32_t r2d_physics_joint_peak(const R2DPhysics *p) { return p ? p->joint_peak : 0; }
uint32_t r2d_physics_contact_capacity(const R2DPhysics *p) { return p ? p->contacts.capacity : 0; }
uint32_t r2d_physics_contact_peak(const R2DPhysics *p) { return p ? p->contacts.peak : 0; }
uint32_t r2d_physics_contact_count(const R2DPhysics *p) { return p ? p->contacts.count : 0; }
bool r2d_physics_contact_oom(const R2DPhysics *p) { return p ? p->contact_oom : false; }

void r2d_physics_sync(R2DPhysics *p)
{
    if (!p->world_valid) return;
    // Только живые тела (dense-список), а не вся ёмкость реестра: при 100
    // живых из 8000 слотов sync больше не делает 8000 итераций.
    for (uint32_t k = 0; k < p->body_pool.alive_count; ++k) {
        const uint32_t i = p->body_pool.dense[k];
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
    if (!p || !r2d__body_slot_bounds(p, id) || !p->body_pool.slots[id].alive) return b2_nullShapeId;
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

    // O(1) слот через freelist; реестр при нехватке удваивается. Нет памяти —
    // это ошибка, а не «тихий отказ»: она уходит и в лог, и в кольцо для
    // машины. Фиксированного лимита тел больше нет.
    const uint32_t slot = r2d__body_slot_alloc(p);
    if (slot == R2D_SLOT_NONE) {
        r2d__push_error(p, R2D_PERR_BODY_LIMIT, -1, -1, (float)p->body_capacity,
                        "нет памяти под тело: тело не создано");
        R2D_ERROR("физика: не удалось выделить слот тела (ёмкость %u)",
                  (unsigned)p->body_capacity);
        return -1;
    }
    const int id = (int)slot;

    // §7: форма проверяется ДО b2CreateBody — некорректный контур не должен
    // тихо превратиться в другое тело.
    if (!r2d__validate_desc(p, d, id, 0)) {
        r2d_slot_pool_free(&p->body_pool, slot);
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
    // CCD: Box2D проверяет такое тело непрерывно, поэтому быстрая пуля не
    // проскакивает тонкую стену между подшагами.
    def.isBullet = d->bullet;

    b2BodyId body = b2CreateBody(p->world, &def);
    if (!b2Body_IsValid(body)) {
        R2D_ERROR("b2CreateBody вернул невалидное тело");
        r2d_slot_pool_free(&p->body_pool, slot);
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
        r2d_slot_pool_free(&p->body_pool, slot);
        return -1;
    }
    b2Shape_SetUserData(shape, R2D__SHAPE_TAG(id, 0));

    p->one_way[id] = d->one_way;
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
    // §7: поколение уже выросло при выдаче слота (пул). Событие контакта несёт
    // его, и JS отличает «то же тело» от «новый узел на том же id».
    p->contact_stay[id] = false;
    if (p->body_pool.alive_count > p->body_peak) p->body_peak = p->body_pool.alive_count;
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
    if (!r2d__body_slot_bounds(p, id) || !p->body_pool.slots[id].alive) return -1;

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
    if (!r2d__body_slot_bounds(p, id) || !p->body_pool.slots[id].alive) return -1;
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
    if (!p || !r2d__body_slot_bounds(p, id) || !p->body_pool.slots[id].alive) return 0;
    return b2Body_GetShapeCount(p->bodies[id]);
}

/**
 * §19. Ящик в Box2D v3 — тоже полигон: отдельного типа формы нет.
 *
 * Отличаем прямоугольник по ГЕОМЕТРИИ контура: ровно 4 вершины, без
 * скругления, соседние стороны перпендикулярны и контур замыкается в
 * параллелограмм (третья сторона равна первой с обратным знаком, четвёртая —
 * второй). Только тогда полуразмеры и угол — измеренный факт, а не догадка.
 *
 * Формы, которые движок создаёт как box (b2MakeBox/b2MakeOffsetBox), проходят
 * эту проверку всегда, включая повёрнутые: угол поворота запечён в вершины,
 * и мы возвращаем именно его.
 */
static bool r2d__poly_as_box(const b2Polygon *poly, R2DPhysShapeInfo *out)
{
    if (poly->count != 4 || poly->radius > 1e-4f) return false;

    const b2Vec2 *v = poly->vertices;
    const float ex = v[1].x - v[0].x, ey = v[1].y - v[0].y;   // сторона 1
    const float fx = v[2].x - v[1].x, fy = v[2].y - v[1].y;   // сторона 2
    const float gx = v[3].x - v[2].x, gy = v[3].y - v[2].y;   // сторона 3
    const float hx = v[0].x - v[3].x, hy = v[0].y - v[3].y;   // сторона 4
    const float le = sqrtf(ex * ex + ey * ey);
    const float lf = sqrtf(fx * fx + fy * fy);
    if (!(le > 0.0f) || !(lf > 0.0f)) return false;

    // Прямой угол между соседними сторонами: |e·f| мал по сравнению с |e||f|.
    if (fabsf(ex * fx + ey * fy) > 1e-3f * le * lf) return false;
    // Замыкание: противоположные стороны равны и противоположны.
    const float eps = 1e-4f * (le + lf);
    if (fabsf(gx + ex) > eps || fabsf(gy + ey) > eps) return false;
    if (fabsf(hx + fx) > eps || fabsf(hy + fy) > eps) return false;

    out->kind   = R2D_SHAPE_BOX;
    out->cx     = R2D_TO_PX(poly->centroid.x);
    out->cy     = R2D_TO_PX(poly->centroid.y);
    out->angle  = atan2f(ey, ex);
    out->half_w = R2D_TO_PX(0.5f * le);
    out->half_h = R2D_TO_PX(0.5f * lf);
    out->radius = 0.0f;
    return true;
}

/**
 * §19. Геометрия формы для overlay DevTools.
 *
 * Читает то, что реально лежит в Box2D, и переводит в пиксели и систему тела.
 * Ничего не выдумывает: если тип формы движку неизвестен (отрезок, цепочка),
 * возвращает false, а не «похожую» геометрию.
 */
bool r2d_physics_shape_info(const R2DPhysics *p, int id, int index, R2DPhysShapeInfo *out)
{
    if (!p || !out) return false;
    const b2ShapeId shape = r2d__shape_at(p, id, index);
    if (!b2Shape_IsValid(shape)) return false;

    R2DPhysShapeInfo info;
    SDL_zero(info);

    const b2Filter filter = b2Shape_GetFilter(shape);
    info.category_bits = filter.categoryBits;
    info.mask_bits     = filter.maskBits;
    info.group_index   = filter.groupIndex;
    info.sensor        = b2Shape_IsSensor(shape);
    // Выключенная форма (нулевой фильтр) — тот же признак, что у §40: кто бы
    // её ни выключил, источник истины один.
    info.enabled       = r2d__shape_filter_enabled(shape);
    info.one_way       = p->one_way[id];

    switch (b2Shape_GetType(shape)) {
    case b2_circleShape: {
        const b2Circle c = b2Shape_GetCircle(shape);
        info.kind   = R2D_SHAPE_CIRCLE;
        info.cx     = R2D_TO_PX(c.center.x);
        info.cy     = R2D_TO_PX(c.center.y);
        info.radius = R2D_TO_PX(c.radius);
        break;
    }
    case b2_capsuleShape: {
        const b2Capsule c = b2Shape_GetCapsule(shape);
        const float dx = c.center2.x - c.center1.x;
        const float dy = c.center2.y - c.center1.y;
        info.kind   = R2D_SHAPE_CAPSULE;
        info.cx     = R2D_TO_PX(0.5f * (c.center1.x + c.center2.x));
        info.cy     = R2D_TO_PX(0.5f * (c.center1.y + c.center2.y));
        info.half_h = R2D_TO_PX(0.5f * sqrtf(dx * dx + dy * dy));
        // Капсула нулевой длины — это круг: собственного угла у неё нет,
        // поэтому angle остаётся нулём, а не случайным atan2(0, 0).
        info.angle  = (dx == 0.0f && dy == 0.0f) ? 0.0f : atan2f(dy, dx);
        info.radius = R2D_TO_PX(c.radius);
        break;
    }
    case b2_polygonShape: {
        const b2Polygon poly = b2Shape_GetPolygon(shape);
        if (!r2d__poly_as_box(&poly, &info)) {
            info.kind   = R2D_SHAPE_POLYGON;
            info.cx     = R2D_TO_PX(poly.centroid.x);
            info.cy     = R2D_TO_PX(poly.centroid.y);
            info.radius = R2D_TO_PX(poly.radius);
            int n = poly.count;
            if (n > R2D_MAX_POLY_POINTS) n = R2D_MAX_POLY_POINTS;
            if (n > B2_MAX_POLYGON_VERTICES) n = B2_MAX_POLYGON_VERTICES;
            for (int i = 0; i < n; ++i) {
                info.points[i * 2]     = R2D_TO_PX(poly.vertices[i].x);
                info.points[i * 2 + 1] = R2D_TO_PX(poly.vertices[i].y);
            }
            info.point_count = n;
        }
        break;
    }
    default:
        return false;
    }

    *out = info;
    return true;
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
    if (!p->world_valid || !r2d__body_slot_bounds(p, id)
        || !p->body_pool.slots[id].alive) return;
    // Суставы, державшиеся за это тело, Box2D уничтожит вместе с ним —
    // освобождаем их слоты, чтобы JS не дёргал невалидные id и чтобы ёмкость
    // пула не утекала. Идём по живым суставам, а не по всей ёмкости.
    for (uint32_t k = 0; k < p->joint_pool.alive_count; ++k) {
        const uint32_t jid = p->joint_pool.dense[k];
        if (!b2Joint_IsValid(p->joints[jid])) {
            // Box2D уже потерял сустав (например, тело удалили раньше через
            // b2DestroyBody из другого места) — слот тоже освобождаем.
            r2d_slot_pool_free(&p->joint_pool, jid);
            // После free последний живой элемент переехал на позицию k —
            // обрабатываем её повторно.
            --k;
            continue;
        }
        const b2BodyId ba = b2Joint_GetBodyA(p->joints[jid]);
        const b2BodyId bb = b2Joint_GetBodyB(p->joints[jid]);
        if (B2_ID_EQUALS(ba, p->bodies[id]) || B2_ID_EQUALS(bb, p->bodies[id])) {
            r2d_slot_pool_free(&p->joint_pool, jid);
            --k;
        }
    }
    b2DestroyBody(p->bodies[id]);
    r2d_slot_pool_free(&p->body_pool, (uint32_t)id);
    p->one_way[id] = false;
    // Флаг живёт на теле: новый владелец этого id не должен унаследовать
    // «спрыгивание» от прошлого.
    p->one_way_ignore[id] = false;
    // §7: stay-события снимаются вместе с телом. Поколение НЕ сбрасываем — оно
    // как раз и отличает события уничтоженного тела от нового владельца id.
    p->contact_stay[id] = false;
}

bool r2d_physics_is_alive(const R2DPhysics *p, int id)
{
    if (!p || !r2d__body_slot_bounds(p, id)) return false;
    if (!r2d_slot_pool_alive(&p->body_pool, (uint32_t)id)) return false;
    return p->world_valid && b2Body_IsValid(p->bodies[id]);
}

int r2d_physics_live_count(const R2DPhysics *p)
{
    return p ? (int)p->body_pool.alive_count : 0;
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
    if (!r2d__body_slot_bounds(p, id)) return false;
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
    if (!r2d__body_slot_bounds(p, id)) return false;
    return p->contact_stay[id];
}

uint32_t r2d_physics_generation(const R2DPhysics *p, int id)
{
    if (!p || !r2d__body_slot_bounds(p, id)) return 0;
    return r2d_slot_pool_generation(&p->body_pool, (uint32_t)id);
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
    // Форма движка несёт id тела в user data, поэтому поиск O(1): раньше
    // каждый луч/запрос линейно обходил ВСЮ ёмкость реестра тел.
    const int id = r2d__body_id_of_shape(shape);
    if (!r2d__body_slot_bounds(p, id) || !p->body_pool.slots[id].alive) return -1;
    const b2BodyId body = b2Shape_GetBody(shape);
    if (!B2_ID_EQUALS(p->bodies[id], body)) return -1;
    return id;
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
        if (!r2d_physics_is_alive(p, id)) continue;

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
    if (!r2d__body_slot_bounds(p, a) || !r2d__body_slot_bounds(p, b)) return -1;
    if (!p->body_pool.slots[a].alive || !p->body_pool.slots[b].alive) {
        R2D_WARN("сустав: тело %d или %d не существует", a, b);
        return -1;
    }

    // O(1) слот сустава: freelist, при нехватке пул удваивается. Лимита 64
    // больше нет — 65-й и 1000-й сустав создаются штатно.
    const uint32_t slot = r2d__joint_slot_alloc(p);
    if (slot == R2D_SLOT_NONE) {
        R2D_ERROR("сустав: не удалось выделить слот (ёмкость %u)",
                  (unsigned)p->joint_capacity);
        return -1;
    }
    const int id = (int)slot;

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
        r2d_slot_pool_free(&p->joint_pool, slot);
        return -1;
    }

    // Сустав НЕ будит уснувшие тела сам (Box2D v3), поэтому только что
    // созданный сустав не действовал: тело спало и стояло на месте. Это
    // нашлось тестом на mouse-сустав («тело тянется к цели» — не тянулось) и
    // касается всех видов: игра вправе ждать, что новый сустав заработает
    // сразу. Для этого у Box2D есть штатный вызов.
    b2Joint_WakeBodies(joint);

    p->joints[id] = joint;
    if (p->joint_pool.alive_count > p->joint_peak) p->joint_peak = p->joint_pool.alive_count;
    return id;
}

void r2d_physics_destroy_joint(R2DPhysics *p, int id)
{
    if (!p || !p->world_valid) return;
    if (id < 0 || (uint32_t)id >= p->joint_capacity
        || !r2d_slot_pool_alive(&p->joint_pool, (uint32_t)id)) return;
    if (b2Joint_IsValid(p->joints[id])) {
        b2DestroyJoint(p->joints[id]);
    }
    r2d_slot_pool_free(&p->joint_pool, (uint32_t)id);
}

bool r2d_physics_joint_alive(const R2DPhysics *p, int id)
{
    if (!p || id < 0 || (uint32_t)id >= p->joint_capacity) return false;
    if (!r2d_slot_pool_alive(&p->joint_pool, (uint32_t)id)) return false;
    return b2Joint_IsValid(p->joints[id]);
}

int r2d_physics_joint_count(const R2DPhysics *p)
{
    if (!p) return 0;
    // Слоты освобождаются при destroy_joint и при удалении тела, поэтому
    // alive_count пула и есть число живых суставов (без обхода ёмкости).
    return (int)p->joint_pool.alive_count;
}
