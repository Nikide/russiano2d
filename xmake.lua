-- ===========================================================================
-- Russiano2D — Xmake build.
--
-- Первый этап порта: нативная macOS-сборка. Пакеты пинятся на версии из
-- cmake/Dependencies.cmake; сгенерированные заголовки пока берутся из
-- build/generated (позже заменяются xmake-правилами).
-- ===========================================================================
set_project("russiano2d")
set_version("1.2.13")
set_license("MIT")
add_rules("mode.release")
includes("xmake/packages/libsdl3.lua")
includes("xmake/packages/libsdl3_image.lua")
set_languages("gnu11", "c++17")

package("quickjs-ng")
    set_homepage("https://github.com/quickjs-ng/quickjs")
    set_description("QuickJS-ng JavaScript engine")
    add_urls("https://github.com/quickjs-ng/quickjs/archive/refs/tags/v0.10.1.tar.gz")
    add_versions("v0.10.1", "4e917eea3bb6051a0551fdd3aac45199ff705fa08920c15b824a08c5fbb032e4")
    add_deps("cmake")
    on_install(function (package)
        local configs = {
            "-DCMAKE_BUILD_TYPE=Release",
            "-DBUILD_SHARED_LIBS=OFF",
            "-DQJS_ENABLE_CLI=OFF",
            "-DQJS_ENABLE_TESTS=OFF",
            "-DQJS_ENABLE_EXAMPLES=OFF",
            "-DCMAKE_C_FLAGS_RELEASE=-O1 -DNDEBUG",
            "-DCMAKE_CXX_FLAGS_RELEASE=-O1 -DNDEBUG",
        }
        if package:is_plat("linux") then
            table.insert(configs, "-DCMAKE_C_FLAGS=-Wno-error=incompatible-pointer-types-discards-qualifiers -target x86_64-linux-gnu")
            table.insert(configs, "-DCMAKE_CXX_FLAGS=-Wno-error=incompatible-pointer-types-discards-qualifiers -target x86_64-linux-gnu")
        elseif package:is_plat("mingw", "windows") then
            table.insert(configs, "-DCMAKE_C_FLAGS=-Wno-error")
            table.insert(configs, "-DCMAKE_CXX_FLAGS=-Wno-error")
        end
        import("package.tools.cmake").install(package, configs, {cmake_generator = "Ninja"})
    end)
    on_load(function (package)
        package:add("includedirs", "include")
        package:add("links", "qjs")
    end)
package_end()

local x11_urlname = {
    libx11 = "libX11", libxext = "libXext", libxrender = "libXrender",
    libxrandr = "libXrandr", libxi = "libXi", libxfixes = "libXfixes",
    libxcursor = "libXcursor", libxss = "libXScrnSaver",
}
local function define_x11_static(name, version, hash, deps, link)
    package(name)
        set_homepage("https://www.x.org/")
        set_description(name .. " (local recipe: static-only, libtool patched)")
        set_urls("https://www.x.org/archive/individual/lib/" .. (x11_urlname[name] or name) .. "-$(version).tar.gz")
        add_versions(version, hash)
        for _, d in ipairs(deps) do add_deps(d) end
        on_install(function (package)
            local configs = {"--sysconfdir=" .. package:installdir("etc"),
                             "--localstatedir=" .. package:installdir("var"),
                             "--disable-shared", "--enable-static", "--with-pic",
                             "--disable-malloc0returnsnull",
                             "--disable-dependency-tracking", "--disable-silent-rules"}
            local autoconf = import("package.tools.autoconf")
            autoconf.configure(package, configs)
            local text = io.readfile("libtool")
            assert(text, "libtool not generated for " .. name)
            text = text:gsub("build_libtool_libs=yes", "build_libtool_libs=no")
            text = text:gsub("build_old_libs=no", "build_old_libs=yes")
            text = text:gsub("fast_install=needless", "fast_install=no")
            io.writefile("libtool", text)
            autoconf.make(package, {"-j1"})
            autoconf.make(package, {"install"})
        end)
        on_load(function (package)
            package:add("includedirs", "include")
            package:add("linkdirs", "lib")
            package:add("links", link)
        end)
    package_end()
end

define_x11_static("libx11", "1.8.13", "acf0e7cd7541110e6330ecb539441a2d53061f386ec7be6906dfde0de2598470",
    {"libxcb", "xtrans", "xorgproto", "util-macros", "pkg-config"}, "X11")
