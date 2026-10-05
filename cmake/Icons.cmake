# ---------------------------------------------------------------------------
# Шрифт иконок Material Design, встроенный в исполняемый файл.
#
# Иконки — это обычные символы в области Private Use Area (U+E000..U+F8FF),
# поэтому их можно подставлять в любой текст: RmlUi рисует их как глифы
# запасного шрифта, а из JS они доступны через engine.ui.icon("home").
#
# Файлы скачиваются с конкретного коммита и проверяются по SHA256: без этого
# сборка «поехала» бы при любом обновлении ветки master.
# ---------------------------------------------------------------------------

set(R2D_MDI_COMMIT "737e3324305806514d7909874fa1818ae1808232")
set(R2D_MDI_BASE "https://raw.githubusercontent.com/google/material-design-icons/${R2D_MDI_COMMIT}")
set(R2D_MDI_FONT_SHA256 "ef149f08bdd2ff09a4e2c8573476b7b0f3fbb15b623954ade59899e7175bedda")
set(R2D_MDI_CODEPOINTS_SHA256 "530f25bf7b2d71c8e1da9476d53f9a9bb6b7e187bff69bb7128bb679b8194894")

set(R2D_ICON_DIR "${CMAKE_BINARY_DIR}/third_party/material-icons")
set(R2D_ICON_FONT "${R2D_ICON_DIR}/MaterialIcons-Regular.ttf")
set(R2D_ICON_CODEPOINTS "${R2D_ICON_DIR}/MaterialIcons-Regular.codepoints")

file(MAKE_DIRECTORY "${R2D_ICON_DIR}")

function(r2d_download_once url dest expected_sha256 what)
    if(EXISTS "${dest}")
        file(SHA256 "${dest}" actual)
        if(actual STREQUAL expected_sha256)
            return()
        endif()
        message(STATUS "[icons] ${what}: хеш не совпал, перекачиваю")
        file(REMOVE "${dest}")
    endif()

    message(STATUS "[icons] ${what}: скачиваю")
    file(DOWNLOAD "${url}" "${dest}"
         EXPECTED_HASH SHA256=${expected_sha256}
         TLS_VERIFY ON
         STATUS dl_status)
    list(GET dl_status 0 code)
    if(NOT code EQUAL 0)
        list(GET dl_status 1 reason)
        file(REMOVE "${dest}")
        message(FATAL_ERROR "не удалось скачать ${what}: ${reason}")
    endif()
endfunction()

r2d_download_once("${R2D_MDI_BASE}/font/MaterialIcons-Regular.ttf"
                   "${R2D_ICON_FONT}" "${R2D_MDI_FONT_SHA256}" "шрифт иконок")
r2d_download_once("${R2D_MDI_BASE}/font/MaterialIcons-Regular.codepoints"
                   "${R2D_ICON_CODEPOINTS}" "${R2D_MDI_CODEPOINTS_SHA256}" "таблица имён иконок")

# --- Генератор заголовка ----------------------------------------------------
# При кросс-сборке генератор обязан работать на ХОСТЕ: собранный под Windows
# .exe на Linux не запускается, и генерация падает с «r2d_embed_icons: not
# found». Поэтому в кросс-сборке компилируем его хост-компилятором.
if(CMAKE_CROSSCOMPILING)
    include("${CMAKE_CURRENT_LIST_DIR}/HostTool.cmake")
    r2d_host_tool(R2D_ICON_TOOL "${CMAKE_SOURCE_DIR}/tools/r2d_embed_icons.c")
else()
    add_executable(r2d_embed_icons "${CMAKE_SOURCE_DIR}/tools/r2d_embed_icons.c")
    set(R2D_ICON_TOOL r2d_embed_icons)
endif()

set(R2D_ICONS_HEADER "${CMAKE_BINARY_DIR}/generated/r2d_icons_data.h")

add_custom_command(
    OUTPUT "${R2D_ICONS_HEADER}"
    COMMAND "${R2D_ICON_TOOL}" "${R2D_ICON_FONT}" "${R2D_ICON_CODEPOINTS}" "${R2D_ICONS_HEADER}"
    DEPENDS "${R2D_ICON_TOOL}" "${R2D_ICON_FONT}" "${R2D_ICON_CODEPOINTS}"
    COMMENT "Встраиваю шрифт иконок Material Design"
    VERBATIM)

add_custom_target(r2d_icons DEPENDS "${R2D_ICONS_HEADER}")
