# ---------------------------------------------------------------------------
# Высокоуровневое API ($) внутри бинарника.
#
# src/highlevel/*.js — обычные ES-модули, но игровой код получает их без
# файлов на диске: движок отдаёт их загрузчику модулей прямо из памяти.
# Поэтому $ работает и в релизной сборке (R2D_EMBED_SCRIPTS), где скриптов на
# диске нет вообще.
#
# Генератор читает каталог и пишет таблицу «имя → исходник»; экранирование
# делается в C, а не в CMake, иначе произвольный JS легко превратить в
# неверный C-литерал.
# ---------------------------------------------------------------------------

set(R2D_HIGHLEVEL_DIR "${CMAKE_SOURCE_DIR}/src/highlevel")
set(R2D_JS_HEADER "${CMAKE_BINARY_DIR}/generated/r2d_js_data.h")

# Модули, которых нет в этой сборке. Механизм есть, и генератор его умеет
# (tools/r2d_embed_js.c, аргумент --exclude: имя не попадает ни в таблицу, ни в
# зависимости сборки).
#
# Для RE2D он намеренно НЕ используется: api.js импортирует модули $ статически
# (обычные ES-import, не ленивая загрузка), поэтому исключение файла из таблицы
# ломает загрузку `$` целиком — проверено сборкой с -DR2D_ENABLE_RE2D=OFF:
# игра падала с «$ is not defined». Необязательность слоя обеспечивает гейт
# возможностей (api.js: re2dAvailable) по нативным биндингам: в сборке без RE2D
# модули просто не устанавливаются. Список оставлен для будущих подсистем,
# которые смогут грузиться лениво.
set(R2D_JS_EXCLUDE "" CACHE STRING "JS-модули $, не встраиваемые в эту сборку")

set(R2D_JS_EXCLUDE_ARGS "")
file(GLOB R2D_HIGHLEVEL_SOURCES CONFIGURE_DEPENDS "${R2D_HIGHLEVEL_DIR}/*.js")
foreach(module IN LISTS R2D_JS_EXCLUDE)
    list(APPEND R2D_JS_EXCLUDE_ARGS "--exclude" "${module}")
    list(REMOVE_ITEM R2D_HIGHLEVEL_SOURCES "${R2D_HIGHLEVEL_DIR}/${module}")
endforeach()

# Под кросс-сборкой генератор собирается хост-компилятором: см. HostTool.cmake.
if(CMAKE_CROSSCOMPILING)
    include("${CMAKE_CURRENT_LIST_DIR}/HostTool.cmake")
    r2d_host_tool(R2D_EMBED_JS_TOOL "${CMAKE_SOURCE_DIR}/tools/r2d_embed_js.c")
else()
    add_executable(r2d_embed_js "${CMAKE_SOURCE_DIR}/tools/r2d_embed_js.c")
    set(R2D_EMBED_JS_TOOL r2d_embed_js)
endif()

add_custom_command(
    OUTPUT "${R2D_JS_HEADER}"
    COMMAND "${R2D_EMBED_JS_TOOL}" "${R2D_HIGHLEVEL_DIR}" "${R2D_JS_HEADER}"
            ${R2D_JS_EXCLUDE_ARGS}
    DEPENDS "${R2D_EMBED_JS_TOOL}" ${R2D_HIGHLEVEL_SOURCES}
    COMMENT "Встраиваю высокоуровневое API ($) в бинарник"
    VERBATIM)

add_custom_target(r2d_js DEPENDS "${R2D_JS_HEADER}")
