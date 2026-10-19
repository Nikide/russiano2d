// ===========================================================================
// Стресс-тест динамических реестров физики (P0/P1 scalability pass).
//
// Проверяет ровно то, что раньше упиралось в фиксированные массивы:
//   * >512 событий контакта за ОДИН шаг доходят до игры целиком (прежний
//     буфер на 128 молча терял всё лишнее);
//   * реестр тел создаёт 100/1000/8000 тел, освобождает и переиспользует
//     слоты без роста ёмкости (freelist) — фиксированного лимита больше нет;
//   * поколение растёт при переиспользовании слота (протухшие события
//     распознаются);
//   * >64 суставов создаются и корректно умирают вместе с телом;
//   * буфер событий растёт 128 → 256 → 512 → … и отдаёт capacity/peak/OOM.
//
// Тест собирается как обычная Unity-цель (см. отчёт: строки для
// tests/CMakeLists.txt). Запускается без окна: только Box2D + SDL.
// ===========================================================================

#include "physics.h"

#include "unity.h"

#include <string.h>

void setUp(void) { }
void tearDown(void) { }

static R2DPhysics *make_world(void)
{
    static R2DPhysics phys;
    memset(&phys, 0, sizeof phys);
    r2d_physics_init(&phys, 0.0f, 0.0f);
    TEST_ASSERT_TRUE_MESSAGE(phys.world_valid, "мир Box2D не создался");
    return &phys;
}

static void drop_world(R2DPhysics *p)
{
    r2d_physics_shutdown(p);
    TEST_ASSERT_NULL(p->transforms);
    TEST_ASSERT_NULL(p->contacts.items);
    TEST_ASSERT_NULL(p->bodies);
    TEST_ASSERT_NULL(p->joints);
}

static int create_circle(R2DPhysics *p, float x, float y, float r, int type,
                         bool sensor, bool contacts)
{
    R2DBodyDesc d;
    memset(&d, 0, sizeof d);
    d.x = x;
    d.y = y;
    d.type = type;
    d.shape = R2D_SHAPE_CIRCLE;
    d.radius = r;
    d.density = 1.0f;
    d.friction = 0.3f;
    d.sensor = sensor;
    d.contacts = contacts;
    return r2d_physics_create(p, &d);
}

static int create_box_body(R2DPhysics *p, float x, float y, int type)
{
    R2DBodyDesc d;
    memset(&d, 0, sizeof d);
    d.x = x;
    d.y = y;
    d.type = type;
    d.shape = R2D_SHAPE_BOX;
    d.half_w = 4.0f;
    d.half_h = 4.0f;
    return r2d_physics_create(p, &d);
}

