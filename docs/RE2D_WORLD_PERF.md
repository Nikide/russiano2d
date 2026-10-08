# RE2D World: native CPU optimisation

Measured 2026-10-08 on Apple M4, macOS 27.0.1, Metal, 800×600 demo window.
Both versions use Release (`-O3 -DNDEBUG`). Baseline is `3bf46c8`; the
optimised version is the change introducing this document. Animations, four
Russi actors, AK viewmodel and RmlUi are enabled in both. No resolution,
supersampling or animation rate reduction was used.

## Measured result

Three samples of 30 frames per scenario, median elapsed wall-clock time per
frame. Both versions start with the same seeded scene and camera reset.

| Scenario | Before, ms/frame | After, ms/frame | Speedup |
|---|---:|---:|---:|
| Stationary camera | 59.86 | 16.17 | 3.70× |
| Turn with Right | 63.22 | 16.09 | 3.93× |
| Walk with W | 74.62 | 16.27 | 4.59× |

The after measurements correspond to approximately 61–62 frames/s throughput
in this agent test. They include command overhead and are **not presented
window FPS** or a guarantee for other scenes, resolutions or hardware. A
separate 60-frame window gave 13.66–16.31 ms/frame; scene progression changes
which actors and surfaces are visible. Fixed-dt agent runs report 60 in the
engine FPS counter regardless of actual speed: that counter was not used.
The ordinary demo now displays the engine's real-clock FPS when launched
without `--fixed-dt`.

## What changed

The World compositor no longer traverses all geometry for every output pixel.
Native C computes clipped screen bounds for each specialised wall segment or
rectangular floor/ceiling region. Within those bounds it evaluates the same
intersection and depth equations using row coefficients. XY BSP orders wall
work; the existing world ray query remains available for gameplay. This is
still a private CPU RGBA/depth synthesis pass followed by one ordinary sprite
through the existing 2D batch. No GPU world mesh or generic triangle API was
introduced.

Re2DSprite's anime synthesis reuses native scratch, clears/resolves only the
affected region, and composes each part's model/view transform once per pose.
The previous 512→256 supersampling and alpha treatment are preserved. Scratch
retains approximately 3.25 MiB per animated anime handle until disposal; this
trades retained memory for fewer allocations and less clearing.

For World composition only, animated state and final relative yaw/pitch are
queued through internal `rotSpritePrepare` and synthesised once when C reads
the pixels. Fully off-screen actors defer synthesis until needed. Their
animation clocks and socket/model state continue updating. Individual GPU
texture uploads are deferred because World reads CPU pixels directly. Explicit
`.re2dPose` and ordinary visible 2D rendering flush and upload as before. All
native model handles are validated even when off-screen. The public high-level
API remains a wrapper; gameplay types are unchanged.

## Verification and reproduction

```
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build -j6
python3 tools/bench_re2d_world.py --frames 30 --samples 3 --json build/bench_re2d_world.json
./build/russiano2d --game demos/re2d_bsp_world
```

The benchmark writes raw samples and environment information. Run on an idle
machine without a second copy of the demo for comparable results. The baseline
was built from committed engine sources, measured, then the optimised sources
were restored and rebuilt before final checks.

All 10 native test executables and 87 JS test files pass. Native tests compare
World coverage/depth against independent per-pixel ray queries across 24
camera/storey/projection combinations and compare reused anime scratch against
fresh scratch across 16 poses, including hidden/empty frames. BSP, World and
RotSprite native tests run with ASan/UBSan. Twelve relevant agent suites pass,
including World pose coalescing, off-screen deferral, immediate Pose semantics,
invalid culled handles, height occlusion, attachments, shooting and stairs.
Three frozen demo views match the pre-optimisation rendered pixels exactly
below the HUD; the HUD gained an FPS label. Documentation checks pass.

Remaining constraints are described in [World audit](RE2D_WORLD_AUDIT.md):
no portals/PVS, no textured World surfaces, rectangular supports, approximate
depth per composed sprite, and no verified Web/WASM build. Off-screen culling
does not imply PVS or rejection of actors hidden behind walls. Large-scene
scaling and higher-resolution presentation still need separate measurements.
