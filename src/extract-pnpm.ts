import { readFileSync } from 'fs'
import { join } from 'path'
import yaml from 'js-yaml'

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

/** Normalize a workspace path to a pnpm importer key (forward slashes, no leading "./"). */
function normalizeImporterKey(path: string): string {
  if (!path || path === '.' || path === './') return '.'
  return path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')
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

  const importerKey = normalizeImporterKey(workspacePath)
  const importer = lockfile.importers[importerKey]
  if (!importer) {
    const available = Object.keys(lockfile.importers).join(', ')
    throw new Error(
      `Importer "${importerKey}" not found in pnpm-lock.yaml. Available importers: ${available}`,
    )
  }

  // Merge prod + optional deps from selected importer (exclude dev)
  const rootDeps: Record<string, string> = {}
  const rootSpecifiers: Record<string, string> = {}
  if (importer.dependencies) {
    for (const [name, info] of Object.entries(importer.dependencies)) {
      rootDeps[name] = info.version
      rootSpecifiers[name] = info.specifier
    }
  }
  if (importer.optionalDependencies) {
    for (const [name, info] of Object.entries(importer.optionalDependencies)) {
      rootDeps[name] = info.version
      rootSpecifiers[name] = info.specifier
    }
  }

  // BFS through snapshots
  const keepSnapshots = new Set<string>()
  const keepPackages = new Set<string>()

  for (const name of packageNames) {
    const version = rootDeps[name]
    if (!version) {
      throw new Error(`Package "${name}" not found in pnpm-lock.yaml`)
    }
    if (version.startsWith('link:')) {
      throw new Error(`Package "${name}" resolves to a workspace (${version}), not a published package`)
    }

    const key = snapshotKey(name, version)
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

  // Build subset dependencies for package.json. Use the original specifier
  // when available so pnpm's lockfile↔manifest cross-check succeeds.
  const dependencies: Record<string, string> = {}
  for (const name of packageNames) {
    const parsed = parseSnapshotKey(snapshotKey(name, rootDeps[name]))
    dependencies[name] = rootSpecifiers[name] ?? parsed.version
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
      specifier: rootSpecifiers[name] ?? dependencies[name],
      version: rootDeps[name],
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
