# Re2D World audio

World audio uses the existing C audio mixer and `$` wrapper. A world owns sources, not actors or a separate 3D scene. XY cells, vertical free spans, solid walls/floors/ceilings and native portal states are authoritative. Height is a scalar on the 2D world. Rendering and audio use the same camera and geometry.

```js
const audio = $.re2dWorldAudio(world); // same object as world.audio
const music = audio.source('music.mp3', {
    x: 2352, y: 1840, h: 64,
    volume: .7, range: 1300, reference: 130,
    loop: true, hrtf: true, priority: 20
});
music.at(2200, 1800, 64).volume(.5).range(1000);
const state = music.info();
music.stop();
```

`source` defaults: x/y=0, h=48, volume=.7, range=1200, reference=120, loop=true, hrtf=true, priority=20. Range/reference must be positive; volume is 0–1; numeric position/options must be finite. Existing audio file formats and 16 mixer channels apply. The handle exposes `at`, `volume`, `range`, `info`, `stop`; setters return the handle. `info` reports channel, position, distance, target gain, smoothed currentGain, cutoff, occluded, hrtf and playing. It reports the last world frame, not a synchronous new geometry query.

`world.render(camera)` supplies the listener each frame. Alternatively `audio.listener(camera)` sets the world camera and `world.render(null)` uses it. Listener h is eye height; yaw/pitch use the world camera convention. The native world-frame pass updates sources, without JS per-sample processing. Without world frames, listener/source attenuation stays at its previous state. World disposal stops only channels belonging to that world's current source generations; stale handles reject operations after channel reuse.

For distance d, reference r and range R:

```
taper = max(0, 1 - (d/R)^2)
gain = volume * min(1, r/max(r,d)) * taper^2
```

The existing native world ray tests listener→source, excluding endpoints. A direct-path hit multiplies gain by .18 and changes a one-pole low-pass from 22 kHz to 700 Hz. Closed doors and height separation participate in that same test. Gain approaches its target by 20% each rendered frame; this smoothing currently depends on frame rate. This is an authored direct-path approximation, not measured wall transmission, diffraction, reflections or room reverberation. Sprites are not acoustic walls.

Steam Audio 4.8.1 supplies its default HRTF and binaural effect only. Camera-relative right/up/back coordinates drive bilinear HRTF interpolation. Stereo material is downmixed to mono at the positioned source and synthesized to two ears after SDL_mixer resampling. Existing channel effects run before the spatial stage. Fixed 512-frame processing introduces 512 frames of adapter latency (10.67 ms at 48 kHz), in addition to device/mixer latency. Reset on channel reuse clears audio history. No source geometry is copied into a Steam Audio scene or simulator; no UE framework is involved.

Build option `R2D_ENABLE_STEAM_AUDIO` defaults ON. `R2D_STEAM_AUDIO_SDK` may point at an extracted SDK containing include/ and lib/. Otherwise the pinned official archive is downloaded with a verified SHA256. Current integration targets macOS, Linux x86_64 and Windows x64; macOS is verified locally. Other targets/audio-disabled builds do not claim HRTF. If HRTF is requested but unavailable, source creation throws. Explicit `hrtf:false` uses equal-power panning plus the same native attenuation/filter. Headphones are appropriate for binaural output; this is the default dataset, not a personalized HRTF.

Dependency licenses/notices are in `third_party/steam_audio`. CMake installs the runtime library and notices; platform release bundle scripts still require their own end-to-end packaging verification. The user-provided club track is a demo asset; no publication was performed.

Verification: `r2d_audio_spatial_test` checks actual PCM ear asymmetry, front/back/elevation differences, irregular callback chunks, finite output, occlusion filter and transparent bypass. `tests/agent/re2d_world_audio_test.py` checks the actual MP3, distance, open/closed door, ceiling, source coincidence, animated light parameters, stale handles, updates, disposal and validation. These tests do not measure a listener's subjective localization or claim a full acoustic simulation.
