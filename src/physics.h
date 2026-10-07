// ===========================================================================
// Физика Box2D v3.
//
// По ТЗ (п. 4.2) мир Box2D живёт целиком в C. JS не считает коллизии и
// векторы — он лишь создаёт тела по числовому id и раз в кадр забирает
// готовые трансформы для отрисовки.
// ===========================================================================
#pragma once

#include "r2d.h"

#include <box2d/box2d.h>

// Соглашение о масштабе.
//
// Игровой код (JS) и рендер работают в пикселях, но Box2D настроена на метры:
// его допуски (linearSlop, максимальная скорость за шаг и т.д.) подобраны под
// объекты размером порядка единицы. Поэтому на границе C ↔ Box2D координаты
// делятся на R2D_PX_PER_M, а результаты умножаются обратно.
//
// 32 пикселя = 1 метр — стандартный выбор для тайловых игр: тайл 32x32
// превращается в квадрат 1x1 м с массой 1 кг при плотности 1.
#define R2D_PX_PER_M 32.0f

#ifdef __cplusplus
extern "C" {
#endif

typedef enum R2DBodyType {
    R2D_BODY_STATIC    = 0,
    R2D_BODY_KINEMATIC = 1,
    R2D_BODY_DYNAMIC   = 2,
} R2DBodyType;

// --- Формы тел --------------------------------------------------------------
// Раньше тело всегда было прямоугольником. Теперь форма выбирается: круг
// катится, капсула не застревает на стыках тайлов, полигон повторяет силуэт.
typedef enum R2DShapeKind {
    R2D_SHAPE_BOX     = 0,
    R2D_SHAPE_CIRCLE  = 1,
    R2D_SHAPE_CAPSULE = 2,
    R2D_SHAPE_POLYGON = 3,
} R2DShapeKind;

#define R2D_MAX_POLY_POINTS 8

// --- Слои и маски коллизий (b2Filter) ---------------------------------------
// Семантика как в Box2D и Godot: category (слой) — «в каком слое лежит тело»,
// mask — «с какими слоями оно сталкивается». Тела A и B сталкиваются, если
// (A.mask & B.category) и (B.mask & A.category) непусты. Маски 64-битные —
// столько же, сколько в Box2D v3, но JS-сторона работает с 32 младшими
// битами: побитовые операторы JavaScript всё равно 32-битные.
#define R2D_FILTER_DEFAULT_CATEGORY 0x1ULL
#define R2D_FILTER_DEFAULT_MASK     0xFFFFFFFFFFFFFFFFULL
// Индекс группы: > 0 — тела группы всегда сталкиваются между собой, минуя
// маски; < 0 — никогда не сталкиваются (Box2D).
#define R2D_FILTER_GROUP_NONE       0

// Описание тела: то, что приходит из JS одним объектом.
typedef struct R2DBodyDesc {
    float x, y, angle;
    int   type;                 // R2DBodyType
    float density, friction, restitution;
    bool  fixed_rotation;
    int   shape;                // R2DShapeKind
    float half_w, half_h;       // прямоугольник / половина капсулы
    float radius;               // круг / капсула
    float points[R2D_MAX_POLY_POINTS * 2];   // полигон, локальные пиксели
    int   point_count;
    float poly_radius;          // скругление полигона
    bool  one_way;              // односторонняя платформа
    float one_way_angle;        // куда смотрит «лицевая» сторона (радианы)
    bool  sensor;               // зона без отталкивания
    bool  contacts;             // присылать события контакта
    // Слои и маски. filter_set = false (значение по SDL_zero) означает
    // «умолчания движка»: category 1 (слой 1), mask — все слои. Отдельный
    // флаг нужен потому, что mask = 0 — законное значение («не сталкиваться
    // ни с кем»), и отличить его от «поле не заполнено» иначе нельзя.
    uint64_t category_bits;
    uint64_t mask_bits;
    int      group_index;
    bool     filter_set;
    // CCD: тело считается быстрым и проверяется непрерывно (пули не проскакивают
    // тонкие стены). Box2D предупреждает, что bullets надо тратить экономно:
    // это не общий CCD для динамика-против-динамика и может мешать суставам.
    bool     bullet;
} R2DBodyDesc;

// Событие контакта за прошедший шаг. Координаты — пиксели.
typedef enum R2DContactKind {
    R2D_CONTACT_BEGIN = 0,
    R2D_CONTACT_END   = 1,
    R2D_CONTACT_HIT   = 2,
} R2DContactKind;

typedef struct R2DContactEvent {
    int   kind;        // R2DContactKind
    int   a, b;        // id тел; -1 — тело не опознано (например, уже удалено)
    float nx, ny;      // нормаль от A к B
    float px, py;      // точка контакта
    float speed;       // скорость сближения для hit, иначе 0
} R2DContactEvent;

#define R2D_MAX_CONTACT_EVENTS 128
#define R2D_MAX_JOINTS         64

typedef enum R2DJointKind {
    R2D_JOINT_REVOLUTE = 0,
    R2D_JOINT_DISTANCE = 1,
    R2D_JOINT_WELD     = 2,
    // Направляющая: тело едет по оси и не вращается вокруг неё. Ось задаётся
    // в мировых координатах, пределы — в метрах (для distance это длина).
    R2D_JOINT_PRISMATIC = 3,
    // Колесо/подвеска: тело крутится вокруг оси и может ходить вдоль неё.
    R2D_JOINT_WHEEL    = 4,
} R2DJointKind;

typedef struct R2DPhysics {
    b2WorldId world;
    b2BodyId  bodies[R2D_MAX_BODIES];
    bool      alive[R2D_MAX_BODIES];
    float     transforms[R2D_MAX_BODIES * 3];   // x, y, angle — читает JS
    int       live_count;
    bool      world_valid;

    // --- Односторонние платформы -------------------------------------------
    // Нормаль «рабочей» стороны в системе тела: тело проходит сквозь платформу
    // с обратной стороны и встаёт на неё с лицевой. Хранится локально, чтобы
    // повёрнутая платформа работала правильно.
    bool  one_way[R2D_MAX_BODIES];
    float one_way_nx[R2D_MAX_BODIES];
    float one_way_ny[R2D_MAX_BODIES];

    // --- События контакта (читает JS через engine.contacts()) ---------------
    R2DContactEvent contacts[R2D_MAX_CONTACT_EVENTS];
    int             contact_count;
    bool            overflow_logged;
    // Буфер копится за все подшаги кадра: события одного шага живут до
    // следующего вызова Box2D, а за кадр шагов бывает до пяти, и раньше
    // выживали только события последнего.
    bool            contact_accumulating;

    // --- Суставы ------------------------------------------------------------
    b2JointId joints[R2D_MAX_JOINTS];
    bool      joint_alive[R2D_MAX_JOINTS];
    // Ось следующего prismatic/wheel-сустава (мировые координаты): параметров
    // у create_joint уже слишком много, а ось нужна только этим двум видам.
    float     joint_axis_x;
    float     joint_axis_y;
} R2DPhysics;

void r2d_physics_init(R2DPhysics *p, float gravity_x, float gravity_y);
void r2d_physics_shutdown(R2DPhysics *p);
void r2d_physics_step(R2DPhysics *p, float dt);
void r2d_physics_sync(R2DPhysics *p);

// Возвращает id тела (>= 0) или -1.
int  r2d_physics_create_box(R2DPhysics *p, float x, float y, float half_w, float half_h,
                             float angle, int type, float density, float friction,
                             float restitution, bool fixed_rotation);

// Общее создание тела по описанию: форма, one-way, сенсор, события контакта.
// Вся новая функциональность идёт через неё; create_box остаётся обёрткой.
int  r2d_physics_create(R2DPhysics *p, const R2DBodyDesc *desc);
void r2d_physics_destroy(R2DPhysics *p, int id);
bool r2d_physics_is_alive(const R2DPhysics *p, int id);
int  r2d_physics_live_count(const R2DPhysics *p);

void  r2d_physics_set_velocity(R2DPhysics *p, int id, float vx, float vy);
void  r2d_physics_get_velocity(const R2DPhysics *p, int id, float *vx, float *vy);
void  r2d_physics_set_angular_velocity(R2DPhysics *p, int id, float w);
float r2d_physics_get_angular_velocity(const R2DPhysics *p, int id);
void  r2d_physics_set_position(R2DPhysics *p, int id, float x, float y, float angle);
void  r2d_physics_apply_impulse(R2DPhysics *p, int id, float ix, float iy);
void  r2d_physics_set_gravity(R2DPhysics *p, float gx, float gy);
void  r2d_physics_get_gravity(const R2DPhysics *p, float *gx, float *gy);
void  r2d_physics_set_awake(R2DPhysics *p, int id, bool awake);
// Включение/выключение тела: выключенное не сталкивается и не попадает в
// запросы, но остаётся живым. Нужно пулу объектов, чтобы не пересоздавать
// тело на каждый spawn (docs/HIGH_LEVEL_API_PERF.md §3.6).
void  r2d_physics_set_enabled(R2DPhysics *p, int id, bool enabled);
bool  r2d_physics_is_enabled(const R2DPhysics *p, int id);
// Множитель гравитации для конкретного тела: 0 — тело не падает (снаряды,
// парящие объекты), 1 — обычное поведение, отрицательное — «вверх».
void  r2d_physics_set_gravity_scale(R2DPhysics *p, int id, float scale);
// CCD для уже созданного тела: включить/выключить и прочитать.
void  r2d_physics_set_bullet(R2DPhysics *p, int id, bool bullet);
bool  r2d_physics_is_bullet(const R2DPhysics *p, int id);
bool  r2d_physics_is_awake(const R2DPhysics *p, int id);
float r2d_physics_get_mass(const R2DPhysics *p, int id);

// --- Слои и маски коллизий ---------------------------------------------------
// Меняет фильтр уже созданного тела (все его формы). Выключенное тело
// (r2d_physics_set_enabled) фильтр сохраняет: при включении он вернётся.
// false — тела нет.
bool  r2d_physics_set_filter(R2DPhysics *p, int id, uint64_t category_bits,
                             uint64_t mask_bits, int group_index);
// Читает фильтр тела. false — тела нет.
bool  r2d_physics_get_filter(const R2DPhysics *p, int id, uint64_t *category_bits,
                             uint64_t *mask_bits, int *group_index);

// --- Запросы к миру (высокоуровневое API: $.world.raycast/query) -----------

// Максимум тел, которые вернёт один запрос.
#define R2D_MAX_QUERY 256

// Результат луча. Координаты — пиксели, нормаль — единичный вектор.
typedef struct R2DRayHit {
    bool  hit;
    int   body;        // наш id тела или -1, если тело не опознано
    float x, y;        // точка попадания
    float nx, ny;      // нормаль поверхности
    float fraction;    // доля пройденного отрезка 0..1
} R2DRayHit;

// Ближайшее препятствие на отрезке. ignore/ignore_count — тела, которые луч
// пропускает (например, тело стрелка): callback перебирает попадания дальше.
// mask — слои, которые запрос принимает; 0 = все слои (у запроса нет своего
// слоя, поэтому маска тела на него не влияет — как collision_mask у RayCast2D
// в Godot). false — ничего не задето.
bool r2d_physics_raycast(const R2DPhysics *p, float x1, float y1, float x2, float y2,
                         const int *ignore, int ignore_count, uint64_t mask, R2DRayHit *out);

// --- Свип формы (аналог ShapeCast2D) -----------------------------------------
// Форма едет из (x1,y1) в (x2,y2) и останавливается на первом препятствии.
// Отличие от луча принципиальное: луч — точка, свип — объём. Поэтому
// «пролезу ли я в проём» и «не задену ли плечом угол» решаются только свипом.
typedef struct R2DCastShape {
    bool  hit;
    int   body;        // наш id тела или -1
    float x, y;        // точка касания, пиксели
    float nx, ny;      // нормаль поверхности
    float fraction;    // доля пройденного пути 0..1 (0 — перекрытие в начале)
} R2DCastShape;

// shape — R2DShapeKind; для круга берётся radius, для капсулы — radius и
// half_h (половина отрезка), для прямоугольника — half_w/half_h. angle —
// поворот формы (радианы). Датчики (зоны) свип не останавливают: они не
// препятствия. false — на пути ничего не было.
bool r2d_physics_cast_shape(const R2DPhysics *p, int shape,
                            float half_w, float half_h, float radius,
                            float x1, float y1, float x2, float y2, float angle,
                            const int *ignore, int ignore_count, uint64_t mask,
                            R2DCastShape *out);

// Тела, чьи формы накрывают точку / попадают в прямоугольник (x, y — центр).
// mask — слои, которые принимает запрос; 0 = все слои. Возвращают число
// записанных id (не больше max_ids).
int r2d_physics_query_point(const R2DPhysics *p, float x, float y, uint64_t mask,
                            int *ids, int max_ids);
int r2d_physics_query_box(const R2DPhysics *p, float x, float y, float w, float h,
                          uint64_t mask, int *ids, int max_ids);

// --- События контакта -------------------------------------------------------
// Заполняются на каждом шаге мира; JS читает их через engine.contacts().
// begin/end приходят только для форм, созданных с desc.contacts = true.
const R2DContactEvent *r2d_physics_contacts(const R2DPhysics *p, int *count);
void r2d_physics_clear_contacts(R2DPhysics *p);
// Начать кадр сбора событий контакта: обнуляет буфер и включает накопление,
// которое держится до r2d_physics_clear_contacts(). Звать один раз за кадр,
// ДО цикла подшагов (см. main.c).
void r2d_physics_begin_contacts(R2DPhysics *p);

// --- Суставы ----------------------------------------------------------------
// a/b — id тел, ax/ay и bx/by — точки крепления в мировых пикселях
// (пересчитываются в локальные координаты тела). type — R2DJointKind.
// Дополнительные параметры: для distance — length (0 = по текущему
// расстоянию); для revolute и prismatic — limits/motor (для prismatic пределы
// в метрах, мотор — сила). Возвращает id сустава или -1.
//
// Ось сустава (prismatic, wheel) задаётся ДО вызова:
// r2d_physics_set_joint_axis(p, x, y). Иначе берётся (1, 0).
int  r2d_physics_create_joint(R2DPhysics *p, int type, int a, int b,
                              float ax, float ay, float bx, float by,
                              bool collide_connected, float length,
                              bool enable_limit, float lower_angle, float upper_angle,
                              bool enable_motor, float motor_speed, float max_motor_torque);
// Ось для следующего prismatic/wheel-сустава в МИРОВЫХ координатах.
void r2d_physics_set_joint_axis(R2DPhysics *p, float ax, float ay);
void r2d_physics_destroy_joint(R2DPhysics *p, int id);
bool r2d_physics_joint_alive(const R2DPhysics *p, int id);
int  r2d_physics_joint_count(const R2DPhysics *p);

#ifdef __cplusplus
}
#endif
