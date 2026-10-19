# ---------------------------------------------------------------------------
# Tracy — опциональный профайлер реального времени (BSD-3-Clause).
#
# Зачем он нужен, если есть свой профайлер. src/profile.c и DevTools показывают
# то, что нужно внутри игры: зоны кадра, окно, перцентили, hitch-захваты. Tracy
# добавляет то, чего у них нет и не будет: живой таймлайн с отдельным сервером
# (tracy-profiler), сэмплирование стека всех потоков, события памяти, локи и
# сравнение двух прогонов. Наш профайлер Tracy НЕ заменяет и наоборот: зоны
# берутся из единственного места — r2d_prof_begin/end (см. src/profile.c),
# поэтому «один источник правды» соблюдается, второй системы зон нет.
#
# Опция по умолчанию OFF. Пока она OFF, Tracy не скачивается, не компилируется,
# не линкуется и не влияет ни на размер бинарника, ни на цену кадра, ни на
# поведение: релизная сборка — ровно та же, что была.
#
# Включение:
#   cmake -S . -B build-tracy -DR2D_TRACY=ON
#   tools/dev_build.sh build-tracy russiano2d
# Сервер (собирается отдельно, внутрь игры не встраивается):
#   git clone https://github.com/wolfpld/tracy && cmake -S tracy -B tracy/build
#   cmake --build tracy/build --target tracy-profiler
# Подробности, что видно и чего не видно, — docs/BUILD.md.
#
# Офлайн-сборка: -DR2D_TRACY_SOURCE_DIR=<каталог Tracy> пропускает FetchContent
# (полезно в CI без сети и при работе с локальной копией).
# ---------------------------------------------------------------------------

if(NOT R2D_TRACY)
    return()
endif()

# Веб-сборка: у клиента Tracy нет поддержки Emscripten/wasm (TCP-сокеты, потоки,
# сэмплирование стека). Молча собирать «пустышку» нельзя — говорим прямо.
if(EMSCRIPTEN)
    message(STATUS "  Tracy ........... выключен: веб-сборка не поддерживается")
    set(R2D_TRACY OFF CACHE BOOL "Tracy выключен в веб-сборке" FORCE)
    return()
endif()

# include(Tracy) вызывается после add_subdirectory(src): зоны Tracy живут в
# целях движка, и линковать их можно только в существующую цель.
if(NOT TARGET russiano2d)
    message(WARNING "Tracy: цель russiano2d не найдена — include(Tracy) обязан "
                    "идти после add_subdirectory(src); опция игнорируется")
    return()
endif()

# Настройки клиента выставляем ДО Tracy.cmake: их читает его set_option().
# Значения — осознанные, каждое с причиной.
set(TRACY_ENABLE ON CACHE BOOL "" FORCE)      # без него клиент — пустышка
# Профилируем «по требованию»: пока сервер Tracy не подключён, клиент ничего не
# пишет и не держит буферов — на кадр остаётся одна атомарная проверка. Это
# важно для игры: включённый Tracy не должен мешать, если сервер не запущен.
set(TRACY_ON_DEMAND ON CACHE BOOL "" FORCE)
# Не рассылаем UDP-оповещения по локальной сети: игра — не сетевая служба, а
# сервер разработчика стоит на той же машине. Подключение при этом остаётся
# явным и проверенным: в tracy-profiler адрес 127.0.0.1 и Connect (или
# tracy-capture -a 127.0.0.1). Нужно автообнаружение клиента в списке сервера —
# собирайте с -DTRACY_NO_BROADCAST=OFF (штатное поведение Tracy).
set(TRACY_NO_BROADCAST ON CACHE BOOL "" FORCE)
# Блокировка выхода (TRACY_NO_EXIT) намеренно НЕ включается: игра обязана
# закрываться, даже если сервер Tracy не отвечает.
set(TRACY_NO_EXIT OFF CACHE BOOL "" FORCE)

set(R2D_TRACY_SOURCE_DIR "" CACHE PATH
    "Готовый каталог Tracy (пусто — скачать через FetchContent)")

if(R2D_TRACY_SOURCE_DIR)
    message(STATUS "[tracy] исходники из ${R2D_TRACY_SOURCE_DIR}")
    add_subdirectory("${R2D_TRACY_SOURCE_DIR}" "${CMAKE_BINARY_DIR}/tracy"
                     EXCLUDE_FROM_ALL)
else()
    include(FetchContent)
    message(STATUS "[tracy] тяну Tracy v0.14.1 из github.com/wolfpld/tracy")
    FetchContent_Declare(tracy
        GIT_REPOSITORY https://github.com/wolfpld/tracy.git
        GIT_TAG        30997d5ca6bb632cc10807a1da8a6d3de0aeeb3c  # v0.14.1
        GIT_SHALLOW    FALSE)
    FetchContent_MakeAvailable(tracy)
endif()

# TracyClient — официальная цель Tracy (public/TracyClient.cpp, режим «один
# файл»). Тянем её приватно в движок: SDK-бинарник и хостовые тесты остаются
# без Tracy. R2D_TRACY — наш собственный признак для #ifdef в коде.
target_link_libraries(russiano2d PRIVATE Tracy::TracyClient)
target_compile_definitions(russiano2d PRIVATE R2D_TRACY=1)

get_target_property(R2D_TRACY_DEFS Tracy::TracyClient INTERFACE_COMPILE_DEFINITIONS)
message(STATUS "[tracy] TracyClient подключён (${R2D_TRACY_DEFS})")
