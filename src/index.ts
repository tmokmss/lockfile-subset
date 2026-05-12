import { dirname, relative, resolve, sep } from 'path'
import { existsSync } from 'fs'
import { execSync } from 'child_process'
import { createRequire } from 'module'
import { extractSubset } from './extract.js'
import { extractPnpmSubset } from './extract-pnpm.js'
import { extractYarnSubset } from './extract-yarn.js'
import { writeOutput, type AnyExtractResult } from './write.js'

const require = createRequire(import.meta.url)
const { version: VERSION } = require('../package.json')

type LockfileType = 'npm' | 'pnpm' | 'yarn'

interface CliArgs {
  packages: string[]
  lockfile: string
  cwd: string
  output: string
  includeOptional: boolean
  install: boolean
  dryRun: boolean
  help: boolean
  version: boolean
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    packages: [],
    lockfile: '',
    cwd: '',
    output: './lockfile-subset-output',
    includeOptional: true,
    install: false,
    dryRun: false,
    help: false,
    version: false,
  }

  let i = 0
  while (i < argv.length) {
    const arg = argv[i]
    switch (arg) {
      case '--lockfile':
      case '-l':
        args.lockfile = argv[++i]
        break
      case '--cwd':
      case '-C':
        args.cwd = argv[++i]
        break
      case '--output':
      case '-o':
        args.output = argv[++i]
        break
      case '--no-optional':
        args.includeOptional = false
        break
      case '--install':
        args.install = true
        break
      case '--dry-run':
        args.dryRun = true
        break
      case '--help':
      case '-h':
        args.help = true
        break
      case '--version':
      case '-v':
        args.version = true
        break
      default:
        if (arg.startsWith('-')) {
          console.error(`Unknown option: ${arg}`)
          process.exit(1)
        }
        args.packages.push(arg)
    }
    i++
  }

  return args
}

interface ResolvedLockfile {
  projectPath: string
  type: LockfileType
}

const LOCKFILE_BASENAMES: Record<string, LockfileType> = {
  'pnpm-lock.yaml': 'pnpm',
  'yarn.lock': 'yarn',
  'package-lock.json': 'npm',
}

