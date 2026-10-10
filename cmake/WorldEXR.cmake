# Image decoding only; no OpenEXR renderer, geometry or scene integration.
include(FetchContent)
FetchContent_Declare(r2d_tinyexr
    URL https://github.com/syoyo/tinyexr/archive/refs/tags/v1.0.13.tar.gz
    URL_HASH SHA256=01edf1e18e32e5503fdd2a35d62bb593109daa392324cec0157b150e5fd68077
    SOURCE_SUBDIR r2d-no-upstream-build)
FetchContent_MakeAvailable(r2d_tinyexr)
add_library(r2d_world_exr STATIC "${CMAKE_SOURCE_DIR}/src/re2d_world_exr.cpp")
target_include_directories(r2d_world_exr PRIVATE "${r2d_tinyexr_SOURCE_DIR}")
if(TARGET zlibstatic)
    target_link_libraries(r2d_world_exr PRIVATE zlibstatic)
    target_include_directories(r2d_world_exr PRIVATE ${ZLIB_INCLUDE_DIR})
else()
    find_package(ZLIB REQUIRED)
    target_link_libraries(r2d_world_exr PRIVATE ZLIB::ZLIB)
endif()
install(DIRECTORY "${CMAKE_SOURCE_DIR}/third_party/tinyexr/" DESTINATION share/licenses/tinyexr)
