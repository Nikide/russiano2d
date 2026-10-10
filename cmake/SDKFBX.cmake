# SDK import only: never linked into the game runtime.
include(FetchContent)
FetchContent_Declare(r2d_ufbx
    URL https://github.com/ufbx/ufbx/archive/refs/tags/v0.20.1.tar.gz
    URL_HASH SHA256=1e45f7040ee38e8a6b564a5becb6b64335af89505f7077a0cc7bce092e188fca
    SOURCE_SUBDIR r2d-no-upstream-build)
FetchContent_MakeAvailable(r2d_ufbx)
add_library(r2d_ufbx STATIC "${r2d_ufbx_SOURCE_DIR}/ufbx.c")
target_include_directories(r2d_ufbx PUBLIC "${r2d_ufbx_SOURCE_DIR}")
if(NOT MSVC)
    target_link_libraries(r2d_ufbx PUBLIC m)
endif()
install(DIRECTORY "${CMAKE_SOURCE_DIR}/third_party/ufbx/" DESTINATION share/licenses/ufbx)
