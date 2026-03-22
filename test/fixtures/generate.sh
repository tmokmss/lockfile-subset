#!/bin/bash
# Generate lockfile fixtures for v1, v2, v3 using Docker
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

PACKAGE_JSON='{
  "name": "fixture-test",
  "version": "1.0.0",
  "dependencies": {
    "chalk": "^4.1.2",
    "ms": "^2.1.3"
  },
  "devDependencies": {
    "semver": "^7.5.0"
  }
}'

generate() {
  local dir="$1"
  local image="$2"
  local label="$3"

  echo "=== Generating $label fixture with $image ==="
  mkdir -p "$dir"
  echo "$PACKAGE_JSON" > "$dir/package.json"

  docker run --rm \
    -v "$dir:/work" \
    -w /work \
    "$image" \
    sh -c 'npm install --ignore-scripts 2>&1 && echo "lockfileVersion: $(node -e "console.log(require(\"./package-lock.json\").lockfileVersion)")" && npm --version'

  # Remove node_modules from fixture (only need lockfile)
  rm -rf "$dir/node_modules"
  echo ""
}

# v1: npm 6 (Node 10)
generate "$SCRIPT_DIR/lockfile-v1" "node:10-slim" "lockfile v1"

# v2: npm 8 (Node 16)
generate "$SCRIPT_DIR/lockfile-v2" "node:16-slim" "lockfile v2"

# v3: npm 10 (Node 22)
generate "$SCRIPT_DIR/lockfile-v3" "node:22-slim" "lockfile v3"

echo "=== Done ==="
