# ---------------------------------------------------------------------------
# Небольшие тесты на C: то, что должно проверяться без запуска окна.
#
# r2d_json_test собирается с AddressSanitizer (если компилятор его умеет):
# именно он поймал переполнение кучи в разборе JSON, из-за которого движок
# падал на командах агента.
#
# Санитайзеры выключаются при кросс-сборке: у MinGW нет libasan/libubsan, и
# линковка падает с «cannot find -lasan» — а сами тесты под Windows всё равно
# запускаются на Windows, где санитайзеры можно включить отдельной сборкой.
# ---------------------------------------------------------------------------

# Санитайзеры доступны только там, где есть рантайм ASan/UBSan: MSVC и
# кросс-сборка (MinGW) их не имеют, и линковка падает с «cannot find -lasan».
# Флаг ставится ДО первого теста: раньше он включался в блоке rotsprite уже
# ПОСЛЕ r2d_json_test, и при кросс-сборке Windows json-тест всё равно получал
# -fsanitize=address и валил всю сборку платформы.
if(MSVC OR CMAKE_CROSSCOMPILING)
    set(R2D_SANITIZE_FLAGS_AVAILABLE FALSE)
else()
    set(R2D_SANITIZE_FLAGS_AVAILABLE TRUE)
endif()

# Unity (ThrowTheSwitch/Unity v2.6.0) — единый фреймворк для ВСЕХ C-тестов.
# Один header + unity.c; тесты подключают r2d_unity и пишут TEST_ASSERT_*.
add_library(r2d_unity STATIC "${CMAKE_SOURCE_DIR}/third_party/unity/unity.c")
target_include_directories(r2d_unity PUBLIC "${CMAKE_SOURCE_DIR}/third_party/unity")

add_executable(r2d_json_test json/json_test.c "${CMAKE_SOURCE_DIR}/src/json.c")
target_include_directories(r2d_json_test PRIVATE "${CMAKE_SOURCE_DIR}/src")
target_link_libraries(r2d_json_test PRIVATE ${R2D_WIN_LIBS} r2d_unity)

if(R2D_SANITIZE_FLAGS_AVAILABLE)
    target_compile_options(r2d_json_test PRIVATE -fsanitize=address -g -fno-omit-frame-pointer)
    target_link_options(r2d_json_test PRIVATE -fsanitize=address)
endif()

add_custom_target(r2d_json_check
    COMMAND r2d_json_test
    DEPENDS r2d_json_test
    COMMENT "Проверяю разбор и сборку JSON"
    VERBATIM)

# --- Шифрование груза --------------------------------------------------------
# Тест-векторы RFC 8439: ChaCha20-Poly1305 не должен «почти работать» —
# молча неверный шифр хуже отсутствия шифра. Собирается с санитайзерами,
# потому что вся арифметика Poly1305 — ручная работа с 32-битными лимбами.
add_executable(r2d_crypto_test "${CMAKE_SOURCE_DIR}/tests/crypto/crypto_test.c"
                               "${CMAKE_SOURCE_DIR}/src/crypto.c")
target_include_directories(r2d_crypto_test PRIVATE "${CMAKE_SOURCE_DIR}/src")
target_link_libraries(r2d_crypto_test PRIVATE ${R2D_WIN_LIBS} r2d_unity)
if(R2D_SANITIZE_FLAGS_AVAILABLE)
    target_compile_options(r2d_crypto_test PRIVATE -fsanitize=address,undefined -fno-omit-frame-pointer)
    target_link_options(r2d_crypto_test PRIVATE -fsanitize=address,undefined)
endif()

# --- Разбор груза игры -------------------------------------------------------
# Контейнер разбирается из памяти, поэтому тесту достаточно SDL; crypto.c нужен
# для символов расшифровки, которые тянет payload.c. Санитайзеры обязательны:
# именно здесь двойное освобождение и выход за границу буфера.
add_executable(r2d_payload_test "${CMAKE_SOURCE_DIR}/tests/payload/payload_test.c"
                                "${CMAKE_SOURCE_DIR}/src/payload.c"
                                "${CMAKE_SOURCE_DIR}/src/crypto.c")
target_include_directories(r2d_payload_test PRIVATE "${CMAKE_SOURCE_DIR}/src")
target_link_libraries(r2d_payload_test PRIVATE SDL3::SDL3 ${R2D_WIN_LIBS} r2d_unity)
if(R2D_SANITIZE_FLAGS_AVAILABLE)
    target_compile_options(r2d_payload_test PRIVATE -fsanitize=address,undefined -fno-omit-frame-pointer)
    target_link_options(r2d_payload_test PRIVATE -fsanitize=address,undefined)
endif()

