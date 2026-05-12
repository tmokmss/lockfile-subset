/**
 * Normalize a workspace/importer path to a forward-slash relative key.
 * Returns "." for the root (empty input, ".", "./").
 */
export function normalizeWorkspacePath(p: string | undefined): string {
  if (!p || p === '.' || p === './') return '.'
  return p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')
}
