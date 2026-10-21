-- ===========================================================================
-- Цели C-тестов (Unity). Нативные test targets управляются Xmake.
--
-- xmake test собирает и запускает каждую цель; set_default(false) держит
-- обычную сборку r2d быстрой. Рабочий каталог — корень репозитория,
-- поэтому относительные пути фикстур в тестах работают как раньше.
-- ===========================================================================

local test_root = os.projectdir()
local test_rooted = function(paths)
    local result = {}
    for _, p in ipairs(paths) do
        result[#result + 1] = path.join(test_root, p)
    end
    return result
end

local test_target = function(name, opt)
    target(name)
        set_kind("binary")
        set_default(false)
        add_files(test_rooted(opt.sources))
        add_files(path.join(test_root, "third_party/unity/unity.c"))
        add_includedirs(path.join(test_root, "src"), path.join(test_root, "third_party/unity"))
        if opt.includedirs then add_includedirs(test_rooted(opt.includedirs)) end
        if opt.packages then add_packages(opt.packages) end
        if opt.links then add_links(opt.links) end
        if opt.defines then add_defines(opt.defines) end
        add_tests(name, {rundir = os.projectdir(), runargs = opt.runargs})
        if opt.sanitize and not is_plat("windows", "mingw") then
            add_cxflags("-fsanitize=" .. opt.sanitize, "-fno-omit-frame-pointer", {force = true})
            add_ldflags("-fsanitize=" .. opt.sanitize, {force = true})
        end
        if is_plat("windows", "mingw") then
            add_syslinks("ws2_32", "iphlpapi", "bcrypt")
        end
end

test_target("r2d_json_test", {
    sources = {
        "tests/json/json_test.c",
        "src/json.c",
    },
    sanitize = "address",
})

test_target("r2d_slot_pool_test", {
    sources = {
        "tests/slot_pool/slot_pool_test.c",
        "src/r2d_slot_pool.c",
    },
    sanitize = "address,undefined",
})

test_target("r2d_crypto_test", {
    sources = {
        "tests/crypto/crypto_test.c",
        "src/crypto.c",
    },
    sanitize = "address,undefined",
})

test_target("r2d_payload_test", {
    sources = {
        "tests/payload/payload_test.c",
        "src/payload.c",
        "src/crypto.c",
    },
    packages = { "libsdl3" },
    sanitize = "address,undefined",
})

test_target("r2d_reverb_test", {
    sources = {
        "tests/audio/reverb_test.c",
        "src/audio_reverb.c",
    },
    packages = { "libsdl3" },
    sanitize = "address,undefined",
})

test_target("r2d_audio_fx_test", {
    sources = {
        "tests/audio/fx_test.c",
        "src/audio_fx.c",
        "src/audio_reverb.c",
    },
    packages = { "libsdl3" },
    sanitize = "address,undefined",
})

test_target("r2d_profile_test", {
    sources = {
        "tests/profile/profile_test.c",
        "src/profile.c",
    },
    packages = { "libsdl3" },
    sanitize = "address,undefined",
})

test_target("r2d_profile_fence_test", {
    sources = {
        "tests/re2d/r2d_profile_fence_test.c",
        "src/profile.c",
    },
    packages = { "libsdl3" },
    defines = { "R2D_PROFILE_TEST=1" },
    sanitize = "address,undefined",
})

test_target("r2d_atlas_prefetch_test", {
    sources = {
        "tests/re2d/atlas_prefetch_test.c",
        "src/re2d_world_atlas_prefetch.c",
    },
    packages = { "libsdl3" },
    defines = { "R2D_ATLAS_PREFETCH_MAX_ENTRIES=8", "R2D_ATLAS_PREFETCH_MAX_PENDING_BYTES=4096", "R2D_ATLAS_PREFETCH_MAX_FILE_BYTES=1024" },
    sanitize = "address,undefined",
})

test_target("r2d_bsp_test", {
    sources = {
        "tests/bsp/bsp_test.c",
        "src/bsp.c",
    },
    packages = { "libsdl3" },
    sanitize = "address,undefined",
})

test_target("r2d_re2d_test", {
    sources = {
        "tests/re2d/re2d_test.c",
        "src/re2d_math.c",
    },
    links = { "m" },
    sanitize = "address,undefined",
})

test_target("r2d_rotsprite_test", {
    sources = {
        "tests/rotsprite/rotsprite_test.c",
        "src/rotsprite_math.c",
    },
    links = { "m" },
    sanitize = "address,undefined",
})

test_target("r2d_re2d_world_test", {
    sources = {
        "tests/re2d/world_test.c",
        "src/re2d_world.c",
        "src/re2d_math.c",
        "src/re2d_world_topology.c",
        "src/re2d_world_visibility.c",
        "src/re2d_world_hint.c",
        "src/re2d_world_light.c",
        "src/re2d_world_material.c",
        "src/re2d_world_bake.c",
        "src/re2d_world_semantic.c",
        "src/re2d_world_metadata.c",
        "src/json.c",
        "src/bsp.c",
        "src/re2d_world_render_features.c",
    },
    packages = { "libsdl3" },
    links = { "m" },
    sanitize = "address,undefined",
})

test_target("r2d_portal_closure_test", {
    sources = {
        "tests/re2d/portal_closure_test.c",
        "src/re2d_world.c",
        "src/re2d_math.c",
        "src/re2d_world_topology.c",
        "src/re2d_world_visibility.c",
        "src/re2d_world_hint.c",
        "src/re2d_world_light.c",
        "src/re2d_world_material.c",
        "src/re2d_world_bake.c",
        "src/re2d_world_semantic.c",
        "src/re2d_world_metadata.c",
        "src/json.c",
        "src/bsp.c",
        "src/re2d_world_render_features.c",
    },
    packages = { "libsdl3" },
    links = { "m" },
    sanitize = "address,undefined",
})

test_target("r2d_world_batch_test", {
    sources = {
        "tests/re2d/batch_test.c",
        "src/re2d_world_batch.c",
        "src/re2d_world.c",
        "src/re2d_math.c",
        "src/re2d_world_topology.c",
        "src/re2d_world_visibility.c",
        "src/re2d_world_hint.c",
        "src/re2d_world_light.c",
        "src/re2d_world_material.c",
        "src/re2d_world_bake.c",
        "src/re2d_world_semantic.c",
        "src/re2d_world_metadata.c",
        "src/json.c",
        "src/bsp.c",
        "src/re2d_world_render_features.c",
    },
    packages = { "libsdl3" },
    links = { "m" },
    sanitize = "address,undefined",
})

test_target("r2d_re2d_atlas_test", {
    sources = {
        "tests/re2d/atlas_test.c",
        "src/re2d_world_atlas.c",
    },
    links = { "m" },
    sanitize = "address,undefined",
})

test_target("r2d_world_trace_test", {
    sources = {
        "tests/re2d/trace_test.c",
        "src/re2d_world_trace.c",
        "src/re2d_world.c",
        "src/re2d_math.c",
        "src/re2d_world_topology.c",
        "src/re2d_world_visibility.c",
        "src/re2d_world_hint.c",
        "src/re2d_world_light.c",
        "src/re2d_world_material.c",
        "src/re2d_world_bake.c",
        "src/re2d_world_semantic.c",
        "src/re2d_world_metadata.c",
        "src/json.c",
        "src/bsp.c",
        "src/re2d_world_render_features.c",
    },
    packages = { "libsdl3" },
    links = { "m" },
    sanitize = "address,undefined",
})

test_target("r2d_world_mover_test", {
    sources = {
        "tests/re2d/mover_test.c",
        "src/re2d_world_mover.c",
    },
    links = { "m" },
    sanitize = "address,undefined",
})

test_target("r2d_world_trigger_test", {
    sources = {
        "tests/re2d/trigger_test.c",
        "src/re2d_world_trigger.c",
    },
    links = { "m" },
    sanitize = "address,undefined",
})

test_target("r2d_world_controller_test", {
    sources = {
        "tests/re2d/controller_test.c",
        "src/re2d_world_controller.c",
        "src/re2d_world.c",
        "src/re2d_math.c",
        "src/re2d_world_topology.c",
        "src/re2d_world_visibility.c",
        "src/re2d_world_hint.c",
        "src/re2d_world_light.c",
        "src/re2d_world_material.c",
        "src/re2d_world_bake.c",
        "src/re2d_world_semantic.c",
        "src/re2d_world_metadata.c",
        "src/json.c",
        "src/bsp.c",
        "src/re2d_world_render_features.c",
    },
    packages = { "libsdl3" },
    links = { "m" },
    sanitize = "address,undefined",
})

test_target("r2d_re2d_semantic_test", {
    sources = {
        "tests/re2d/semantic_test.c",
        "src/re2d_world_semantic.c",
        "src/re2d_world_metadata.c",
        "src/re2d_world.c",
        "src/re2d_math.c",
        "src/re2d_world_topology.c",
        "src/re2d_world_visibility.c",
        "src/re2d_world_hint.c",
        "src/re2d_world_light.c",
        "src/re2d_world_material.c",
        "src/re2d_world_bake.c",
        "src/json.c",
        "src/bsp.c",
        "src/re2d_world_render_features.c",
    },
    packages = { "libsdl3" },
    links = { "m" },
    sanitize = "address,undefined",
})

test_target("r2d_re2d_portal_test", {
    sources = {
        "tests/re2d/portal_fraction_test.c",
        "src/re2d_world.c",
        "src/re2d_math.c",
        "src/re2d_world_topology.c",
        "src/re2d_world_visibility.c",
        "src/re2d_world_hint.c",
        "src/re2d_world_light.c",
        "src/re2d_world_material.c",
        "src/re2d_world_bake.c",
        "src/re2d_world_semantic.c",
        "src/re2d_world_metadata.c",
        "src/json.c",
        "src/bsp.c",
        "src/re2d_world_render_features.c",
    },
    packages = { "libsdl3" },
    links = { "m" },
    sanitize = "address,undefined",
})

test_target("r2d_world_metadata_test", {
    sources = {
        "tests/re2d/metadata_test.c",
        "src/re2d_world_metadata.c",
        "src/json.c",
    },
    sanitize = "address,undefined",
})

test_target("r2d_world_automap_test", {
    sources = {
        "tests/re2d/automap_test.c",
        "src/re2d_world_automap.c",
        "src/re2d_world.c",
        "src/re2d_math.c",
        "src/re2d_world_topology.c",
        "src/re2d_world_visibility.c",
        "src/re2d_world_hint.c",
        "src/re2d_world_light.c",
        "src/re2d_world_material.c",
        "src/re2d_world_bake.c",
        "src/re2d_world_semantic.c",
        "src/re2d_world_metadata.c",
        "src/json.c",
        "src/bsp.c",
        "src/re2d_world_render_features.c",
    },
    packages = { "libsdl3" },
    links = { "m" },
    sanitize = "address,undefined",
})

test_target("r2d_world_particle_test", {
    sources = {
        "tests/re2d/particle_test.c",
        "src/re2d_world_particle.c",
    },
    links = { "m" },
    sanitize = "address,undefined",
})

test_target("r2d_world_vfx_test", {
    sources = {
        "tests/re2d/vfx_test.c",
        "src/re2d_world_vfx.c",
        "src/re2d_world_particle.c",
        "src/json.c",
    },
    links = { "m" },
    sanitize = "address,undefined",
})

test_target("r2d_world_render_features_test", {
    sources = {
        "tests/re2d/render_features_test.c",
        "src/re2d_world_render_features.c",
    },
    links = { "m" },
    sanitize = "address,undefined",
})

test_target("r2d_world_nav_test", {
    sources = {
        "tests/re2d/nav_test.c",
        "src/re2d_world_nav.c",
        "src/re2d_world.c",
        "src/re2d_math.c",
        "src/re2d_world_topology.c",
        "src/re2d_world_visibility.c",
        "src/re2d_world_hint.c",
        "src/re2d_world_light.c",
        "src/re2d_world_material.c",
        "src/re2d_world_bake.c",
        "src/re2d_world_semantic.c",
        "src/re2d_world_metadata.c",
        "src/json.c",
        "src/bsp.c",
        "src/re2d_world_render_features.c",
    },
    packages = { "libsdl3" },
    links = { "m" },
    sanitize = "address,undefined",
})

test_target("r2d_world_secret_test", {
    sources = {
        "tests/re2d/secret_test.c",
        "src/re2d_world_secret.c",
    },
    links = { "m" },
    sanitize = "address,undefined",
})

test_target("r2d_world_terrain_test", {
    sources = {
        "tests/re2d/terrain_test.c",
        "src/re2d_world_terrain.c",
    },
    links = { "m" },
    sanitize = "address,undefined",
})

test_target("r2d_world_save_test", {
    sources = {
        "tests/re2d/save_test.c",
        "src/re2d_world_save.c",
        "src/json.c",
    },
    links = { "m" },
    sanitize = "address,undefined",
})

test_target("r2d_world_portal_visual_test", {
    sources = {
        "tests/re2d/portal_visual_test.c",
        "src/re2d_world_portal_visual.c",
    },
    links = { "m" },
    sanitize = "address,undefined",
})

test_target("r2d_world_volume_test", {
    sources = {
        "tests/re2d/volume_test.c",
        "src/re2d_world_volume.c",
    },
    links = { "m" },
    sanitize = "address,undefined",
})

test_target("r2d_world_material_anim_test", {
    sources = {
        "tests/re2d/material_anim_test.c",
        "src/re2d_world_material_anim.c",
    },
    links = { "m" },
    sanitize = "address,undefined",
})

test_target("r2d_world_polywall_test", {
    sources = {
        "tests/re2d/polywall_test.c",
        "src/re2d_world_polywall.c",
    },
    links = { "m" },
    sanitize = "address,undefined",
})

test_target("r2d_world_polygon_test", {
    sources = {
        "tests/re2d/polygon_test.c",
        "src/re2d_world_polygon.c",
    },
    links = { "m" },
    sanitize = "address,undefined",
})

test_target("r2d_world_stream_io_test", {
    sources = {
        "tests/re2d/stream_io_test.c",
        "src/re2d_world_stream_io.c",
    },
    links = { "m" },
    sanitize = "address,undefined",
})

test_target("r2d_world_region_test", {
    sources = {
        "tests/re2d/region_test.c",
        "src/re2d_world_region.c",
    },
    links = { "m" },
    sanitize = "address,undefined",
})

test_target("r2d_world_stream_test", {
    sources = {
        "tests/re2d/stream_test.c",
        "src/re2d_world_stream.c",
        "src/re2d_world_region.c",
    },
    links = { "m" },
    sanitize = "address,undefined",
})

test_target("r2d_world_stream_residency_test", {
    sources = {
        "tests/re2d/stream_residency_test.c",
        "src/re2d_world_stream.c",
    },
    links = { "m" },
    sanitize = "address,undefined",
})

test_target("r2d_world_atlas_tiled_test", {
    sources = {
        "tests/re2d/atlas_tiled_test.c",
        "src/re2d_world_atlas.c",
    },
    links = { "m" },
    sanitize = "address,undefined",
})

test_target("r2d_world_impostor_test", {
    sources = {
        "tests/re2d/impostor_test.c",
        "src/re2d_world_impostor.c",
        "src/re2d_world_region.c",
        "src/re2d_world.c",
        "src/re2d_math.c",
        "src/re2d_world_topology.c",
        "src/re2d_world_visibility.c",
        "src/re2d_world_hint.c",
        "src/re2d_world_light.c",
        "src/re2d_world_material.c",
        "src/re2d_world_bake.c",
        "src/re2d_world_semantic.c",
        "src/re2d_world_metadata.c",
        "src/json.c",
        "src/bsp.c",
        "src/re2d_world_render_features.c",
    },
    packages = { "libsdl3" },
    links = { "m" },
    sanitize = "address,undefined",
})

test_target("r2d_world_impostor_lod_policy_test", {
    sources = {
        "tests/re2d/impostor_lod_policy_test.c",
        "src/re2d_world_impostor.c",
        "src/re2d_world_region.c",
        "src/re2d_world.c",
        "src/re2d_math.c",
        "src/re2d_world_topology.c",
        "src/re2d_world_visibility.c",
        "src/re2d_world_hint.c",
        "src/re2d_world_light.c",
        "src/re2d_world_material.c",
        "src/re2d_world_bake.c",
        "src/re2d_world_semantic.c",
        "src/re2d_world_metadata.c",
        "src/json.c",
        "src/bsp.c",
        "src/re2d_world_render_features.c",
    },
    packages = { "libsdl3" },
    links = { "m" },
    sanitize = "address,undefined",
})

test_target("r2d_world_hierarchical_test", {
    sources = {
        "tests/re2d/hierarchical_visibility_test.c",
        "src/re2d_world_region.c",
        "src/re2d_world.c",
        "src/re2d_math.c",
        "src/re2d_world_topology.c",
        "src/re2d_world_visibility.c",
        "src/re2d_world_hint.c",
        "src/re2d_world_light.c",
        "src/re2d_world_material.c",
        "src/re2d_world_bake.c",
        "src/re2d_world_semantic.c",
        "src/re2d_world_metadata.c",
        "src/json.c",
        "src/bsp.c",
        "src/re2d_world_render_features.c",
    },
    packages = { "libsdl3" },
    links = { "m" },
    sanitize = "address,undefined",
})

test_target("r2d_sdk_brush_test", {
    includedirs = { "sdk/native" },
    sources = {
        "tests/re2d/brush_test.c",
        "sdk/native/sdk_brush.c",
        "src/re2d_world_polygon.c",
    },
    links = { "m" },
    sanitize = "address,undefined",
})

test_target("r2d_world_tools_test", {
    sources = {
        "tests/re2d/world_tools_test.c",
        "src/re2d_world.c",
        "src/re2d_math.c",
        "src/re2d_world_topology.c",
        "src/re2d_world_visibility.c",
        "src/re2d_world_hint.c",
        "src/re2d_world_light.c",
        "src/re2d_world_material.c",
        "src/re2d_world_bake.c",
        "src/re2d_world_semantic.c",
        "src/re2d_world_metadata.c",
        "src/json.c",
        "src/bsp.c",
        "src/re2d_world_render_features.c",
    },
    packages = { "libsdl3" },
    links = { "m" },
    sanitize = "address,undefined",
})

test_target("r2d_world_hint_test", {
    sources = {
        "tests/re2d/hint_cache_test.c",
        "src/re2d_world_hint.c",
        "src/re2d_world_region.c",
        "src/re2d_world.c",
        "src/re2d_math.c",
        "src/re2d_world_topology.c",
        "src/re2d_world_visibility.c",
        "src/re2d_world_light.c",
        "src/re2d_world_material.c",
        "src/re2d_world_bake.c",
        "src/re2d_world_semantic.c",
        "src/re2d_world_metadata.c",
        "src/json.c",
        "src/bsp.c",
        "src/re2d_world_render_features.c",
    },
    packages = { "libsdl3" },
    links = { "m" },
    sanitize = "address,undefined",
})

test_target("r2d_postprocess_test", {
    sources = {
        "tests/re2d/postprocess_test.c",
        "src/re2d_postprocess.c",
    },
    links = { "m" },
    sanitize = "address,undefined",
})

test_target("r2d_audio_zone_test", {
    sources = {
        "tests/re2d/audio_zone_test.c",
        "src/re2d_audio_zone.c",
    },
    links = { "m" },
    sanitize = "address,undefined",
})

test_target("r2d_audio_voices_test", {
    sources = {
        "tests/audio/voices_test.c",
        "src/re2d_audio_voices.c",
    },
    links = { "m" },
    sanitize = "address,undefined",
})

test_target("r2d_world_sky_test", {
    sources = {
        "tests/re2d/sky_test.c",
        "src/re2d_world_sky.c",
        "src/json.c",
    },
    links = { "m" },
    sanitize = "address,undefined",
})

test_target("r2d_world_sky_layers_test", {
    sources = {
        "tests/re2d/sky_layers_test.c",
        "src/re2d_world_sky.c",
        "src/json.c",
    },
    links = { "m" },
    sanitize = "address,undefined",
})

test_target("r2d_world_post_test", {
    sources = {
        "tests/re2d/render_post_test.c",
        "src/re2d_world_post.c",
    },
    links = { "m" },
    sanitize = "address,undefined",
})

test_target("r2d_world_render_p4_test", {
    sources = {
        "tests/re2d/render_p4_test.c",
        "src/re2d_world_render_features.c",
    },
    links = { "m" },
    sanitize = "address,undefined",
})

test_target("r2d_world_render_regression_test", {
    sources = {
        "tests/re2d/render_regression_test.c",
        "src/re2d_world_sky.c",
        "src/json.c",
        "src/re2d_world_post.c",
        "src/re2d_world_render_features.c",
    },
    links = { "m" },
    sanitize = "address,undefined",
})

test_target("r2d_world_decal2_test", {
    sources = {
        "tests/re2d/decal2_test.c",
        "src/re2d_world.c",
        "src/re2d_math.c",
        "src/re2d_world_topology.c",
        "src/re2d_world_visibility.c",
        "src/re2d_world_hint.c",
        "src/re2d_world_light.c",
        "src/re2d_world_material.c",
        "src/re2d_world_bake.c",
        "src/re2d_world_semantic.c",
        "src/re2d_world_metadata.c",
        "src/json.c",
        "src/bsp.c",
        "src/re2d_world_render_features.c",
    },
    packages = { "libsdl3" },
    links = { "m" },
    sanitize = "address,undefined",
})

test_target("r2d_world_debug_views_test", {
    sources = {
        "tests/re2d/debug_views_test.c",
        "src/re2d_world_debug_overlay.c",
        "src/re2d_world_render_features.c",
        "src/re2d_math.c",
    },
    links = { "m" },
    sanitize = "address,undefined",
})

test_target("r2d_world_exr_test", {
    sources = {
        "tests/re2d/exr_test.c",
        "src/re2d_world_exr.cpp",
    },
    packages = { "tinyexr-r2d", "zlib" },
    runargs = { "demos/re2d_dust2/sky.exr" },
    sanitize = "address,undefined",
})

test_target("r2d_async_backpressure_test", {
    sources = {
        "tests/async/backpressure_test.c",
        "src/async.c",
    },
    packages = { "libsdl3", "libsdl3_image" },
    defines = { "R2D_ASYNC_TEST=1" },
    sanitize = "address,undefined",
})

test_target("r2d_payload_lookup_test", {
    sources = {
        "tests/payload/lookup_bench_test.c",
        "src/payload.c",
        "src/crypto.c",
    },
    packages = { "libsdl3" },
    sanitize = "address,undefined",
})

test_target("r2d_audio_sound_registry_test", {
    sources = {
        "tests/audio/sound_registry_stress_test.c",
        "src/audio.c",
        "src/audio_fx.c",
        "src/audio_reverb.c",
    },
    packages = { "libsdl3", "libsdl3_mixer" },
    links = { "m" },
    sanitize = "address,undefined",
})

test_target("r2d_physics_stress_test", {
    sources = {
        "tests/physics/contact_stress_test.c",
        "src/physics.c",
        "src/r2d_slot_pool.c",
    },
    packages = { "libsdl3", "box2d" },
    links = { "m" },
    sanitize = "address,undefined",
})

test_target("r2d_re2d_scalability_test", {
    sources = {
        "tests/re2d/scalability_test.c",
        "src/re2d_world.c",
        "src/re2d_math.c",
        "src/re2d_world_topology.c",
        "src/re2d_world_visibility.c",
        "src/re2d_world_hint.c",
        "src/re2d_world_light.c",
        "src/re2d_world_material.c",
        "src/re2d_world_bake.c",
        "src/re2d_world_semantic.c",
        "src/re2d_world_metadata.c",
        "src/re2d_world_render_features.c",
        "src/json.c",
        "src/bsp.c",
    },
    packages = { "libsdl3" },
    links = { "m" },
    sanitize = "address,undefined",
})

test_target("r2d_fs_atomic_test", {
    sources = {
        "tests/fs/atomic_write_test.c",
        "src/fs_util.c",
    },
    sanitize = "address,undefined",
})

test_target("r2d_replay_checkpoint_test", {
    sources = {
        "tests/replay/replay_checkpoint_test.c",
        "src/replay.c",
        "src/json.c",
    },
    packages = { "libsdl3" },
    sanitize = "address,undefined",
})

-- JS-наборы: один phony-тест, который запускает qjs из пакета quickjs-ng.
-- xmake test вызывает on_test, поэтому отдельный qjs-бинарник не нужен.
target("js_tests")
    set_kind("phony")
    set_default(false)
    add_packages("quickjs-ng")
    add_tests("js", {rundir = test_root})
    on_test(function (target)
        local pkg = target:pkg("quickjs-ng")
        if not pkg then
            raise("js_tests: нет пакета quickjs-ng")
        end
        local qjs = path.join(pkg:installdir(), "bin", is_host("windows") and "qjs.exe" or "qjs")
        if not os.isfile(qjs) then
            raise("js_tests: не найден %s", qjs)
        end
        local files = os.files(path.join(test_root, "tests/js/*_test.mjs"))
        table.sort(files)
        if #files == 0 then
            raise("js_tests: нет tests/js/*_test.mjs")
        end
        local failed = {}
        for _, file in ipairs(files) do
            local ok = os.execv(qjs, {file}, {try = true, curdir = test_root})
            if ok ~= 0 then
                table.insert(failed, file)
                print("FAILED %s", file)
            end
        end
        if #failed > 0 then
            print("js_tests: упало %d из %d наборов", #failed, #files)
            return false
        end
        print("js_tests: %d набор(ов) прошли", #files)
        return true
    end)
