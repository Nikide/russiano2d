# ---------------------------------------------------------------------------
# Веб-сборка russiano2d (Emscripten + SDL_GPU с WebGPU-бэкендом SDL).
#
# Подключается из корневого CMakeLists ДО зависимостей: часть решений
# (какие подсистемы вообще собирать) должна быть принята раньше, чем
# Dependencies.cmake и Shaders.cmake начнут тянуть FetchContent.
#
# Что здесь есть и почему:
#   * R2D_SHADERS_WGSL_ONLY — браузерный WebGPU принимает только WGSL;
#     SPIR-V и MSL ему не нужны, а SPIRV-Cross в WGSL не умеет, поэтому
#     веб-сборка берёт рукописные shaders/wgsl/*.wgsl и не тянет glslang.
#   * Подсистемы, которых в браузере нет или которые пока не портированы
#     (RmlUi, ImGui, сеть на датаграммах, hot reload, libcurl), выключаются
#     штатными опциями движка — вместо них работают существующие заглушки.
#   * HTML-оболочка и груз игры (--preload-file) описываются здесь, чтобы
#     веб-сборка запускалась одной командой.
# ---------------------------------------------------------------------------

if(NOT EMSCRIPTEN)
    return()
endif()

set(R2D_PLATFORM_WEB ON CACHE BOOL "Сборка под браузер (Emscripten)" FORCE)

# --- SDL3 с WebGPU-бэкендом ----------------------------------------------
# Emscripten-тулчейн ищет пакеты ТОЛЬКО в своём sysroot
# (CMAKE_FIND_ROOT_PATH_MODE_PACKAGE = ONLY), поэтому SDL3, собранный и
# установленный рядом (см. docs/WEB_EXPORT.md), без этой строки не находится —
# и движок молча собирается с апстримом SDL3, у которого WebGPU-бэкенда нет.
# Тулчейн выставляет значение только если оно не задано, так что здесь оно и
# переопределяется.
set(CMAKE_FIND_ROOT_PATH_MODE_PACKAGE BOTH)

# Проверка «тот ли это SDL3»: апстрим SDL3 формата SDL_GPU_SHADERFORMAT_WGSL
# не знает. Лучше упасть на конфигурации, чем получить пустое окно в браузере.
if(R2D_PLATFORM_WEB)
    list(GET CMAKE_PREFIX_PATH 0 R2D_WEB_SDL3_PREFIX)
    set(R2D_WEB_SDL3_GPU_HEADER "${R2D_WEB_SDL3_PREFIX}/include/SDL3/SDL_gpu.h")
    if(NOT EXISTS "${R2D_WEB_SDL3_GPU_HEADER}")
        message(FATAL_ERROR
            "для веб-сборки нужен SDL3 с WebGPU-бэкендом (ветка PR libsdl-org/SDL#16020), "
            "а по CMAKE_PREFIX_PATH его нет: не найден ${R2D_WEB_SDL3_GPU_HEADER}. "
            "Порядок сборки — docs/WEB_EXPORT.md")
    endif()
    file(READ "${R2D_WEB_SDL3_GPU_HEADER}" R2D_WEB_SDL3_GPU_HEADER_TEXT LIMIT 262144)
    if(NOT R2D_WEB_SDL3_GPU_HEADER_TEXT MATCHES "SDL_GPU_SHADERFORMAT_WGSL")
        message(FATAL_ERROR
            "SDL3 в ${R2D_WEB_SDL3_PREFIX} не знает формата WGSL — это апстрим SDL "
            "без WebGPU-бэкенда; движку в браузере нужен форк из PR #16020")
    endif()
    message(STATUS "[web] SDL3 с WebGPU: ${R2D_WEB_SDL3_PREFIX}")
endif()

# --- Подсистемы -------------------------------------------------------------
# RmlUi собирается и в вебе: его шрифтовой движок (FreeType) сам умеет
# Emscripten через порт -sUSE_FREETYPE=1, а WGSL-варианты трёх его шейдеров
# лежат в движке (src/rmlui_wgsl.c) и подключаются патчем к его бэкенду
# (third_party/patches/rmlui-webgpu-wgsl.patch) — см. cmake/Dependencies.cmake.
set(R2D_ENABLE_RMLUI        ON  CACHE BOOL "" FORCE)
set(R2D_ENABLE_IMGUI        OFF CACHE BOOL "" FORCE)
# Сеть движка — датаграммы (UDP); браузер их не даёт: нужен транспорт поверх
# WebSocket/WebRTC. Пока net_stub.c.
set(R2D_ENABLE_NET          OFF CACHE BOOL "" FORCE)
# Файлы в браузере не меняются — следить за mtime нечего.
set(R2D_ENABLE_HOTRELOAD    OFF CACHE BOOL "" FORCE)
# HTTP: libcurl в wasm не собирается, нужен бэкенд на fetch/XHR.
set(R2D_ENABLE_HTTP         OFF CACHE BOOL "" FORCE)
# Компилятор живых шейдеров (glslang+spirv-cross) в веб-сборке не нужен:
# он собирает SPIR-V, а WebGPU его не принимает.
set(R2D_ENABLE_LIVE_SHADERS OFF CACHE BOOL "" FORCE)
set(R2D_SHADERS_WGSL_ONLY   ON  CACHE BOOL "" FORCE)
# Байткод-упаковщик — хост-инструмент; в веб-сборке скрипты кладутся в MEMFS.
set(R2D_EMBED_SCRIPTS       OFF CACHE BOOL "" FORCE)

