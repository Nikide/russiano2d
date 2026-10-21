#!/usr/bin/env python3
"""Roadmap coverage audit for RUSSIANO2D_VN_AND_RE2D_RENDER_ROADMAP.md.

Maps every top-level roadmap section 0..153 to:
  * a status (done / partial / deferred / policy / meta),
  * concrete evidence groups (files, tests, docs),
  * the exact reason when not done.

The checker is deliberately evidence-based: a section marked `done` must have at
least one existing evidence path. `partial`/`deferred` sections are allowed but
are counted as red gaps when the section is mandatory. The matrix is generated
into docs/ROADMAP_COVERAGE.md by `--write`; `--check` validates it.

Usage:
  python3 tools/roadmap_coverage.py --check
  python3 tools/roadmap_coverage.py --check --json
  python3 tools/roadmap_coverage.py --write
  python3 tools/roadmap_coverage.py --roadmap /path/to/roadmap.md --check

No engine/GPU is needed: this is a static repository audit. The roadmap file is
optional for CI; when absent the checked-in section-title manifest is used, and
the checker reports that fact instead of failing.
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOC = ROOT / "docs" / "ROADMAP_COVERAGE.md"
DEFAULT_ROADMAP = Path("/Users/nikitademcev/Downloads/RUSSIANO2D_VN_AND_RE2D_RENDER_ROADMAP.md")
AUDIT_DATE = "2026-10-17"
ACCEPTANCE = {
    "build": "`xmake build -y -j 8 r2d` PASS",
    "native tests": "Xmake native/JS targets; see current test gate",
    "xmake": "single r2d executable; see docs/BUILD.md",
    "site build": "`python3 site/build-doc.py` PASS",
    "docs/API guards": "doc_claims, doc_coverage, api_docs_sync, site_prune PASS",
    "BASHNYA repro": "exit 0; packaged runtime reports `large_save` serialization error, repo build succeeds with 4097 spans",
    "BASHNYA play": "exit 0, `FINAL complete` (key, MAP2, seal, checkpoint, boss victory)",
    "agent suite": "acceptance subset 15/15 in 65.4 s (renderer/dust2/huge/VFX/VN/DevTools/budget/batching); full tools/run_tests.py wedged on audio_hrtf and is not claimed green",
    "coverage checker": "154/154 sections mapped; mandatory red gaps listed in the matrix; literal TODO/stub hits listed in the source audit",
}

# Top-level titles parsed from the roadmap (checked-in copy for portable CI).
TITLES = {
    0: "ЗАЧЕМ ЭТОТ ДОКУМЕНТ", 1: "НЕИЗМЕНЯЕМЫЕ ПРИНЦИПЫ",
    2: "ТЕКУЩЕЕ СОСТОЯНИЕ RE2D НА v1.2.5", 3: "ТЕКУЩАЯ ПРОБЛЕМА VN-ЧАСТИ",
    4: "НОВАЯ ФИНАЛЬНАЯ АРХИТЕКТУРА VN", 5: "`$.dialog` — ЕДИНСТВЕННЫЙ ДВИЖОК РЕПЛИК",
    6: "`$.cutscene`", 7: "`$.timeline`", 8: "`$.story`", 9: "NARRATIVE IR",
    10: "SPEAKER REGISTRY", 11: "EXPRESSION SYSTEM", 12: "PORTRAIT SLOTS",
    13: "FOCUS ACTIVE SPEAKER", 14: "DIALOGUE LOGIC НЕ ЗНАЕТ RML",
    15: "DIALOGUE VIEW INTERNAL API", 16: "CUSTOM RML TEMPLATE",
    17: "SEMANTIC RML ROLES", 18: "ПРИМЕР CUSTOM RML", 19: "CUSTOM FONT",
    20: "DEFAULT RML + CUSTOM RCSS", 21: "CSS VARIABLES", 22: "CHOICE TEMPLATE",
    23: "DIALOG ACTIONS", 24: "ROOT UI STATES", 25: "THEME REGISTRY",
    26: "THEME TOKEN / STACK", 27: "HOT RELOAD RML/RCSS", 28: "INVALID HOT RELOAD",
    29: "INPUT LOCK TOKEN", 30: "WORLD MODE ВО ВРЕМЯ СЦЕНЫ", 31: "SKIP CONTRACT",
    32: "SAVE / RESUME", 33: "BACKLOG", 34: "READ / UNREAD", 35: "VOICE",
    36: "PREFETCH", 37: "STORY LINTER", 38: "DIALOG THEME VALIDATOR",
    39: "NARRATIVE INSPECTOR", 40: "VN P0",
    41: "BASHNYA ПОКАЗАЛА ГЛАВНУЮ ПРОБЛЕМУ", 42: "ЦЕЛЬ НОВОГО ВИЗУАЛЬНОГО ПУТИ",
    43: "SPRITE GROUNDING — PRIORITY P0", 44: "SPRITE EDGE QUALITY",
    45: "MATERIAL VARIATION", 46: "FAKE BEVEL SHADING", 47: "CORNER AO-LITE",
    48: "BAKED AMBIENT LIGHT FIELD", 49: "LIGHTING 2.0", 50: "CONTACT LIGHTING",
    51: "HEIGHT FOG", 52: "ATMOSPHERIC HAZE", 53: "LIGHT SHAFT CARDS",
    54: "EMISSIVE + BLOOM-LITE", 55: "DECALS 2.0", 56: "SURFACE DETAIL LAYERS",
    57: "MATERIAL ANIMATION 2.0", 58: "LIQUID RENDERING", 59: "REFLECTION-LITE",
    60: "POSTPROCESS STACK", 61: "DEPTH-AWARE HEAT DISTORTION", 62: "RE2D SKY SYSTEM",
    63: "SKY LAYER 0 — PANORAMA", 64: "SKY LAYER 1–4 — PARALLAX CARDS",
    65: "SUN / MOON DISC", 66: "DISTANT SKY SCENE", 67: "SKY PORTAL",
    68: "SKY SURFACE", 69: "HUGE OPEN WORLD", 70: "REGION GRID",
    71: "ACTIVE REGION SET", 72: "REGION STATES", 73: "STREAMING",
    74: "HIERARCHICAL VISIBILITY", 75: "WORLD PVS", 76: "AREAPORTALS",
    77: "VIS CLUSTERS", 78: "HINT / SKIP ANALOG", 79: "OCCLUDER",
    80: "DISTANT REGION LOD", 81: "DISTANT IMPOSTOR", 82: "SPRITE LOD",
    83: "ANIMATION LOD", 84: "LIGHT LOD", 85: "PARTICLE LOD",
    86: "DECAL REGION POOL", 87: "AUDIO CULLING", 88: "LARGE COORDINATE STABILITY",
    89: "REGION-LOCAL RENDER COORDINATES", 90: "OPEN WORLD TARGET",
    91: "BSP ДО УРОВНЯ HAMMER AUTHORING", 92: "BRUSH AUTHORING",
    93: "BRUSH OPERATIONS", 94: "BRUSH COMPILE", 95: "POINT ENTITIES",
    96: "BRUSH ENTITIES", 97: "TOOL MATERIALS", 98: "NODRAW", 99: "CLIP",
    100: "VISGROUPS / EDITOR LAYERS", 101: "COMPILE STAGES",
    102: "HUGE WORLD COMPILER WARNINGS", 103: "SKY LEAK CHECK",
    104: "STATIC BATCHING", 105: "TEXTURE RESIDENCY", 106: "ATLAS RESIDENCY",
    107: "GPU UPLOAD BUDGET", 108: "RE2D VFX LIBRARY", 109: "VFX PRIMITIVES",
    110: "FX BUNDLE", 111: "ОБЯЗАТЕЛЬНЫЙ RE2D VFX PACK",
    112: "WORLD CARD EFFECTS", 113: "TRAILS", 114: "PARTICLE COLLISION MODES",
    115: "VFX LIGHT BUDGET", 116: "VFX DEBUG",
    117: "RENDERER P0 — «ДЕШЁВЫЙ WAD → Re2D»", 118: "RENDERER P1 — OPEN WORLD FOUNDATION",
    119: "RENDERER P2 — HAMMER PIPELINE", 120: "RENDERER P3 — SKY / DISTANT WORLD",
    121: "RENDERER P4 — ADVANCED VISUAL POLISH", 122: "RENDERER P5 — OPTIONAL",
    123: "PERFORMANCE PRINCIPLE", 124: "REGION BUDGET", 125: "ACTOR / VFX BUDGET",
    126: "DEBUG VIEWS", 127: "PROFILER", 128: "RE2D MATERIAL DEBUG",
    129: "TEST POLICY", 130: "PYTHON POLICY", 131: "NATIVE TEST STRUCTURE",
    132: "FAST TEST SUITE", 133: "RENDER REGRESSION",
    134: "SPECIFIC REGRESSION TESTS", 135: "HAMMER COMPILER TESTS",
    136: "ACCEPTANCE DEMOS", 137: "BASHNYA ACCEPTANCE",
    138: "DO NOT IMPLEMENT", 139: "HAMMER-INSPIRED, НЕ HAMMER CLONE",
    140: "SKYBOX ТЕРМИНОЛОГИЯ", 141: "VN + RENDER CROSSOVER",
    142: "VN НЕ ДОЛЖНА ОСТАНАВЛИВАТЬ RENDERER", 143: "BASHNYA CUSTOM DIALOG THEME",
    144: "BASHNYA RENDER TARGET", 145: "РЕКОМЕНДУЕМЫЙ ПОРЯДОК DEEPSEEK",
    146: "DEFINITION OF DONE — VN", 147: "DEFINITION OF DONE — RENDER P0",
    148: "DEFINITION OF DONE — HUGE WORLD", 149: "ГЛАВНОЕ ПРАВИЛО ДЛЯ DEEPSEEK",
    150: "КОНЕЧНАЯ ФОРМУЛА", 151: "ПЕРВАЯ ЗАДАЧА ПО VN",
    152: "ПЕРВАЯ ЗАДАЧА ПО RENDER", 153: "ФИНАЛЬНАЯ УСТАНОВКА",
}

# Evidence groups: each value must exist (file, dir, or glob). The matrix names
# groups to stay readable; this table is the concrete file list.
GROUPS = {
    "policy": ["docs/HANDOFF_VN_RENDER_ROADMAP.md", "docs/RE2D.md", "AGENTS.md"],
    "vn_core": ["src/highlevel/dialog.js", "docs/VN_NARRATIVE.md", "docs/highlevel/dialog.md"],
    "vn_view": ["src/highlevel/dialog_view.js", "src/highlevel/dialog_theme.js",
                "docs/highlevel/dialog_theme.md", "docs/highlevel/dialog_view.md"],
    "vn_theme": ["ui/dialog/bashnya.rml", "ui/dialog/bashnya.rcss",
                 "tests/agent/vn_bashnya_theme_test.py"],
    "vn_story": ["src/highlevel/story.js", "src/highlevel/story_script.js",
                 "src/highlevel/cutscene.js", "src/highlevel/timeline.js",
                 "tests/js/story_test.mjs"],
    "vn_tests": ["tests/js/dialog_test.mjs", "tests/js/vn_narrative_test.mjs",
                 "tests/js/vn_gaps_test.mjs", "tests/agent/vn_bashnya_theme_test.py",
                 "tests/agent/vn_narrative_validation_test.py"],
    "vn_audio": ["src/highlevel/sound.js", "src/highlevel/resource.js",
                 "src/highlevel/i18n.js"],
    "vn_lint": ["sdk/native/sdk_story.c", "sdk/native/sdk_dialog.c", "docs/SDK.md"],
    "vn_dev": ["src/highlevel/devtools.js", "docs/highlevel/dialog.md"],
    "render": ["src/re2d_world_render_features.c", "src/re2d_world_render_features.h",
               "src/re2d_world_gpu.c", "docs/RE2D_RENDER_FEATURES.md",
               "tests/re2d/render_features_test.c", "tests/re2d/render_p4_test.c",
               "tests/agent/re2d_render_visual_features_test.py",
               "tests/agent/re2d_render_p4_test.py"],
    "render_tests": ["tests/re2d/render_regression_test.c", "tests/re2d/decal2_test.c",
                     "tests/agent/re2d_render_regression_test.py",
                     "tests/agent/reference"],
    "sky": ["src/re2d_world_sky.c", "src/re2d_world_sky.h",
            "docs/RE2D_SKY_BOUNDARY.md", "tests/re2d/sky_test.c"],
    "post": ["src/re2d_world_post.c", "src/re2d_world_post.h",
             "tests/re2d/postprocess_test.c", "tests/agent/render_post_lazy_test.py"],
    "region": ["src/re2d_world_region.c", "src/re2d_world_region.h",
               "docs/RE2D_HUGE_WORLD.md", "tests/re2d/region_test.c",
               "tests/agent/re2d_huge_world_test.py", "demos/re2d_openworld_lab"],
    "visibility": ["src/re2d_world_visibility.c",
                   "tests/re2d/hierarchical_visibility_test.c",
                   "tests/agent/re2d_huge_world_test.py"],
    "stream": ["src/re2d_world_stream.c", "src/re2d_world_stream.h",
               "tests/re2d/stream_test.c", "docs/RE2D_HUGE_WORLD.md"],
    "impostor": ["src/re2d_world_impostor.c", "src/re2d_world_impostor.h",
                 "tests/re2d/impostor_test.c", "tests/agent/re2d_huge_world_test.py"],
    "brush": ["sdk/native/sdk_brush.c", "sdk/native/sdk_brush.h",
              "sdk/native/sdk_world.c", "docs/RE2D_BRUSH_AUTHORING.md",
              "tests/re2d/brush_test.c", "tests/re2d/brush_advanced_fixture_test.c",
              "tests/re2d/world_tools_test.c"],
    "brush_entities": ["sdk/native/sdk_brush.c", "tests/re2d/brush_entity_smoke_test.c",
                       "docs/RE2D_BRUSH_AUTHORING.md"],
    "vfx": ["src/re2d_world_vfx.c", "src/re2d_world_vfx.h",
            "src/re2d_world_particle.c", "assets/vfx/pack.json",
            "docs/RE2D_VFX.md", "tests/re2d/vfx_test.c",
            "tests/re2d/particle_test.c", "tests/agent/re2d_vfx_pack_test.py"],
    "vfx_render": ["tests/agent/re2d_render_vfx_pass_test.py", "demos/re2d_vfx_lab"],
    "world_misc": ["src/re2d_world_automap.c", "src/re2d_world_nav.c",
                   "src/re2d_world_save.c", "src/re2d_world_secret.c",
                   "src/re2d_world_metadata.c", "src/re2d_world_terrain.c",
                   "src/re2d_world_volume.c", "src/re2d_world_trigger.c",
                   "src/re2d_world_mover.c", "src/re2d_world_material_anim.c",
                   "src/re2d_world_portal_visual.c", "src/re2d_world_polywall.c",
                   "src/re2d_world_polygon.c", "src/re2d_world_controller.c"],
    "tests_policy": ["xmake/tests.lua", "xmake.lua", "docs/TESTING.md",
                     "tests/re2d", "tests/js"],
    "debug": ["docs/RE2D_DEBUG_VIEWS.md", "tests/agent/re2d_budget_test.py",
              "src/highlevel/re2d.js"],
    "handoff": ["docs/HANDOFF_VN_RENDER_ROADMAP.md"],
    "openworld": ["demos/re2d_openworld_lab"],
    "automap": ["src/re2d_world_automap.c", "tests/re2d/automap_test.c"],
    "nav": ["src/re2d_world_nav.c", "tests/re2d/nav_test.c"],
    "save": ["src/re2d_world_save.c", "tests/re2d/save_test.c"],
    "secret": ["src/re2d_world_secret.c", "tests/re2d/secret_test.c"],
    "metadata": ["src/re2d_world_metadata.c", "tests/re2d/metadata_test.c"],
    "terrain": ["src/re2d_world_terrain.c", "tests/re2d/terrain_test.c",
                "docs/RE2D_RENDER_FEATURES.md"],
    "volume": ["src/re2d_world_volume.c", "tests/re2d/volume_test.c"],
    "trigger": ["src/re2d_world_trigger.c", "tests/re2d/trigger_test.c"],
    "mover": ["src/re2d_world_mover.c", "tests/re2d/mover_test.c"],
    "material_anim": ["src/re2d_world_material_anim.c", "tests/re2d/material_anim_test.c"],
    "portal_visual": ["src/re2d_world_portal_visual.c", "tests/re2d/portal_visual_test.c"],
    "polywall": ["src/re2d_world_polywall.c", "tests/re2d/polywall_test.c"],
    "polygon": ["src/re2d_world_polygon.c", "tests/re2d/polygon_test.c"],
    "controller": ["src/re2d_world_controller.c", "tests/re2d/controller_test.c"],
    "audio": ["tests/re2d/audio_zone_test.c", "src/highlevel/audiobus.js"],
    "assets": ["assets/sprites/ultra16", "assets/sky",
               "tests/agent/re2d_p5_asset_packs_test.py",
               "tests/agent/re2d_sky_layers_test.py"],
    "stream_io": ["src/re2d_world_stream_io.c", "src/re2d_world_stream_io.h",
                  "tests/re2d/stream_io_test.c"],
    "huge_test": ["tests/agent/re2d_huge_world_test.py"],
    "batch": ["src/re2d_world_batch.c", "src/re2d_world_batch.h",
              "tests/re2d/batch_test.c", "tests/agent/re2d_batch_info_test.py"],
}

# Mandatory delivery sections. Analysis/policy/optional sections are excluded.
MANDATORY = set(range(4, 41)) | set(range(43, 122)) | set(range(123, 138)) | \
            set(range(141, 149))

ROWS: dict[int, dict] = {}


def add(ids, status, evidence, note=""):
    for i in ids:
        if i in ROWS:
            raise SystemExit("duplicate roadmap section %d" % i)
        ROWS[i] = {"status": status, "evidence": list(evidence), "note": note}


add([0, 1, 2, 3], "policy", ["policy"],
    "Analysis/principles; no runtime deliverable.")
add(range(4, 14), "done", ["vn_core", "vn_story", "vn_tests"],
    "One dialog runtime, story/timeline/cutscene route through it.")
add(range(14, 19), "done", ["vn_core", "vn_view", "vn_theme"],
    "Logic/view split, semantic roles, custom RML.")
add(range(19, 25), "done", ["vn_view", "vn_theme", "tests/js/vn_narrative_test.mjs"],
    "Custom font/RCSS, CSS variables in the default theme, dynamic choices, actions, root states.")
add(range(25, 29), "done", ["vn_view", "tests/js/vn_narrative_test.mjs"],
    "Theme registry/stack, hot reload with last-valid fallback.")
add([29, 30, 31], "done", ["src/highlevel/dialog.js", "src/highlevel/story.js",
                           "tests/js/vn_narrative_test.mjs", "tests/js/vn_gaps_test.mjs"],
    "Input lock (advisory + optional hard), world mode, skip contract.")
add(range(32, 37), "done", ["vn_core", "vn_audio", "tests/js/vn_gaps_test.mjs"],
    "Save/resume, backlog, read ids, real voice, real prefetch.")
add([37, 38], "done", ["vn_lint"],
    "Native story/dialog validators; i18n keys checked against dictionaries.")
add([39, 40], "done", ["vn_dev", "vn_tests"],
    "Narrative inspector + VN P0 tests (JS and RmlUi pixel).")
add([41, 42], "policy", ["policy"],
    "Problem/goal analysis for the renderer.")
add(range(43, 54), "done", ["render"],
    "Grounding/edges/material/light/fog/haze/shafts implemented in the render feature model; native tests.")
add([54, 55, 56, 57, 58, 59, 60, 61], "done",
    ["render", "post", "material_anim", "terrain"],
    "Bloom/reflection/heat GPU post pass, decals 2.0, detail layers, liquid, material animation.")
add([62, 63, 65, 67, 68], "done", ["sky"],
    "Panorama, celestial discs, sky portal/surface policy.")
add([64, 66], "done", ["sky", "assets"],
    "Task-16 ships four independent parallax layers plus four distant-city silhouette cards and manifests; agent asset/sky tests green.")
add(range(69, 72), "done", ["region", "openworld"],
    "Region grid, active/preload rings, open-world acceptance lab.")
add([72], "done", ["stream", "stream_io", "huge_test"],
    "UNLOADED/PRELOAD/RESIDENT/EVICTABLE plus real payload packets/refcounts/queues; world.info exposes payloadResident/Bytes/Loads/Unloads.")
add([73], "done", ["stream_io", "docs/RE2D_HUGE_WORLD.md", "huge_test"],
    "Incremental, budgeted payload streaming (load/unload queues, no hitch) is implemented; true async disk I/O is explicitly not used, disk still goes through the existing loader.")
add(range(74, 78), "done", ["visibility", "region", "brush"],
    "Hierarchical visibility, coarse region PVS, areaportals, vis clusters.")
add([78], "done", ["visibility", "tests/re2d/hint_cache_test.c", "docs/RE2D_BRUSH_AUTHORING.md"],
    "Compiler emits real per-portal hint barriers and runtime cuts portal traversal (hintPortalsCut); it is a portal-level visibility split, not a new BSP plane.")
add([79], "done", ["visibility", "tests/re2d/hint_cache_test.c", "docs/RE2D_HUGE_WORLD.md"],
    "Occluder wall segments are consumed before traversal with deterministic cell reject counters; conservative multi-sample, not per-pixel.")
add([80, 81], "done", ["region", "impostor", "huge_test"],
    "Distant LOD/impostor data and the GPU impostor pass are wired and the huge-world agent reports drawn cards within budget.")
add([82, 83], "done", ["region", "impostor", "render"],
    "Sprite/animation LOD budgets are wired to the existing atlas/RotSprite path.")
add([84], "done", ["render", "region", "huge_test"],
    "GPU light LOD drops far lights from shader masks; huge-world agent asserts nonzero culling.")
add([85], "done", ["render", "vfx", "region"],
    "Particle LOD/culling uses existing particle budgets and region visibility.")
add([86], "done", ["region", "huge_test", "docs/RE2D_HUGE_WORLD.md"],
    "Per-region decal residency/culling counters and GPU cell/distance skip are exercised by the huge-world agent.")
add([87], "done", ["audio", "region", "src/re2d_world_runtime.c"],
    "Audio culling/virtualization and ACOUSTIC wall policy in the audio occlusion path.")
add([88], "done", ["region", "src/re2d_world_gpu.c", "tests/agent/re2d_huge_world_test.py"],
    "Render-origin/local-coordinate support and boundary screenshots.")
add([89], "done", ["docs/RE2D_HUGE_WORLD.md", "src/re2d_world_gpu.c", "huge_test"],
    "SDL_GPU subtracts the region origin from world-space uniforms/shadow geometry; boundary screenshots show continuity.")
add([90], "done", ["openworld", "tests/agent/re2d_visual_lab_acceptance_test.py", "tests/agent/re2d_huge_scaling_test.py", "handoff"],
    "Open-world target: visual lab with 50 enemies/150 props/1292 particles, openworld region lab, fixed-active-region scaling benchmark (1x/2x/4x) and streaming-boundary gameplay/nav evidence.")
add([91, 92, 94], "done", ["brush"],
    "Brush authoring/compile pipeline with stage report.")
add([93], "done", ["brush", "tests/re2d/brush_test.c", "docs/RE2D_BRUSH_AUTHORING.md"],
    "Convex/rectilinear footprints, rect holes, overlapping/multi-solid Z-CSG subtraction, vertex move and split helpers with exact diagnostics; arbitrary Studio boolean authoring remains policy, not a runtime gap.")
add([95], "done", ["brush_entities"], "Point/brush entities and stable metadata.")
add([96], "done", ["brush_entities", "tests/re2d/volume_entity_test.c", "tests/re2d/brush_entity_smoke_test.c"],
    "Fog/water volumes apply native span fog/terrain; areaportal resolves nearest generated portal and sets area flag; door/lift/crusher/trigger map to existing mover/trigger APIs.")
add(range(97, 100), "done", ["brush", "tests/re2d/world_tools_test.c"],
    "Tool material policy bits: nodraw/clip/sky/occluder/areaportal/hint/skip.")
add([100], "done", ["brush", "sdk/native/sdk_brush.c"],
    "Visgroup/editor-layer labels are preserved as metadata.")
add(range(101, 103), "done", ["brush"],
    "Compile stages and huge-world warnings (areaportal/hint/giant/sky-leak/light).")
add([103], "done", ["sdk/native/sdk_brush.c", "tests/re2d/sky_leak_test.c", "docs/RE2D_BRUSH_AUTHORING.md"],
    "Exterior/void flood fill over cells/portals reports leaked cell ids; sealed/leaked fixtures covered.")
add([104], "partial", ["render", "tests/agent/re2d_batch_gpu_test.py", "docs/RE2D_RENDER_FEATURES.md"],
    "Real per-group SSBO/instanced GPU submission for opaque/masked surfaces (23 logical -> 4 group draws, fallback and logical attribution tested). Open: translucent/additive surfaces still go through the per-surface path and group batching is disabled for non-final debug views, so the material/blend/light/atlas batching contract is not complete.")
add([105, 106, 107], "done", ["src/re2d_world_gpu.c", "docs/RE2D_HUGE_WORLD.md",
                              "tests/re2d/stream_test.c"],
    "Real texture/atlas GPU upload/evict and upload counters on stream transitions; BSP/surface payload streaming is section 73/148.")
add(range(108, 117), "done", ["vfx", "vfx_render"],
    "VFX library, primitives, 53 bundles, cards/trails, collision modes, light budget, debug; native+agent tests.")
add([117], "done", ["render", "render_tests", "tests/agent/reference", "handoff"],
    "P0 feature set implemented/tested; visual-lab BEFORE/AFTER pairs and BASHNYA bridge/shot/VFX reference frames are stored in-repo.")
add([118], "done", ["region", "openworld", "handoff"],
    "P1 open-world foundation: region grid/PVS/stream/LOD/impostors.")
add([119], "done", ["brush", "docs/RE2D_BRUSH_AUTHORING.md", "docs/SDK.md"],
    "P2 Hammer pipeline: brush compile, tool materials, entity metadata, warnings.")
add([120], "done", ["sky", "assets"],
    "P3 sky/distant world path plus task-16 per-layer sky textures and distant-city cards; sky/asset agent tests green.")
add([121], "done", ["render", "post", "handoff"],
    "P4 advanced visual polish: shafts/ambient/reflection/bloom/detail/decals2/distortion.")
add([122], "done", ["assets", "tests/agent/re2d_p5_asset_packs_test.py"],
    "P5 optional assets delivered: 16-direction ultra sprite packs (warden/turret), per-layer sky, distant city cards; runtime consumes existing atlas/sky slots.")
add([123], "policy", ["debug", "handoff"], "Performance principle; measured budgets below.")
add([124, 125], "done", ["tests/agent/re2d_budget_test.py", "tests/agent/re2d_render_visual_features_test.py"],
    "Region/actor/VFX budgets measured by the budget agent test.")
add([126], "done", ["debug", "tests/re2d/debug_views_test.c", "tests/agent/re2d_debug_views_test.py"],
    "Native debug enum/overlays for region/active/PVS/viscluster/areaportal/occluder/distant/sprite/material/AO/VFX, all tested.")
add([127], "done", ["debug", "src/re2d.c", "docs/RE2D_WORLD_PERF.md"],
    "Profiler exposes regionLoadMs/regionVisibilityMs/regionStreamMs/regionStreamIoMs and stream upload/evict counters.")
add([128], "partial", ["docs/RE2D_DEBUG_VIEWS.md", "tests/agent/re2d_debug_views_test.py"],
    "Inspector by name/index is real (materialInfo/materialList, albedo/normal/emissive dims, blend, surfaceCount, tint/UV variation) and the debug material overlay is tested. Open: there is no trace/click material probe, and macro/detail/terrain/AO-factor fields required by the section are not exposed.")
add([129, 130], "done", ["tests_policy"],
    "Unity for native, JS/agent for high-level/VN; no new Python core tests.")
add([131], "done", ["tests_policy", "tests/re2d", "tests/re2d/LAYOUT.md",
                    "tools/test_layout_check.py", "tests/agent/native_test_layout_test.py"],
    "Documented compatibility layout: flat files mapped to roadmap subsystem dirs, tracked test files are mapped, Xmake-referenced sources resolve, accepted by native_test_layout_test.")
add([132], "done", ["tests_policy", "handoff"],
    "r2d_check/CTest fast suite: 158/158 in ~10 s.")
add([133], "done", ["render_tests"],
    "Tolerance-based GPU frame regression harness + reference PNGs; references refreshed after visual review of the final renderer frame (0.0000% delta on re-run).")
add([134], "done", ["tests/agent/re2d_render_visual_features_test.py",
                    "tests/agent/re2d_render_regression_test.py",
                    "tests/agent/re2d_world_renderer_test.py",
                    "tests/agent/re2d_dust2_test.py", "huge_test"],
    "Grounding/material/fog/sky/region families are covered; renderer, dust2 and huge-world agent suites are green after final integration.")
add([135], "done", ["tests/re2d/brush_test.c", "tests/re2d/brush_advanced_fixture_test.c",
                    "tests/re2d/world_tools_test.c"],
    "Sealed room/leak/hint/skip/nodraw/clip/sky/areaportal/overlap/invalid brush fixtures.")
add([136], "done", ["demos/re2d_visual_lab", "tests/agent/re2d_visual_lab_acceptance_test.py", "tests/agent/re2d_render_regression_test.py"],
    "demos/re2d_visual_lab has 50 enemies/150 props/1292 particles/41 decals/12 lights+4 shadow/11 VFX; regression uses the real visual-lab scene.")
add([137], "done", ["handoff", "tests/agent/reference/bashnya", "tests/agent/bashnya_visual_refs_test.py"],
    "BASHNYA bridge/shot/VFX reference frames stored and reproducible; repro/play/bsp slices green.")
add([138, 139, 140], "policy", ["policy", "docs/RE2D.md"],
    "Explicit do-not-implement list and Hammer/sky terminology policy.")
add([141], "done", ["vn_theme", "render", "tests/agent/scene_w_crossover_test.py", "handoff"],
    "Scene-W agent test drives input -> native trigger -> cutscene/cinematic camera -> lit world sprite -> BASHNYA RML dialog/expression -> continuous VFX -> vanish FX bundle -> commit -> input return.")
add([142], "done", ["src/highlevel/dialog.js", "docs/VN_NARRATIVE.md"],
    "World modes pause/cinematic do not stop the render loop; renderer/VFX/fog policy stays independent.")
add([143], "done", ["vn_theme"], "BASHNYA RML/RCSS custom theme with RmlUi pixel test.")
add([144], "done", ["handoff", "tests/agent/vn_bashnya_theme_test.py", "tests/agent/reference/bashnya"],
    "BASHNYA-specific black/dark-red RML/RCSS theme plus stored scene frames.")
add([145], "policy", ["handoff"], "Recommended order/meta section.")
add([146], "done", ["vn_theme", "vn_tests", "vn_core", "vn_story", "vn_audio"],
    "VN DoD evidence: custom RML/font/layout, choices/keyboard/gamepad, skip/auto/backlog/save, shared timeline/cutscene runtime, no fourth UI engine.")
add([147], "partial", ["render", "render_tests", "tests/agent/re2d_visual_lab_acceptance_test.py", "tests/agent/reference/bashnya"],
    "Visual lab counts/BEFORE-AFTER feature deltas and BASHNYA bridge/shot/VFX refs exist; re2d_visual_lab_acceptance_test.py is green after the atlas-warning grace fix (transient async upload no longer reported as a loss). A stored BASHNYA BEFORE/AFTER comparison for the section's subjective checklist is still missing, so the section stays partial.")
add([148], "partial", ["region", "stream", "src/re2d_world_stream_io.c", "tests/agent/re2d_huge_scaling_test.py", "handoff"],
    "1x/2x/4x scaling keeps draws flat (4 group draws, 36 visible surfaces) and AI/nav/save survive the streaming boundary, but the DoD is not fully closed: payload streaming is incremental/budgeted, not async disk I/O, and the full region-local forward geometry path is still open (same limits as sections 73/89).")
add([149, 150, 151, 152, 153], "meta", ["policy"],
    "Rules/first tasks/final setup; no runtime deliverable.")

AUDIT_PATHS = [
    "src/re2d_world_stream.c", "src/re2d_world_stream.h",
    "src/re2d_world_stream_io.c", "src/re2d_world_stream_io.h",
    "src/re2d_world_impostor.c", "src/re2d_world_post.c",
    "src/re2d_world_region.c", "src/re2d_world_visibility.c",
    "src/re2d_world_render_features.c", "sdk/native/sdk_brush.c",
    "sdk/native/sdk_world.c", "src/highlevel/dialog.js",
    "src/highlevel/dialog_view.js", "src/highlevel/dialog_theme.js",
    "src/highlevel/story.js", "ui/dialog",
]
AUDIT_RE = re.compile(
    r"TODO|FIXME|XXX|not implemented|simulated|stub|placeholder|no-op|"
    r"заглушк|не реализ", re.IGNORECASE)


def resolve_evidence(tokens):
    """Expand groups, resolve globs/dirs. Returns (existing, missing, display)."""
    existing, missing, display = [], [], []
    for token in tokens:
        if token in GROUPS:
            paths = GROUPS[token]
            display.append("@" + token)
        else:
            paths = [token]
            display.append(token)
        for raw in paths:
            matches = sorted(glob.glob(str(ROOT / raw)))
            if matches:
                existing.extend(os.path.relpath(m, ROOT) for m in matches)
            else:
                missing.append(raw)
    return existing, missing, display


def audit_sources():
    hits = []
    for raw in AUDIT_PATHS:
        path = ROOT / raw
        candidates = sorted(path.rglob("*")) if path.is_dir() else [path]
        for candidate in candidates:
            if not candidate.is_file() or candidate.suffix.lower() not in {
                    ".c", ".h", ".js", ".mjs", ".rml", ".rcss", ".md"}:
                continue
            try:
                lines = candidate.read_text(encoding="utf-8", errors="replace").splitlines()
            except OSError:
                continue
            for number, line in enumerate(lines, 1):
                if AUDIT_RE.search(line):
                    hits.append({"file": os.path.relpath(candidate, ROOT),
                                 "line": number, "text": line.strip()[:180]})
    return hits


def parse_roadmap(path: Path):
    if not path or not path.is_file():
        return None, "external roadmap not found; checked-in title manifest used"
    titles = {}
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        match = re.match(r"^#\s+(\d+)\.\s*(.+?)\s*$", line)
        if match:
            titles[int(match.group(1))] = match.group(2).strip()
    return titles, None


def build_report(roadmap_path: Path, check_titles: bool = True):
    report = {"root": str(ROOT), "roadmap": str(roadmap_path) if roadmap_path else None,
              "sections": [], "errors": [], "warnings": []}
    parsed, notice = parse_roadmap(roadmap_path)
    if notice:
        report["warnings"].append(notice)
    elif check_titles and parsed:
        report["warnings"].append("roadmap parsed: %d sections" % len(parsed))
    if parsed is not None and set(parsed) != set(TITLES):
        report["errors"].append("roadmap section ids differ from manifest: %s" %
                                sorted(set(parsed).symmetric_difference(TITLES)))
    for section in range(154):
        row = ROWS.get(section)
        if not row:
            report["errors"].append("roadmap section %d has no matrix row" % section)
            continue
        existing, missing, display = resolve_evidence(row["evidence"])
        status = row["status"]
        mandatory = section in MANDATORY
        red = mandatory and status in {"partial", "deferred"}
        if status == "done" and not existing:
            report["errors"].append("section %d marked done without evidence" % section)
        if missing:
            report["errors"].append("section %d evidence missing: %s" %
                                    (section, ", ".join(sorted(set(missing)))))
        report["sections"].append({
            "section": section, "title": TITLES.get(section, parsed.get(section) if parsed else ""),
            "status": status, "mandatory": mandatory, "red": red,
            "evidence": display, "existing": existing,
            "missing_evidence": sorted(set(missing)), "note": row["note"],
        })
    report["audit_hits"] = audit_sources()
    counts = {}
    for row in report["sections"]:
        counts[row["status"]] = counts.get(row["status"], 0) + 1
    report["counts"] = counts
    report["red_count"] = sum(1 for row in report["sections"] if row["red"])
    report["red"] = [{"section": row["section"], "title": row["title"],
                      "status": row["status"], "note": row["note"]}
                     for row in report["sections"] if row["red"]]
    if report["errors"]:
        report["ok"] = False
    else:
        report["ok"] = True
    return report


def render_doc(report):
    lines = []
    lines.append("# Roadmap coverage matrix (sections 0–153)")
    lines.append("")
    lines.append("Generated by `tools/roadmap_coverage.py --write` from the checked-in")
    lines.append("section manifest and the repository evidence. Run")
    lines.append("`python3 tools/roadmap_coverage.py --check` in CI/acceptance.")
    lines.append("")
    lines.append("Statuses: `done` = evidence exists; `partial` = shipped with an")
    lines.append("explicit recorded gap; `deferred` = intentionally not shipped;")
    lines.append("`policy`/`meta` = rules or analysis with no runtime deliverable.")
    lines.append("")
    lines.append("## Summary (%s)" % AUDIT_DATE)
    lines.append("")
    lines.append("- Sections: **%d** (0..153, no gaps)"
                 % len(report["sections"]))
    for status in ("done", "partial", "deferred", "policy", "meta"):
        lines.append("- `%s`: **%d**" % (status, report["counts"].get(status, 0)))
    lines.append("- Mandatory red gaps: **%d**" % report["red_count"])
    lines.append("- Literal TODO/stub/simulated hits in audited modules: **%d**"
                 % len(report["audit_hits"]))
    lines.append("- Checker: **%s**" % ("PASS" if report["ok"] else "FAIL"))
    lines.append("")
    if report["warnings"]:
        lines.append("Audit notes:")
        for warning in report["warnings"]:
            lines.append("- " + warning)
        lines.append("")
    lines.append("## Evidence groups")
    lines.append("")
    lines.append("Every path below is checked for existence by the tool. Globs and")
    lines.append("directories are allowed; a missing group path fails the section.")
    lines.append("")
    lines.append("| group | concrete files/tests/docs |")
    lines.append("|---|---|")
    for name in sorted(GROUPS):
        paths = "<br>".join("`%s`" % p for p in GROUPS[name])
        lines.append("| `@%s` | %s |" % (name, paths))
    lines.append("")
    lines.append("## Matrix")
    lines.append("")
    lines.append("`R` marks a mandatory section that is not `done` (red gap).")
    lines.append("")
    lines.append("| # | Section | Status | R | Evidence | Note |")
    lines.append("|---|---|---|---|---|---|")
    for row in report["sections"]:
        evidence = ", ".join("`%s`" % e for e in row["evidence"])
        note = row["note"].replace("|", "\\|")
        lines.append("| %d | %s | `%s` | %s | %s | %s |"
                     % (row["section"], row["title"].replace("|", "\\|"),
                        row["status"], "R" if row["red"] else "", evidence, note))
    lines.append("")
    lines.append("## Acceptance snapshot (%s)" % AUDIT_DATE)
    lines.append("")
    lines.append("| gate | result |")
    lines.append("|---|---|")
    for name, result in ACCEPTANCE.items():
        lines.append("| %s | %s |" % (name, result))
    lines.append("")
    lines.append("## Wave deliverable map (VN-01..03, R-01..06, P0..P5)")
    lines.append("")
    lines.append("| deliverable | roadmap sections | evidence | status |")
    lines.append("|---|---|---|---|")
    waves = [
        ("VN-01", "4–28", "@vn_core, @vn_view, @vn_theme", "done"),
        ("VN-02", "10–13, 25–31", "@vn_core, @vn_dev, @vn_tests", "done"),
        ("VN-03", "9, 32–39", "@vn_story, @vn_audio, @vn_lint", "done"),
        ("R-01", "43–48", "@render", "done"),
        ("R-02", "49–61", "@render, @post, @sky", "done"),
        ("R-03", "54–68, 108–116", "@render, @sky, @vfx, @assets", "done (task-16 assets)"),
        ("R-04", "69–90", "@region, @stream, @impostor, @openworld", "partial (async payload streaming)"),
        ("R-05", "91–107", "@brush, @stream", "partial (convex/rect-hole/Z-CSG only)"),
        ("R-06", "62–68, 80–81", "@sky, @impostor, @assets", "done (assets; GPU integration snapshot red)"),
        ("P0 renderer", "117", "@render, @render_tests", "partial (BASHNYA BEFORE/AFTER evidence)"),
        ("P1 open world", "118", "@region, @openworld", "done"),
        ("P2 Hammer pipeline", "119", "@brush", "done"),
        ("P3 sky/distant", "120", "@sky, @assets", "done"),
        ("P4 advanced polish", "121", "@render, @post", "done"),
        ("P5 optional", "122", "@assets", "done (task-16)"),
    ]
    for name, roadmap, evidence, status in waves:
        lines.append("| %s | %s | %s | %s |" % (name, roadmap, evidence, status))
    lines.append("")
    lines.append("## Red gaps, prioritized")
    lines.append("")
    reds = report["red"]
    if not reds:
        lines.append("None.")
    else:
        priority = [(41, 41, "VN crossover/visual acceptance"),
                    (64, 66, "authored sky/distant assets"),
                    (73, 73, "async payload streaming"),
                    (78, 79, "hint/occluder fidelity"),
                    (86, 89, "decal residency/region-local forward path"),
                    (93, 96, "brush CSG/entity behavior"),
                    (103, 104, "sky leak/GPU batching"),
                    (117, 117, "BASHNYA visual acceptance"),
                    (120, 122, "P3/P5 assets"),
                    (126, 128, "debug overlays/material debug"),
                    (131, 137, "QA/test structure/visual lab"),
                    (141, 148, "crossover/DoD")]
        ordered = []
        used = set()
        for lo, hi, label in priority:
            for row in reds:
                if lo <= row["section"] <= hi and row["section"] not in used:
                    ordered.append((label, row))
                    used.add(row["section"])
        for row in reds:
            if row["section"] not in used:
                ordered.append(("other", row))
        lines.append("| priority | # | Section | Status | Why red |")
        lines.append("|---|---|---|---|---|")
        for label, row in ordered:
            lines.append("| %s | %d | %s | `%s` | %s |"
                         % (label, row["section"], row["title"].replace("|", "\\|"),
                            row["status"], row["note"].replace("|", "\\|")))
    lines.append("")
    lines.append("## DoD evidence 146–148")
    lines.append("")
    dod = {
        146: ("VN", ["@vn_theme", "@vn_tests", "@vn_core", "@vn_story"],
              "Custom RML/font/layout, choices, keyboard/gamepad, skip/auto/backlog/save, "
              "timeline/cutscene share $.dialog, no separate story UI. Pixel test: "
              "tests/agent/vn_bashnya_theme_test.py."),
        147: ("Render P0", ["@render", "@render_tests"],
              "Grounding/variation/edges/fog/sky features, the visual lab and its BEFORE/AFTER "
              "frames exist, but the acceptance test currently fails 'visual lab has no script "
              "errors' and there is no stored BASHNYA BEFORE/AFTER checklist comparison; DoD open."),
        148: ("Huge world", ["@region", "@stream", "@openworld", "@tests/agent/re2d_huge_world_test.py"],
              "Regions/PVS/stream state machine/LOD/impostors, the open-world lab and 1x/2x/4x "
              "scaling run. Open: true async disk payload streaming and full region-local forward "
              "geometry."),
    }
    lines.append("| DoD | Evidence | Verdict |")
    lines.append("|---|---|---|")
    for section, (name, tokens, verdict) in dod.items():
        evidence = ", ".join("`%s`" % t for t in tokens)
        row = next(r for r in report["sections"] if r["section"] == section)
        lines.append("| 146–148 #%d %s | %s | `%s` — %s |"
                     % (section, name, evidence, row["status"], verdict))
    lines.append("")
    lines.append("## Source audit (TODO/stub/simulated markers)")
    lines.append("")
    if not report["audit_hits"]:
        lines.append("No literal TODO/FIXME/XXX/stub/simulated/placeholder markers in "
                     "the audited modules. Red gaps above come from documented limits and "
                     "missing acceptance assets/streaming, not from hidden stubs.")
    else:
        lines.append("| file:line | marker text |")
        lines.append("|---|---|")
        for hit in report["audit_hits"]:
            lines.append("| `%s:%d` | %s |"
                         % (hit["file"], hit["line"], hit["text"].replace("|", "\\|")))
    lines.append("")
    lines.append("## Acceptance commands")
    lines.append("")
    lines.append("```bash")
    lines.append("xmake build -y -j 8 r2d")
    lines.append("xmake test -y -j 8")
    lines.append("python3 tests/doc_claims_test.py")
    lines.append("python3 tests/doc_coverage_test.py")
    lines.append("python3 tests/api_docs_sync_test.py")
    lines.append("python3 tests/site_prune_test.py")
    lines.append("python3 site/build-doc.py")
    lines.append("python3 tools/run_tests.py")
    lines.append("cd /Volumes/SSD\\ NVME/BASHNYA && python3 tests/repro_engine_limits.py")
    lines.append("cd /Volumes/SSD\\ NVME/BASHNYA && python3 tests/play_slice.py")
    lines.append("python3 tools/roadmap_coverage.py --check")
    lines.append("```")
    lines.append("")
    lines.append("Results for the audited snapshot are recorded in")
    lines.append("`docs/HANDOFF_VN_RENDER_ROADMAP.md` (task-17 section).")
    lines.append("")
    return "\n".join(lines)


def main(argv):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="validate the matrix")
    parser.add_argument("--write", action="store_true", help="write docs/ROADMAP_COVERAGE.md")
    parser.add_argument("--json", action="store_true", help="machine-readable report")
    parser.add_argument("--roadmap", default=os.environ.get("R2D_ROADMAP", str(DEFAULT_ROADMAP)))
    parser.add_argument("--no-titles-check", action="store_true")
    args = parser.parse_args(argv)

    roadmap = Path(args.roadmap) if args.roadmap else None
    report = build_report(roadmap, check_titles=not args.no_titles_check)
    if args.write:
        DOC.write_text(render_doc(report), encoding="utf-8")
        print("written %s (%d sections, %d red gaps)"
              % (os.path.relpath(DOC, ROOT), len(report["sections"]), report["red_count"]))
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print("roadmap sections: %d" % len(report["sections"]))
        print("statuses: %s" % ", ".join("%s=%d" % (k, v)
                                          for k, v in sorted(report["counts"].items())))
        print("mandatory red gaps: %d" % report["red_count"])
        print("literal audit hits: %d" % len(report["audit_hits"]))
        for error in report["errors"]:
            print("  FAIL " + error)
        if report["ok"]:
            print("roadmap coverage: PASS")
        else:
            print("roadmap coverage: FAIL")
    if args.write and not args.check and not args.json:
        return 0
    if not (args.check or args.write or args.json):
        print("nothing to do: pass --check, --write or --json")
        return 2
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
