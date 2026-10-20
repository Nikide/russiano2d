# Russiano2D 1.3.1 — 2026-10-20

4 коммита в релизе.

### Сборка и версии

- release_build: Zig requirement only for opt-in Linux; docs match (`198cd37a4`)
- Release: exclude linux-x86_64 from local build_and_push by default (Zig cross hangs); Linux builds on target OS, R2D_BUILD_LINUX=1 opts in (`34a39a5bc`)

### Прочее

- Revert accidental version bump: FINAL ENGINE PASS must not change version (`916332ceb`)
- FINAL ENGINE PASS follow-up: tilemap terrain/anim, RmlUi font faces, C-replay checkpoints, atlas grace, test/docs reality (`e69021f9c`)