option(R2D_WEB_PROFILING_FUNCS "Веб-сборка: имена функций в wasm-стеке и в Release" OFF)

# --- Память и стек ----------------------------------------------------------
# Стек Emscripten по умолчанию мал (64 КиБ), а у движка крупные кадровые
# буферы и разбор аргументов; QuickJS отдельно просит 2 МБ под свой стек.
#
# ASYNCIFY обязателен, а не «на всякий случай». WebGPU-бэкенд SDL_GPU ждёт
# асинхронные ответы браузера (запрос адаптера и устройства) ЦИКЛОМ:
#
#     while (!waitInfo.completed) {
#         wgpuInstanceWaitAny(...);
#         SDL_DelayNS(100);          // на Emscripten это emscripten_sleep()
#     }
#
# В браузере такой цикл блокирует очередь событий, колбэк адаптера не может
# выполниться, и SDL_CreateGPUDevice виснет навсегда (проверено изолированным
# щупом web/probe/gpu_probe.c: без Asyncify — зависание на создании устройства,
# с ним — 120 кадров). Emscripten_sleep отдаёт управление браузеру только в
# сборке с Asyncify; то же требование записано в самом SDL — см. комментарий
# «The WebGPU SDLGPU backend requires Asyncify» в examples/CMakeLists.txt
# ветки PR libsdl-org/SDL#16020.
#
# Цена: Asyncify раздувает .wasm и замедляет вызовы (примерно в 1.5–2 раза по
# размеру). Альтернатива на будущее — JSPI (Chrome) либо неблокирующий путь
# создания устройства в бэкенде.
add_link_options(
    -sALLOW_MEMORY_GROWTH=1
    -sINITIAL_MEMORY=134217728
    -sSTACK_SIZE=5242880
    -sENVIRONMENT=web
    -sEXIT_RUNTIME=0
    -sFORCE_FILESYSTEM=1
    -sASYNCIFY=1
    # Стек самого Asyncify по умолчанию 4 КиБ — для нашей глубины вызовов
    # (main → app_init → SDL_CreateGPUDevice → waiter) это мало: переполнение
    # проявляется порчей кучи («memory access out of bounds» в malloc).
    -sASYNCIFY_STACK_SIZE=131072
    # main() запускается НЕ автоматически: экран загрузки (web/shell.html) ждёт
    # нажатия «Играть», и только потом зовёт Module.callMain(). Иначе браузер
    # не даёт открыть аудиоустройство (нужен жест пользователя), а движок
    # поднимает звук при старте.
    -sINVOKE_RUN=0
    -sEXPORTED_RUNTIME_METHODS=callMain
    # Имена функций в стеке: без них wasm-ловушка ("RuntimeError: unreachable")
    # не говорит, ГДЕ упало — только номера функций. Нужны отладке, а не игроку:
    # в Release (так собирает web/export.py) флаг не ставится — .wasm меньше;
    # вернуть имена в Release можно -DR2D_WEB_PROFILING_FUNCS=ON.
    "$<$<OR:$<NOT:$<CONFIG:Release>>,$<BOOL:${R2D_WEB_PROFILING_FUNCS}>>:--profiling-funcs>"
)

# --- Груз для браузера ------------------------------------------------------
# R2D_WEB_PRELOAD — список «<каталог репозитория>@<точка монтирования в MEMFS>».
# Базовый каталог движка в браузере — корень MEMFS, поэтому игра монтируется
# в /game, а встроенные ассеты движка — в /assets.
set(R2D_WEB_PRELOAD "" CACHE STRING
    "Каталоги для --preload-file, вид: каталог@точка-монтирования")

# Что НЕ класть в груз: заметки и исходники художника движку не нужны, а в
# браузер уезжают целиком. Шаблоны — как у `emcc --exclude-file` (fnmatch по
# полному пути). Каталоги с данными, которые читает игра (например,
# demos/rotsprite/source/*.surface.json), сюда добавлять нельзя.
set(R2D_WEB_PRELOAD_EXCLUDE
    "*.md" "*.py" "*.psd" "*.kra" "*.xcf" "*.aseprite" "*.blend"
    "*.bak" "*.orig" "*~" "*/.DS_Store" "*/Thumbs.db"
    CACHE STRING "Шаблоны emcc --exclude-file для груза веб-сборки")
foreach(pattern IN LISTS R2D_WEB_PRELOAD_EXCLUDE)
    add_link_options("--exclude-file=${pattern}")
endforeach()

# --- Настройки экспорта (страница и её экран загрузки) ----------------------
#   R2D_WEB_SHELL        — своя HTML-оболочка вместо web/shell.html. Внутри
#                          работают подстановки @ИМЯ@ (их видит CMake) и
#                          {{{ SCRIPT }}} (это уже Emscripten).
#   R2D_WEB_LOADER_IMAGE — своя картинка экрана загрузки (по умолчанию маскот
#                          из README). Копируется рядом с .html.
#   R2D_WEB_FORCE_PLAY   — начинать игру сразу после загрузки, без кнопки
#                          «Играть». Кнопка нужна браузеру как жест
#                          пользователя для звука, поэтому по умолчанию она есть.
set(R2D_WEB_SHELL "" CACHE FILEPATH "HTML-оболочка Emscripten (пусто — web/shell.html)")
set(R2D_WEB_LOADER_IMAGE "" CACHE FILEPATH
    "Картинка экрана загрузки (пусто — маскот из docs/images)")
option(R2D_WEB_FORCE_PLAY "Веб-сборка: начинать игру без кнопки «Играть»" OFF)