// --- 512+ событий за один шаг -------------------------------------------------
static void test_many_contacts_one_step(void)
{
    R2DPhysics *p = make_world();

    // Одно динамическое тело и 600 статических сенсоров поверх него: за шаг
    // broadphase даёт 600 пар «сенсор — гость», каждая обязана прийти в буфер.
    const int body = create_circle(p, 0.0f, 0.0f, 10.0f, R2D_BODY_DYNAMIC, false, true);
    TEST_ASSERT_TRUE(body >= 0);

    const int sensors = 600;
    for (int i = 0; i < sensors; ++i) {
        const int id = create_circle(p, (float)(i % 20) * 0.5f,
                                     (float)(i / 20) * 0.5f, 40.0f,
                                     R2D_BODY_STATIC, true, true);
        TEST_ASSERT_TRUE_MESSAGE(id >= 0, "сенсор не создался");
    }

    r2d_physics_begin_contacts(p);
    r2d_physics_step(p, 1.0f / 60.0f);

    int n = 0;
    const R2DContactEvent *ev = r2d_physics_contacts(p, &n);
    TEST_ASSERT_NOT_NULL(ev);
    TEST_ASSERT_TRUE_MESSAGE(n >= 512, "за шаг пришло меньше 512 событий — буфер теряет события");
    TEST_ASSERT_EQUAL_UINT32((uint32_t)n, r2d_physics_contact_count(p));

    // События должны быть непрерывным массивом: первые и последние читаются.
    TEST_ASSERT_TRUE(ev[0].kind == R2D_CONTACT_BEGIN || ev[0].kind == R2D_CONTACT_STAY);
    TEST_ASSERT_TRUE(ev[n - 1].kind == R2D_CONTACT_BEGIN || ev[n - 1].kind == R2D_CONTACT_STAY);

    // Буфер вырос по документированной лестнице и запомнил пик.
    TEST_ASSERT_TRUE_MESSAGE(r2d_physics_contact_capacity(p) >= 1024u,
                             "ёмкость буфера не выросла до 1024 при 600+ событиях");
    TEST_ASSERT_TRUE(r2d_physics_contact_capacity(p) % 128u == 0u);
    TEST_ASSERT_TRUE(r2d_physics_contact_peak(p) >= (uint32_t)n);
    TEST_ASSERT_FALSE(r2d_physics_contact_oom(p));

    // Второй кадр не должен перевыделять буфер: count сбрасывается, capacity
    // остаётся прежней.
    const uint32_t cap_after_growth = r2d_physics_contact_capacity(p);
    r2d_physics_begin_contacts(p);
    r2d_physics_step(p, 1.0f / 60.0f);
    TEST_ASSERT_EQUAL_UINT32(cap_after_growth, r2d_physics_contact_capacity(p));

    r2d_physics_clear_contacts(p);
    int cleared = 1;
    r2d_physics_contacts(p, &cleared);
    TEST_ASSERT_EQUAL_INT(0, cleared);

    R2DPhysicsStats st;
    r2d_physics_stats(p, &st);
    TEST_ASSERT_EQUAL_UINT32(st.contacts_capacity, cap_after_growth);
    TEST_ASSERT_TRUE(st.contacts_peak >= 512u);

    drop_world(p);
}

// --- 100/1000/8000 тел, освобождение и переиспользование ----------------------
static void test_body_registry_scales(void)
{
    R2DPhysics *p = make_world();

    const uint32_t initial_cap = r2d_physics_body_capacity(p);
    TEST_ASSERT_EQUAL_UINT32(R2D_INITIAL_BODIES, initial_cap);

    const int counts[] = { 100, 1000, 8000 };
    for (size_t round = 0; round < sizeof counts / sizeof counts[0]; ++round) {
        const int count = counts[round];
        int first_id = -1;
        for (int i = 0; i < count; ++i) {
            const int id = create_box_body(p, (float)(i * 20), 0.0f, R2D_BODY_STATIC);
            TEST_ASSERT_TRUE_MESSAGE(id >= 0, "тело не создалось: реестр не растёт");
            if (first_id < 0) first_id = id;
            TEST_ASSERT_TRUE(r2d_physics_is_alive(p, id));
        }
        TEST_ASSERT_EQUAL_INT(count, r2d_physics_live_count(p));
        TEST_ASSERT_TRUE_MESSAGE((uint32_t)count <= r2d_physics_body_capacity(p),
                                 "ёмкость меньше числа живых тел");
        TEST_ASSERT_TRUE(r2d_physics_body_peak(p) >= (uint32_t)count);
        TEST_ASSERT_TRUE(r2d_physics_generation(p, first_id) >= 1u);

        // Поколение при переиспользовании растёт: destroy + create того же
        // слота даёт новое поколение, события старого тела не «оживают».
        const uint32_t gen_before = r2d_physics_generation(p, first_id);
        r2d_physics_destroy(p, first_id);
        TEST_ASSERT_FALSE(r2d_physics_is_alive(p, first_id));
        const int reused = create_box_body(p, 0.0f, 0.0f, R2D_BODY_STATIC);
        TEST_ASSERT_TRUE(reused >= 0);
        TEST_ASSERT_TRUE_MESSAGE(r2d_physics_generation(p, reused) > gen_before,
                                 "поколение переиспользованного слота не выросло");

        // Уничтожаем всё: freelist должен вернуть слоты, а не потерять их.
        // id-ы выданы не подряд (пул LIFO), поэтому перебираем слоты.
        for (uint32_t slot = 0; slot < r2d_physics_body_capacity(p); ++slot) {
            if (r2d_physics_is_alive(p, (int)slot)) r2d_physics_destroy(p, (int)slot);
        }
        TEST_ASSERT_EQUAL_INT(0, r2d_physics_live_count(p));
    }

    // После 8000 destroy ёмкость не сжимается; создание 100 тел не растит её
    // заново — это и есть O(1)-переиспользование вместо сканирования слотов.
    const uint32_t cap = r2d_physics_body_capacity(p);
    TEST_ASSERT_TRUE(cap >= 8000u);
    for (int i = 0; i < 100; ++i) {
        const int id = create_box_body(p, (float)i, 0.0f, R2D_BODY_STATIC);
        TEST_ASSERT_TRUE(id >= 0);
    }
    TEST_ASSERT_EQUAL_UINT32(cap, r2d_physics_body_capacity(p));
    TEST_ASSERT_TRUE(r2d_physics_body_peak(p) >= 8000u);

    R2DPhysicsStats st;
    r2d_physics_stats(p, &st);
    TEST_ASSERT_EQUAL_UINT32(st.bodies_live, r2d_physics_live_count(p));
    TEST_ASSERT_EQUAL_UINT32(st.bodies_capacity, cap);
    TEST_ASSERT_TRUE(st.bodies_peak >= 8000u);

    drop_world(p);
}