# --- Реверберация помещения (Freeverb) --------------------------------------
# На разнице хвоста держится звук «комната 5×5 против зала 20×20», поэтому
# проверяем именно её, а не факт вызова функции. Санитайзеры — как у crypto:
# вся работа идёт с кольцевыми буферами вручную.
add_executable(r2d_reverb_test "${CMAKE_SOURCE_DIR}/tests/audio/reverb_test.c"
                               "${CMAKE_SOURCE_DIR}/src/audio_reverb.c")
target_include_directories(r2d_reverb_test PRIVATE "${CMAKE_SOURCE_DIR}/src")
target_link_libraries(r2d_reverb_test PRIVATE SDL3::SDL3 ${R2D_WIN_LIBS} r2d_unity)
if(R2D_SANITIZE_FLAGS_AVAILABLE)
    target_compile_options(r2d_reverb_test PRIVATE -fsanitize=address,undefined -fno-omit-frame-pointer)
    target_link_options(r2d_reverb_test PRIVATE -fsanitize=address,undefined)
endif()

# --- DSP-эффекты каналов и шин ----------------------------------------------
# Фильтры, тремоло, bitcrush, кольцевая модуляция и реверб-шина с посылом:
# математика без SDL_mixer, поэтому проверяется офлайн, вместе с ревербом.
add_executable(r2d_audio_fx_test "${CMAKE_SOURCE_DIR}/tests/audio/fx_test.c"
                               "${CMAKE_SOURCE_DIR}/src/audio_fx.c"
                               "${CMAKE_SOURCE_DIR}/src/audio_reverb.c")
target_include_directories(r2d_audio_fx_test PRIVATE "${CMAKE_SOURCE_DIR}/src")
target_link_libraries(r2d_audio_fx_test PRIVATE SDL3::SDL3 ${R2D_WIN_LIBS} r2d_unity)
if(R2D_SANITIZE_FLAGS_AVAILABLE)
    target_compile_options(r2d_audio_fx_test PRIVATE -fsanitize=address,undefined -fno-omit-frame-pointer)
    target_link_options(r2d_audio_fx_test PRIVATE -fsanitize=address,undefined)
endif()

# --- Профайлер кадра ---------------------------------------------------------
# Модель строк (сначала CPU-зоны, затем GPU) и тихий фолбэк без GPU-устройства.
# Профайлеру хватает таймеров и потоков SDL: GPU-устройство не нужно, поэтому
# тест идёт в общем наборе, без окна и драйвера.
add_executable(r2d_profile_test "${CMAKE_SOURCE_DIR}/tests/profile/profile_test.c"
                                "${CMAKE_SOURCE_DIR}/src/profile.c")
target_include_directories(r2d_profile_test PRIVATE "${CMAKE_SOURCE_DIR}/src")
target_link_libraries(r2d_profile_test PRIVATE SDL3::SDL3 ${R2D_WIN_LIBS} r2d_unity)
if(R2D_SANITIZE_FLAGS_AVAILABLE)
    target_compile_options(r2d_profile_test PRIVATE -fsanitize=address,undefined -fno-omit-frame-pointer)
    target_link_options(r2d_profile_test PRIVATE -fsanitize=address,undefined)
endif()

# --- 2D BSP-дерево -----------------------------------------------------------
# Инвариант полноты: обход обязан вернуть каждый отрезок дерева ровно один раз.
# Ловит случай предельной глубины, когда остаток геометрии «сваливался» в лист
# и пропадал из порядка отрисовки.
# Unity: BSP-тест — образец конвертации (TEST_ASSERT_*/UNITY_BEGIN, отдельные
# test_* функции). Все C-цели ниже подключены к r2d_unity.
add_executable(r2d_bsp_test "${CMAKE_SOURCE_DIR}/tests/bsp/bsp_test.c"
                            "${CMAKE_SOURCE_DIR}/src/bsp.c")
target_include_directories(r2d_bsp_test PRIVATE "${CMAKE_SOURCE_DIR}/src")
target_link_libraries(r2d_bsp_test PRIVATE SDL3::SDL3 ${R2D_WIN_LIBS} r2d_unity)
if(R2D_SANITIZE_FLAGS_AVAILABLE)
    target_compile_options(r2d_bsp_test PRIVATE -fsanitize=address,undefined -fno-omit-frame-pointer)
    target_link_options(r2d_bsp_test PRIVATE -fsanitize=address,undefined)
endif()

# --- RE2D-тесты: только в сборке с RE2D --------------------------------------
# Тесты 3D-авторинга собираются вместе со своим кодом: при
# -DR2D_ENABLE_RE2D=OFF целей r2d_re2d_test / r2d_re2d_world_test /
# r2d_world_exr_test нет — исходников, которые они проверяют, в сборке тоже
# нет, и цель ссылалась бы на несуществующие файлы. Тест check-скриптов
# (tools/ci_verify.py) пропускает отсутствующие цели по тому же флагу.
if(NOT R2D_ENABLE_RE2D)
    message(STATUS "  RE2D ............ C-тесты re2d/rotsprite пропущены (R2D_ENABLE_RE2D=OFF)")
