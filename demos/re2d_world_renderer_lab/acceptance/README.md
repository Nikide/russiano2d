# Full renderer acceptance lab

Launch `build/russiano2d --game demos/re2d_world_renderer_lab/acceptance --seed 7` from the repository root. Keys 1–7 select corridor/upper/bridge/fog/stairs/ramp/glass, E switches storey, O closes the doorway, Space fires a timed native flash, M toggles moving light, F2 cycles diagnostics, WASD/arrows move/look.

The compiled native map supplies a bright starting room, dark lower room, red upper room, corridor and door, four steps, upper floor/room-over-room/solid bridge, continuous ramp, glass window, blue fog, emissive panel, normal wall and sixteen authored lights. A moving red native lamp at upper-storey height 208 and muzzle flashes exercise updates/lifetimes. Three Re2DSprites include two pigs at exactly the same XY on different floors and the lower pig's native AK attachment. `acceptanceMoving` is a public demo switch for deterministic acceptance capture.

Pig data independently extends the repository's existing animal surface/rig template with pink material, snout/ears/eyes and an equipment socket. The inspectable surface and character JSON compile through existing `tools/compile_rotsprite.py`; the result remains an ordinary Re2DSprite PNG, not a world mesh. Other materials and AK/character assets reuse project originals.

Native SDK recompilation:

```
build/r2d-sdk world-compile demos/re2d_world_renderer_lab/acceptance/acceptance.re2dmap --renderer --output demos/re2d_world_renderer_lab/acceptance/acceptance.re2dworld
```

`tests/agent/re2d_world_acceptance_test.py` exercises the final acceptance conditions in the actual native runtime. The parent lab stays unchanged as the six-camera golden fixture.
