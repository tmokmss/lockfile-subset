/**
 * Yarn's `resolutions` field lives only in package.json. Berry records the
 * *rewritten* descriptor in the lockfile (`ansi-styles@npm:3.2.1`) and never the
 * original one (`ansi-styles@npm:^4.1.0`), so walking the lockfile has to apply
 * the same rewrite — otherwise the overridden package and everything below it
 * silently drops out of the subset.
 */

export interface ResolutionPattern {
  /** Parent scope, if the key was `chalk/ansi-styles` rather than `ansi-styles`. */
  from?: { name: string; range?: string }
  to: { name: string; range?: string }
  /** Replacement descriptor range, protocol-qualified (e.g. `npm:3.2.1`). */
  spec: string
}

const PROTOCOL_RE = /^[a-z][a-z0-9+.-]*:/i

/** Split "chalk@npm:^4.1.0" into name + range, keeping scoped names intact. */
function splitNameAndRange(spec: string): { name: string; range?: string } {
  const lastAt = spec.lastIndexOf('@')
  if (lastAt <= 0) return { name: spec }
  return { name: spec.slice(0, lastAt), range: spec.slice(lastAt + 1) }
}

/** Split a resolution key on "/" without breaking "@scope/name" apart. */
function splitScoped(key: string): string[] {
  const segments = key.split('/')
  const parts: string[] = []
  for (let i = 0; i < segments.length; i++) {
    if (segments[i].startsWith('@') && i + 1 < segments.length) {
      parts.push(`${segments[i]}/${segments[i + 1]}`)
      i++
    } else {
      parts.push(segments[i])
    }
  }
  return parts
}

/** Ranges are compared without the `npm:` protocol so `^1.0.0` matches `npm:^1.0.0`. */
function stripProtocol(range: string | undefined): string | undefined {
  if (range === undefined) return undefined
  return range.startsWith('npm:') ? range.slice(4) : range
}

export function parseResolutions(resolutions?: Record<string, string>): ResolutionPattern[] {
  if (!resolutions) return []

  const patterns: ResolutionPattern[] = []
  for (const [key, value] of Object.entries(resolutions)) {
    // `**/foo` (Yarn 1 style) means the same as an unscoped `foo`.
    const parts = splitScoped(key).filter((part) => part !== '**')
    if (parts.length === 0) continue
    patterns.push({
      from: parts.length >= 2 ? splitNameAndRange(parts[parts.length - 2]) : undefined,
      to: splitNameAndRange(parts[parts.length - 1]),
      spec: PROTOCOL_RE.test(value) ? value : `npm:${value}`,
    })
  }
  return patterns
}

/**
 * Rewrite a descriptor the way Yarn would when resolving `descriptor` as a
 * dependency of `parent`. Returns the descriptor unchanged when nothing matches.
 * A parent-scoped pattern wins over a global one, matching Yarn's precedence.
 */
export function applyResolutions(
  descriptor: string,
  parent: { name: string; range?: string } | undefined,
  patterns: ResolutionPattern[],
): string {
  if (patterns.length === 0) return descriptor

  const { name, range } = splitNameAndRange(descriptor)
  let global: ResolutionPattern | undefined

  for (const pattern of patterns) {
    if (pattern.to.name !== name) continue
    if (pattern.to.range && stripProtocol(pattern.to.range) !== stripProtocol(range)) continue

    if (!pattern.from) {
      global ??= pattern
      continue
    }
    if (!parent || pattern.from.name !== parent.name) continue
    if (pattern.from.range && stripProtocol(pattern.from.range) !== stripProtocol(parent.range)) continue
    return `${name}@${pattern.spec}`
  }

  return global ? `${name}@${global.spec}` : descriptor
}