else()

# Re2D: проекция, отсечение по ближней плоскости, обход граней и туман —
# чистая математика (src/re2d_math.c), без окна и GPU.
add_executable(r2d_re2d_test re2d/re2d_test.c "${CMAKE_SOURCE_DIR}/src/re2d_math.c")
target_include_directories(r2d_re2d_test PRIVATE "${CMAKE_SOURCE_DIR}/src")
if(NOT MSVC)
    target_link_libraries(r2d_re2d_test PRIVATE m r2d_unity)
endif()
if(NOT MSVC AND NOT CMAKE_CROSSCOMPILING)
    target_compile_options(r2d_re2d_test PRIVATE -fsanitize=address,undefined -fno-omit-frame-pointer)
    target_link_options(r2d_re2d_test PRIVATE -fsanitize=address,undefined)
endif()

# RotSprite: математика и границы буфера, без GPU и окна.
add_executable(r2d_rotsprite_test rotsprite/rotsprite_test.c "${CMAKE_SOURCE_DIR}/src/rotsprite_math.c")
target_include_directories(r2d_rotsprite_test PRIVATE "${CMAKE_SOURCE_DIR}/src")
if(NOT MSVC)
    target_link_libraries(r2d_rotsprite_test PRIVATE m r2d_unity)
endif()
if(NOT MSVC AND NOT CMAKE_CROSSCOMPILING)
    target_compile_options(r2d_rotsprite_test PRIVATE -fsanitize=address,undefined -fno-omit-frame-pointer)
    target_link_options(r2d_rotsprite_test PRIVATE -fsanitize=address,undefined)
endif()
# RE2D World: multi-height queries and final RGBA synthesis, no GPU.
add_executable(r2d_re2d_world_test re2d/world_test.c
    "${CMAKE_SOURCE_DIR}/src/re2d_world.c" "${CMAKE_SOURCE_DIR}/src/re2d_math.c"
    "${CMAKE_SOURCE_DIR}/src/re2d_world_topology.c" "${CMAKE_SOURCE_DIR}/src/re2d_world_visibility.c" "${CMAKE_SOURCE_DIR}/src/re2d_world_light.c" "${CMAKE_SOURCE_DIR}/src/re2d_world_material.c" "${CMAKE_SOURCE_DIR}/src/re2d_world_bake.c" "${CMAKE_SOURCE_DIR}/src/re2d_world_semantic.c" "${CMAKE_SOURCE_DIR}/src/re2d_world_metadata.c" "${CMAKE_SOURCE_DIR}/src/json.c"
    "${CMAKE_SOURCE_DIR}/src/bsp.c")
target_include_directories(r2d_re2d_world_test PRIVATE "${CMAKE_SOURCE_DIR}/src")
target_link_libraries(r2d_re2d_world_test PRIVATE SDL3::SDL3 ${R2D_WIN_LIBS} r2d_unity)
if(NOT MSVC)
    target_link_libraries(r2d_re2d_world_test PRIVATE m)
endif()
if(R2D_SANITIZE_FLAGS_AVAILABLE)
    target_compile_options(r2d_re2d_world_test PRIVATE -fsanitize=address,undefined -fno-omit-frame-pointer)
    target_link_options(r2d_re2d_world_test PRIVATE -fsanitize=address,undefined)
endif()

# Atlas world sprites: native direction/pivot/crop math, no GPU and no window.
add_executable(r2d_re2d_atlas_test re2d/atlas_test.c "${CMAKE_SOURCE_DIR}/src/re2d_world_atlas.c")
target_include_directories(r2d_re2d_atlas_test PRIVATE "${CMAKE_SOURCE_DIR}/src")
target_link_libraries(r2d_re2d_atlas_test PRIVATE r2d_unity)
if(NOT MSVC)
    target_link_libraries(r2d_re2d_atlas_test PRIVATE m)
endif()
if(R2D_SANITIZE_FLAGS_AVAILABLE)
    target_compile_options(r2d_re2d_atlas_test PRIVATE -fsanitize=address,undefined -fno-omit-frame-pointer)
    target_link_options(r2d_re2d_atlas_test PRIVATE -fsanitize=address,undefined)
endif()

