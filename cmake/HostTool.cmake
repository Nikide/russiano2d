# ---------------------------------------------------------------------------
# Инструменты кодогенерации при кросс-сборке.
#
# r2d_embed_icons и r2d_embed_js запускаются во время сборки и должны
# исполняться на ХОСТЕ. Под кросс-компиляцией `add_executable` даёт бинарник
# целевой платформы (например, .exe под Windows на Linux), который на хосте
# запустить нельзя — сборка падает с «r2d_embed_icons: not found».
#
# Поэтому такие инструменты компилируются хост-компилятором и вызываются по
# полному пути. Хост-компилятор можно задать вручную: -DR2D_HOST_CC=gcc
#
#   r2d_host_tool(<переменная-с-путём> <исходник.c>)
# ---------------------------------------------------------------------------

function(r2d_host_tool out_var source)
    if(NOT R2D_HOST_CC)
        find_program(R2D_HOST_CC NAMES cc gcc clang)
        if(NOT R2D_HOST_CC)
            message(FATAL_ERROR
                "не найден хост-компилятор для инструментов кодогенерации — "
                "задайте его явно: -DR2D_HOST_CC=/usr/bin/gcc")
        endif()
    endif()

    get_filename_component(tool_name "${source}" NAME_WE)
    set(tool_dir "${CMAKE_BINARY_DIR}/host-tools")
    set(tool_path "${tool_dir}/${tool_name}")

    add_custom_command(
        OUTPUT "${tool_path}"
        COMMAND "${CMAKE_COMMAND}" -E make_directory "${tool_dir}"
        COMMAND "${R2D_HOST_CC}" -O2 -o "${tool_path}" "${source}"
        DEPENDS "${source}"
        COMMENT "Собираю хост-инструмент ${tool_name}"
        VERBATIM)

    set(${out_var} "${tool_path}" PARENT_SCOPE)
endfunction()
