// ===========================================================================
// Физика Box2D v3.
//
// По ТЗ (п. 4.2) мир Box2D живёт целиком в C. JS не считает коллизии и
// векторы — он лишь создаёт тела по числовому id и раз в кадр забирает
// готовые трансформы для отрисовки.
// ===========================================================================
#pragma once

#include "r2d.h"
// Пул слотов с поколениями и проверяемый рост массивов (§36): реестры тел и
// суставов больше не фиксированные, поэтому используют ту же инфраструктуру,
// что и текстуры рендера.
#include "r2d_slot_pool.h"

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

// Сколько форм может быть у одного тела. Основная плюс добавленные через
// `r2d_physics_add_shape`: «голова», «нога», «щит» — по форме на зону.
#define R2D_MAX_SHAPES_PER_BODY 8

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
    // §7: тело продолжает касаться (контакт был и в прошлом шаге). Опционально:
    // считается только для тел, включивших stay (r2d_physics_set_contact_stay).
    R2D_CONTACT_STAY  = 3,
} R2DContactKind;

typedef struct R2DContactEvent {
    int   kind;        // R2DContactKind
    int   a, b;        // id тел; -1 — тело не опознано (например, уже удалено)
    // §40: индекс формы в теле (0 — основная, дальше области). По нему игра
    // отличает «попал в область оружия» от «задел тело» и находит область
    // участника; -1 — форма не наша/не опознана.
    int   shape_a, shape_b;
    float nx, ny;      // нормаль от A к B
    float px, py;      // точка контакта
    float speed;       // скорость сближения для hit, иначе 0
    // §7: поколение тела на момент события. body id переиспользуется после
    // destroy, поэтому «устаревший handle» отличается по поколению: событие со
    // старым gen не должно дойти до нового владельца того же id.
    uint32_t gen_a, gen_b;
    // §7: чего backend НЕ дал. Для сенсоров контактная нормаль не определена —
    // это `has_normal = false`, а не выдуманный нулевой вектор.
    bool  sensor;      // хотя бы одна сторона — сенсор
    bool  has_normal;  // false — нормали нет (сенсор или end)
    bool  has_point;   // false — точки контакта нет (begin без манифолда)
} R2DContactEvent;

// --- §7. Машиночитаемые ошибки физики --------------------------------------
// Лог R2D_ERROR видит человек, но не игра и не агент. Ошибки копятся в кольце
// и отдаются через engine.physicsErrors(): код, тело, форма, число и короткая
// причина. В отличие от лога, они не теряются при нескольких ошибках подряд.
typedef enum R2DPhysicsErrorCode {
    R2D_PERR_SHAPE_INVALID = 1,   // контур/капсула/круг отвергнуты до создания тела
    R2D_PERR_BODY_LIMIT    = 2,   // не хватило памяти под тело (бывший лимит)
    R2D_PERR_SHAPE_INDEX   = 3,   // форма с таким индексом не найдена
} R2DPhysicsErrorCode;

#define R2D_MAX_PHYSICS_ERRORS 16
#define R2D_PHYSICS_DETAIL_MAX 80

typedef struct R2DPhysicsError {
    int   code;        // R2DPhysicsErrorCode
    int   body;        // id тела или -1
    int   shape;       // индекс формы или -1
    float value;       // числовой контекст (число точек, радиус, …)
    char  detail[R2D_PHYSICS_DETAIL_MAX];
} R2DPhysicsError;


// Стартовые ёмкости динамических реестров. Это НЕ потолки: при нехватке
// массив удваивается, поэтому 9000-е тело или 100-й сустав создаются штатно.
// Рост проверяемый: required <= UINT32_MAX, capacity * sizeof(T) <= SIZE_MAX,
// при отказе аллокатора данные не меняются и ошибка уходит в R2D_ERROR.
#ifndef R2D_INITIAL_BODIES
#define R2D_INITIAL_BODIES         1024
#endif
#define R2D_INITIAL_CONTACT_EVENTS 128
#define R2D_INITIAL_JOINTS         64

// ВРЕМЕННЫЕ legacy-алиасы: script.c ещё читает эти имена как «потолки».
// Физика их не использует; после интеграции их нужно заменить на
// r2d_physics_contact_capacity()/r2d_physics_joint_capacity().

// Растущий буфер событий контакта за кадр. items выделяется один раз и
// переиспользуется: в начале кадра обнуляется только count, free/realloc на
// каждом кадре нет. Ёмкость растёт 128 → 256 → 512 → … без фиксированного
// потолка; peak — максимум за всё время жизни мира (диагностика).
typedef struct R2DContactBuffer {
    R2DContactEvent *items;
    uint32_t         count;
    uint32_t         capacity;
    uint32_t         peak;
} R2DContactBuffer;

