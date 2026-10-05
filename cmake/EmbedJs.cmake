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

file(GLOB R2D_HIGHLEVEL_SOURCES CONFIGURE_DEPENDS "${R2D_HIGHLEVEL_DIR}/*.js")

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
    DEPENDS "${R2D_EMBED_JS_TOOL}" ${R2D_HIGHLEVEL_SOURCES}
    COMMENT "Встраиваю высокоуровневое API ($) в бинарник"
    VERBATIM)

add_custom_target(r2d_js DEPENDS "${R2D_JS_HEADER}")
