import { resolve } from 'path'
import { existsSync } from 'fs'
import { execSync } from 'child_process'
import { createRequire } from 'module'
import { extractSubset } from './extract.js'
import { extractPnpmSubset } from './extract-pnpm.js'
import { writeOutput, type AnyExtractResult } from './write.js'

const require = createRequire(import.meta.url)
const { version: VERSION } = require('../package.json')

type LockfileType = 'npm' | 'pnpm'

interface CliArgs {
  packages: string[]
  lockfile: string
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

function resolveLockfile(lockfilePath: string): ResolvedLockfile {
  // Auto-detect from cwd
  if (!lockfilePath) {
    if (existsSync(resolve('pnpm-lock.yaml'))) {
      return { projectPath: resolve('.'), type: 'pnpm' }
    }
    if (existsSync(resolve('package-lock.json'))) {
      return { projectPath: resolve('.'), type: 'npm' }
    }
    throw new Error(
      'No lockfile found in current directory. Expected package-lock.json or pnpm-lock.yaml.',
    )
  }

  // Explicit file path
  const resolved = resolve(lockfilePath)
  const basename = resolved.split('/').pop()!

  if (basename === 'pnpm-lock.yaml') {
    return { projectPath: resolve(resolved, '..'), type: 'pnpm' }
  }
  if (basename === 'package-lock.json') {
    return { projectPath: resolve(resolved, '..'), type: 'npm' }
  }
  throw new Error(
    `Invalid lockfile path: ${lockfilePath}. Expected a path to package-lock.json or pnpm-lock.yaml.`,
  )
}

const HELP = `
lockfile-subset <packages...> [options]

Extract a subset of package-lock.json or pnpm-lock.yaml for specified packages
and their transitive dependencies.

Arguments:
  packages                  Package names to extract (one or more, space-separated)

Options:
  --lockfile, -l <path>     Path to lockfile (auto-detected from cwd by default)
  --output, -o <dir>        Output directory (default: ./lockfile-subset-output)
  --no-optional             Exclude optional dependencies
  --install                 Run npm ci / pnpm install --frozen-lockfile after generating
  --dry-run                 Print the result without writing files
  --version, -v             Show version
  --help, -h                Show this help

Examples:
  lockfile-subset @prisma/client sharp
  lockfile-subset @prisma/client sharp -o /standalone
  lockfile-subset @prisma/client sharp -l /build/package-lock.json
  lockfile-subset @prisma/client sharp -l pnpm-lock.yaml --install
  lockfile-subset chalk --dry-run
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
  const outputDir = resolve(args.output)

  let result: AnyExtractResult

  if (type === 'pnpm') {
    result = await extractPnpmSubset({
      projectPath,
      packageNames: args.packages,
      includeOptional: args.includeOptional,
    })
  } else {
    result = await extractSubset({
      projectPath,
      packageNames: args.packages,
      includeOptional: args.includeOptional,
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
    } else {
      const yaml = (await import('js-yaml')).default
      console.log('\n--- pnpm-lock.yaml ---')
      console.log(yaml.dump(result.lockfileYaml, { lineWidth: -1, noCompatMode: true }))
    }
    return
  }

  writeOutput(outputDir, result)
  console.log(`Written to ${outputDir}`)

  if (args.install) {
    if (type === 'pnpm') {
      console.log('Running pnpm install --frozen-lockfile...')
      execSync('pnpm install --frozen-lockfile', { cwd: outputDir, stdio: 'inherit' })
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