// --- >64 суставов -------------------------------------------------------------
static void test_more_than_64_joints(void)
{
    R2DPhysics *p = make_world();

    const int anchor = create_box_body(p, 0.0f, 0.0f, R2D_BODY_STATIC);
    TEST_ASSERT_TRUE(anchor >= 0);

    enum { JOINT_COUNT = 100 };
    int joint_ids[JOINT_COUNT];
    for (int i = 0; i < JOINT_COUNT; ++i) {
        const int body = create_circle(p, 500.0f + (float)i * 40.0f, 0.0f, 8.0f,
                                       R2D_BODY_DYNAMIC, false, false);
        TEST_ASSERT_TRUE(body >= 0);
        joint_ids[i] = r2d_physics_create_joint(p, R2D_JOINT_DISTANCE, anchor, body,
                                               0.0f, 0.0f, 500.0f + (float)i * 40.0f, 0.0f,
                                               false, 0.0f, false, 0.0f, 0.0f,
                                               false, 0.0f, 0.0f);
        TEST_ASSERT_TRUE_MESSAGE(joint_ids[i] >= 0, "сустав сверх 64 не создался");
        TEST_ASSERT_TRUE(r2d_physics_joint_alive(p, joint_ids[i]));
    }
    TEST_ASSERT_EQUAL_INT(JOINT_COUNT, r2d_physics_joint_count(p));
    TEST_ASSERT_TRUE(r2d_physics_joint_capacity(p) > 64u);
    TEST_ASSERT_TRUE(r2d_physics_joint_peak(p) >= (uint32_t)JOINT_COUNT);

    // Удаление тела освобождает его сустав, счётчик уменьшается.
    const uint32_t before = (uint32_t)r2d_physics_joint_count(p);
    for (uint32_t slot = 0; slot < r2d_physics_body_capacity(p); ++slot) {
        if (!r2d_physics_is_alive(p, (int)slot)) continue;
        if ((int)slot == anchor) continue;
        r2d_physics_destroy(p, (int)slot);
        break;
    }
    TEST_ASSERT_TRUE((uint32_t)r2d_physics_joint_count(p) < before);

    drop_world(p);
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_many_contacts_one_step);
    RUN_TEST(test_body_registry_scales);
    RUN_TEST(test_more_than_64_joints);
    return UNITY_END();
}