define_x11_static("libxext", "1.3.7", "6564608dc3b816b0cfddf0c7ddc62bc579055dd70b2f28113a618df2acb64189",
    {"libx11", "xorgproto"}, "Xext")
define_x11_static("libxrender", "0.9.12", "0fff64125819c02d1102b6236f3d7d861a07b5216d8eea336c3811d31494ecf7",
    {"libx11", "xorgproto"}, "Xrender")
define_x11_static("libxrandr", "1.5.4", "c72c94dc3373512ceb67f578952c5d10915b38cc9ebb0fd176a49857b8048e22",
    {"libxrender", "libxext", "libx11", "xorgproto"}, "Xrandr")
define_x11_static("libxi", "1.8.2", "5542daec66febfeb6f51d57abfa915826efe2e3af57534f4105b82240ea3188d",
    {"libxext", "libx11", "libxfixes", "xorgproto"}, "Xi")
define_x11_static("libxfixes", "6.0.1", "e69eaa321173c748ba6e2f15c7cf8da87f911d3ea1b6af4b547974aef6366bec",
    {"libx11", "xorgproto"}, "Xfixes")
define_x11_static("libxcursor", "1.2.3", "74e72da27e61cc2cfd2e267c14f500ea47775850048ee0b00362a55c9b60ee9b",
    {"libxrender", "libxfixes", "libx11", "xorgproto"}, "Xcursor")
define_x11_static("libxss", "1.2.5", "127cd6862cfe7bcd14aa882e82695b3ca2b05e0cc9c208cadbbfb0f6a1114734",
    {"libx11", "libxext", "xorgproto", "pkg-config"}, "Xss")

package("libxcb")
    set_homepage("https://xcb.freedesktop.org/")
    set_description("libxcb (local recipe: static-only, libtool patched)")
    add_urls("https://xcb.freedesktop.org/dist/libxcb-1.17.0.tar.gz",
             "https://www.x.org/archive/individual/lib/libxcb-1.17.0.tar.gz")
    add_versions("1.17.0", "2c69287424c9e2128cb47ffe92171e10417041ec2963bceafb65cb3fcf8f0b85")
    add_deps("libxau", "libxdmcp", "xcb-proto", "libpthread-stubs", "pkg-config", "python 3.x")
    on_install(function (package)
        local configs = {"--sysconfdir=" .. package:installdir("etc"),
                         "--localstatedir=" .. package:installdir("var"),
                         "--disable-shared", "--enable-static", "--with-pic",
                         "--disable-dependency-tracking", "--disable-silent-rules",
                         "--enable-devel-docs=no", "--with-doxygen=no", "PYTHON=python3"}
        local autoconf = import("package.tools.autoconf")
        autoconf.configure(package, configs)
        -- xmake's libtool cross patch can fail; force static-only libtool.
        local text = io.readfile("libtool")
        assert(text, "libtool not generated")
        text = text:gsub("build_libtool_libs=yes", "build_libtool_libs=no")
        text = text:gsub("build_old_libs=no", "build_old_libs=yes")
        text = text:gsub("fast_install=needless", "fast_install=no")
        io.writefile("libtool", text)
        autoconf.make(package, {"-j1"})
        autoconf.make(package, {"install"})
    end)
    on_load(function (package)
        package:add("includedirs", "include")
        package:add("linkdirs", "lib")
        package:add("links", "xcb")
    end)
package_end()

package("libxdmcp")
    set_homepage("https://www.x.org/")
    set_description("libXdmcp (local recipe: static Zig build, no libtool)")
    add_urls("https://www.x.org/archive/individual/lib/libXdmcp-1.1.5.tar.gz")
    add_versions("1.1.5", "31a7abc4f129dcf6f27ae912c3eedcb94d25ad2e8f317f69df6eda0bc4e4f2f3")
    add_deps("xorgproto")
    on_install(function (package)
        local inc = path.join(package:installdir(), "include")
        local lib = path.join(package:installdir(), "lib")
        os.mkdir(inc); os.mkdir(lib); os.mkdir(package:builddir())
        os.cp("include/*", inc)
        local xorg = package:dep("xorgproto"):installdir("include")
        local sources = {"Array.c","Fill.c","Flush.c","Key.c","Read.c","Unwrap.c","Wrap.c","Wraphelp.c","Write.c"}
        local objs = {}
        for _, src in ipairs(sources) do
            local obj = path.join(package:builddir(), src .. ".o")
            os.execv("zig", {"cc", "-target", "x86_64-linux-gnu", "-O2", "-fPIC",
                             "-Iinclude", "-I" .. xorg, "-c", src, "-o", obj})
            table.insert(objs, obj)
        end
        os.execv("zig", table.join({"ar", "rcs", path.join(lib, "libXdmcp.a")}, objs))
    end)
    on_load(function (package)
        package:add("includedirs", "include")
        package:add("linkdirs", "lib")
        package:add("links", "Xdmcp")
    end)
