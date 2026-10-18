# Re2D renderer visual features (R-01/R-02) and VFX pass

Native, constrained 2.5D renderer work for the RUSSIANO2D_VN_AND_RE2D_RENDER
roadmap, sections 41–68/117–122. No mesh, no generic 3D, no ECS, no second
renderer backend. The feature model is pure C in
`src/re2d_world_render_features.c`; the GPU pass is in
`src/re2d_world_gpu.c` and `shaders/world.frag.glsl`; the CPU reference for
grounding is in `src/re2d_world_runtime.c`. R-03 cards/trails are read from
`src/re2d_world_vfx.*` without owning that module.

## Acceptance visual lab (R-03/R-06)

`demos/re2d_visual_lab` (`--scene re2d_visual_lab`) is the dense acceptance
scene for the renderer/VFX pass:

| What | Count / source |
|---|---|
| enemies | 50 atlas world sprites (`warden_ultra16`, 16 directions) |
| props | 150 atlas world sprites (`turret_ultra16`, 16 directions) |
| particles | ~1.2k native pool + VFX bursts (1000–3000 acceptance range) |
| decals | 40+ on authored floor surfaces |
| lights | 12, 4 shadowed |
| materials | brick / floor / emissive panel, surface variation + bevel/AO |
| sky | 4 layers, weather cards, celestial disc, distant city cards |
| VFX | 11 native bundles (muzzle/fire/portal/electric/rain/snow/shafts) |
| regions | `regionConfig(256,1,2)` + monotonic `regionLod`; testroom has no compiler region grid, so `impostorCount` is 0 (openworld lab has 25) |

Camera is fixed at `(800,900,h=76,yaw=-90°)`. Counters come from
`world.info()`/`world.vfx.info()`; the probe is `globalThis.visualLab.counts()`.

```sh
python3 tests/agent/re2d_visual_lab_acceptance_test.py --update
python3 tests/agent/re2d_visual_lab_acceptance_test.py
```

References live in `tests/agent/reference/`:

* [`re2d_visual_lab.png`](../tests/agent/reference/re2d_visual_lab.png) — acceptance frame;
* `visual_lab_<feature>_{before,after}.png` for material variation, bevel/corner
  AO, height fog/haze, sky layers, emissive/bloom and VFX;
* BASHNYA evidence: `tests/agent/reference/bashnya/start_bridge.png`,
  `shot.png`, `vfx.png` + `manifest.json`, captured by
  `tests/agent/bashnya_visual_refs_test.py` from the unchanged bundled BASHNYA
  runtime (`level1`, seed 7, fixed 60 Hz).

## Quality tiers

The visual tier, the pose budget and the atmosphere are independent controls:

```js
world.renderQuality('low');                // visual tier: low | medium | high | ultra
world.quality({poseBudget:2, poseStep:5}); // pose policy only, never the tier
world.atmosphere({heightDensity:0.004, baseHeight:64, falloff:60,
                  hazeStrength:0.12, hazeColor:'#102030',
                  skyLayers:false, sunDisc:false}); // only provided fields change
world.qualityPreset('high');               // full preset: pose + tier + particles
```

`world.renderQuality(name)` runs `r2d_world_render_quality(world, R2D_RENDER_QUALITY_*)`;
no argument returns the current tier. Being a preset it resets atmosphere
overrides to the tier defaults, so call `world.atmosphere` after picking a tier.

`world.quality({poseBudget, poseStep})` changes only the pose policy (BASHNYA
1.2.6: `poseBudget:4` used to force HIGH and change the whole frame).
`world.qualityPreset` keeps the full-preset behavior (pose budget + visual tier
+ particle budget). Default worlds create with LOW, preserving the legacy low
frame.

