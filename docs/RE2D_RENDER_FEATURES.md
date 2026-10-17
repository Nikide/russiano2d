# Re2D renderer visual features (R-01/R-02) and VFX pass

Native, constrained 2.5D renderer work for the RUSSIANO2D_VN_AND_RE2D_RENDER
roadmap, sections 41–68/117–122. No mesh, no generic 3D, no ECS, no second
renderer backend. The feature model is pure C in
`src/re2d_world_render_features.c`; the GPU pass is in
`src/re2d_world_gpu.c` and `shaders/world.frag.glsl`; the CPU reference for
grounding is in `src/re2d_world_runtime.c`. R-03 cards/trails are read from
`src/re2d_world_vfx.*` without owning that module.

## Quality tiers

The existing high-level quality call drives the visual tier; no new JS wrapper
is required:

```js
world.qualityPreset('low');    // legacy look + P0 contact grounding
world.qualityPreset('medium'); // + foot AO, floor tint, contact light,
                               //   material variation/macro, height fog/haze,
                               //   sky layers, liquid shading
world.qualityPreset('high');   // + edge outline/grime/feather, bevel,
                               //   corner AO-lite, 4 sky layers, full VFX look
```

`world.quality({poseBudget, poseStep})` also updates the tier:
`poseBudget<=1` → low, `2..3` → medium, `>=4` → high. The C API
`r2d_world_render_quality(world, R2D_RENDER_QUALITY_*)` and
`r2d_world_render_set_features(world, &features)` are available to native hosts;
`r2d_world_render_features(world)` returns the current immutable view.
`r2d_world_render_defaults/preset/validate` are the single contract used by
tests.

Low quality is the parity-safe default: every R-01/R-02 visual uniform is zero
except grounding, so the legacy frame is unchanged. Medium/high are GPU
reference features; mixed CPU/GPU parity for them is not claimed (see Limits).

## R-01 sprite grounding

* Contact shadow — floor-aligned screen-space ellipse under each visible actor
  (one draw per actor), sampled from the actor's support span. Radius, opacity,
  softness and height fade are deterministic.
* Foot AO — a smaller radial core inside the contact card.
* Local floor tint — the card colour is mixed from the support span's floor
  colour and ambient/light tint.
* Height fog — per-fragment optical depth uses the span fog plus a height term
  above `fog_base_height`, so high rooms/far floors lose contrast.
* Contact lighting — the sprite shader darkens the lower part of the actor by
  `contactLightStrength`, tying the feet to the floor.

The CPU reference call uses the same `R2DWorldGroundCard` as the GPU ground pass
(center/radii/opacity/softness/foot ratio/tint), so both backends draw the same
footprint. The card is 2D screen-space: it does not ray-test every floor pixel
and does not generate a shadow map.

## R-01 surface and sprite detail

* Deterministic per-surface tint/macro variation keyed by world position and
  renderer seed; no two long walls repeat the same brightness pattern.
* Edge grime near wall bottoms with a low-frequency noise mask.
* Fake bevel shading and corner AO-lite from distances to two surface edges.
* Sprite edge quality: configurable masked alpha threshold/feather, inner
  outline from neighbour-alpha, deterministic grime and a foot gradient.
* Liquid floors: scrolled/distorted UV, tint, highlight and foam driven by
  `world.surface(i).terrain('water'|'blood'|'acid'|'lava'|'mist')`.
* Material animation 2.0 (scroll/flipbook/emissive pulse) continues through the
  existing `materialAnimSet` path; the visual pass only consumes its uniforms.

## R-02 atmosphere and sky

* Height fog + atmospheric haze: distance fog is mixed with sky tint, contrast
  and saturation fall with depth. Legacy branch is byte-identical when off.
* Sky layers: panorama (existing) + up to four parallax cards sampled from the
  panorama with per-layer parallax/scale/vertical offset/alpha, plus a
  procedural sun/moon disc with glow. Layer data is configured in
  `R2DWorldRenderFeatures.sky_*`.
* Sky portal and sky surface paths keep their existing behaviour; a sky surface
  skips the regular surface draw and the sky stack is rendered in the same pass.

## R-03 VFX render pass (cards/trails/distortion)

`world.vfx` spawns VFX data into fixed native pools. This renderer task adds the
GPU pass for that data:

* cards — `sprite`, `streak`, `ring`, `flash`, `decal` and `light_pulse` are
  procedural quads in `world.frag.glsl` (no texture, no mesh), depth-tested
  against the world, blending masked/translucent/additive.
* trails — one rotated streak quad per live trail segment, colour/alpha from the
  trail age.
* distortion cards — rendered as animated wavy cards and counted in
  `vfxDistortion`; the actual screen refraction still uses the existing
  postprocess/`$.gfx.post` distortion path (see Limits).
* counters: `world.info().gpuDrawsVfx` is a separate draw bucket;
  `world.info().visual.vfxCards/vfxTrails/vfxDistortion/vfxCardDraws/
  vfxTrailDraws/vfxDraws` are per-frame feature counters. Existing
  `gpuDrawsBase/Span/Actor/Other` are unchanged and the total attribution is
  `Base+Span+Actor+Other+Ground+Vfx == gpuDraws`.

## world.info() additions

`gpuDrawsGround` and `gpuDrawsVfx` join the existing draw attribution.
`info.visual` reports the selected quality plus per-frame counters:
`groundedActors, contactShadows, footAo, floorTint, contactLit, edgeActors,
outlineActors, grimeActors, variedSurfaces, macroSurfaces, bevelSurfaces,
cornerAoSurfaces, fogSurfaces, hazeSurfaces, liquidSurfaces, animatedMaterials,
skyLayers, celestialDiscs, skySurfaces, reflectionPasses, groundDraws, skyDraws,
decals, vfx*` and `renderTime`.

## Tests

```sh
./build/tests/r2d_world_render_features_test        # 13 Unity tests: presets,
                                                    # curve math, fog, AO, sky,
                                                    # liquid, validation
python3 tests/agent/re2d_render_visual_features_test.py  # low/high screenshots,
                                                          # all feature counters
python3 tests/agent/re2d_render_vfx_pass_test.py         # VFX cards/trails/
                                                          # distortion + attribution
python3 tests/agent/re2d_world_renderer_test.py          # existing regression
```

## Limitations (honest)

* Advanced R-01/R-02 effects are GPU-reference. The CPU composer keeps the
  legacy material/lighting/fog path; only grounding is shared by both backends.
* No per-pixel floor occlusion for the contact card (screen-space grounding).
* Sky parallax cards reuse the single panorama texture; separate layer textures,
  weather layers and per-room sky profiles are not authored yet.
* Distortion cards render as wavy world cards. A depth-aware distortion-mask
  post pass is not wired here; use `world.post`/`$.gfx.post` for screen
  distortion until a mask target is added.
* Decals 2.0 are still bounded by the existing 128-slot world decal pool and
  material bank; no new decal rotation/size authoring was added in this pass.
* Liquid shading uses terrain metadata on existing floor surfaces; no fluid
  simulation, reflection engine or planar 3D reflection.
* CPU/GPU parity for medium/high tiers is not claimed; default low is
  parity-safe and is what existing regression comparisons use.
