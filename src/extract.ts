import Arborist from '@npmcli/arborist'
import type { Node, Edge } from '@npmcli/arborist'

function normalizeWorkspacePath(p: string): string {
  if (!p || p === '.' || p === './') return ''
  return p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')
}

/**
 * Rewrite a package-lock.json location key so the output is a standalone project.
 * Locations inside the chosen workspace get their workspace prefix stripped;
 * hoisted entries at the root stay where they are.
 */
function rewritePackageLocation(location: string, workspacePath: string): string {
  if (!workspacePath) return location
  if (location === workspacePath) return ''
  const prefix = workspacePath + '/'
  if (location.startsWith(prefix)) return location.slice(prefix.length)
  return location
}

export interface ExtractOptions {
  projectPath: string
  packageNames: string[]
  includeOptional?: boolean
  /** Workspace path relative to projectPath. Defaults to "." (root). */
  workspacePath?: string
}

export interface ExtractResult {
  type: 'npm'
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
  workspacePath = '.',
}: ExtractOptions): Promise<ExtractResult> {
  const arb = new Arborist({ path: projectPath })
  const tree = await arb.loadVirtual()

  const originalLockfileVersion = (tree.meta as any).originalLockfileVersion
  if (originalLockfileVersion < 2) {
    throw new Error(
      `Lockfile version ${originalLockfileVersion} is not supported. Please upgrade to npm 7+ (lockfile v2/v3) by running: npm install --package-lock-only`,
    )
  }

  const normalizedWorkspace = normalizeWorkspacePath(workspacePath)
  let startNode: Node = tree
  if (normalizedWorkspace !== '') {
    let found: Node | undefined
    for (const child of tree.fsChildren as Set<Node>) {
      if (child.location === normalizedWorkspace) {
        found = child
        break
      }
    }
    if (!found) {
      const available = [...(tree.fsChildren as Set<Node>)].map((c) => c.location).join(', ')
      throw new Error(
        `Workspace "${normalizedWorkspace}" not found in package-lock.json. Available workspaces: ${available || '(none)'}`,
      )
    }
    startNode = found
  }

  // BFS to collect transitive deps
  const keep = new Set<Node>()

  for (const name of packageNames) {
    const edge: Edge | undefined = startNode.edgesOut.get(name)
    if (!edge?.to) {
      throw new Error(`Package "${name}" not found in lockfile`)
    }
    // Skip workspace edges — we only ship published packages
    if (edge.type === 'workspace' || edge.to.isWorkspace) {
      throw new Error(`Package "${name}" resolves to a workspace, not a published package`)
    }

    const queue: Node[] = [edge.to]
    while (queue.length > 0) {
      const node = queue.shift()!
      if (keep.has(node)) continue
      if (node.isWorkspace) continue
      keep.add(node)
      for (const e of node.edgesOut.values()) {
        if (e.type === 'dev') continue
        if (e.type === 'workspace') continue
        if (e.type === 'optional' && !includeOptional) continue
        if (e.to && !e.to.isWorkspace && !keep.has(e.to)) queue.push(e.to)
      }
    }
  }

  // Build subset lockfile
  const dependencies: Record<string, string> = {}
  for (const name of packageNames) {
    const edge = startNode.edgesOut.get(name)!
    dependencies[name] = edge.to!.version
  }

  const subsetPackages: Record<string, unknown> = {}

  // Root entry
  subsetPackages[''] = {
    name: 'lockfile-subset-output',
    version: '1.0.0',
    dependencies,
  }

  // Copy collected nodes' entries from original lockfile, rewriting locations
  // to be relative to the chosen workspace (so the output is a standalone project).
  const originalPackages = (tree.meta as any).data.packages as Record<string, unknown>
  for (const node of keep) {
    const original = originalPackages[node.location]
    if (!original) continue
    const rewritten = rewritePackageLocation(node.location, normalizedWorkspace)
    subsetPackages[rewritten] = original
  }

  const collected = [...keep].map((node) => ({
    name: node.name,
    version: node.version,
    location: node.location,
  }))

  return {
    type: 'npm',
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
