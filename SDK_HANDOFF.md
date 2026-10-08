# SDK Handoff

Last updated: 2026-10-08 (Europe/Moscow)

## Current status

The root specification is [Следующая цель SDK AGENT.md](Следующая%20цель%20SDK%20AGENT.md).
It has been updated with the current agreed direction. This is a documentation
specification; the SDK launcher, `sdk_tools.json`, and SDK tools have not been
implemented in this session.

## Decisions captured in the specification

- The SDK itself is an R2D application built on the R2D runtime. Its UI uses
  RmlUi.
- The public application API is C → `$`. Private `engine.*` bindings still
  exist internally in QuickJS modules; application and SDK code must not expose
  or use them as a second public API.
- Capabilities needed by both games and the SDK belong in `$`; tool-only
  operations remain tool-only.
- SDK tool backends and agent client/protocol components must be native C
  binaries. No Python, Node.js, Ruby, shell scripts, or external scripting
  runtimes for SDK tools.
- No ImGui UI. The existing debug overlay is legacy and must be removed or
  replaced with RmlUi.
- Engine and SDK are AI-first. SDK agents retain parity with the current engine
  agent protocol and gain machine access to SDK operations. Extending the
  existing SDK agent module is allowed; a parallel agent stack is not.
- Re2D World/BSP Studio should be a more capable, R2D-specific editor inspired
  by Valve Hammer, not a direct copy or a universal scene editor.
- One SDK Launcher/Manager discovers all components from root `sdk_tools.json`
  entries with a stable id, name, description, ISO 8601 `last_updated`, and
  entry point.
- Every SDK session/agent reads and updates this shared handoff.

## Work completed this session

- Updated `Следующая цель SDK AGENT.md` with the above architecture and
  acceptance rules.
- Reviewed current agent command headings in `docs/AGENT_API.md` and checked the
  QuickJS/private `engine.*` boundary in `src/highlevel/bootstrap.js`,
  `src/highlevel/native.js`, and `src/script.c`.
- No engine or SDK implementation code was changed. No tests were run; this
  session reviewed and edited documentation only.

## Before continuing

1. Check `git status` first. The repository already had many unrelated modified,
   deleted, and untracked files before these documentation edits; preserve them.
2. Read this handoff and `Следующая цель SDK AGENT.md`, then verify live code
   before treating any planned feature as implemented.
3. A useful next step is an implementation audit/plan for the single R2D-based
   launcher and `sdk_tools.json`, including the C-only tool/backend boundary and
   agent parity. Do not claim the launcher or manifest exists until created.

