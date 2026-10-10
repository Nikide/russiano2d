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

The original Dust2 part has 137 XY cells, 139 free spans, 393 portals and 1004 canonical surfaces; with the annex below the compiled map is 312 cells, 315 spans, 650 portals and 1891 surfaces. Two mid cells have lower [0,96] and upper [128,1024] free spans. Three constrained ramps connect ground to height 128. Cover is made from solid wall primitives. Decal site marks use bounded floor UVs. Outdoor spans and connecting outdoor openings extend to height1024, leaving air above the authored walls (height360); club/tunnel ceilings remain closed. Panorama is a directional background, not a 3D dome or a wall-height texture. The demo starts at T spawn; key8 visits the club.

`routes.json` supplies named cameras, zones, door IDs and the original minimap. It configures gameplay/HUD; C owns rendering, BSP/portal traversal, light culling, shadows, depth, sprite synthesis and resources.

`tests/agent/re2d_dust2_test.py` validates all seven real frames, continuous T→mid→CT→A→long→T, T→tunnels→B→CT, short ramp/catwalk, stacked spans, door open/closed collision, outer boundary and CPU/GPU tunnel parity. It also checks six enlarged NPCs, mouse/Space input, ground acceleration/friction, air strafing, ceiling collisions, and all three ramps in both directions with and without repeated jumps. Passing these tests proves the reference routes and renderer integration; it does not claim competitive Counter-Strike gameplay, exact scale or a full shooter game.

The native SDK splits generated portals along varying slope edges into up to 256 rectangular pieces (one-unit edges on this map). This preserves visibility beside the low part of a ramp without changing continuous floors or introducing a mesh scene. The integration regression checks a real low-camera frame for the former sky hole.

The club opens east of Long/T through two doors. Four native lights cycle pink/blue/purple/yellow and intensity; speaker props and a mascot occupy the room. The supplied `club_loop.mp3` loops at a positioned speaker via `$.re2dWorldAudio(world)`. Native world walls, ceilings and closed doors attenuate/filter the direct sound; Steam Audio supplies binaural PCM processing only. Use headphones. See [world audio](../../docs/re2d/WORLD_AUDIO.md) for the API and limits.

The elevated Short NPC at (1200,1040,128) starts her supplied Suzu MP3 monologue when the player approaches within250 units in direct view. During speech she cycles the imported talking, standing-arguing and walk-in-circle Re2DSprite clips every4.2 seconds. Her existing Re2DSprite `headYaw` control looks toward the player up to32 degrees; the additive `bodyYaw` control follows the remaining turn at75 degrees/second, so the head never twists past its limit and the imported pose remains active. Native World audio applies distance, roof/wall occlusion and HRTF. She can speak again after the player leaves620 units. The HUD has no dialogue overlay; its title reads `Руссиано2Д - РЕ2Д ТЕСТ 0.2`.

The original FBXs are in `source/`. Rebuild the combined clips with `python3 demos/re2d_dust2/import_npc_animations.py` after running `cmake --build build --target r2d-sdk`. It selects FBX stack `mixamo.com` (each supplied file also has a shorter Take 001 stack), bakes15 samples/second with a0.15-second seam and preserves the base idle/expression clips. Runtime reads `npc.animations.json`; it does not parse FBX.

All five crates now have native floor lids and solid volumes. `close_crates.py` partitions authored cells along existing crate-wall footprints, retaining original portal IDs/indices and appending extra apertures. It is an authoring tool for this demo, not a new mesh API. Run it after editing crates, then recompile. The B mascot was moved off its crate footprint.

Player footsteps use nine alternating samples after each72 units of actual grounded travel (90 when running), with positional feet-level HRTF and priority0; standing still, pushing against a wall and airborne movement do not accumulate steps. Wind loops above the player at height800, using the same native ceiling obstruction as club music. Indoors the direct signal gets factor.18 and700Hz low-pass, with existing smoothing; outdoors it restores22kHz. This models direct obstruction, not room reverberation/diffraction. Audio sources/license/conversion are in [audio/CREDITS.md](audio/CREDITS.md). Dedicated integration: `tests/agent/re2d_dust2_props_audio_test.py`.

The high outdoor headroom leaves air above height360 boundary walls; the SDK currently reports79 `SDK_WORLD_OPEN_EDGE` authoring warnings there. They are recorded rather than hidden; no compile errors. Future SDK authoring diagnostics should distinguish intentional outdoor sky clearance from accidental openings.

## Annex: большое крыло для проверки графики

East of the club a second wing continues the map (club door → blue gate): 173 new cells, two ramps, 9 doors, a stacked atrium, 32 static + 8 dynamic lights. Camera shortcuts: `Tab` cycles `ANNEX GATE`, `MAZE`, `GRAND HALL`, `SERVER`, `TOXIC`, `OFFICES`, `ATRIUM LOW`, `MEZZANINE`, `YARD`.

| Room | What it checks |
| --- | --- |
| Blue gate (fog corridor) | per-span coloured fog, flickering static blue lights |
| Brick maze (6×6, DFS) | very dark ambient, normal-mapped brick, red flicker lights, muzzle-flash shadows |
| Grand hall (10×7, 7 pillars) | tile floor, emissive neon strips, magenta/cyan orbiting dynamic lights, many shadows |
| Server room | near-zero ambient, emissive LED racks, pulsing red alarm light, grate window (masked) |
| Toxic pool | emissive floor, dense green fog, sunk pool floor (−32) with ramp, hazard trim |
| Three offices | wood/carpet/tile, warm/pink/cold coloured lights, translucent glass window |
| Atrium | **two free spans at the same XY** (lower 0..224, mezzanine 288..544), multiple openings in one boundary |
| Service corridor + ramp | haze fog, a 288-high ramp that reaches the mezzanine |
| Yard | outdoor sky, raised cover blocks (56..200), daylight and dust fog |