`world.atmosphere({...})` applies only the provided fields through
`r2d_world_render_set_features`, returns the applied values and never changes
the tier. Height fog/haze: `heightDensity` 0..1 (asymptote is
`heightDensity*falloff`), `baseHeight` -100000..100000, `falloff` 0..100 — the
height-fog **scale height in world units** (`0` disables the height term; this
replaced the old dimensionless multiplier in 1.2.7, so old
`atmosphere({falloff:...})` values must be re-read as world units),
`hazeStrength` 0..1. `hazeColor` is an explicit linear RGB override
(`'#rrggbb'` or packed RGBA number); `hazeColor:null` restores the automatic
tint derived from the authored sky colour (legacy frames unchanged).
`skyLayers`/`sunDisc` booleans toggle the sky features. Wrong type throws
TypeError, out-of-range throws RangeError; unknown options are rejected.

The C API `r2d_world_render_quality(world, R2D_RENDER_QUALITY_*)` and
`r2d_world_render_set_features(world, &features)` are available to native hosts;
`r2d_world_render_features(world)` returns the current immutable view.
`r2d_world_render_defaults/preset/validate` are the single contract used by
tests.

Low quality is the parity-safe default: every R-01/R-02 visual uniform is zero
except grounding, so the legacy frame is unchanged. The R-02 atmosphere term
(bounded height fog + haze) is implemented in both the GPU shader and the CPU
composer (`r2d_world_frame_targets_features`), so MEDIUM/HIGH CPU frames carry
the same fog/haze as the GPU tier. The remaining R-01/R-02 surface features
(material/macro variation, bevel/corner AO, detail, liquid, sky layers) are
GPU-reference; mixed CPU/GPU parity for them is not claimed (see Limits).

## R-01 sprite grounding

* Contact shadow — floor-aligned screen-space ellipse under each visible actor
  (one draw per actor), sampled from the actor's support span. Radius, opacity,
  softness and height fade are deterministic.
* Foot AO — a smaller radial core inside the contact card.
* Local floor tint — the card colour is mixed from the support span's floor
  colour and ambient/light tint.
* Height fog — per-fragment optical depth adds a bounded, distance-gated height
  integral above `fog_base_height`:
  `heightDensity*falloff*(1-exp(-max(0,height-base)/falloff))*(1-exp(-depth*0.002))`.
  The contribution approaches the finite asymptote `heightDensity*falloff`
  (MEDIUM 24%, HIGH 42%, ULTRA 55%), so tall vertical maps keep authored
  material contrast while extreme height/distance still lose it (`falloff` is
  the scale height in world units; 0 disables the height term). Shared by the
  GPU shader and the CPU composer.
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

* Height fog + atmospheric haze: the authored span distance fog is mixed with
  the bounded, distance-gated height term (see R-01 grounding), the fog colour
  is blended toward the haze tint, and contrast/saturation fall with depth.
  Implemented identically in `shaders/world.frag.glsl` and the CPU composer;
  the legacy branch is byte-identical when both are off.
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

* Advanced R-01/R-02 effects are GPU-reference, except the R-02 atmosphere term
  (bounded height fog + haze), which the CPU composer also applies through
  `r2d_world_frame_targets_features` so MEDIUM/HIGH CPU frames carry the same
  fog/haze. Material/macro variation, bevel/corner AO, detail, liquid shading
  and sky layers stay GPU-only; the CPU composer is not a second renderer.
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
* CPU/GPU parity for medium/high tiers is not pixel-exact: the atmosphere term
  matches, but the GPU-only R-01/R-02 surface effects above legitimately differ.
  Default low is parity-safe and is what existing regression comparisons use;
  the BASHNYA MEDIUM parity repro (walls/floors at the same visibility) reports
  MAD ~4/255 with the atmosphere term matched.

## P4/P5 renderer remainder (task-7)

Files: `src/re2d_world_sky.*` (sky profiles, layers, weather, celestial,
distant cards, portal/surface policy), `src/re2d_world_post.*` (bloom-lite,
reflection-lite, depth-aware heat distortion, CPU reference passes),
`src/re2d_world_render_features.*` (shaft cards, ambient/AO field, detail
layers, decals 2.0, batching/residency hooks, 16-direction helper).
All are pure native C: no mesh/3D/ECS, no allocation in evaluation paths.

