#pragma once
// Internal API between r2d commands (api/docs/doctor): one runtime snapshot,
// multiple generated artifacts. Not part of the runtime/SDK public ABI.
#include "sdk.h"

R2dJson *sdk_api_snapshot(const SdkArgs *a, SdkReport *rep, char **raw_out);
void sdk_api_schema_text(const R2dJson *root, R2dSb *out);
void sdk_api_dts_text(const R2dJson *root, R2dSb *out);
void sdk_api_docs_text(const R2dJson *root, R2dSb *out);