# Unified world+actor trace: nearest hit, masks, ignore, multi-hit (P0-B core).
add_executable(r2d_world_trace_test re2d/trace_test.c
    "${CMAKE_SOURCE_DIR}/src/re2d_world_trace.c"
    "${CMAKE_SOURCE_DIR}/src/re2d_world.c" "${CMAKE_SOURCE_DIR}/src/re2d_math.c"
    "${CMAKE_SOURCE_DIR}/src/re2d_world_topology.c" "${CMAKE_SOURCE_DIR}/src/re2d_world_visibility.c" "${CMAKE_SOURCE_DIR}/src/re2d_world_light.c" "${CMAKE_SOURCE_DIR}/src/re2d_world_material.c" "${CMAKE_SOURCE_DIR}/src/re2d_world_bake.c" "${CMAKE_SOURCE_DIR}/src/re2d_world_semantic.c" "${CMAKE_SOURCE_DIR}/src/re2d_world_metadata.c" "${CMAKE_SOURCE_DIR}/src/json.c"
    "${CMAKE_SOURCE_DIR}/src/bsp.c")
target_include_directories(r2d_world_trace_test PRIVATE "${CMAKE_SOURCE_DIR}/src")
target_link_libraries(r2d_world_trace_test PRIVATE SDL3::SDL3 ${R2D_WIN_LIBS} r2d_unity)
if(NOT MSVC)
    target_link_libraries(r2d_world_trace_test PRIVATE m)
endif()
if(R2D_SANITIZE_FLAGS_AVAILABLE)
    target_compile_options(r2d_world_trace_test PRIVATE -fsanitize=address,undefined -fno-omit-frame-pointer)
    target_link_options(r2d_world_trace_test PRIVATE -fsanitize=address,undefined)
endif()

# Mover timeline (P0-E core): pure deterministic fixed-tick state machine.
add_executable(r2d_world_mover_test re2d/mover_test.c "${CMAKE_SOURCE_DIR}/src/re2d_world_mover.c")
target_include_directories(r2d_world_mover_test PRIVATE "${CMAKE_SOURCE_DIR}/src")
target_link_libraries(r2d_world_mover_test PRIVATE r2d_unity)
if(NOT MSVC)
    target_link_libraries(r2d_world_mover_test PRIVATE m)
endif()
if(R2D_SANITIZE_FLAGS_AVAILABLE)
    target_compile_options(r2d_world_mover_test PRIVATE -fsanitize=address,undefined -fno-omit-frame-pointer)
    target_link_options(r2d_world_mover_test PRIVATE -fsanitize=address,undefined)
endif()

# Trigger state machine (P0-F core): enter/use/shoot, once/cooldown.
add_executable(r2d_world_trigger_test re2d/trigger_test.c "${CMAKE_SOURCE_DIR}/src/re2d_world_trigger.c")
target_include_directories(r2d_world_trigger_test PRIVATE "${CMAKE_SOURCE_DIR}/src")
target_link_libraries(r2d_world_trigger_test PRIVATE r2d_unity)
if(NOT MSVC)
    target_link_libraries(r2d_world_trigger_test PRIVATE m)
endif()
if(R2D_SANITIZE_FLAGS_AVAILABLE)
    target_compile_options(r2d_world_trigger_test PRIVATE -fsanitize=address,undefined -fno-omit-frame-pointer)
    target_link_options(r2d_world_trigger_test PRIVATE -fsanitize=address,undefined)
endif()

# Player controller (P0-C): sweep/slide/step/slope/jump determinism.
add_executable(r2d_world_controller_test re2d/controller_test.c
    "${CMAKE_SOURCE_DIR}/src/re2d_world_controller.c"
    "${CMAKE_SOURCE_DIR}/src/re2d_world.c" "${CMAKE_SOURCE_DIR}/src/re2d_math.c"
    "${CMAKE_SOURCE_DIR}/src/re2d_world_topology.c" "${CMAKE_SOURCE_DIR}/src/re2d_world_visibility.c"
    "${CMAKE_SOURCE_DIR}/src/re2d_world_light.c" "${CMAKE_SOURCE_DIR}/src/re2d_world_material.c"
    "${CMAKE_SOURCE_DIR}/src/re2d_world_bake.c" "${CMAKE_SOURCE_DIR}/src/re2d_world_semantic.c" "${CMAKE_SOURCE_DIR}/src/re2d_world_metadata.c"
    "${CMAKE_SOURCE_DIR}/src/json.c" "${CMAKE_SOURCE_DIR}/src/bsp.c")
target_include_directories(r2d_world_controller_test PRIVATE "${CMAKE_SOURCE_DIR}/src")
target_link_libraries(r2d_world_controller_test PRIVATE SDL3::SDL3 ${R2D_WIN_LIBS} r2d_unity)
if(NOT MSVC)
    target_link_libraries(r2d_world_controller_test PRIVATE m)
endif()
if(R2D_SANITIZE_FLAGS_AVAILABLE)
    target_compile_options(r2d_world_controller_test PRIVATE -fsanitize=address,undefined -fno-omit-frame-pointer)
    target_link_options(r2d_world_controller_test PRIVATE -fsanitize=address,undefined)