### Sky, weather and distant cards

* Four profiles (`clear`, `dusk`, `night`, `storm`) and 1-4 labelled layers with
  independent texture slot, tint, parallax, scale, offset, alpha and scroll.
* Weather layers stack with normalised weights: rain, snow, ash and clouds.
  Cards are deterministic, caller-seeded and time-driven (no particle state).
* Sun/moon discs return a unit direction, visibility, size, glow and colour.
* Two to four distant sky cards provide independent parallax silhouettes.
* Portal policy: `none`, `inherit` (room sky) and `profile` override; `tool_sky`
  surfaces draw the stack unless the wall is nodraw/clip.
* GPU: profile layers feed the existing sky shader; distant cards, weather
  cards and light-shaft cards use the existing procedural card branch
  (`plane.w=5`) so no new pipeline or mesh is introduced. Counters:
  `shafts`, `weatherCards`, `distantCards`.

### Ambient/AO field and surface detail

* `r2d_world_ambient_bake()` builds a coarse 32x32 max grid with ambient RGB
  and occlusion from floor/ceiling pairs and a sky bias; bilinear sampling.
  Deterministic across runs/branches (tested byte-identical).
* `r2d_world_render_detail_layer()` supplies deterministic base/detail/macro/
  emissive/normal UVs and weights from the surface hash.
* `r2d_world_render_sprite_direction()` maps yaw to 8/16/32... direction buckets
  for ultra sprites.

### Shafts, decals 2.0 and batching

* Light-shaft cards derive from active point lights: budget 0-8, cone width,
  height fade and alpha are deterministic; drawn additively with depth test.
  No raymarch/volume texture.
* Decals 2.0 model: material, rect, rotation, scale, lifetime, fade-in/out and
  seeded variation; 256-slot constant. `eval()` returns alpha/rotation/scale.
* Static batching key covers material/blend/light-policy/atlas; stats count
  draws, batches and saved draws. Residency hooks expose resident/pending,
  byte budget and a per-frame upload budget.

### Post passes

`re2d_world_post` provides the pass math plus deterministic CPU reference
images for regression: soft-knee bloom threshold + 8-tap ring, reflection-lite
UV/weight, elliptical heat mask and depth-attenuated screen offset. The CPU
reference bloom/heat functions are used by the regression harness.

### Debug/profiler and regression

`info.visual` now also reports `shafts, weatherCards, distantCards,
ambientSamples, detailSamples, decals2, batchDraws, batchBatches, batchSaved,
residentTextures, uploadBytes`.

Native harness: `tests/re2d/render_regression_test.c` composes a deterministic
64x64 reference frame from the P4 sky/ambient/post math, compares its FNV hash
to a stored baseline and an 8x8 average grid within +/-1.5. Toggles prove that
bloom, heat and sky-layer count change the frame while re-running is exact.

### Measured native test results (this pass)

| target | tests |
|---|---|
| `r2d_world_sky_test` | 5 |
| `r2d_world_post_test` | 5 |
| `r2d_world_render_p4_test` | 8 |
| `r2d_world_render_regression_test` | 2 |

GPU reference lab (`demos/re2d_world_renderer_lab`, agent screenshots):

| tier | gpuDraws | frameMs | shafts | weather | distant |
|---|---|---|---|---|---|
| medium | 30 | 12.04 | 2 | 0 | 2 |
| high | 91 | 12.11 | 2 | 61 | 2 |

`re2d_render_p4_test.py`: high changes 61.85% of pixels vs medium and 65.03%
vs low; `re2d_render_visual_features_test.py` still passes with 67.27% low/high
difference. Weather cards are bounded per layer (<=96) and by density; no
frame-time regression is measurable on this lab. Reference-frame FNV baseline:
`643744434` (regenerate only with an intentional visual change).

