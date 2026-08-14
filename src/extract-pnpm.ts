import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import yaml from 'js-yaml'
import { normalizeWorkspacePath } from './workspace-path.js'
import { expandWildcards } from './wildcard.js'

export interface PnpmExtractOptions {
  projectPath: string
  packageNames: string[]
  includeOptional?: boolean
  /** Importer path within the lockfile (relative to projectPath, forward slashes). Defaults to "." (root). */
  workspacePath?: string
}

/** pnpm 11 records just the hash; pnpm 9/10 recorded { hash, path }. */
type LockPatchEntry = string | { hash: string; path: string }

interface PnpmLockfile {
  lockfileVersion: string
  settings?: Record<string, unknown>
  catalogs?: Record<string, Record<string, { specifier: string; version: string }>>
  patchedDependencies?: Record<string, LockPatchEntry>
  importers: Record<
    string,
    {
      dependencies?: Record<string, { specifier: string; version: string }>
      devDependencies?: Record<string, { specifier: string; version: string }>
      optionalDependencies?: Record<string, { specifier: string; version: string }>
    }
  >
  packages: Record<string, Record<string, unknown>>
  snapshots: Record<string, { dependencies?: Record<string, string>; optionalDependencies?: Record<string, string> }>
}

export interface PnpmExtractResult {
  type: 'pnpm'
  packageJson: {
    name: string
    version: string
    dependencies: Record<string, string>
  }
  lockfileYaml: PnpmLockfile
  /**
   * Contents for a pnpm-workspace.yaml to place next to the subset, so the
   * install context agrees with every field pnpm's lockfile settings check
   * compares (getOutdatedLockfileSetting). Mirrors the lockfile's `settings`
   * plus install-behavior keys carried from the root pnpm-workspace.yaml.
   */
  workspaceYaml: Record<string, unknown>
  /** Patch files referenced by the subset, to copy into the output directory. */
  patchFiles: Array<{ source: string; relativePath: string }>
  collected: Array<{ name: string; version: string }>
}

/** Parse "name@version" or "@scope/name@version", with optional parenthesized suffixes */
function parseSnapshotKey(key: string): { name: string; version: string; patchHash?: string } {
  // Remove peer dep / patch suffix: "foo@1.0.0(patch_hash=x)(bar@2.0.0)" -> "foo@1.0.0"
  const withoutPeers = key.replace(/\(.*\)$/, '')
  // For scoped packages like @scope/name@version, find the last @
  const lastAt = withoutPeers.lastIndexOf('@')
  if (lastAt <= 0) {
    throw new Error(`Invalid snapshot key: ${key}`)
  }
  return {
    name: withoutPeers.slice(0, lastAt),
    version: withoutPeers.slice(lastAt + 1),
    patchHash: key.match(/patch_hash=([^),]+)/)?.[1],
  }
}

/** Build snapshot key from name and version */
function snapshotKey(name: string, version: string): string {
  return `${name}@${version}`
}

/**
 * Root pnpm-workspace.yaml keys copied verbatim into the subset's generated
 * pnpm-workspace.yaml. These change install behavior but are not recorded in
 * the lockfile: build-script allowlists (both the pnpm 9/10 and pnpm 11
 * spellings), supply-chain policies, and platform selection.
 *
 * Derived from pnpm's own list of install-affecting settings
 * (WORKSPACE_STATE_SETTING_KEYS in
 * https://github.com/pnpm/pnpm/blob/main/pnpm11/workspace/state/src/types.ts),
 * minus keys mirrored from the lockfile's `settings`, keys the lockfile
 * settings check compares (handled elsewhere), and workspace-linking keys
 * meaningless for a single-importer output. Re-check against that list when
 * new pnpm majors add settings.
 *
 * Lockfile-checked fields (overrides, packageExtensions, catalogs, pnpmfile,
 * ignoredOptionalDependencies) are intentionally NOT carried: their effects
 * are already baked into the resolved snapshots, and omitting them from both
 * the subset lockfile and the generated config keeps pnpm's lockfile
 * settings check passing.
 */
const CARRIED_WORKSPACE_KEYS = [
  'allowBuilds',
  'onlyBuiltDependencies',
  'neverBuiltDependencies',
  'ignoredBuiltDependencies',
  'dangerouslyAllowAllBuilds',
  'minimumReleaseAge',
  'minimumReleaseAgeStrict',
  'minimumReleaseAgeExclude',
  'minimumReleaseAgeIgnoreMissingTime',
  'trustPolicy',
  'trustPolicyExclude',
  'trustPolicyIgnoreAfter',
  'supportedArchitectures',
  'nodeLinker',
] as const

