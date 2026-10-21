package("libsdl3_image")
    set_homepage("https://github.com/libsdl-org/SDL_image")
    set_description("Image decoding for many popular formats for Simple Directmedia Layer.")
    set_license("zlib")

    if is_plat("mingw") and is_subhost("msys") then
        add_extsources("pacman::sdl3-image")
    elseif is_plat("linux") then
        add_extsources("apt::libsdl3-image-dev")
    elseif is_plat("macosx") then
        add_extsources("brew::sdl3_image")
    end

    add_urls("https://www.libsdl.org/projects/SDL_image/release/SDL3_image-$(version).zip",
             "https://github.com/libsdl-org/SDL_image/releases/download/release-$(version)/SDL3_image-$(version).zip", { alias = "archive" })
    add_urls("https://github.com/libsdl-org/SDL_image.git", { alias = "github" })

    add_versions("archive:3.4.0", "158d89a217afc9869d85dcef58800ea90626fa0c96c588979055cb34f567bd7f")
    add_versions("archive:3.2.0", "144715a6afae430adc275fd3ab0e3e96177a2752cc10a49ca78511b1e665964e")

    add_versions("github:3.4.0", "release-3.4.0")
    add_versions("github:3.2.0", "release-3.2.0")

    if is_plat("macosx", "iphoneos") then
        add_frameworks("CoreFoundation", "CoreGraphics", "ImageIO", "CoreServices")
    end

    add_deps("cmake")

    on_load(function (package)
        package:add("deps", "libsdl3", { configs = { shared = package:config("shared") }})
    end)

    on_install(function (package)
        local configs = {
            "-DSDLIMAGE_SAMPLES=OFF", "-DSDLIMAGE_TESTS=OFF",
            "-DSDLIMAGE_VENDORED=OFF",
            "-DSDLIMAGE_PNG=ON", "-DSDLIMAGE_JPEG=ON",
            "-DSDLIMAGE_AVIF=OFF", "-DSDLIMAGE_JXL=OFF",
            "-DSDLIMAGE_TIF=OFF", "-DSDLIMAGE_WEBP=OFF",
        }
        table.insert(configs, "-DCMAKE_BUILD_TYPE=" .. (package:debug() and "Debug" or "Release"))
        table.insert(configs, "-DBUILD_SHARED_LIBS=" .. (package:config("shared") and "ON" or "OFF"))
        if package:is_plat("linux") and package:is_cross() then
            local globaldir = os.getenv("XMAKE_GLOBALDIR")
            local packageroot = globaldir and path.join(globaldir, ".xmake", "packages")
                or path.join(os.getenv("HOME"), ".xmake", "packages")
            table.insert(configs, "-DCMAKE_FIND_ROOT_PATH=" .. packageroot)
            table.insert(configs, "-DCMAKE_FIND_ROOT_PATH_MODE_PROGRAM=NEVER")
            table.insert(configs, "-DCMAKE_FIND_ROOT_PATH_MODE_LIBRARY=ONLY")
            table.insert(configs, "-DCMAKE_FIND_ROOT_PATH_MODE_INCLUDE=ONLY")
            table.insert(configs, "-DCMAKE_FIND_ROOT_PATH_MODE_PACKAGE=ONLY")
        end
        import("package.tools.cmake").install(package, configs, {packagedeps = {"libsdl3"}})
    end)

    on_test(function (package)
        assert(package:has_cfuncs("IMG_Version", {includes = "SDL3_image/SDL_image.h"}))
    end)
