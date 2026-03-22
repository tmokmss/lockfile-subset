# lockfile-subset

Extract a subset of `package-lock.json` for specified packages and their transitive dependencies.

## Why?

When using bundlers like esbuild with `--external`, you need to ship those external packages separately (e.g., in a Docker multi-stage build or Lambda layer). Getting the exact right set of dependencies is surprisingly hard:

| Approach | Problem |
|---|---|
| Manually copy `node_modules` dirs | Breaks when transitive deps change (e.g., Prisma v6 added new deps) |
| `npm install <pkg>` in runner stage | Resolves versions independently — may differ from your lockfile |
| `npm ci --omit=dev` | Installs *all* prod dependencies, not just the ones you need |

**lockfile-subset** solves this by extracting a precise subset from your existing `package-lock.json` — only the packages you specify and their transitive dependencies, with versions exactly matching the original lockfile.

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
lockfile-subset @prisma/client sharp --lockfile /build/package-lock.json

# Generate + install in one step
lockfile-subset @prisma/client sharp -o /standalone --install

# Preview without writing files
lockfile-subset prisma --dry-run
```

This generates a minimal `package.json` and `package-lock.json` in the output directory. Then run `npm ci` to install exactly those packages at the exact versions from your original lockfile.

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

```
lockfile-subset <packages...> [options]

Arguments:
  packages                  Package names to extract (space-separated)

Options:
  --lockfile, -l <path>     Path to project directory (default: .)
  --output, -o <dir>        Output directory (default: ./lockfile-subset-output)
  --no-optional             Exclude optional dependencies
  --install                 Run npm ci after generating the subset
  --dry-run                 Print the result without writing files
  --version, -v             Show version
  --help, -h                Show help
```

## How it works

1. Loads your `package-lock.json` using [`@npmcli/arborist`](https://github.com/npm/cli/tree/latest/workspaces/arborist) (npm's own dependency resolver)
2. Starting from the specified packages, walks the dependency tree via BFS to collect all transitive dependencies
3. Copies the matching entries from the original lockfile — no re-resolution, no version drift
4. Outputs a minimal `package.json` + `package-lock.json` ready for `npm ci`

Dev dependencies of each package are excluded from traversal. Optional dependencies are included by default (use `--no-optional` to exclude).

## Limitations

- **npm only** — pnpm and yarn have different lockfile formats. pnpm users can use `pnpm deploy`; yarn users can use `yarn workspaces focus`.
- **Platform-specific optional deps** — Packages like `sharp` have OS/arch-specific optional dependencies (e.g., `@img/sharp-linux-x64`). If your lockfile was generated on macOS but you run `npm ci` on Linux (e.g., in Docker), those Linux-specific packages may be missing from the lockfile. In that case, generate the lockfile on the target platform, or use `npm install` instead of `npm ci`.

## License

MIT