endif()

# Semantic IDs (P0-D): bake -> load -> find_* lookup and validation.
add_executable(r2d_re2d_semantic_test re2d/semantic_test.c
    "${CMAKE_SOURCE_DIR}/src/re2d_world_semantic.c" "${CMAKE_SOURCE_DIR}/src/re2d_world_metadata.c"
    "${CMAKE_SOURCE_DIR}/src/re2d_world.c" "${CMAKE_SOURCE_DIR}/src/re2d_math.c"
    "${CMAKE_SOURCE_DIR}/src/re2d_world_topology.c" "${CMAKE_SOURCE_DIR}/src/re2d_world_visibility.c"
    "${CMAKE_SOURCE_DIR}/src/re2d_world_light.c" "${CMAKE_SOURCE_DIR}/src/re2d_world_material.c"
    "${CMAKE_SOURCE_DIR}/src/re2d_world_bake.c" "${CMAKE_SOURCE_DIR}/src/json.c" "${CMAKE_SOURCE_DIR}/src/bsp.c")
target_include_directories(r2d_re2d_semantic_test PRIVATE "${CMAKE_SOURCE_DIR}/src")
target_link_libraries(r2d_re2d_semantic_test PRIVATE SDL3::SDL3 ${R2D_WIN_LIBS} r2d_unity)
if(NOT MSVC)
    target_link_libraries(r2d_re2d_semantic_test PRIVATE m)
endif()
if(R2D_SANITIZE_FLAGS_AVAILABLE)
    target_compile_options(r2d_re2d_semantic_test PRIVATE -fsanitize=address,undefined -fno-omit-frame-pointer)
    target_link_options(r2d_re2d_semantic_test PRIVATE -fsanitize=address,undefined)
endif()

# Portal 2.0: smooth open fraction clips collision/visibility openings.
add_executable(r2d_re2d_portal_test re2d/portal_fraction_test.c
    "${CMAKE_SOURCE_DIR}/src/re2d_world.c" "${CMAKE_SOURCE_DIR}/src/re2d_math.c"
    "${CMAKE_SOURCE_DIR}/src/re2d_world_topology.c" "${CMAKE_SOURCE_DIR}/src/re2d_world_visibility.c"
    "${CMAKE_SOURCE_DIR}/src/re2d_world_light.c" "${CMAKE_SOURCE_DIR}/src/re2d_world_material.c"
    "${CMAKE_SOURCE_DIR}/src/re2d_world_bake.c" "${CMAKE_SOURCE_DIR}/src/re2d_world_semantic.c" "${CMAKE_SOURCE_DIR}/src/re2d_world_metadata.c"
    "${CMAKE_SOURCE_DIR}/src/json.c" "${CMAKE_SOURCE_DIR}/src/bsp.c")
target_include_directories(r2d_re2d_portal_test PRIVATE "${CMAKE_SOURCE_DIR}/src")
target_link_libraries(r2d_re2d_portal_test PRIVATE SDL3::SDL3 ${R2D_WIN_LIBS} r2d_unity)
if(NOT MSVC)
    target_link_libraries(r2d_re2d_portal_test PRIVATE m)
endif()
if(R2D_SANITIZE_FLAGS_AVAILABLE)
    target_compile_options(r2d_re2d_portal_test PRIVATE -fsanitize=address,undefined -fno-omit-frame-pointer)
    target_link_options(r2d_re2d_portal_test PRIVATE -fsanitize=address,undefined)
endif()

# Map metadata/spawns (P1): authored identity + typed spawn points.
add_executable(r2d_world_metadata_test re2d/metadata_test.c
    "${CMAKE_SOURCE_DIR}/src/re2d_world_metadata.c" "${CMAKE_SOURCE_DIR}/src/json.c")
target_include_directories(r2d_world_metadata_test PRIVATE "${CMAKE_SOURCE_DIR}/src")
target_link_libraries(r2d_world_metadata_test PRIVATE ${R2D_WIN_LIBS} r2d_unity)
if(R2D_SANITIZE_FLAGS_AVAILABLE)
    target_compile_options(r2d_world_metadata_test PRIVATE -fsanitize=address,undefined -fno-omit-frame-pointer)
    target_link_options(r2d_world_metadata_test PRIVATE -fsanitize=address,undefined)
endif()

