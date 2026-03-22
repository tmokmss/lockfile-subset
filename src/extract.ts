import Arborist from '@npmcli/arborist'
import type { Node, Edge } from '@npmcli/arborist'

export interface ExtractOptions {
  projectPath: string
  packageNames: string[]
  includeOptional?: boolean
}

export interface ExtractResult {
  packageJson: {
    name: string
    version: string
    dependencies: Record<string, string>
  }
  lockfileJson: {
    name: string
    version: string
    lockfileVersion: number
    requires: boolean
    packages: Record<string, unknown>
  }
  /** Collected nodes (for diagnostics / dry-run) */
  collected: Array<{ name: string; version: string; location: string }>
}

export async function extractSubset({
  projectPath,
  packageNames,
  includeOptional = true,
}: ExtractOptions): Promise<ExtractResult> {
  const arb = new Arborist({ path: projectPath })
  const tree = await arb.loadVirtual()

  const originalLockfileVersion = (tree.meta as any).originalLockfileVersion
  if (originalLockfileVersion < 2) {
    throw new Error(
      `Lockfile version ${originalLockfileVersion} is not supported. Please upgrade to npm 7+ (lockfile v2/v3) by running: npm install --package-lock-only`,
    )
  }

  // BFS to collect transitive deps
  const keep = new Set<Node>()

  for (const name of packageNames) {
    const edge: Edge | undefined = tree.edgesOut.get(name)
    if (!edge?.to) {
      throw new Error(`Package "${name}" not found in lockfile`)
    }

    const queue: Node[] = [edge.to]
    while (queue.length > 0) {
      const node = queue.shift()!
      if (keep.has(node)) continue
      keep.add(node)
      for (const e of node.edgesOut.values()) {
        if (e.type === 'dev') continue
        if (e.type === 'optional' && !includeOptional) continue
        if (e.to && !keep.has(e.to)) queue.push(e.to)
      }
    }
  }

  // Build subset lockfile
  const dependencies: Record<string, string> = {}
  for (const name of packageNames) {
    const edge = tree.edgesOut.get(name)!
    dependencies[name] = edge.to!.version
  }

  const subsetPackages: Record<string, unknown> = {}

  // Root entry
  subsetPackages[''] = {
    name: 'lockfile-subset-output',
    version: '1.0.0',
    dependencies,
  }

  // Copy collected nodes' entries from original lockfile
  const originalPackages = (tree.meta as any).data.packages as Record<string, unknown>
  for (const node of keep) {
    const location = node.location
    if (originalPackages[location]) {
      subsetPackages[location] = originalPackages[location]
    }
  }

  const collected = [...keep].map((node) => ({
    name: node.name,
    version: node.version,
    location: node.location,
  }))

  return {
    packageJson: {
      name: 'lockfile-subset-output',
      version: '1.0.0',
      dependencies,
    },
    lockfileJson: {
      name: 'lockfile-subset-output',
      version: '1.0.0',
      lockfileVersion: 3,
      requires: true,
      packages: subsetPackages,
    },
    collected,
  }
}
