# CI migration

CI is configured only in `.github/workflows/build.yml` (GitHub Actions).
The previous GitLab and GitVerse configurations are preserved here with
`.disabled` extensions, outside their providers' workflow directories.

`build_and_push.sh` defaults to the `github` remote, bumps the patch version,
builds locally, commits and pushes the current branch plus a new annotated
`vX.Y.Z` tag. CI triggers only on new version tags, not branch pushes or PRs.
Existing tags are never overwritten. Old remotes remain unchanged.

The initial workflow builds Linux Debug and runs nine existing native regression
executables. GPU/agent, JavaScript, Windows, macOS and release jobs are not yet
configured. The hosted workflow must be verified after the first push.

Removing a configuration locally does not change the configuration already
present on old remote branches. No push to hub.mos.ru or GitVerse was performed.