# Automap (P1): XY line extraction + 2D view transform.
add_executable(r2d_world_automap_test re2d/automap_test.c "${CMAKE_SOURCE_DIR}/src/re2d_world_automap.c"
    "${CMAKE_SOURCE_DIR}/src/re2d_world.c" "${CMAKE_SOURCE_DIR}/src/re2d_math.c"
    "${CMAKE_SOURCE_DIR}/src/re2d_world_topology.c" "${CMAKE_SOURCE_DIR}/src/re2d_world_visibility.c"
    "${CMAKE_SOURCE_DIR}/src/re2d_world_light.c" "${CMAKE_SOURCE_DIR}/src/re2d_world_material.c"
    "${CMAKE_SOURCE_DIR}/src/re2d_world_bake.c" "${CMAKE_SOURCE_DIR}/src/re2d_world_semantic.c"
    "${CMAKE_SOURCE_DIR}/src/re2d_world_metadata.c" "${CMAKE_SOURCE_DIR}/src/json.c" "${CMAKE_SOURCE_DIR}/src/bsp.c")
target_include_directories(r2d_world_automap_test PRIVATE "${CMAKE_SOURCE_DIR}/src")
target_link_libraries(r2d_world_automap_test PRIVATE SDL3::SDL3 ${R2D_WIN_LIBS} r2d_unity)
if(NOT MSVC)
    target_link_libraries(r2d_world_automap_test PRIVATE m)
endif()
if(R2D_SANITIZE_FLAGS_AVAILABLE)
    target_compile_options(r2d_world_automap_test PRIVATE -fsanitize=address,undefined -fno-omit-frame-pointer)
    target_link_options(r2d_world_automap_test PRIVATE -fsanitize=address,undefined)
endif()

# Particle pool (P1): deterministic emitters, fixed pool, no allocation.
add_executable(r2d_world_particle_test re2d/particle_test.c "${CMAKE_SOURCE_DIR}/src/re2d_world_particle.c")
target_include_directories(r2d_world_particle_test PRIVATE "${CMAKE_SOURCE_DIR}/src")
target_link_libraries(r2d_world_particle_test PRIVATE r2d_unity)
if(NOT MSVC)
    target_link_libraries(r2d_world_particle_test PRIVATE m)
endif()
if(R2D_SANITIZE_FLAGS_AVAILABLE)
    target_compile_options(r2d_world_particle_test PRIVATE -fsanitize=address,undefined -fno-omit-frame-pointer)
    target_link_options(r2d_world_particle_test PRIVATE -fsanitize=address,undefined)
endif()

# 2D cell/portal navigation (P1): graph build + deterministic A*.
add_executable(r2d_world_nav_test re2d/nav_test.c "${CMAKE_SOURCE_DIR}/src/re2d_world_nav.c"
    "${CMAKE_SOURCE_DIR}/src/re2d_world.c" "${CMAKE_SOURCE_DIR}/src/re2d_math.c"
    "${CMAKE_SOURCE_DIR}/src/re2d_world_topology.c" "${CMAKE_SOURCE_DIR}/src/re2d_world_visibility.c"
    "${CMAKE_SOURCE_DIR}/src/re2d_world_light.c" "${CMAKE_SOURCE_DIR}/src/re2d_world_material.c"
    "${CMAKE_SOURCE_DIR}/src/re2d_world_bake.c" "${CMAKE_SOURCE_DIR}/src/re2d_world_semantic.c"
    "${CMAKE_SOURCE_DIR}/src/re2d_world_metadata.c" "${CMAKE_SOURCE_DIR}/src/json.c"
    "${CMAKE_SOURCE_DIR}/src/bsp.c")
target_include_directories(r2d_world_nav_test PRIVATE "${CMAKE_SOURCE_DIR}/src")
target_link_libraries(r2d_world_nav_test PRIVATE SDL3::SDL3 ${R2D_WIN_LIBS} r2d_unity)
if(NOT MSVC)
    target_link_libraries(r2d_world_nav_test PRIVATE m)
endif()
if(R2D_SANITIZE_FLAGS_AVAILABLE)
    target_compile_options(r2d_world_nav_test PRIVATE -fsanitize=address,undefined -fno-omit-frame-pointer)
    target_link_options(r2d_world_nav_test PRIVATE -fsanitize=address,undefined)
endif()

# Secrets/breakables (P1): edge-triggered secret volumes + authored breakables.
add_executable(r2d_world_secret_test re2d/secret_test.c "${CMAKE_SOURCE_DIR}/src/re2d_world_secret.c")
target_include_directories(r2d_world_secret_test PRIVATE "${CMAKE_SOURCE_DIR}/src")
target_link_libraries(r2d_world_secret_test PRIVATE r2d_unity)
if(NOT MSVC)
    target_link_libraries(r2d_world_secret_test PRIVATE m)
endif()
if(R2D_SANITIZE_FLAGS_AVAILABLE)
    target_compile_options(r2d_world_secret_test PRIVATE -fsanitize=address,undefined -fno-omit-frame-pointer)
    target_link_options(r2d_world_secret_test PRIVATE -fsanitize=address,undefined)
endif()