package_end()

package("libxau")
    set_homepage("https://www.x.org/")
    set_description("libXau (local recipe: static-only for Zig cross)")
    add_urls("https://www.x.org/archive/individual/lib/libXau-1.0.12.tar.gz")
    add_versions("1.0.12", "2402dd938da4d0a332349ab3d3586606175e19cb32cb9fe013c19f1dc922dcee")
    add_deps("pkg-config", "util-macros", "xorgproto")
    on_install(function (package)
        -- Zig-кросс: собираем libXau напрямую, без libtool/autotools (он не
        -- умеет shared-линковку под zigcc и падает на macOS .tbd).
        local inc = path.join(package:installdir(), "include")
        local lib = path.join(package:installdir(), "lib")
        os.mkdir(inc)
        os.mkdir(lib)
        os.mkdir(package:builddir())
        os.cp("include/*", inc)
        local sources = {"AuDispose.c","AuFileName.c","AuGetAddr.c","AuGetBest.c",
                         "AuLock.c","AuRead.c","AuUnlock.c","AuWrite.c"}
        local xorg = package:dep("xorgproto"):installdir("include")
        local objs = {}
        for _, src in ipairs(sources) do
            local obj = path.join(package:builddir(), path.basename(src) .. ".o")
            os.execv("zig", {"cc", "-target", "x86_64-linux-gnu", "-O2", "-fPIC",
                             "-Iinclude", "-I" .. xorg, "-c", src, "-o", obj})
            table.insert(objs, obj)
        end
        os.execv("zig", table.join({"ar", "rcs", path.join(lib, "libXau.a")}, objs))
    end)
    on_load(function (package)
        package:add("includedirs", "include")
        package:add("linkdirs", "lib")
        package:add("links", "Xau")
    end)
package_end()

package("zlib")
    set_homepage("https://zlib.net")
    set_description("zlib (local recipe: CMake install, no nested xmake install)")
    add_urls("https://github.com/madler/zlib/archive/refs/tags/v1.3.2.tar.gz")
    add_versions("v1.3.2", "b99a0b86c0ba9360ec7e78c4f1e43b1cbdf1e6936c8fa0f6835c0cd694a495a1")
    add_deps("cmake")
    on_install(function (package)
        local configs = {
            "-DCMAKE_BUILD_TYPE=Release",
            "-DBUILD_SHARED_LIBS=OFF",
            "-DZLIB_BUILD_EXAMPLES=OFF",
            "-DZLIB_BUILD_TESTING=OFF",
            "-DZLIB_BUILD_SHARED=OFF",
            "-DZLIB_BUILD_STATIC=ON",
            "-DBUILD_TESTING=OFF",
        }
        import("package.tools.cmake").install(package, configs, {cmake_generator = "Ninja"})
    end)
    on_load(function (package)
        package:add("includedirs", "include")
        package:add("linkdirs", "lib")
        if package:is_plat("mingw", "windows") then
            package:add("links", "zs")
        else
            package:add("links", "z")
        end
    end)
package_end()

package("rmlui")
    set_homepage("https://mikke89.github.io/RmlUiDoc/")
    set_description("RmlUi (local recipe: static CMake cross build)")
    add_urls("https://github.com/mikke89/RmlUi/archive/refs/tags/6.3.tar.gz")
    add_versions("6.3", "d977298bb6147610e5984d5db85ddf284020d655a8713913f6982074f1dbdede")
    add_deps("cmake", "freetype", "zlib")
    on_install(function (package)
        local configs = {
            "-DCMAKE_BUILD_TYPE=Release",
            "-DBUILD_SHARED_LIBS=OFF",
            "-DCMAKE_TRY_COMPILE_TARGET_TYPE=STATIC_LIBRARY",
            "-DBUILD_TESTING=OFF",
            "-DBUILD_SAMPLES=OFF",
            "-DNO_FONT_INTERFACE_DEFAULT=OFF",
            "-DRMLUI_LUA_BINDINGS=OFF",
            "-DENABLE_SVG_PLUGIN=OFF",
            "-DENABLE_LOTTIE_PLUGIN=OFF",
            "-DDISABLE_RTTI_AND_EXCEPTIONS=OFF",
        }
        import("package.tools.cmake").install(package, configs, {packagedeps = {"freetype", "zlib"}, cmake_generator = "Ninja"})
    end)
    on_load(function (package)
        package:add("defines", "RMLUI_STATIC_LIB")
        package:add("includedirs", "include")
        package:add("links", "rmlui")
    end)
