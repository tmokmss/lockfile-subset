# lockfile-subset

Extract a subset of `package-lock.json` or `pnpm-lock.yaml` for specified packages and their transitive dependencies.

## Why?

When using bundlers like esbuild with `--external`, you need to ship those external packages separately (e.g., in a Docker multi-stage build or Lambda layer). Getting the exact right set of dependencies is surprisingly hard:

| Approach | Problem |
|---|---|
| Manually copy `node_modules` dirs | Breaks when transitive deps change (e.g., Prisma v6 added new deps) |
| `npm install <pkg>` in runner stage | Resolves versions independently — may differ from your lockfile |
| `npm ci --omit=dev` | Installs *all* prod dependencies, not just the ones you need |
| `pnpm deploy` | Only works with workspaces, not arbitrary packages |

**lockfile-subset** solves this by extracting a precise subset from your existing lockfile — only the packages you specify and their transitive dependencies, with versions exactly matching the original lockfile.

## Install

```bash
npm install -g lockfile-subset
# or use directly with npx
npx lockfile-subset
```

## Usage

```bash
# Extract @prisma/client and sharp with their transitive deps
lockfile-subset @prisma/client sharp

# Specify output directory
lockfile-subset @prisma/client sharp -o /standalone

# Use a different lockfile path
lockfile-subset @prisma/client sharp -l /build/package-lock.json

# Use a pnpm lockfile
lockfile-subset @prisma/client sharp -l pnpm-lock.yaml

# Generate + install in one step
lockfile-subset @prisma/client sharp -o /standalone --install

# Preview without writing files
lockfile-subset chalk --dry-run
```

The lockfile type (npm or pnpm) is auto-detected from the project directory. This generates a minimal `package.json` and lockfile in the output directory. Then run `npm ci` or `pnpm install --frozen-lockfile` to install exactly those packages.

### Dockerfile example

```dockerfile
# === Builder ===
FROM node AS builder
WORKDIR /build
COPY package*.json ./
RUN npm ci

COPY . .
RUN npx esbuild src/index.ts --bundle --outdir=dist \
    --external:@prisma/client --external:sharp

# Generate subset lockfile + install
RUN npx lockfile-subset @prisma/client sharp \
    -o /standalone --install

# === Runner ===
FROM node AS runner
WORKDIR /app

# Only the packages you need, at exact lockfile versions
COPY --from=builder /standalone/node_modules ./node_modules
COPY --from=builder /build/dist ./dist

CMD ["node", "dist/index.js"]
```

### Options

Run `lockfile-subset --help` for the full list of options.

## How it works

1. Loads your lockfile (`package-lock.json` via [@npmcli/arborist](https://github.com/npm/cli/tree/latest/workspaces/arborist), or `pnpm-lock.yaml` directly)
2. Starting from the specified packages, walks the dependency tree via BFS to collect all transitive dependencies
3. Copies the matching entries from the original lockfile — no re-resolution, no version drift
4. Outputs a minimal `package.json` + lockfile ready for `npm ci` or `pnpm install --frozen-lockfile`

Dev dependencies of each package are excluded from traversal. Optional dependencies are included by default (use `--no-optional` to exclude).

## Supported lockfile formats

| Package manager | Lockfile | Supported versions |
|---|---|---|
| npm | `package-lock.json` | v2 (npm 7-8), v3 (npm 9+) |
| pnpm | `pnpm-lock.yaml` | v9 (pnpm 9-10) |

## Limitations

- **yarn is not supported** — yarn users can use `yarn workspaces focus`.
- **Platform-specific optional deps** — Packages like `sharp` have OS/arch-specific optional dependencies (e.g., `@img/sharp-linux-x64`). If your lockfile was generated on macOS but you run `npm ci` on Linux (e.g., in Docker), those Linux-specific packages may be missing from the lockfile. In that case, generate the lockfile on the target platform, or use `npm install` instead of `npm ci`.

## License

MIT