// Растущий вектор int: списки пар began/ended/stay тоже больше не упираются в
// размер буфера событий. Раньше при >128 контактах пары молча отбрасывались,
// из-за чего могли дублироваться end/stay.
typedef struct R2DIntVec {
    int      *items;
    uint32_t  count;
    uint32_t  capacity;
} R2DIntVec;

typedef enum R2DJointKind {
    R2D_JOINT_REVOLUTE = 0,
    R2D_JOINT_DISTANCE = 1,
    R2D_JOINT_WELD     = 2,
    // Направляющая: тело едет по оси и не вращается вокруг неё. Ось задаётся
    // в мировых координатах, пределы — в метрах (для distance это длина).
    R2D_JOINT_PRISMATIC = 3,
    // Колесо/подвеска: тело крутится вокруг оси и может ходить вдоль неё.
    R2D_JOINT_WHEEL    = 4,
    // Запрет столкновений между двумя конкретными телами (Box2D filter joint).
    // Это надёжнее масок: работает для пары, не трогая слои остальных.
    R2D_JOINT_FILTER   = 6,
} R2DJointKind;

typedef struct R2DPhysics {
    b2WorldId world;
    bool      world_valid;

    // --- Реестр тел ---------------------------------------------------------
    // Слоты выдаёт пул: id = индекс слота (стабильный публичный id), freelist —
    // O(1) создание после удаления, dense-список — обход только живых тел,
    // generation — распознавание протухших ссылок на переиспользованный id.
    // Массивы ниже индексируются слотом и растут вместе с ёмкостью пула.
    R2DSlotPool body_pool;
    b2BodyId   *bodies;
    float      *transforms;        // x, y, angle — читает JS
    bool       *one_way;
    float      *one_way_nx;
    float      *one_way_ny;
    bool       *one_way_ignore;
    bool       *contact_stay;
    uint32_t    body_capacity;     // ёмкость массивов (== body_pool.slot_capacity)
    uint32_t    body_peak;         // максимум одновременно живых тел

    // --- События контакта (читает JS через engine.contacts()) ---------------
    R2DContactBuffer contacts;
    // Совместимость: script.c читает это поле напрямую. Значение всегда равно
    // contacts.count и обновляется в конце каждой функции сбора событий.
    int             contact_count;
    bool            contact_oom;   // рост буфера/пар не удался (события не потеряны молча)
    // Буфер копится за все подшаги кадра: события одного шага живут до
    // следующего вызова Box2D, а за кадр шагов бывает до пяти, и раньше
    // выживали только события последнего.
    bool            contact_accumulating;

    // --- §7. Устойчивые контакты -------------------------------------------
    // Пары тел, у которых в этом кадре уже было begin/end/stay. Векторы растут:
    // при >128 контактах пары больше не теряются. Нужны, чтобы один и тот же
    // end не пришёл дважды, а stay не дублировался, когда его просят оба
    // участника пары.
    R2DIntVec began_pairs;
    R2DIntVec ended_pairs;
    R2DIntVec stay_pairs;

    // --- §7. Ошибки физики (кольцо, читает JS) ------------------------------
    R2DPhysicsError errors[R2D_MAX_PHYSICS_ERRORS];
    int             error_head;      // следующий слот записи
    int             error_count;     // сколько записей сейчас в кольце (<= MAX)
    int             error_total;     // сколько всего записано (растёт всегда)
    bool            error_overflow;

    // --- Суставы ------------------------------------------------------------
    // Тот же пул слотов: id = индекс слота, freelist + dense-список + поколения.
    R2DSlotPool joint_pool;
    b2JointId   *joints;
    uint32_t     joint_capacity;
    uint32_t     joint_peak;
    // Ось следующего prismatic/wheel-сустава (мировые координаты): параметров
    // у create_joint уже слишком много, а ось нужна только этим двум видам.
    float        joint_axis_x;
    float        joint_axis_y;
} R2DPhysics;

// --- Диагностика для debug-страницы -----------------------------------------
// Только чтение: занято/ёмкость/пик по телам и суставам, count/ёмкость/пик по
// контактам и флаг OOM. Всё это — факты реестров, а не «потолки из define».
typedef struct R2DPhysicsStats {
    uint32_t bodies_live;
    uint32_t bodies_capacity;
    uint32_t bodies_peak;
    uint32_t joints_live;
    uint32_t joints_capacity;
    uint32_t joints_peak;
    uint32_t contacts_count;
    uint32_t contacts_capacity;
    uint32_t contacts_peak;
    bool     contact_oom;
} R2DPhysicsStats;