package_end()

package("freetype")
    set_homepage("https://freetype.org")
    set_description("FreeType (local recipe: static CMake cross build)")
    add_urls("https://downloads.sourceforge.net/project/freetype/freetype2/2.14.1/freetype-2.14.1.tar.gz")
    add_versions("2.14.1", "174d9e53402e1bf9ec7277e22ec199ba3e55a6be2c0740cb18c0ee9850fc8c34")
    add_deps("cmake", "zlib")
    on_install(function (package)
        local configs = {
            "-DCMAKE_BUILD_TYPE=Release",
            "-DBUILD_SHARED_LIBS=OFF",
            "-DCMAKE_TRY_COMPILE_TARGET_TYPE=STATIC_LIBRARY",
            "-DFT_DISABLE_HARFBUZZ=ON",
            "-DFT_DISABLE_BZIP2=ON",
            "-DFT_DISABLE_PNG=ON",
            "-DFT_DISABLE_BROTLI=ON",
            "-DFT_DISABLE_ZLIB=OFF",
        }
        import("package.tools.cmake").install(package, configs, {packagedeps = {"zlib"}, cmake_generator = "Ninja"})
    end)
    on_load(function (package)
        package:add("includedirs", "include/freetype2")
        package:add("links", "freetype")
    end)
package_end()

package("sdl3_net-r2d")
    set_homepage("https://github.com/libsdl-org/SDL_net")
    set_description("SDL3_net pinned to the project commit")
    add_urls("https://github.com/libsdl-org/SDL_net/archive/30dd38a36b487b60847a8bb9832e94b124802e2f.tar.gz")
    add_versions("30dd38a", "a5bf9af94fb89d7339af71f018c2dea93ea0d00089eed63beec1bfe18f0d2674")
    add_deps("libsdl3", "cmake")
    on_install(function (package)
        local configs = {
            "-DCMAKE_BUILD_TYPE=Release",
            "-DBUILD_SHARED_LIBS=OFF",
            "-DSDLNET_INSTALL=ON",
            "-DSDLNET_SAMPLES=OFF",
            "-DSDLNET_WERROR=OFF",
        }
        import("package.tools.cmake").install(package, configs, {packagedeps = {"libsdl3"}, cmake_generator = "Ninja"})
        local inc = path.join(package:installdir(), "include")
        os.mkdir(inc)
        os.cp("include/*", inc)
    end)
    on_load(function (package)
        package:add("includedirs", "include")
        package:add("links", "SDL3_net")
        if package:is_plat("mingw", "windows") then
            package:add("syslinks", "ws2_32", "iphlpapi")
        end
    end)
package_end()

package("tinyexr-r2d")
    set_homepage("https://github.com/syoyo/tinyexr")
    set_description("TinyEXR 1.0.13 (header-only, pinned as in cmake/WorldEXR.cmake)")
    add_urls("https://github.com/syoyo/tinyexr/archive/refs/tags/v1.0.13.tar.gz")
    add_versions("v1.0.13", "01edf1e18e32e5503fdd2a35d62bb593109daa392324cec0157b150e5fd68077")
    on_install(function (package)
        local inc = path.join(package:installdir(), "include")
        os.mkdir(inc)
        os.cp("*.h", inc)
        os.cp("*.hh", inc)
    end)
    on_load(function (package)
        package:add("includedirs", "include")
    end)
package_end()

add_requires("libsdl3 3.4.16", {system = false})
add_requires("libsdl3_image", {system = false})
add_requires("sdl3_net-r2d 30dd38a", {system = false})
add_requires("libsdl3_mixer 3.2.4", {system = false})
if is_plat("macosx") then
    add_requires("libcurl", {system = false})
end
if is_plat("macosx") then
    add_requires("glslang", {system = false})
    add_requires("spirv-cross", {system = false})