### P4/P5 limitations (honest)

* Distant/weather/shaft cards are GPU-reference procedural cards; per-layer
  independent sky textures still need authored texture slots (the model and
  policy support them, the demo assets do not ship four panoramas).
* Bloom-lite/reflection-lite/heat-distortion have validated native math and CPU
  references, but the world forward pass has no scene-colour target, so the
  final screen composite is not wired into `re2d_world_gpu.c`. That needs the
  engine post/bloom path to sample the world colour texture; documented for the
  integration owner. `world.post` remains the screen distortion path today.
* Ambient field and detail layers are not yet uploaded to shader uniforms;
  existing macro variation/bevel shading stays the runtime path.
* Decals 2.0 model is not yet fed by the 128-slot world decal pool; authored
  lifetime/fade authoring and JSON parsing are follow-up work.
* Batching/residency are native accounting + hooks; GPU submission order and
  texture streaming are not rerouted by them yet.

## Final GPU composite and remaining P4 gaps (task-11)

### Offscreen post pass (actually in the frame)

`re2d_world_gpu` now renders the world into the existing colour/owner/depth
targets, then runs a fullscreen composite into a **separate** post colour/owner
target using the same world shaders with `plane.w = 6`. It samples:

* scene colour for bloom-lite (8-tap ring, luminance threshold, strength from
  `world.post` bloom or the quality preset);
* owner target surface id to apply reflection-lite only to floor pixels
  (vertical screen mirror, roughness-weighted, no planar reflection engine);
* scene depth for depth-aware heat distortion (UV sine offset attenuated past
  `heat_depth_start`; a distorted sample closer than the source depth is
  rejected so foreground pixels do not smear).

The composite runs only for `R2D_WORLD_DEBUG_FINAL`; every debug view and the
CPU backend keep reading the raw colour/owner/depth targets. The final copy and
download paths are unchanged, and the post target is separate from every input,
so there is no read/write hazard. New counters: `postPasses`, `postBloom`,
`postReflection`, `postHeat`.

The composite is gated to the high/ultra (GPU-reference) tiers plus an explicit
`world.post` bloom request, so low/medium keep the byte-identical CPU/GPU parity
the old regression suite asserts. `postPasses` is 0 at medium and 1 at high.

Measured on `demos/re2d_world_renderer_lab` (agent screenshots): authored
`world.post.set("bloom",{strength:1})` changes 1.73% of pixels; high tier uses
92 draws / 8 material batches / 11.79 ms; medium 30 draws / 12.04 ms (post off).
Native test totals: sky 5, post 5, p4 8, regression 2, decals 2.

### Ambient/AO field and detail layers uploaded

The baked 4x4 ambient/AO grid is uploaded to the forward `SurfaceUniform`
(`ambientGrid[16]`, `ambientRect`) and sampled at the hit XY in the fragment
shader for non-decal surfaces. A detail layer samples the albedo texture at a
scaled/rotated UV and blends by `SurfaceUniform.detail` when `surface_detail`
is enabled. No extra sampler or pipeline was required.

### Decals 2.0 authoring and rendering

`R2DWorldDecal` gained `max_life, rotation, scale, fade_in, fade_out` while the
legacy 7-argument decal path stays compatible (`max_life` defaults to `remaining`,
scale to 1, no fade). `r2d_world_decal_alpha()` is the shared fade function.
GPU decal draws pass rotation/scale/fade in `SurfaceUniform.decal2`; the shader
uses them when enabled, otherwise the old deterministic hash rotation/scale.
`world.decal()` accepts optional `rotation, scale, fadeIn, fadeOut`.
Agent check: an authored paint decal changes 7.07% of pixels and reports
`visual.decals2 > 0`.

### P5 visual asset packs (16-dir sprites, sky layers, distant city)