void     r2d_physics_stats(const R2DPhysics *p, R2DPhysicsStats *out);
uint32_t r2d_physics_body_capacity(const R2DPhysics *p);
uint32_t r2d_physics_body_peak(const R2DPhysics *p);
uint32_t r2d_physics_joint_capacity(const R2DPhysics *p);
uint32_t r2d_physics_joint_peak(const R2DPhysics *p);
uint32_t r2d_physics_contact_capacity(const R2DPhysics *p);
uint32_t r2d_physics_contact_peak(const R2DPhysics *p);
uint32_t r2d_physics_contact_count(const R2DPhysics *p);
bool     r2d_physics_contact_oom(const R2DPhysics *p);

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
// Разрешение засыпать. false — тело всегда бодрое: нужно там, где игра
// двигает тело напрямую скоростью (перетаскивание), иначе Box2D усыпит его
// на накопленном покое и управление перестанет действовать.
void  r2d_physics_set_sleeping(R2DPhysics *p, int id, bool sleeping);
bool  r2d_physics_is_sleeping_enabled(const R2DPhysics *p, int id);
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
// Игнорировать ли этому телу односторонние платформы (спрыгивание вниз).
// Включается на время падения и снимается, когда узел прошёл платформу.
void  r2d_physics_set_one_way_ignore(R2DPhysics *p, int id, bool on);
bool  r2d_physics_one_way_ignore(const R2DPhysics *p, int id);
bool  r2d_physics_is_awake(const R2DPhysics *p, int id);

// --- §7. Контракт надёжности -------------------------------------------------

// STAY-события для тела: opt-in, по умолчанию выключены (обход контактов не
// бесплатный). Включённое тело получает `stay` для каждого касания, которое
// уже было в прошлом шаге (begin приходит один раз, stay — пока касаются).
void  r2d_physics_set_contact_stay(R2DPhysics *p, int id, bool on);
bool  r2d_physics_contact_stay(const R2DPhysics *p, int id);

// Поколение тела: 0 — тела нет или оно не создавалось. Событие, пришедшее с
// другим поколением, относится к уже уничтоженному телу — игра не должна
// принимать его за новый узел с тем же body id.
uint32_t r2d_physics_generation(const R2DPhysics *p, int id);

// Ошибки физики в порядке появления (до `cap` записей). Возвращает число
// записей. `overflow` — кольцо переполнялось (часть ошибок вытеснена).
int  r2d_physics_errors(const R2DPhysics *p, R2DPhysicsError *out, int cap, bool *overflow);
void r2d_physics_clear_errors(R2DPhysics *p);

bool  r2d_physics_is_awake(const R2DPhysics *p, int id);

// Добавить телу ещё одну форму (второй зоной: голова, нога, щит). Описание —
// тот же R2DBodyDesc: важны поля формы. Возвращает индекс формы или -1.
// `dx`/`dy` — СМЕЩЕНИЕ формы от центра тела в пикселях: «голова» выше центра
// (`dy` отрицательный), «ноги» ниже. Отдельные параметры, а не поля описания:
// описание описывает ТЕЛО, а смещение относится только к добавочной форме.
// `d->angle` — собственный поворот формы (радианы).
int  r2d_physics_add_shape(R2DPhysics *p, int id, const R2DBodyDesc *d, float dx, float dy);
// Сколько форм у тела (0 — тела нет).
int  r2d_physics_shape_count(const R2DPhysics *p, int id);

// --- §19. Чтение геометрии формы для overlay DevTools ------------------------
//
// Physics Debugger рисует поверх кадра контуры форм: прямоугольник, круг,
// капсулу, контур полигона, сенсоры и односторонние платформы. Данные для
// этого берутся ИЗ BOX2D — второй физической модели движок не заводит.
//
// Координаты — локальные, в системе тела и в ПИКСЕЛЯХ (как всё, что видит JS):
// мировой контур получается трансформом тела из engine.getTransforms() плюс
// собственный угол/смещение формы. Так overlay не зависит от того, спит тело
// или движется.
//
// Чего в Box2D нет, того здесь НЕ появляется: собственного «объявленного» вида
// формы Box2D не хранит (прямоугольник для неё — полигон из 4 точек), поэтому
// `kind` — геометрический факт: прямоугольником считается только контур из
// четырёх вершин с прямыми углами и без скругления, всё остальное — polygon.
typedef struct R2DPhysShapeInfo {
    int   kind;              // R2DShapeKind: box / circle / capsule / polygon
    float cx, cy;            // локальный центр формы (пиксели, система тела)
    float angle;             // собственный поворот формы (радианы)
    float half_w, half_h;    // box: полуразмеры; capsule: half_h — половина отрезка
    float radius;            // circle/capsule: радиус; polygon: скругление углов
    float points[R2D_MAX_POLY_POINTS * 2];   // polygon: вершины, локальные пиксели
    int   point_count;
    bool  sensor;            // зона без отталкивания
    // Форма выключена (нулевой фильтр, см. r2d_physics_set_shape_enabled) —
    // в столкновениях и запросах она не участвует.
    bool  enabled;
    // Форма принадлежит телу с односторонней платформой (поле у тела, не у
    // формы: Box2D не знает про «пройти сквозь снизу»).
    bool  one_way;
    uint64_t category_bits;  // b2Filter формы: слой
    uint64_t mask_bits;      // b2Filter формы: с какими слоями сталкивается
    int   group_index;       // b2Filter формы: группа
} R2DPhysShapeInfo;