# Terrain presets + conveyors (P1): gameplay metadata, no fluid simulation.
add_executable(r2d_world_terrain_test re2d/terrain_test.c "${CMAKE_SOURCE_DIR}/src/re2d_world_terrain.c")
target_include_directories(r2d_world_terrain_test PRIVATE "${CMAKE_SOURCE_DIR}/src")
target_link_libraries(r2d_world_terrain_test PRIVATE r2d_unity)
if(NOT MSVC)
    target_link_libraries(r2d_world_terrain_test PRIVATE m)
endif()
if(R2D_SANITIZE_FLAGS_AVAILABLE)
    target_compile_options(r2d_world_terrain_test PRIVATE -fsanitize=address,undefined -fno-omit-frame-pointer)
    target_link_options(r2d_world_terrain_test PRIVATE -fsanitize=address,undefined)
endif()

# Save/load state (P1): versioned native gameplay snapshot.
add_executable(r2d_world_save_test re2d/save_test.c "${CMAKE_SOURCE_DIR}/src/re2d_world_save.c" "${CMAKE_SOURCE_DIR}/src/json.c")
target_include_directories(r2d_world_save_test PRIVATE "${CMAKE_SOURCE_DIR}/src")
target_link_libraries(r2d_world_save_test PRIVATE r2d_unity)
if(NOT MSVC)
    target_link_libraries(r2d_world_save_test PRIVATE m)
endif()
if(R2D_SANITIZE_FLAGS_AVAILABLE)
    target_compile_options(r2d_world_save_test PRIVATE -fsanitize=address,undefined -fno-omit-frame-pointer)
    target_link_options(r2d_world_save_test PRIVATE -fsanitize=address,undefined)
endif()

# Portal visuals (P2): mirror/link/sky math + recursion budget.
add_executable(r2d_world_portal_visual_test re2d/portal_visual_test.c "${CMAKE_SOURCE_DIR}/src/re2d_world_portal_visual.c")
target_include_directories(r2d_world_portal_visual_test PRIVATE "${CMAKE_SOURCE_DIR}/src")
target_link_libraries(r2d_world_portal_visual_test PRIVATE r2d_unity)
if(NOT MSVC)
    target_link_libraries(r2d_world_portal_visual_test PRIVATE m)
endif()
if(R2D_SANITIZE_FLAGS_AVAILABLE)
    target_compile_options(r2d_world_portal_visual_test PRIVATE -fsanitize=address,undefined -fno-omit-frame-pointer)
    target_link_options(r2d_world_portal_visual_test PRIVATE -fsanitize=address,undefined)
endif()

# Volumetric sprites (P2): box/cross/slice-stack part selection (no mesh API).
add_executable(r2d_world_volume_test re2d/volume_test.c "${CMAKE_SOURCE_DIR}/src/re2d_world_volume.c")
target_include_directories(r2d_world_volume_test PRIVATE "${CMAKE_SOURCE_DIR}/src")
target_link_libraries(r2d_world_volume_test PRIVATE r2d_unity)
if(NOT MSVC)
    target_link_libraries(r2d_world_volume_test PRIVATE m)
endif()
if(R2D_SANITIZE_FLAGS_AVAILABLE)
    target_compile_options(r2d_world_volume_test PRIVATE -fsanitize=address,undefined -fno-omit-frame-pointer)
    target_link_options(r2d_world_volume_test PRIVATE -fsanitize=address,undefined)
endif()

# Material animation (P2): deterministic flipbook/scroll/emissive timeline.
add_executable(r2d_world_material_anim_test re2d/material_anim_test.c "${CMAKE_SOURCE_DIR}/src/re2d_world_material_anim.c")
target_include_directories(r2d_world_material_anim_test PRIVATE "${CMAKE_SOURCE_DIR}/src")
target_link_libraries(r2d_world_material_anim_test PRIVATE r2d_unity)
if(NOT MSVC)
    target_link_libraries(r2d_world_material_anim_test PRIVATE m)
endif()
if(R2D_SANITIZE_FLAGS_AVAILABLE)
    target_compile_options(r2d_world_material_anim_test PRIVATE -fsanitize=address,undefined -fno-omit-frame-pointer)
    target_link_options(r2d_world_material_anim_test PRIVATE -fsanitize=address,undefined)
endif()

# PolyWallGroup core (P1/P3): rigid XY transform, bounds, circle sweep, lerp.
add_executable(r2d_world_polywall_test re2d/polywall_test.c "${CMAKE_SOURCE_DIR}/src/re2d_world_polywall.c")
target_include_directories(r2d_world_polywall_test PRIVATE "${CMAKE_SOURCE_DIR}/src")
target_link_libraries(r2d_world_polywall_test PRIVATE r2d_unity)
if(NOT MSVC)
    target_link_libraries(r2d_world_polywall_test PRIVATE m)