Self-made procedural assets, generated by `tools/gen_p5_asset_packs.py`
(stdlib only, deterministic; `--check` verifies the repo matches the generator).

```text
assets/sprites/ultra16/        warden + turret, 16 directions
  pack.json                    2 sets, cell 64x64, directions 16, 336 frames
  warden_ultra16.png           1024x960 = 16 columns x 15 rows
  warden_ultra16.atlas.json    Aseprite frames/tags/slices for $.atlas
  warden_ultra16.world.json    world.sprite manifest: columns/rows/pivot/rows
  turret_ultra16.png           1024x384 = 16 columns x 6 rows
  turret_ultra16.atlas.json / turret_ultra16.world.json

assets/sky/                    canonical r2d_world_sky manifest
  layers.json                  4 layers + weather + sun/moon (runtime schema)
  manifest.json                extended pack manifest with slots/parallax notes
  layer_far_mountains.png      1024x512, slot 0, parallax 0.05
  layer_hills.png              1024x512, slot 1, parallax 0.12
  layer_clouds.png             1024x512, slot 2, parallax 0.22
  layer_spires.png             1024x512, slot 3, parallax 0.35
  layer_0_sky.png              1024x512 optional opaque backdrop
  weather_rain/snow/ash/clouds/fog.png  512x512 weather cards
                                       (canonical layers.json binds rain/snow/ash/clouds;
                                        fog is an extended-manifest extra)
  sun.png / moon.png           128x128 celestial discs

assets/sky/distant/             R-06 distant city silhouette cards
  manifest.json                4 cards with parallax/tint/slot names
  city_far/mid/near/landmark.png  1024x256 RGBA silhouettes with lit windows
```

**Ultra16 atlas layout.** Rows are state/frame, columns are direction 0..15.
`warden` rows: idle 0–3, walk 4–9, attack 10–14; `turret` rows: idle 0–1,
attack 2–5. Use `sprite_row` from `*.world.json` and pass
`{ columns:16, rows:N, directions:16, cell:{w:64,h:64}, pivot:'feet' }` to the
existing atlas world-sprite path. The Aseprite JSON also exposes `idle`, `walk`,
`attack` tags and per-frame feet pivots for `$.atlas`.

```js
const warden = $.atlas.load('warden', 'assets/sprites/ultra16/warden_ultra16.atlas.json');
warden.tagSprites('idle');       // 64 frames (4 idle rows x 16 directions)
// world.sprite(node, { atlas:'assets/sprites/ultra16/warden_ultra16.png',
//   columns:16, rows:15, directions:16, cell:{w:64,h:64}, pivot:'feet' });
```

**Sky slots.** `assets/sky/layers.json` is the canonical schema parsed by
`r2d_world_sky_manifest_parse`: version 1, 1..4 layers (`id,texture,tint,
parallax,scroll,alpha,offset,scale`), `weather` name→path object and `sun`/`moon`
paths. The pack binds slot 0 far mountains, 1 hills, 2 clouds, 3 near spires;
weather and distant cards are separate alpha/additive passes. `manifest.json`
adds explicit slot documentation for the renderer owner (no GPU wiring here).

**Distant city slots.** `assets/sky/distant/manifest.json` lists 4 cards
(`city_far`, `city_mid`, `city_near`, `city_landmark`) with parallax/tint/scale.
Draw them behind the sky layers, farthest first; the landmark card has the tallest
spire.

**Generate / validate.**

```sh
python3 tools/gen_p5_asset_packs.py          # deterministic regeneration
python3 tools/gen_p5_asset_packs.py --check  # repo assets match generator
./build/r2d-sdk atlas-info assets/sprites/ultra16/warden_ultra16.atlas.json
./build/r2d-sdk atlas-info assets/sprites/ultra16/turret_ultra16.atlas.json
python3 tests/agent/re2d_p5_asset_packs_test.py
```