end
add_requires("quickjs-ng v0.10.1", {system = false})
add_requires("box2d 3.1.1", {system = false})
add_requires("rmlui 6.3", {system = false})
add_requires("freetype", {system = false})
add_requires("zlib", {system = false})
add_requires("zstd", {system = false})
add_requires("stb", {system = false})
add_requires("tinyexr-r2d v1.0.13", {system = false})

target("russiano2d")
    set_kind("binary")
    add_files("src/*.c", "src/*.cpp")
    add_files("third_party/zlib/*.c")
    -- R2D_ENABLE_RE2D=0 / AUDIO=0 / LIVE_SHADERS=0 на этом этапе.
    remove_files("src/net_stub.c", "src/audio_stub.c", "src/gui_stub.c",
                 "src/sdk_launcher.c", "src/rmlui_wgsl.c")
    if is_plat("macosx") then
        remove_files("src/shader_live_stub.c")
    else
        remove_files("src/shader_live.cpp")
    end
    add_files("third_party/rmlui_backends/RmlUi_Platform_SDL.cpp",
              "third_party/rmlui_backends/RmlUi_Renderer_SDL_GPU.cpp")
    add_includedirs("src", "third_party/fastnoise_lite",
                    "third_party/zlib",
                    "third_party/visibility",
                    "third_party/rmlui_backends",
                    "build-xmake/generated", "build-xmake/generated/shaders")
    add_defines("R2D_VERSION_STRING=\"1.2.13\"",
                "R2D_ENABLE_HOTRELOAD=1",
                "R2D_ENABLE_RE2D=1",
                "R2D_ENABLE_AUDIO=1",
                "R2D_ENABLE_NET=1",
                "R2D_ENABLE_HTTP=1",
                "R2D_GLSLANG_FLAT_INCLUDES=1",
                "R2D_ENABLE_RMLUI=1",
                "R2D_ENABLE_ZSTD=1",
                "RMLUI_SDL_VERSION_MAJOR=3",
                "RMLUI_STATIC_LIB")
    add_packages("libsdl3", "libsdl3_image", "libsdl3_mixer", "sdl3_net-r2d", "quickjs-ng", "box2d", "rmlui",
                 "freetype", "zstd", "stb", "tinyexr-r2d")
    if is_plat("macosx") then
        add_packages("libcurl", "glslang", "spirv-cross")
        add_defines("R2D_HTTP_WITH_CURL=1", "R2D_ENABLE_LIVE_SHADERS=1")
        add_links("glslang-default-resource-limits")
    end
    if is_plat("mingw", "windows") then
        add_syslinks("ws2_32", "iphlpapi", "bcrypt")
    end
    before_build(function (target)
        os.execv("tools/xmake_generate.sh", {"build-xmake/generated"})
    end)

target("russiano2d-sdk")
    set_kind("binary")
    add_files("src/sdk_launcher.c")
    add_packages("libsdl3")

target("r2d-sdk")
    set_kind("binary")
    add_files("sdk/native/*.c")
    add_files("src/re2d_world.c", "src/re2d_world_region.c", "src/re2d_world_topology.c",
              "src/re2d_world_visibility.c", "src/re2d_world_hint.c", "src/re2d_world_bake.c",
              "src/re2d_world_semantic.c", "src/re2d_world_metadata.c", "src/re2d_world_polygon.c",
              "src/re2d_world_light.c", "src/re2d_world_material.c", "src/re2d_world_render_features.c",
              "src/re2d_math.c", "src/sprite_mesh.c", "src/bsp.c", "src/json.c")
    add_includedirs("sdk/native", "src")
    add_defines("R2D_SDK_VERSION=\"1.2.13\"")
    add_cflags("-include stdio.h -include ctype.h -include string.h -include stdlib.h")
    add_packages("libsdl3", "stb")
    if is_plat("mingw", "windows") then
        add_syslinks("ws2_32", "iphlpapi")
    end

if is_plat("macosx") then
    target("russiano2d-sdk-app")
        set_kind("phony")
        add_deps("russiano2d", "russiano2d-sdk", "r2d-sdk")
        after_build(function (target)
            local outdir = target:dep("russiano2d"):targetdir()
            local app = path.join(outdir, "Russiano2D SDK.app")
            os.execv("python3", {
                path.join(os.projectdir(), "tools/package_macos_sdk_app.py"),
                "--app", app,
                "--engine", target:dep("russiano2d"):targetfile(),
                "--launcher", target:dep("russiano2d-sdk"):targetfile(),
                "--backend", target:dep("r2d-sdk"):targetfile(),
                "--source-root", os.projectdir()
            })
        end)
end
