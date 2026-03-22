import { readFileSync } from 'fs'
import { join } from 'path'
import yaml from 'js-yaml'

export interface PnpmExtractOptions {
  projectPath: string
  packageNames: string[]
  includeOptional?: boolean
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
}: PnpmExtractOptions): Promise<PnpmExtractResult> {
  const lockfilePath = join(projectPath, 'pnpm-lock.yaml')
  const content = readFileSync(lockfilePath, 'utf8')
  const lockfile = yaml.load(content) as PnpmLockfile

  if (!lockfile.lockfileVersion || !String(lockfile.lockfileVersion).startsWith('9')) {
    throw new Error(
      `pnpm lockfile version ${lockfile.lockfileVersion} is not supported. Please upgrade to pnpm 9+ (lockfile v9).`,
    )
  }

  const rootImporter = lockfile.importers['.']
  if (!rootImporter) {
    throw new Error('No root importer found in pnpm-lock.yaml')
  }

  // Merge prod + optional deps from root importer (exclude dev)
  const rootDeps: Record<string, string> = {}
  if (rootImporter.dependencies) {
    for (const [name, info] of Object.entries(rootImporter.dependencies)) {
      rootDeps[name] = info.version
    }
  }
  if (rootImporter.optionalDependencies) {
    for (const [name, info] of Object.entries(rootImporter.optionalDependencies)) {
      rootDeps[name] = info.version
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
          const depKey = snapshotKey(depName, depVersion)
          if (!keepSnapshots.has(depKey)) queue.push(depKey)
        }
      }

      if (includeOptional && snapshot.optionalDependencies) {
        for (const [depName, depVersion] of Object.entries(snapshot.optionalDependencies)) {
          const depKey = snapshotKey(depName, depVersion)
          if (!keepSnapshots.has(depKey)) queue.push(depKey)
        }
      }
    }
  }

  // Build subset dependencies for package.json
  const dependencies: Record<string, string> = {}
  for (const name of packageNames) {
    const parsed = parseSnapshotKey(snapshotKey(name, rootDeps[name]))
    dependencies[name] = parsed.version
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
      specifier: dependencies[name],
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