The agent test validates manifests, atlas grid/dimensions, PNG alpha, runs
`atlas-info` for both sheets and loads both atlases through the real `$.atlas`
runtime (240 + 96 frames).

### Static batching and sky textures: measured status

* **Batching**: surfaces are fullscreen raytraced draws (no vertex buffers), so
  one draw per material/blend/light/atlas group would need per-instance surface
  parameters (SSBO or instanced attributes) plus a shader rewrite. This pass
  keeps the existing material/texture binding cache and the native
  batch/residency accounting; measured high-tier lab: 91 draws, material batch
  rebinds are already coalesced. Report reason: no SSBO/instancing rewrite.
* **Independent per-layer sky textures**: the P5 asset pack now ships real
  per-layer textures and the canonical `assets/sky/layers.json` manifest (see
  below). The runtime model binds texture slots per layer; the renderer owner
  can consume the authored files instead of the procedural fallback.

## P4 static batching contract (GPU owner)

The data path is ready in `src/re2d_world_batch.h`; the GPU renderer owns
submission and may consume it without any further CPU changes:

```
instance SSBO: std430 array of R2DWorldBatchInstance (32 bytes)
  u32 surface, span, material, flags, tint, aux, light, atlas
group SSBO: array of R2DWorldBatchGroup (24 bytes)
  u32 material, blend, lightPolicy, atlas, first, count
```

Rules:

* draw groups in ascending group index; instance index = `group.first + i`;
* instances are already sorted by group key; do not re-sort on GPU;
* `saved_binds = instances - groups` is the bind saving; the renderer may use
  `group.count > 1` to choose instanced submission;
* `flags` low bits: 0..3 kind (surface/actor/sky), 4..7 blend, bit 8 sky,
  bit 9 unlit/emissive, bit 10 shadow policy;
* the renderer may append its own actor cards to the item array before
  `r2d_world_batch_build`; the core module has no GPU/shader/state dependency;
* CPU fallback keeps using the current per-surface path, so parity and draw
  attribution are preserved while the GPU path is migrated.

Counters are available as `world.batchInfo()` and `world.info().visual`.

## Per-layer sky textures (data/loader half, task-19)

`src/re2d_world_sky.*` now carries per-layer authored identity:

* `R2DWorldSkyLayer.id[32]`, `texture_path[128]`, `tint`, `parallax`, `scale`,
  `offset`, `alpha`, `scroll` (plus the existing texture slot `-1`).
* `R2DWorldSkyWeather.texture[128]` and `R2DWorldSky.weather_texture[type]`,
  `sun_texture`, `moon_texture` (paths; empty means procedural fallback).
* `r2d_world_sky_set_layer()`, `r2d_world_sky_set_weather_texture()`,
  `r2d_world_sky_set_celestial_texture()` with bounded strings and numeric
  validation (rejects oversized paths/ids and out-of-range values).

Manifest `assets/sky/layers.json` (canonical; `assets/sky/manifest.json` points
to it) is validated by `r2d_world_sky_manifest_parse()`: version 1, 1-4 layers,
unique non-empty ids, texture paths, optional `#rrggbb`/`#rrggbbaa` tint,
per-layer parallax/scroll/alpha/offset/scale ranges, weather map, sun/moon.
`r2d_world_sky_apply_manifest()` applies it to a config; parsing is
transactional and leaves the output zeroed with an ASCII error on failure.

Runtime (`r2d_world_runtime.c`, no GPU calls):

* decodes layer PNGs through the existing image/asset path into owned RGBA8
  buffers, bounded to 2048 px, and stores them per layer;
* `r2d_world_runtime_sky_layer_set()` updates one layer; a missing/broken
  texture is rejected and the previous layer stays intact;
* `r2d_world_runtime_sky_manifest()` validates the manifest, decodes all layer
  textures into temporaries, then commits atomically; a missing layer asset or
  missing manifest changes nothing;
