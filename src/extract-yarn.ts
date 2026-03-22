import { readFileSync } from 'fs'
import { join } from 'path'
import { createRequire } from 'module'
import yaml from 'js-yaml'

const require = createRequire(import.meta.url)
const { parse: parseYarnLockV1, stringify: stringifyYarnLockV1 } = require('@yarnpkg/lockfile')

export interface YarnExtractOptions {
  projectPath: string
  packageNames: string[]
  includeOptional?: boolean
}

export interface YarnExtractResult {
  type: 'yarn'
  yarnVersion: 1 | 2
  packageJson: {
    name: string
    version: string
    dependencies: Record<string, string>
  }
  lockfileContent: string
  collected: Array<{ name: string; version: string }>
}

function detectYarnVersion(content: string): 1 | 2 {
  return content.includes('# yarn lockfile v1') ? 1 : 2
}

// ── Yarn v1 ──

interface YarnV1Entry {
  version: string
  resolved?: string
  integrity?: string
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
}

function extractV1({
  projectPath,
  packageNames,
  includeOptional,
  lockfileContent,
}: {
  projectPath: string
  packageNames: string[]
  includeOptional: boolean
  lockfileContent: string
}): YarnExtractResult {
  const parsed = parseYarnLockV1(lockfileContent)
  if (parsed.type !== 'success') {
    throw new Error(`Failed to parse yarn.lock: ${parsed.type}`)
  }
  const lockfile = parsed.object as Record<string, YarnV1Entry>

  const pkgJsonPath = join(projectPath, 'package.json')
  const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8'))
  const allDeps: Record<string, string> = {
    ...pkgJson.dependencies,
    ...pkgJson.optionalDependencies,
  }

  // BFS
  const keepKeys = new Set<string>()
  const collected: Array<{ name: string; version: string }> = []

  for (const name of packageNames) {
    const range = allDeps[name]
    if (!range) {
      throw new Error(`Package "${name}" not found in yarn.lock`)
    }

    const rootKey = `${name}@${range}`
    const queue: string[] = [rootKey]

    while (queue.length > 0) {
      const key = queue.shift()!
      if (keepKeys.has(key)) continue

      const entry = lockfile[key]
      if (!entry) continue

      keepKeys.add(key)
      collected.push({ name: key.slice(0, key.lastIndexOf('@')), version: entry.version })

      if (entry.dependencies) {
        for (const [depName, depRange] of Object.entries(entry.dependencies)) {
          const depKey = `${depName}@${depRange}`
          if (!keepKeys.has(depKey)) queue.push(depKey)
        }
      }

      if (includeOptional && entry.optionalDependencies) {
        for (const [depName, depRange] of Object.entries(entry.optionalDependencies)) {
          const depKey = `${depName}@${depRange}`
          if (!keepKeys.has(depKey)) queue.push(depKey)
        }
      }
    }
  }

  // Build subset object for stringify
  const subset: Record<string, YarnV1Entry> = {}
  for (const key of keepKeys) {
    subset[key] = lockfile[key]
  }

  // Build dependencies for package.json
  const dependencies: Record<string, string> = {}
  for (const name of packageNames) {
    const range = allDeps[name]
    const entry = lockfile[`${name}@${range}`]
    dependencies[name] = entry.version
  }

  // Deduplicate collected by name@version
  const seen = new Set<string>()
  const deduped = collected.filter((c) => {
    const key = `${c.name}@${c.version}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  return {
    type: 'yarn',
    yarnVersion: 1,
    packageJson: {
      name: 'lockfile-subset-output',
      version: '1.0.0',
      dependencies,
    },
    lockfileContent: stringifyYarnLockV1(subset),
    collected: deduped,
  }
}

// ── Yarn v2+ (Berry) ──

interface YarnBerryEntry {
  version: string
  resolution: string
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  dependenciesMeta?: Record<string, { optional?: boolean }>
  checksum?: string
  languageName?: string
  linkType?: string
  bin?: Record<string, string>
  conditions?: string
}

function extractBerry({
  projectPath,
  packageNames,
  includeOptional,
  lockfileContent,
}: {
  projectPath: string
  packageNames: string[]
  includeOptional: boolean
  lockfileContent: string
}): YarnExtractResult {
  const lockfile = yaml.load(lockfileContent) as Record<string, YarnBerryEntry>

  // Build descriptor → entry map (handle comma-separated keys)
  // Also track original compound keys for output
  const descriptorMap = new Map<string, { entry: YarnBerryEntry; originalKey: string }>()
  for (const [compoundKey, entry] of Object.entries(lockfile)) {
    if (compoundKey === '__metadata') continue
    const descriptors = compoundKey.split(', ')
    for (const descriptor of descriptors) {
      descriptorMap.set(descriptor, { entry, originalKey: compoundKey })
    }
  }

  const pkgJsonPath = join(projectPath, 'package.json')
  const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8'))
  const allDeps: Record<string, string> = {
    ...pkgJson.dependencies,
    ...pkgJson.optionalDependencies,
  }

  // BFS
  const keepOriginalKeys = new Set<string>()
  const visited = new Set<string>()
  const collected: Array<{ name: string; version: string }> = []

  for (const name of packageNames) {
    const range = allDeps[name]
    if (!range) {
      throw new Error(`Package "${name}" not found in yarn.lock`)
    }

    // Berry descriptors use "npm:" prefix
    const descriptor = `${name}@npm:${range}`
    const queue: string[] = [descriptor]

    while (queue.length > 0) {
      const desc = queue.shift()!
      if (visited.has(desc)) continue
      visited.add(desc)

      const match = descriptorMap.get(desc)
      if (!match) continue

      keepOriginalKeys.add(match.originalKey)
      collected.push({ name: parseDescriptorName(desc), version: match.entry.version })

      if (match.entry.dependencies) {
        for (const [depName, depRange] of Object.entries(match.entry.dependencies)) {
          const depDesc = `${depName}@${depRange}`
          if (!visited.has(depDesc)) queue.push(depDesc)
        }
      }

      if (includeOptional && match.entry.optionalDependencies) {
        for (const [depName, depRange] of Object.entries(match.entry.optionalDependencies)) {
          const depDesc = `${depName}@${depRange}`
          if (!visited.has(depDesc)) queue.push(depDesc)
        }
      }
    }
  }

  // Build dependencies for package.json
  const dependencies: Record<string, string> = {}
  for (const name of packageNames) {
    const descriptor = `${name}@npm:${allDeps[name]}`
    const match = descriptorMap.get(descriptor)
    dependencies[name] = match!.entry.version
  }

  // Build subset lockfile content
  // Re-read and rebuild to preserve formatting
  const lines: string[] = []
  lines.push('# This file is generated by running "yarn install" inside your project.')
  lines.push('# Manual changes might be lost - proceed with caution!')
  lines.push('')

  // __metadata
  const metadata = (lockfile as any).__metadata
  if (metadata) {
    lines.push('__metadata:')
    lines.push(`  version: ${metadata.version}`)
    if (metadata.cacheKey) {
      lines.push(`  cacheKey: ${metadata.cacheKey}`)
    }
    lines.push('')
  }

  // Add kept entries in order
  for (const originalKey of keepOriginalKeys) {
    const entry = lockfile[originalKey] as YarnBerryEntry
    lines.push(`"${originalKey}":`)
    lines.push(`  version: ${entry.version}`)
    lines.push(`  resolution: "${entry.resolution}"`)
    if (entry.dependencies && Object.keys(entry.dependencies).length > 0) {
      lines.push('  dependencies:')
      for (const [k, v] of Object.entries(entry.dependencies)) {
        lines.push(`    ${k}: "${v}"`)
      }
    }
    if (entry.optionalDependencies && Object.keys(entry.optionalDependencies).length > 0) {
      lines.push('  optionalDependencies:')
      for (const [k, v] of Object.entries(entry.optionalDependencies)) {
        lines.push(`    ${k}: "${v}"`)
      }
    }
    if (entry.dependenciesMeta && Object.keys(entry.dependenciesMeta).length > 0) {
      lines.push('  dependenciesMeta:')
      for (const [k, v] of Object.entries(entry.dependenciesMeta)) {
        lines.push(`    ${k}:`)
        if (v.optional !== undefined) {
          lines.push(`      optional: ${v.optional}`)
        }
      }
    }
    if (entry.bin && Object.keys(entry.bin).length > 0) {
      lines.push('  bin:')
      for (const [k, v] of Object.entries(entry.bin)) {
        lines.push(`    ${k}: ${v}`)
      }
    }
    if (entry.conditions) {
      lines.push(`  conditions: ${entry.conditions}`)
    }
    if (entry.checksum) {
      lines.push(`  checksum: ${entry.checksum}`)
    }
    lines.push(`  languageName: ${entry.languageName || 'node'}`)
    lines.push(`  linkType: ${entry.linkType || 'hard'}`)
    lines.push('')
  }

  // Deduplicate collected by name@version
  const seen = new Set<string>()
  const deduped = collected.filter((c) => {
    const key = `${c.name}@${c.version}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  return {
    type: 'yarn',
    yarnVersion: 2,
    packageJson: {
      name: 'lockfile-subset-output',
      version: '1.0.0',
      dependencies,
    },
    lockfileContent: lines.join('\n'),
    collected: deduped,
  }
}

/** Extract package name from a descriptor like "chalk@npm:4.1.2" or "@scope/pkg@npm:^1.0.0" */
function parseDescriptorName(descriptor: string): string {
  // Remove protocol prefix from the range part
  // e.g., "chalk@npm:4.1.2" → "chalk", "@scope/pkg@npm:^1.0.0" → "@scope/pkg"
  const npmIdx = descriptor.indexOf('@npm:')
  if (npmIdx > 0) return descriptor.slice(0, npmIdx)
  // Fallback: find last @ that's not the first char
  const lastAt = descriptor.lastIndexOf('@')
  if (lastAt > 0) return descriptor.slice(0, lastAt)
  return descriptor
}

// ── Public API ──

export async function extractYarnSubset({
  projectPath,
  packageNames,
  includeOptional = true,
}: YarnExtractOptions): Promise<YarnExtractResult> {
  const lockfilePath = join(projectPath, 'yarn.lock')
  const lockfileContent = readFileSync(lockfilePath, 'utf8')
  const version = detectYarnVersion(lockfileContent)

  if (version === 1) {
    return extractV1({ projectPath, packageNames, includeOptional, lockfileContent })
  } else {
    return extractBerry({ projectPath, packageNames, includeOptional, lockfileContent })
  }
}
