# Re2D Dust2 reference

Runnable Re2D interpretation of the Dust II route structure: A/B, T/CT spawn, mid doors, upper/lower tunnels, long doors/pit, short/catwalk and three continuous height transitions. This is an original constrained-cell reference map, not a geometrically exact Valve map or imported Counter-Strike assets. Layout context: https://www.counter-strike.net/dust2 . All bitmap materials/signs/map artwork were authored for this demo. Character targets reuse the project's Re2DSprite assets.

From the repository root:

```
build/russiano2d --game demos/re2d_dust2 --seed 7
```

WASD uses a Quake-inspired controller with acceleration, ground friction, inertia and air strafing; mouse looks (locked initially), Space jumps, Left Shift runs. Arrows also look, O operates a nearby door, LMB/F creates a native timed flash. F2 cycles 13 diagnostic views; G compares CPU/GPU; R resets. Keys 1–8 visit T, mid, B, A, long, short, tunnels and club. Esc releases the mouse, M toggles capture, Q exits. The HUD uses existing RmlUi and shows speed/ground-air state. Six standing enlarged anime Re2DSprite mascots populate T spawn, approaches and sites; these are visual NPCs, not combat AI. Window is 1920×1080; native target is 800×450. The controller uses native coarse queries with 120Hz substeps; it is a game-specific Quake-inspired approximation, not imported Quake physics.

`close_ramp_sides.py` rebuilds exposed ramp/ledge walls from compiled cell/span topology; run it before recompiling after height changes. Inclined skirts use one-unit constrained wall strips with at most 0.8-unit edge deviation; continuous floors remain unchanged.

`dust2.re2dmap` is editable data; `dust2.re2dworld` is the native compiled artifact. Rebuild through the existing SDK:

```
build/r2d-sdk world-compile demos/re2d_dust2/dust2.re2dmap --renderer --output demos/re2d_dust2/dust2.re2dworld
```

The map has 137 XY cells, 139 free spans, 393 portals and 1004 canonical surfaces. Two mid cells have lower [0,96] and upper [128,1024] free spans. Three constrained ramps connect ground to height 128. Cover is made from solid wall primitives. Decal site marks use bounded floor UVs. Outdoor spans and connecting outdoor openings extend to height1024, leaving air above the authored walls (height360); club/tunnel ceilings remain closed. Panorama is a directional background, not a 3D dome or a wall-height texture. The demo starts at T spawn; key8 visits the club.

`routes.json` supplies named cameras, zones, door IDs and the original minimap. It configures gameplay/HUD; C owns rendering, BSP/portal traversal, light culling, shadows, depth, sprite synthesis and resources.

`tests/agent/re2d_dust2_test.py` validates all seven real frames, continuous T→mid→CT→A→long→T, T→tunnels→B→CT, short ramp/catwalk, stacked spans, door open/closed collision, outer boundary and CPU/GPU tunnel parity. It also checks six enlarged NPCs, mouse/Space input, ground acceleration/friction, air strafing, ceiling collisions, and all three ramps in both directions with and without repeated jumps. Passing these tests proves the reference routes and renderer integration; it does not claim competitive Counter-Strike gameplay, exact scale or a full shooter game.

The native SDK splits generated portals along varying slope edges into up to 256 rectangular pieces (one-unit edges on this map). This preserves visibility beside the low part of a ramp without changing continuous floors or introducing a mesh scene. The integration regression checks a real low-camera frame for the former sky hole.

The club opens east of Long/T through two doors. Four native lights cycle pink/blue/purple/yellow and intensity; speaker props and a mascot occupy the room. The supplied `club_loop.mp3` loops at a positioned speaker via `$.re2dWorldAudio(world)`. Native world walls, ceilings and closed doors attenuate/filter the direct sound; Steam Audio supplies binaural PCM processing only. Use headphones. See [world audio](../../docs/re2d/WORLD_AUDIO.md) for the API and limits.

The elevated Short NPC at (1200,1040,128) starts her supplied Suzu MP3 monologue when the player approaches within250 units in direct view. During speech she cycles the imported talking, standing-arguing and walk-in-circle Re2DSprite clips every4.2 seconds. Her existing Re2DSprite `headYaw` control looks toward the player up to32 degrees; the additive `bodyYaw` control follows the remaining turn at75 degrees/second, so the head never twists past its limit and the imported pose remains active. Native World audio applies distance, roof/wall occlusion and HRTF. She can speak again after the player leaves620 units. The HUD has no dialogue overlay; its title reads `Руссиано2Д - РЕ2Д ТЕСТ 0.2`.

The original FBXs are in `source/`. Rebuild the combined clips with `python3 demos/re2d_dust2/import_npc_animations.py` after running `cmake --build build --target r2d-sdk`. It selects FBX stack `mixamo.com` (each supplied file also has a shorter Take 001 stack), bakes15 samples/second with a0.15-second seam and preserves the base idle/expression clips. Runtime reads `npc.animations.json`; it does not parse FBX.

All five crates now have native floor lids and solid volumes. `close_crates.py` partitions authored cells along existing crate-wall footprints, retaining original portal IDs/indices and appending extra apertures. It is an authoring tool for this demo, not a new mesh API. Run it after editing crates, then recompile. The B mascot was moved off its crate footprint.

Player footsteps use nine alternating samples after each72 units of actual grounded travel (90 when running), with positional feet-level HRTF and priority0; standing still, pushing against a wall and airborne movement do not accumulate steps. Wind loops above the player at height800, using the same native ceiling obstruction as club music. Indoors the direct signal gets factor.18 and700Hz low-pass, with existing smoothing; outdoors it restores22kHz. This models direct obstruction, not room reverberation/diffraction. Audio sources/license/conversion are in [audio/CREDITS.md](audio/CREDITS.md). Dedicated integration: `tests/agent/re2d_dust2_props_audio_test.py`.

The high outdoor headroom leaves air above height360 boundary walls; the SDK currently reports79 `SDK_WORLD_OPEN_EDGE` authoring warnings there. They are recorded rather than hidden; no compile errors. Future SDK authoring diagnostics should distinguish intentional outdoor sky clearance from accidental openings.
