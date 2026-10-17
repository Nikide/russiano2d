# Re2D acceptance visual lab

`--scene re2d_visual_lab` on the `demos` project. One deterministic GPU scene
for the renderer acceptance pass:

- **50 enemies** (`warden_ultra16` atlas, 16 directions, idle rows);
- **150 props** (`turret_ultra16` atlas, 16 directions);
- **~1.2k particles** in the native pool, plus VFX pack bursts;
- **40+ decals** on authored floor surfaces;
- **12 lights**, 4 shadowed;
- authored brick/floor/emissive panel materials;
- sky layers + weather + shaft cards + distant cards (R-02/R-06 counters);
- region LOD/impostor request (`regionConfig`/`regionLod`);
- native VFX pack bundles (muzzle, fire, portal, electric, rain, snow, shafts).

Camera: `(800, 900, h=76, yaw=-90°)`, fixed; frame 960×540 (window 1280×720).
Everything is constrained Re2D: world surfaces, atlas sprites, native particles,
native VFX pools, no mesh/ECS/JS per-spark nodes.

## Run

```sh
./build/russiano2d --game demos --scene re2d_visual_lab
```

## Capture / regression

```sh
python3 tests/agent/re2d_visual_lab_acceptance_test.py --update  # intentional
python3 tests/agent/re2d_visual_lab_acceptance_test.py
```

References: `tests/agent/reference/re2d_visual_lab.png` and
`visual_lab_<feature>_{before,after}.png` for material variation, bevel/AO,
fog/haze, sky layers, emissive/bloom and VFX. BASHNYA evidence:
`tests/agent/reference/bashnya/{start_bridge,shot,vfx}.png` via
`tests/agent/bashnya_visual_refs_test.py` (BASHNYA sources unchanged).

## Script probe

`globalThis.visualLab` exposes `counts()`, `sceneCounts()`, `mode(name,side)`
(accepts `material`, `bevel_ao`, `fog_haze`, `sky_layers`, `emissive_bloom`,
`vfx`), and `restore()` for the capture harness.

## Limits

- The testroom map has no compiler region grid: `regionConfig/regionLod` is
  exercised but `impostorCount` stays 0; `distantCards` comes from the sky
  layer model. A region-grid map is available in `re2d_openworld_lab`.
- The frame is a reference capture, not a performance benchmark; counters are
  printed by the acceptance test.
