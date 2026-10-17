#pragma once
// Machine-readable public `$` API metadata for r2d-sdk `api dump`.
// The runtime is the single source of truth: this JS snapshot walks the live
// `$` object and `engine` bindings after scripts load, so a new `$` method is
// visible to SDK tooling without a second hand-written list.
const char *r2d_api_metadata_script(void);