Data flow: `build_annex.py` appends everything (ids start with `a_`; idempotent) to `dust2.re2dmap` and writes `annex*` keys to `routes.json`; the native SDK compiles it:

```
python3 demos/re2d_dust2/make_annex_assets.py      # procedural textures + loopable sounds into annex/
python3 demos/re2d_dust2/build_annex.py
build/r2d-sdk world-compile demos/re2d_dust2/dust2.re2dmap --renderer --output demos/re2d_dust2/dust2.re2dworld
python3 demos/re2d_dust2/build_annex.py --doors    # maps annex door portals to compiled indices
```

Walls are emitted pre-split around openings so the compiled authored-wall order of the original map is unchanged (the original material/tag mapping by index keeps working). The compile reports 107 `SDK_WORLD_OPEN_EDGE` warnings: 29 are the intentional open yard sky, the rest are the original outdoor headroom.

**HRTF everywhere:** 17 positional ambience sources (server hum, fans, alarm, toxic bubbling, drips, ticks, water, crackle, rumble, buzz) are generated by `make_annex_assets.py` (no third-party audio; originals, no licence). Only the six nearest in range stay alive because the mixer has 16 channels shared with steps, wind, music and voices; every one is created with `hrtf:true`. Doors play open/close sounds at the door and `F`/LMB plays a shot at the player, both through the same HRTF path.

**Guns are Re2DSprite only.** Seven weapons (`ak47`, `pistol`, `revolver`, `shotgun`, `smg`, `sniper`, `lmg`) are the first-person viewmodel (`C` cycles, recoil kick on `F`) and the five annex NPCs hold `smg`/`pistol`/`sniper`/`shotgun`/`lmg` through the normal equipment sockets. See [weapons README](../rotsprite/weapons/README.md).

Test: `python3 tests/agent/re2d_dust2_annex_test.py` (all annex cameras, same-XY spans, the full club → hall → atrium → yard → ramp → mezzanine walk, door close/open collision, HRTF channel budget, guns).

## Игрок: AKS-74U с руками, HRTF-звук и свет мира

Основное оружие — анимированный AKS-74U (FBX, 11 клипов), запечённый SDK покадрово: `build/r2d-sdk bake-re2d … --fbx-stack клип --fbx-time t --scale 55 --pivot …`
(`aks74u/bake_aks74u.py <папка с FBX и текстурами>`; сам FBX и 40 МБ текстур в репозиторий не входят). Кадры — 31 обычный Re2DSprite: `idle`, `draw`, `fire`, `reload`.
Управление: ЛКМ или `F` — огонь (автомат), `R` — перезапись магазина, `C` — другое оружие (8 штук), `X` — сброс позиции.
Выстрел, гильза, перезарядка, пустой магазин, попадание и рикошет — звуки пака Free Gun Sounds через HRTF в точке дула/попадания;
вспышка — аддитивный спрайт + короткий свет с тенью. Оружие тонируется `world.lightAt` в точке игрока: в тёмной комнате оно тёмное, в красном свете — красное.
Скриншоты формата: viewmodel — 2D-узел поверх кадра мира, не меш; ограничение формата Re2DSprite (≤49 152 отсчётов) видно как блочность при таком увеличении.

## Карта 2 — горящий объект (клавиша `0`)

Отдельный мир внутри той же демки: `fire/fire.re2dmap` → `fire/fire.re2dworld`, второй `$.re2dWorld` со своими материалами и звуком; `0` переключает мир
(главное — подменяются `world` и `clubAudio`), повторное `0` возвращает на то же место в Dust2. Пять комнат: пульт, коридор с красными аварийными панелями,
серверный зал со стойками, реакторный зал с ямой, склад. Тёмно, дым, 9 очагов (штатные `$.particles.preset('fire'|'smoke')`), случайные взрывы
(`explosion`/`sparks` + вспышка света + тряска + звук), сирена (присланный mp3) из четырёх динамиков через HRTF. Сборка:

```
python3 demos/re2d_dust2/fire/build_fire.py
build/r2d-sdk world-compile demos/re2d_dust2/fire/fire.re2dmap --renderer --output demos/re2d_dust2/fire/fire.re2dworld
```

Зомби (8): Re2D-персонаж из присланного Mixamo FBX (`zombie/bake_zombie.py`: `bake-re2d --type character --fbx-rot` для A-позы, ходьба через `animation-import`,
`hit`/`death` — существующие клипы `demos/re2d_npcs/animations.json`). Слышат выстрелы и взрывы, видят по лучу, обходят препятствия, кусают при контакте (−10 HP);
рычание, укус и смерть — процедурные звуки (`make_annex_assets.py`) через HRTF в точке зомби. 3 попадания убивают. Смерть игрока — перезапуск сцены через 3 с.
Известное ограничение движка: камера ровно на ребре клетки (целая координата, кратная 160) даёт вырожденное окно видимости — спавны сдвинуты внутрь клетки.

Тест: `python3 tests/agent/re2d_dust2_annex_test.py`.
