import { resolve } from 'path'
import { execSync } from 'child_process'
import { createRequire } from 'module'
import { extractSubset } from './extract.js'
import { writeOutput } from './write.js'

const require = createRequire(import.meta.url)
const { version: VERSION } = require('../package.json')

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
    lockfile: '.',
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

const HELP = `
lockfile-subset <packages...> [options]

Extract a subset of package-lock.json for specified packages and their transitive dependencies.

Arguments:
  packages                  Package names to extract (one or more, space-separated)

Options:
  --lockfile, -l <path>     Path to project dir or package-lock.json (default: .)
  --output, -o <dir>        Output directory (default: ./lockfile-subset-output)
  --no-optional             Exclude optional dependencies
  --install                 Run npm ci after generating the subset
  --dry-run                 Print the result without writing files
  --version, -v             Show version
  --help, -h                Show this help

Examples:
  lockfile-subset prisma sharp
  lockfile-subset prisma sharp -o /lambda-standalone
  lockfile-subset prisma sharp --lockfile /build/package-lock.json
  lockfile-subset prisma sharp -o /lambda-standalone --install
  lockfile-subset prisma --dry-run
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

  const projectPath = resolve(args.lockfile)
  const outputDir = resolve(args.output)

  const result = await extractSubset({
    projectPath,
    packageNames: args.packages,
    includeOptional: args.includeOptional,
  })

  console.log(
    `Collected ${result.collected.length} packages (${args.packages.length} direct, ${result.collected.length - args.packages.length} transitive)`,
  )

  if (args.dryRun) {
    console.log('\n--- package.json ---')
    console.log(JSON.stringify(result.packageJson, null, 2))
    console.log('\n--- package-lock.json ---')
    console.log(JSON.stringify(result.lockfileJson, null, 2))
    return
  }

  writeOutput(outputDir, result)
  console.log(`Written to ${outputDir}`)

  if (args.install) {
    console.log('Running npm ci...')
    execSync('npm ci', { cwd: outputDir, stdio: 'inherit' })
    console.log('Done.')
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`)
  process.exit(1)
})
