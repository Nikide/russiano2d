# Russiano2D 1.3.2 — 2026-10-20

23 коммита в релизе.

### Сборка и версии

- fix(release): allow binaries inside macOS app bundle (`02fd12b6c`)
- fix(release): retry macOS package cleanup races (`16b75519c`)
- release_publish: publish three platforms by default; Linux only with R2D_BUILD_LINUX=1 (`3330cbf56`)

### Прочее

- fix(macos): keep SDK runtime in app process (`0049d4763`)
- fix(macos): bundle SDK UI and backend assets (`29683120e`)
- feat(macos): package SDK as Finder app (`38184600c`)
- feat(sprite-mesh): complete V1 authoring pipeline (`316d785e2`)
- feat(sdk): bake SpriteMesh cache for atlas frames (`8175bd2fe`)
- feat(sprite-mesh): cache meshes for all frames (`209c72f96`)
- feat(sprite-mesh): add frame extrusion generator (`02bfc2487`)
- ux(sdk): use material icons in world editor (`6f539c602`)
- ux(sdk): translate common tool controls (`0e673f0e4`)
- ux(sdk): localize tool catalog and world studio (`6ca9783de`)
- ux(sdk): simplify and localize world editor (`f2368049a`)
- fix(sdk): improve editor tool routing and map guidance (`e619b135e`)
- demo(sdk): integrate 2d and re2d showcase (`6f9af77e2`)
- demo(sdk): scaffold multi-tool showcase project (`1a82dff75`)
- docs(sdk): record studio editing audit (`36b4e430a`)
- sdk: compact studio diagnostics and verify editing (`b8158be95`)
- sdk: compact workspace and diagnostics (`bbf65c659`)
- docs(sdk): refresh verification audit (`e80923871`)
- tests: avoid false failure in world editor runner (`da98fea7a`)
- sdk: make tool catalog easier to navigate (`76499f0b3`)
