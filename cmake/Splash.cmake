# ---------------------------------------------------------------------------
# Сплэш SDK, вшитый в исполняемый файл (см. tools/r2d_embed_assets.c).
#
# Картинка/разметка сплэша лежат в sdk/assets и sdk/ui (их правят как обычные
# данные), но на этапе сборки превращаются в байтовые массивы внутри
# бинарника. Поэтому сплэш работает и в урезанной поставке, где каталога
# sdk/ рядом нет: RmlUi получает файлы из памяти (src/gui.cpp).
# ---------------------------------------------------------------------------
if(CMAKE_CROSSCOMPILING)
    include("${CMAKE_CURRENT_LIST_DIR}/HostTool.cmake")
    r2d_host_tool(R2D_EMBED_ASSETS_TOOL "${CMAKE_SOURCE_DIR}/tools/r2d_embed_assets.c")
else()
    add_executable(r2d_embed_assets "${CMAKE_SOURCE_DIR}/tools/r2d_embed_assets.c")
    set(R2D_EMBED_ASSETS_TOOL r2d_embed_assets)
endif()

set(R2D_SPLASH_JPG  "${CMAKE_SOURCE_DIR}/sdk/assets/splash.jpg")
set(R2D_SPLASH_RML  "${CMAKE_SOURCE_DIR}/sdk/ui/splash.rml")
set(R2D_SPLASH_RCSS "${CMAKE_SOURCE_DIR}/sdk/ui/splash.rcss")
set(R2D_SPLASH_HEADER "${CMAKE_BINARY_DIR}/generated/r2d_splash_data.h")

add_custom_command(
    OUTPUT "${R2D_SPLASH_HEADER}"
    COMMAND "${R2D_EMBED_ASSETS_TOOL}" "${R2D_SPLASH_HEADER}"
            "sdk/assets/splash.jpg" "${R2D_SPLASH_JPG}"
            "sdk/ui/splash.rml" "${R2D_SPLASH_RML}"
            "sdk/ui/splash.rcss" "${R2D_SPLASH_RCSS}"
    DEPENDS "${R2D_EMBED_ASSETS_TOOL}" "${R2D_SPLASH_JPG}" "${R2D_SPLASH_RML}" "${R2D_SPLASH_RCSS}"
    COMMENT "Встраиваю сплэш SDK в бинарник"
    VERBATIM)

add_custom_target(r2d_splash DEPENDS "${R2D_SPLASH_HEADER}")