/** Walk up from `start` looking for any known lockfile. Returns null if none found. */
function findLockfileUpwards(start: string): { projectPath: string; type: LockfileType } | null {
  let dir = start
  while (true) {
    for (const [basename, type] of Object.entries(LOCKFILE_BASENAMES)) {
      if (existsSync(resolve(dir, basename))) {
        return { projectPath: dir, type }
      }
    }
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

function resolveLockfile(lockfilePath: string): ResolvedLockfile {
  // Auto-detect: walk up from cwd
  if (!lockfilePath) {
    const found = findLockfileUpwards(resolve('.'))
    if (found) return found
    throw new Error(
      'No lockfile found in current directory or any parent. Expected package-lock.json, pnpm-lock.yaml, or yarn.lock.',
    )
  }

  // Explicit file path
  const resolved = resolve(lockfilePath)
  const basename = resolved.split('/').pop()!
  const type = LOCKFILE_BASENAMES[basename]
  if (!type) {
    throw new Error(
      `Invalid lockfile path: ${lockfilePath}. Expected a path to package-lock.json, pnpm-lock.yaml, or yarn.lock.`,
    )
  }
  return { projectPath: resolve(resolved, '..'), type }
}

/**
 * Resolve the workspace path (relative to projectPath, forward slashes).
 * Explicit `--cwd` wins; otherwise infer from process.cwd() vs projectPath.
 * Returns "." when no sub-workspace is involved.
 */
function resolveWorkspacePath(projectPath: string, cwd: string): string {
  if (cwd) {
    const abs = resolve(cwd)
    const rel = relative(projectPath, abs)
    if (rel === '' || rel === '.') return '.'
    if (rel.startsWith('..')) {
      throw new Error(`--cwd "${cwd}" is outside the lockfile's project directory (${projectPath})`)
    }
    return rel.split(sep).join('/')
  }
  const rel = relative(projectPath, resolve('.'))
  if (rel === '' || rel === '.') return '.'
  if (rel.startsWith('..')) return '.'
  return rel.split(sep).join('/')
}

const HELP = `
lockfile-subset <packages...> [options]

Extract a subset of package-lock.json, pnpm-lock.yaml, or yarn.lock for specified
packages and their transitive dependencies.

Arguments:
  packages                  Package names to extract (one or more, space-separated)

Options:
  --lockfile, -l <path>     Path to lockfile (auto-detected by walking up from cwd)
  --cwd, -C <path>          Workspace/sub-package directory to extract from
                            (defaults to process.cwd() relative to the lockfile)
  --output, -o <dir>        Output directory (default: ./lockfile-subset-output)
  --no-optional             Exclude optional dependencies
  --install                 Run npm ci / pnpm install / yarn install after generating
  --dry-run                 Print the result without writing files
  --version, -v             Show version
  --help, -h                Show this help

Examples:
  lockfile-subset @prisma/client sharp
  lockfile-subset @prisma/client sharp -o /standalone
  lockfile-subset @prisma/client sharp -l /build/package-lock.json
  lockfile-subset @prisma/client sharp -l pnpm-lock.yaml --install
  lockfile-subset chalk --dry-run

Monorepos:
  cd apps/web && lockfile-subset next        # auto-detects workspace
  lockfile-subset next -l ./pnpm-lock.yaml --cwd apps/web
`.trim()

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.version) {
    console.log(VERSION)
    return
  }

  if (args.help) {
    console.log(HELP)
    return
  }

  if (args.packages.length === 0) {
    console.error('Error: At least one package name is required.\n')
    console.log(HELP)
    process.exit(1)
  }

  const { projectPath, type } = resolveLockfile(args.lockfile)
  const workspacePath = resolveWorkspacePath(projectPath, args.cwd)
  const outputDir = resolve(args.output)

  if (workspacePath !== '.') {
    console.log(`Using workspace: ${workspacePath} (lockfile root: ${projectPath})`)
  }

  let result: AnyExtractResult

  if (type === 'pnpm') {
    result = await extractPnpmSubset({
      projectPath,
      packageNames: args.packages,
      includeOptional: args.includeOptional,
      workspacePath,
    })
  } else if (type === 'yarn') {
    result = await extractYarnSubset({
      projectPath,
      packageNames: args.packages,
      includeOptional: args.includeOptional,
      workspacePath,
    })
  } else {
    result = await extractSubset({
      projectPath,
      packageNames: args.packages,
      includeOptional: args.includeOptional,
      workspacePath,
    })
  }

  console.log(
    `Collected ${result.collected.length} packages (${args.packages.length} direct, ${result.collected.length - args.packages.length} transitive)`,
  )

  if (args.dryRun) {
    console.log('\n--- package.json ---')
    console.log(JSON.stringify(result.packageJson, null, 2))
    if (result.type === 'npm') {
      console.log('\n--- package-lock.json ---')
      console.log(JSON.stringify(result.lockfileJson, null, 2))
    } else if (result.type === 'pnpm') {
      const yaml = (await import('js-yaml')).default
      console.log('\n--- pnpm-lock.yaml ---')
      console.log(yaml.dump(result.lockfileYaml, { lineWidth: -1, noCompatMode: true }))
    } else {
      console.log('\n--- yarn.lock ---')
      console.log(result.lockfileContent)
    }
    return
  }

  writeOutput(outputDir, result)
  console.log(`Written to ${outputDir}`)

  if (args.install) {
    if (type === 'pnpm') {
      console.log('Running pnpm install --frozen-lockfile...')
      execSync('pnpm install --frozen-lockfile', { cwd: outputDir, stdio: 'inherit' })
    } else if (type === 'yarn') {
      if (result.type === 'yarn' && result.yarnVersion === 1) {
        console.log('Running yarn install --frozen-lockfile...')
        execSync('yarn install --frozen-lockfile', { cwd: outputDir, stdio: 'inherit' })
      } else {
        console.log('Running yarn install --immutable...')
        execSync('yarn install --immutable', { cwd: outputDir, stdio: 'inherit' })
      }
    } else {
      console.log('Running npm ci...')
      execSync('npm ci', { cwd: outputDir, stdio: 'inherit' })
    }
    console.log('Done.')
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`)
  process.exit(1)
})