// Заполняет `out` геометрией формы с нашим индексом (`index` 0 — основная
// форма тела, дальше добавочные области). false — тела или формы нет (тогда
// `out` не тронут).
bool r2d_physics_shape_info(const R2DPhysics *p, int id, int index, R2DPhysShapeInfo *out);

// --- §40. Независимые области (compound shapes) -----------------------------
//
// Область — форма тела с собственным смыслом: «тело» (движение), «contact
// circle», «weapon rect». Описания живут в JS на узле, поэтому здесь только
// операции над native-формой по индексу (индекс — наш, хранится в user data
// формы и НЕ меняется при пересборке).

// Пересобрать форму с индексом `index`: геометрия, смещение, угол, слои,
// сенсорность. Возвращает индекс или -1.
int  r2d_physics_shape_set(R2DPhysics *p, int id, int index, const R2DBodyDesc *d,
                           float dx, float dy, float angle);
// Включить/выключить форму, не удаляя её: выключенная выходит из столкновений
// и запросов (нулевой фильтр) и не присылает события, но тело и владелец живы.
// При включении фильтр берётся из аргументов (описание области — в JS).
bool r2d_physics_set_shape_enabled(R2DPhysics *p, int id, int index, bool enabled,
                                   uint64_t category_bits, uint64_t mask_bits, int group_index);
// Включена ли форма сейчас (false — выключена или формы нет). Нужна, чтобы
// JS-описание области не расходилось с native-состоянием: внешний драйвер
// (анимационная дорожка) может переключить форму напрямую.
bool r2d_physics_shape_is_enabled(const R2DPhysics *p, int id, int index);
// Кто пересекается с формой ПРЯМО СЕЙЧАС: явный геометрический запрос по её
// текущему мировому положению с фильтром (category, mask). Возвращает число
// записанных пар; `bodies[i]` — тело, `shapes[i]` — индекс его формы. -1 — ошибка.
int  r2d_physics_shape_overlaps(R2DPhysics *p, int id, int index,
                                uint64_t category_bits, uint64_t mask_bits,
                                int *bodies, int *shapes, int cap);

// --- Контакты: импульс, точки, «касаются ли сейчас» ------------------------
//
// События (begin/end/hit) говорят, что СТОЛКНУЛОСЬ, но не дают импульса: он
// считается солвером ПОСЛЕ события. Поэтому сила удара читается отдельно —
// b2Body_GetContactData отдаёт манифолд с импульсом предыдущего шага.
//
// У тела может быть НЕСКОЛЬКО форм (r2d_physics_add_shape), и тогда
// `out_shape_a`/`out_shape_b` говорят, какая именно столкнулась: по ним игра
// понимает «попал в голову, а не в ногу».
//
// `out_impulse` — наибольший нормальный импульс по точкам (Н·с);
// `out_points` — число точек контакта; `out_normal` — нормаль (x, y).
// Возвращает false, если тела не касаются ПРЯМО СЕЙЧАС.
bool r2d_physics_contact_between(const R2DPhysics *p, int a, int b,
                                 float *out_impulse, int *out_points,
                                 float *out_normal_x, float *out_normal_y,
                                 int *out_shape_a, int *out_shape_b);
// Контакты тела: сколько нашлось (до `cap`), с кем и с каким импульсом.
// Возвращает число записанных; `others[i]` — тело, `impulses[i]` — импульс.
int  r2d_physics_contacts_of(const R2DPhysics *p, int id, int *others,
                             float *impulses, int *points,
                             int *shape_self, int *shape_other, int cap);
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

// Тела, чей ЦЕНТР не дальше radius от точки (x, y): кандидатов даёт broadphase
// Box2D (прямоугольник вокруг круга), затем они отсеиваются по расстоянию между
// центрами. ids отсортированы по расстоянию (при равенстве — по id), потому что
// порядок обхода broadphase не определён, а результат запроса обязан быть
// воспроизводимым (реплеи, тесты, `$('.enemy').within(...)`).
//
// candidates (необязательный, может быть NULL) — сколько кандидатов вернул
// broadphase до отсева; это диагностика запроса (ROADMAP, фаза 2).
int r2d_physics_query_circle(const R2DPhysics *p, float x, float y, float radius,
                             uint64_t mask, int *ids, int max_ids, int *candidates);

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
