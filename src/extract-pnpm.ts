import { readFileSync } from 'fs'
import { join } from 'path'
import yaml from 'js-yaml'
import { normalizeWorkspacePath } from './workspace-path.js'

export interface PnpmExtractOptions {
  projectPath: string
  packageNames: string[]
  includeOptional?: boolean
  /** Importer path within the lockfile (relative to projectPath, forward slashes). Defaults to "." (root). */
  workspacePath?: string
}

interface PnpmLockfile {
  lockfileVersion: string
  settings?: Record<string, unknown>
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
  collected: Array<{ name: string; version: string }>
}

/** Parse "name@version" or "@scope/name@version" into [name, version] */
function parseSnapshotKey(key: string): { name: string; version: string } {
  // Remove peer dep suffix: "foo@1.0.0(bar@2.0.0)" -> "foo@1.0.0"
  const withoutPeers = key.replace(/\(.*\)$/, '')
  // For scoped packages like @scope/name@version, find the last @
  const lastAt = withoutPeers.lastIndexOf('@')
  if (lastAt <= 0) {
    throw new Error(`Invalid snapshot key: ${key}`)
  }
  return {
    name: withoutPeers.slice(0, lastAt),
    version: withoutPeers.slice(lastAt + 1),
  }
}

/** Build snapshot key from name and version */
function snapshotKey(name: string, version: string): string {
  return `${name}@${version}`
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

  // BFS through snapshots
  const keepSnapshots = new Set<string>()
  const keepPackages = new Set<string>()

  for (const name of packageNames) {
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
  // manifest↔lockfile cross-check succeeds.
  const dependencies: Record<string, string> = {}
  for (const name of packageNames) {
    dependencies[name] = rootDeps[name].specifier
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
  for (const name of packageNames) {
    subsetImporter.dependencies![name] = {
      specifier: rootDeps[name].specifier,
      version: rootDeps[name].version,
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
      importers: { '.': subsetImporter },
      packages: subsetPackages,
      snapshots: subsetSnapshots,
    },
    collected,
  }
}