endif()
if(R2D_SANITIZE_FLAGS_AVAILABLE)
    target_compile_options(r2d_world_polywall_test PRIVATE -fsanitize=address,undefined -fno-omit-frame-pointer)
    target_link_options(r2d_world_polywall_test PRIVATE -fsanitize=address,undefined)
endif()

# Polygon cells (P1 authoring): validation, convex decomposition, shared edges.
add_executable(r2d_world_polygon_test re2d/polygon_test.c "${CMAKE_SOURCE_DIR}/src/re2d_world_polygon.c")
target_include_directories(r2d_world_polygon_test PRIVATE "${CMAKE_SOURCE_DIR}/src")
target_link_libraries(r2d_world_polygon_test PRIVATE r2d_unity)
if(NOT MSVC)
    target_link_libraries(r2d_world_polygon_test PRIVATE m)
endif()
if(R2D_SANITIZE_FLAGS_AVAILABLE)
    target_compile_options(r2d_world_polygon_test PRIVATE -fsanitize=address,undefined -fno-omit-frame-pointer)
    target_link_options(r2d_world_polygon_test PRIVATE -fsanitize=address,undefined)
endif()

# EXR-декодер панорамного неба Re2D World (cmake/WorldEXR.cmake).
add_executable(r2d_world_exr_test re2d/exr_test.c)
target_include_directories(r2d_world_exr_test PRIVATE "${CMAKE_SOURCE_DIR}/src")
target_link_libraries(r2d_world_exr_test PRIVATE r2d_world_exr r2d_unity)
if(R2D_SANITIZE_FLAGS_AVAILABLE)
    target_compile_options(r2d_world_exr_test PRIVATE -fsanitize=address,undefined -fno-omit-frame-pointer)
    target_link_options(r2d_world_exr_test PRIVATE -fsanitize=address,undefined)
endif()

endif()   # R2D_ENABLE_RE2D

if(TARGET R2D_SteamAudio)
    add_executable(r2d_audio_spatial_test audio/spatial_test.c "${CMAKE_SOURCE_DIR}/src/audio_spatial.c")
    target_include_directories(r2d_audio_spatial_test PRIVATE "${CMAKE_SOURCE_DIR}/src")
    # Тот же define, что у движка (src/CMakeLists.txt): без него audio_spatial.c
    # компилируется БЕЗ Steam Audio, тест проверяет фолбэк-панораму и три его
    # проверки (инициализация HRTF, фронт/тыл, высота) падают «не по делу».
    target_compile_definitions(r2d_audio_spatial_test PRIVATE R2D_STEAM_AUDIO=1)
    target_link_libraries(r2d_audio_spatial_test PRIVATE SDL3::SDL3 R2D_SteamAudio r2d_unity)
    if(NOT MSVC)
        target_link_libraries(r2d_audio_spatial_test PRIVATE m)
    endif()
    set_target_properties(r2d_audio_spatial_test PROPERTIES RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}")
    if(R2D_SANITIZE_FLAGS_AVAILABLE)
        target_compile_options(r2d_audio_spatial_test PRIVATE -fsanitize=address,undefined -fno-omit-frame-pointer)
        target_link_options(r2d_audio_spatial_test PRIVATE -fsanitize=address,undefined)
    endif()
endif()


# --- P0-H: CTest для каждой Unity-цели и всех JS-наборов --------------------
# Цели перечисляются автоматически по имени r2d_*_test; EXR-тест требует
# аргумент-файл и зарегистрирован отдельно. `r2d_check` (корневой CMakeLists)
# собирает эти цели и запускает `ctest`.
get_property(_r2d_test_targets DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}" PROPERTY BUILDSYSTEM_TARGETS)
foreach(_r2d_target IN LISTS _r2d_test_targets)
    if(_r2d_target MATCHES "^r2d_.*_test$" AND NOT _r2d_target STREQUAL "r2d_world_exr_test")
        add_test(NAME ${_r2d_target} COMMAND $<TARGET_FILE:${_r2d_target}>)
    endif()
endforeach()
if(TARGET r2d_world_exr_test)
    add_test(NAME r2d_world_exr_test
             COMMAND $<TARGET_FILE:r2d_world_exr_test> "${CMAKE_SOURCE_DIR}/demos/re2d_dust2/sky.exr"
             WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}")
endif()

set(_r2d_qjs "${CMAKE_BINARY_DIR}/_deps/quickjs-build/qjs")
file(GLOB _r2d_js_tests "${CMAKE_SOURCE_DIR}/tests/js/*_test.mjs")
foreach(_r2d_js IN LISTS _r2d_js_tests)
    get_filename_component(_r2d_js_name "${_r2d_js}" NAME_WE)
    add_test(NAME js_${_r2d_js_name}
             COMMAND "${_r2d_qjs}" "${_r2d_js}"
             WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}")
endforeach()
