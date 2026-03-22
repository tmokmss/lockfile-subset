# CLAUDE.md

## Build & Test

- `npm run build` — build with tsdown
- `npm test` — run tests with vitest
- `npm run test:watch` — watch mode

## Release

Pushes to main trigger automatic releases via semantic-release.
Publishing to npm uses Trusted Publishing (OIDC) — no NPM_TOKEN needed.

**Important: PR titles must follow Conventional Commits format.**
GitHub squash merge uses the PR title as the commit message.
`feat:` triggers a minor release. Most types trigger a patch release.
`ci`, `test`, `build`, `style` do NOT trigger a release.

Examples:
- `feat: add lockfile v2 support` → minor release
- `fix: handle scoped packages correctly` → patch release
- `chore: update dependencies` → patch release
- `ci: update workflow` → no release
- `feat!: change output format` or `BREAKING CHANGE` in body → major release
