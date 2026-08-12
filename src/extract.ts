import Arborist from '@npmcli/arborist'
import type { Node, Edge } from '@npmcli/arborist'
import { normalizeWorkspacePath } from './workspace-path.js'
import { expandWildcards } from './wildcard.js'

/**
 * Rewrite a package-lock.json location key so the output is a standalone project.
 * Locations inside the chosen workspace get their workspace prefix stripped;
 * hoisted entries at the root stay where they are.
 */
function rewritePackageLocation(location: string, workspacePath: string): string {
  if (workspacePath === '.') return location
  if (location === workspacePath) return ''
  const prefix = workspacePath + '/'
  if (location.startsWith(prefix)) return location.slice(prefix.length)
  return location
}

/**
 * npm keeps `overrides` in package.json only — never in the lockfile — and
 * re-checks every lockfile entry against the range its dependents declare when
 * `npm ci` runs. Dropping them makes `npm ci` reject the subset with
 * "lock file's x@1.0.0 does not satisfy x@2.0.0" whenever an override pushed a
 * package outside that range, so they have to be carried over.
 *
 * `$name` references are resolved to the version the original lockfile picked:
 * they point at a root dependency that the subset usually does not have.
 */
function copyOverrides(overrides: Record<string, unknown>, root: Node): Record<string, unknown> {
  const copied: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(overrides)) {
    if (value && typeof value === 'object') {
      copied[name] = copyOverrides(value as Record<string, unknown>, root)
    } else if (typeof value === 'string' && value.startsWith('$')) {
      const referenced = root.edgesOut.get(value.slice(1))?.to?.version
      copied[name] = referenced ?? value
    } else {
      copied[name] = value
    }
  }
  return copied
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
    overrides?: Record<string, unknown>
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
  if (normalizedWorkspace !== '.') {
    let found: Node | undefined
    for (const child of tree.fsChildren) {
      if (child.location === normalizedWorkspace) {
        found = child
        break
      }
    }
    if (!found) {
      const available = [...tree.fsChildren].map((c) => c.location).join(', ')
      throw new Error(
        `Workspace "${normalizedWorkspace}" not found in package-lock.json. Available workspaces: ${available || '(none)'}`,
      )
    }
    startNode = found
  }

  // Wildcard universe excludes dev edges so behavior matches pnpm/yarn extractors,
  // which only see prod+optional deps. Literal names still resolve against the
  // full edge set below (so `lockfile-subset typescript` keeps working as before).
  const nonDevDirectDeps: string[] = []
  for (const [name, edge] of startNode.edgesOut) {
    if (edge.type !== 'dev') nonDevDirectDeps.push(name)
  }
  const resolvedNames = expandWildcards(packageNames, nonDevDirectDeps)

  // BFS to collect transitive deps
  const keep = new Set<Node>()

  for (const name of resolvedNames) {
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
  for (const name of resolvedNames) {
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

  // Overrides are declared once, in the project root package.json — never in a
  // workspace's own manifest — so they are read from the tree root.
  const rootOverrides = (tree.package as any)?.overrides as Record<string, unknown> | undefined
  const overrides =
    rootOverrides && Object.keys(rootOverrides).length > 0 ? copyOverrides(rootOverrides, tree) : undefined

  return {
    type: 'npm',
    packageJson: {
      name: 'lockfile-subset-output',
      version: '1.0.0',
      dependencies,
      ...(overrides ? { overrides } : {}),
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
