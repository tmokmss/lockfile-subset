/**
 * esbuild-style wildcard matching for package names. A pattern may contain
 * at most one `*`, which matches any (possibly empty) substring. Patterns
 * without `*` are treated as exact names.
 */

export function isWildcard(pattern: string): boolean {
  return pattern.includes('*')
}

export function matchesPattern(pattern: string, name: string): boolean {
  if (!pattern.includes('*')) return pattern === name
  const star = pattern.indexOf('*')
  if (pattern.indexOf('*', star + 1) !== -1) {
    throw new Error(`Pattern "${pattern}" has more than one "*"; only one wildcard is supported.`)
  }
  const prefix = pattern.slice(0, star)
  const suffix = pattern.slice(star + 1)
  return (
    name.length >= prefix.length + suffix.length &&
    name.startsWith(prefix) &&
    name.endsWith(suffix)
  )
}

/**
 * Expand wildcard patterns against the set of available (root-level) package
 * names. Literal patterns pass through unchanged. Wildcard patterns that
 * match nothing throw, so typos surface as errors rather than silent no-ops.
 */
export function expandWildcards(patterns: string[], available: Iterable<string>): string[] {
  const availableArr = [...available]
  const result: string[] = []
  const seen = new Set<string>()

  for (const pattern of patterns) {
    if (!isWildcard(pattern)) {
      if (!seen.has(pattern)) {
        seen.add(pattern)
        result.push(pattern)
      }
      continue
    }

    const matched = availableArr.filter((name) => matchesPattern(pattern, name))
    if (matched.length === 0) {
      throw new Error(`Pattern "${pattern}" did not match any direct dependency.`)
    }
    for (const name of matched) {
      if (!seen.has(name)) {
        seen.add(name)
        result.push(name)
      }
    }
  }

  return result
}
