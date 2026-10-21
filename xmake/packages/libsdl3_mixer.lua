package("libsdl3_mixer")
    set_homepage("https://github.com/libsdl-org/SDL_mixer")
    set_description("SDL3_mixer built against the pinned project SDL3 package")
    set_license("zlib")
    add_urls("https://www.libsdl.org/projects/SDL_mixer/release/SDL3_mixer-$(version).zip")
    add_versions("3.2.4", "bbf0173861d5ee66555605435d4f423261d228649cb03dcb6cf3d24063683625")
    add_deps("cmake", "libsdl3")
    on_load(function (package)
        package:add("deps", "libsdl3", {configs = {shared = package:config("shared")}})
        package:add("includedirs", "include")
        package:add("links", "SDL3_mixer")
    end)
    on_install(function (package)
        local configs = {
            "-DSDLMIXER_TESTS=OFF",
            "-DSDLMIXER_EXAMPLES=OFF",
            "-DSDLMIXER_VENDORED=OFF",
            "-DBUILD_SHARED_LIBS=" .. (package:config("shared") and "ON" or "OFF"),
        }
        import("package.tools.cmake").install(package, configs, {packagedeps = {"libsdl3"}})
    end)
package_end()
