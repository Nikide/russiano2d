# Russiano2D 1.2.4 — 2026-10-17

30 коммитов в релизе.

### Исправления

- Re2D P1-C…F: particles, nav graph, automap, map metadata/spawns (`e29549c5a`)

### Добавлено

- Re2D P1: audio voice virtualization в runtime (`b4fa6842b`)
- Re2D P2: animated materials (scroll/emissive) в runtime и $ API (`e4b7350b9`)
- Re2D P0-A: нативные atlas world sprites вместо ui.image оверлея (`fbcc5cdee`)

### Удалено и изменено

- Re2D P2: mirror pass clipping fix (per-subdraw clip rect) (`581f7e639`)

### Тесты и гейты

- demos: sky-lab переключает mirror/sky горячими клавишами (`2f77c0e7c`)
- Re2D P4: nav nodes в debug overlay + capabilities mirror=true (`f352d14ea`)
- Re2D P4/P5: live profiler HUD + mist bands (`a043789e0`)
- Re2D P3: rotating polywall runtime groups (`d854e9a50`)
- Re2D P4: debug overlay draw layer + demo (`5a6217a17`)
- Re2D P1/P3: conveyor gameplay tick (world.conveyorMotion) (`4d39e68b8`)
- Re2D P1: polygon cells compiler tiling + audio zones per span (`4363222da`)
- Re2D P2/P4: postprocess stack, aim assist, quality/feel presets, debug entities + audio cores (`d6ca907f1`)
- Re2D P2: volumetric sprites + P1/P3 polygon & polywall cores (`ac70b73fe`)
- Re2D P1-H…J + P2 cores: save/load, secrets, terrain, portal math, volumes, material anim (`544baeeac`)
- Re2D P1-B: passenger carry на лифте и crusher-контакт для mover (`e7502d953`)
- Re2D P0-C…P0-H: controller, semantic IDs, movers, triggers, viewmodel, native gate (`511997a97`)
- Re2D P0-B: world.trace/hit в $ API + JS-контракт (`8bbf25d48`)

### Прочее

- Re2D P2: mirror portal (scissored reflected-world pass) (`824ad2f0d`)
- docs Re2D: dynamic nav masks и P3 progress (`ab222b391`)
- Re2D P3: dynamic nav masks (blocked spans/portals без rebuild) (`fda16a8ac`)
- Re2D P2: sky portal (visibility window) + save persistence (`769f3340a`)
- Re2D P2: impactInfo/ricochet + surfaceMaterialName (`fd1eba505`)
- Re2D P4: debug overlay data + determinism audit (`846a43649`)
- Re2D P3: multi-zone boss hit proxies (`31d5f8e44`)
- Re2D P1/P2: save secrets/breakables, sky animation, fog zones (`e230096d6`)
- Re2D P4: benchmark lab со сценариями и честными native-числами (`0943122e3`)
- Re2D P4: capabilities API + profiler fields для trace/controller/nav/audio (`ad7e5f2c3`)
- Re2D P1-G: VFX bundles поверх particles/light/decal/sound (`1101516b7`)
- Re2D P1-A: Portals 2.0 — плавная open fraction вместо бинарного closed (`52faa99b1`)