* `r2d_world_runtime_sky_layer_pixels()` / `_config()` / `_layer_path()` are
  the GPU-independent hooks. **GPU binding contract for task-13:** for every
  `i < cfg->layer_count`, if `_layer_pixels()` is non-NULL upload/bind it as a
  texture (stride/RGBA8, width/height from the getter) and use
  `cfg->layers[i]` (tint/parallax/scale/offset/alpha/scroll) as the layer
  uniforms; when the pointer is NULL use the existing procedural/panorama
  fallback. Weather/sun/moon paths are exposed for the same upload hook.

Script API (`src/re2d.c` + `src/highlevel/re2d.js`):

```js
world.skyLayer(2, {id:'clouds', texture:'assets/sky/layer_clouds.png',
                   tint:'#d0d8e8', parallax:0.22, scroll:0.004,
                   alpha:0.4, offset:0.08, scale:1.8}); // true/false
world.skyLayers();                     // [{index,id,texture,tint,parallax,...,
                                       //   loaded,width,height}, ...]
world.skyManifest('assets/sky/layers.json'); // true/false, transactional
world.info().sky // {count,error,layers[],sun,moon,weather:{rain,snow,ash,clouds}}
```

Missing layer/manifest returns false, keeps the old state and exposes the
reason via `info.sky.error`. The test asset set was supplied by task-16
(4 layers at 1024x512, weather/sun/moon placeholders).

Tests: `r2d_world_sky_layers_test` (4 native tests: manifest parse/apply,
invalid schemas, authoring bounds), `tests/agent/re2d_sky_layers_test.py`
(single layer decode 1024x512, missing-asset transaction, 4-layer manifest,
skyLayers/info contract, missing manifest). Existing `r2d_world_sky_test`
still green with the JSON dependency.

Limits: task-19 does not edit GPU/shaders, so layers decode/expose data but the
current GPU pass still binds one panorama texture until task-13 consumes the
hook. Weather/sun/moon texture **paths** are stored but not decoded here.
Path resolution follows the existing runtime asset resolver (VFS or project
path). No `assets/sky` binary is generated by this module when task-16 assets
exist; placeholders were only used before they landed.

## P4 static batching: GPU submission (implemented)

The GPU path now consumes the batch plan; the per-surface loop is the fallback.

* Each visible opaque draw becomes one `R2DWorldBatchInstance`; the GPU stores
  a per-instance `SurfaceUniform` (std430 SSBO) and draws **one fullscreen
  triangle per (material, blend, light policy, atlas) group** with
  `instanceCount = group.count`.
* Per-group SSBOs are uploaded once per frame (copy pass before the render
  pass); the shader reads `batch.data[gl_InstanceIndex]` and clips to the
  per-instance scissor carried in the uniform (the batch pass resets the
  inherited scissor to the full target).
* Equal-depth wall/base/span draws keep the sequential LEQUAL outcome through a
  tiny span-rank depth bias (2e-7..5e-7, below the parity tolerance). This is
  the only visual difference from sequential submission and is covered by the
  CPU/GPU parity suite.
* `world.batchGpu(false)` restores the old per-surface path at runtime; it is
  also used automatically for overdraw/non-final debug views and when the
  batch pipeline or SSBO allocation is unavailable.
* Counters: `world.batchInfo().gpuDraws/gpuLogicalDraws/gpuSavedDraws/
  gpuInstances`, mirrored in `world.info().visual.gpuBatch*`. Logical
  base/span attribution (`gpuDrawsBase/gpuDrawsSpan`) is preserved; the legacy
  `world.info().gpuDraws`/`drawCalls` counters stay logical-submission counts
  (so attribution sums stay exact), while actual group submission is visible in
  `gpuBatchDraws`.

Measured on `demos/re2d_world_renderer_lab` (medium, 2 cells): 23 logical
surface draws collapse to **4 group draws** (19 saved draws) with CPU/GPU parity
green; `tests/agent/re2d_batch_gpu_test.py` asserts the reduction and fallback.