function readRootWorkspaceYaml(projectPath: string): Record<string, unknown> {
  const path = join(projectPath, 'pnpm-workspace.yaml')
  if (!existsSync(path)) return {}
  return (yaml.load(readFileSync(path, 'utf8')) as Record<string, unknown>) ?? {}
}

/** Patch paths declared in the root package.json `pnpm.patchedDependencies` (pnpm 9). */
function readRootPackageJsonPatchPaths(projectPath: string): Record<string, string> {
  const path = join(projectPath, 'package.json')
  if (!existsSync(path)) return {}
  return JSON.parse(readFileSync(path, 'utf8')).pnpm?.patchedDependencies ?? {}
}

export async function extractPnpmSubset({
  projectPath,
  packageNames,
  includeOptional = true,
  workspacePath = '.',
}: PnpmExtractOptions): Promise<PnpmExtractResult> {
  const lockfilePath = join(projectPath, 'pnpm-lock.yaml')
  const content = readFileSync(lockfilePath, 'utf8')
  const lockfile = yaml.load(content) as PnpmLockfile

  if (!lockfile.lockfileVersion || !String(lockfile.lockfileVersion).startsWith('9')) {
    throw new Error(
      `pnpm lockfile version ${lockfile.lockfileVersion} is not supported. Please upgrade to pnpm 9+ (lockfile v9).`,
    )
  }

  const importerKey = normalizeWorkspacePath(workspacePath)
  const importer = lockfile.importers[importerKey]
  if (!importer) {
    const available = Object.keys(lockfile.importers).join(', ')
    throw new Error(
      `Importer "${importerKey}" not found in pnpm-lock.yaml. Available importers: ${available}`,
    )
  }

  // Merge prod + optional deps from selected importer (exclude dev)
  interface RootDep { specifier: string; version: string }
  const rootDeps: Record<string, RootDep> = {}
  for (const info of [importer.dependencies, importer.optionalDependencies]) {
    if (!info) continue
    for (const [name, dep] of Object.entries(info)) {
      rootDeps[name] = { specifier: dep.specifier, version: dep.version }
    }
  }

  const resolvedNames = expandWildcards(packageNames, Object.keys(rootDeps))

  // BFS through snapshots
  const keepSnapshots = new Set<string>()
  const keepPackages = new Set<string>()
  const patchHashes = new Set<string>()

  for (const name of resolvedNames) {
    const dep = rootDeps[name]
    if (!dep) {
      throw new Error(`Package "${name}" not found in pnpm-lock.yaml`)
    }
    if (dep.version.startsWith('link:')) {
      throw new Error(`Package "${name}" resolves to a workspace (${dep.version}), not a published package`)
    }

    const key = snapshotKey(name, dep.version)
    const queue: string[] = [key]

    while (queue.length > 0) {
      const current = queue.shift()!
      if (keepSnapshots.has(current)) continue
      keepSnapshots.add(current)

      // Also track the package entry (without peer suffix)
      const parsed = parseSnapshotKey(current)
      keepPackages.add(snapshotKey(parsed.name, parsed.version))
      if (parsed.patchHash) patchHashes.add(parsed.patchHash)

      const snapshot = lockfile.snapshots[current]
      if (!snapshot) continue

      if (snapshot.dependencies) {
        for (const [depName, depVersion] of Object.entries(snapshot.dependencies)) {
          if (depVersion.startsWith('link:')) continue
          const depKey = snapshotKey(depName, depVersion)
          if (!keepSnapshots.has(depKey)) queue.push(depKey)
        }
      }

      if (includeOptional && snapshot.optionalDependencies) {
        for (const [depName, depVersion] of Object.entries(snapshot.optionalDependencies)) {
          if (depVersion.startsWith('link:')) continue
          const depKey = snapshotKey(depName, depVersion)
          if (!keepSnapshots.has(depKey)) queue.push(depKey)
        }
      }
    }
  }

  // Use the original specifier in both manifest and lockfile so pnpm's
  // manifest↔lockfile cross-check succeeds. `catalog:` specifiers are
  // replaced with the catalog's own specifier, because the subset drops the
  // lockfile's `catalogs` section and installs without catalog definitions.
  const resolveSpecifier = (name: string, specifier: string): string => {
    if (!specifier.startsWith('catalog:')) return specifier
    const catalogName = specifier.slice('catalog:'.length) || 'default'
    const entry = lockfile.catalogs?.[catalogName]?.[name]
    if (!entry) {
      throw new Error(
        `Catalog entry for "${name}" ("${specifier}") not found in pnpm-lock.yaml`,
      )
    }
    return entry.specifier
  }

  const dependencies: Record<string, string> = {}
  for (const name of resolvedNames) {
    dependencies[name] = resolveSpecifier(name, rootDeps[name].specifier)
  }

  // Build subset lockfile
  const subsetPackages: Record<string, Record<string, unknown>> = {}
  for (const key of keepPackages) {
    if (lockfile.packages[key]) {
      subsetPackages[key] = lockfile.packages[key]
    }
  }

  const subsetSnapshots: Record<string, { dependencies?: Record<string, string>; optionalDependencies?: Record<string, string> }> = {}
  for (const key of keepSnapshots) {
    if (lockfile.snapshots[key]) {
      subsetSnapshots[key] = lockfile.snapshots[key]
    }
  }

  const subsetImporter: PnpmLockfile['importers']['.'] = {
    dependencies: {},
  }
  for (const name of resolvedNames) {
    subsetImporter.dependencies![name] = {
      specifier: dependencies[name],
      version: rootDeps[name].version,
    }
  }

  // Patched packages keep their `(patch_hash=…)` snapshot suffix, so the
  // matching `patchedDependencies` entries and patch files must travel with
  // the subset — otherwise pnpm installs them silently unpatched. The lockfile
  // only records the hash (pnpm 11), so patch file paths come from the root
  // config — pnpm-workspace.yaml (pnpm 10+) or package.json
  // `pnpm.patchedDependencies` (pnpm 9) — falling back to the lockfile entry
  // itself (pnpm 9/10 lockfiles record { hash, path }).
  const rootWorkspaceYaml = readRootWorkspaceYaml(projectPath)
  const configPatchPaths: Record<string, string> = lockfile.patchedDependencies
    ? {
        ...readRootPackageJsonPatchPaths(projectPath),
        ...(rootWorkspaceYaml.patchedDependencies as Record<string, string> | undefined),
      }
    : {}
  const subsetPatched: Record<string, LockPatchEntry> = {}
  const patchPaths: Record<string, string> = {}
  for (const [key, entry] of Object.entries(lockfile.patchedDependencies ?? {})) {
    const hash = typeof entry === 'string' ? entry : entry.hash
    if (!patchHashes.has(hash)) continue
    const path = configPatchPaths[key] ?? (typeof entry === 'object' ? entry.path : undefined)
    if (!path) {
      throw new Error(
        `Patched dependency "${key}" is in pnpm-lock.yaml but its patch file path was not found in pnpm-workspace.yaml or package.json`,
      )
    }
    if (!existsSync(join(projectPath, path))) {
      throw new Error(`Patch file for "${key}" not found at ${join(projectPath, path)}`)
    }
    subsetPatched[key] = entry
    patchPaths[key] = path
    patchHashes.delete(hash)
  }
  if (patchHashes.size > 0) {
    throw new Error(
      `Snapshots reference patch hashes with no matching patchedDependencies entry in pnpm-lock.yaml: ${[...patchHashes].join(', ')}`,
    )
  }
  const patchFiles: PnpmExtractResult['patchFiles'] = Object.values(patchPaths).map((path) => ({
    source: join(projectPath, path),
    relativePath: path,
  }))
  const hasPatches = Object.keys(subsetPatched).length > 0

  const workspaceYaml: Record<string, unknown> = { ...lockfile.settings }
  if (hasPatches) {
    workspaceYaml.patchedDependencies = patchPaths
  }
  for (const key of CARRIED_WORKSPACE_KEYS) {
    if (rootWorkspaceYaml[key] !== undefined) {
      workspaceYaml[key] = rootWorkspaceYaml[key]
    }
  }

  const collected = [...keepPackages].map((key) => {
    const parsed = parseSnapshotKey(key)
    return { name: parsed.name, version: parsed.version }
  })

  return {
    type: 'pnpm',
    packageJson: {
      name: 'lockfile-subset-output',
      version: '1.0.0',
      dependencies,
    },
    lockfileYaml: {
      lockfileVersion: lockfile.lockfileVersion,
      settings: lockfile.settings,
      ...(hasPatches ? { patchedDependencies: subsetPatched } : {}),
      importers: { '.': subsetImporter },
      packages: subsetPackages,
      snapshots: subsetSnapshots,
    },
    workspaceYaml,
    patchFiles,
    collected,
  }
}
