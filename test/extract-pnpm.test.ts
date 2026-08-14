import { describe, it, expect } from 'vitest'
import { extractPnpmSubset, type PnpmExtractResult } from '../src/extract-pnpm.js'
import { writeOutput } from '../src/write.js'
import { execSync } from 'child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const FIXTURE_PNPM_V9 = join(import.meta.dirname, 'fixtures', 'pnpm-v9')
const FIXTURE_PNPM_OVERRIDES = join(import.meta.dirname, 'fixtures', 'pnpm-v9-overrides')
const FIXTURE_PNPM_CATALOG = join(import.meta.dirname, 'fixtures', 'pnpm-v9-catalog')
const FIXTURE_PNPM_PATCHED = join(import.meta.dirname, 'fixtures', 'pnpm-v9-patched')

/** Write the subset to a temp dir, run a frozen pnpm install there, then assert. */
function installSubset(prefix: string, result: PnpmExtractResult, assert: (tmpDir: string) => void): void {
  const tmpDir = mkdtempSync(join(tmpdir(), prefix))
  try {
    writeOutput(tmpDir, result)
    execSync('pnpm install --frozen-lockfile', { cwd: tmpDir, stdio: 'pipe' })
    assert(tmpDir)
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
}

describe('extractPnpmSubset', () => {
  it('should extract a single package with transitive deps', async () => {
    const result = await extractPnpmSubset({
      projectPath: FIXTURE_PNPM_V9,
      packageNames: ['chalk'],
    })

    expect(result.type).toBe('pnpm')
    expect(result.packageJson.dependencies).toHaveProperty('chalk')
    expect(result.packageJson.dependencies.chalk).toBe('^4.1.2')

    // chalk@4 has transitive deps
    const names = result.collected.map((c) => c.name)
    expect(names).toContain('chalk')
    expect(names).toContain('ansi-styles')
    expect(names).toContain('supports-color')
    expect(result.collected.length).toBeGreaterThan(1)
  })

  it('should extract multiple packages', async () => {
    const result = await extractPnpmSubset({
      projectPath: FIXTURE_PNPM_V9,
      packageNames: ['chalk', 'ms'],
    })

    expect(result.packageJson.dependencies).toHaveProperty('chalk')
    expect(result.packageJson.dependencies).toHaveProperty('ms')
  })

  it('should throw for unknown package', async () => {
    await expect(
      extractPnpmSubset({
        projectPath: FIXTURE_PNPM_V9,
        packageNames: ['nonexistent-package-xyz'],
      }),
    ).rejects.toThrow('not found in pnpm-lock.yaml')
  })

  it('should expand wildcards against direct dependencies', async () => {
    const result = await extractPnpmSubset({
      projectPath: FIXTURE_PNPM_V9,
      packageNames: ['c*'],
    })

    expect(result.packageJson.dependencies).toHaveProperty('chalk')
    expect(result.packageJson.dependencies).not.toHaveProperty('ms')
  })

  it('should expand a wildcard matching multiple direct dependencies', async () => {
    const result = await extractPnpmSubset({
      projectPath: FIXTURE_PNPM_V9,
      packageNames: ['*'],
    })

    expect(Object.keys(result.packageJson.dependencies).sort()).toEqual(['chalk', 'ms'])
  })

  it('should throw when wildcard matches nothing', async () => {
    await expect(
      extractPnpmSubset({
        projectPath: FIXTURE_PNPM_V9,
        packageNames: ['@aws-sdk/*'],
      }),
    ).rejects.toThrow(/did not match/)
  })

  it('should not include devDependencies in transitive deps', async () => {
    const result = await extractPnpmSubset({
      projectPath: FIXTURE_PNPM_V9,
      packageNames: ['chalk'],
    })

    const names = result.collected.map((c) => c.name)
    expect(names).not.toContain('semver')
  })

  it('should produce valid lockfile structure', async () => {
    const result = await extractPnpmSubset({
      projectPath: FIXTURE_PNPM_V9,
      packageNames: ['chalk'],
    })

    expect(result.lockfileYaml.lockfileVersion).toBe('9.0')
    expect(result.lockfileYaml.importers['.']).toBeDefined()
    expect(result.lockfileYaml.importers['.'].dependencies).toHaveProperty('chalk')
    expect(Object.keys(result.lockfileYaml.packages).length).toBeGreaterThan(0)
    expect(Object.keys(result.lockfileYaml.snapshots).length).toBeGreaterThan(0)
  })
})

describe('overrides', () => {
  // pnpm needs no manifest-side counterpart: snapshots pin exact versions, so
  // dropping the lockfile's `overrides` block keeps both sides consistent and
  // the frozen-lockfile check still passes.
  it('should collect the overridden version without emitting an overrides block', async () => {
    const result = await extractPnpmSubset({
      projectPath: FIXTURE_PNPM_OVERRIDES,
      packageNames: ['chalk'],
    })

    expect(result.collected.find((c) => c.name === 'ansi-styles')?.version).toBe('3.2.1')
    expect(result.collected.find((c) => c.name === 'color-convert')?.version).toBe('1.9.3')
    expect(result.lockfileYaml).not.toHaveProperty('overrides')
    expect(result.lockfileYaml.snapshots['chalk@4.1.2'].dependencies!['ansi-styles']).toBe('3.2.1')
  })

  it('should install the overridden version', async () => {
    const result = await extractPnpmSubset({
      projectPath: FIXTURE_PNPM_OVERRIDES,
      packageNames: ['chalk'],
    })

    installSubset('lockfile-subset-pnpm-overrides-', result, (tmpDir) => {
      const installed = JSON.parse(
        readFileSync(
          join(tmpDir, 'node_modules', '.pnpm', 'ansi-styles@3.2.1', 'node_modules', 'ansi-styles', 'package.json'),
          'utf8',
        ),
      )
      expect(installed.version).toBe('3.2.1')
    })
  }, 30000)
})

describe('workspace yaml', () => {
  it('should mirror the lockfile settings so the settings check passes', async () => {
    const result = await extractPnpmSubset({
      projectPath: FIXTURE_PNPM_V9,
      packageNames: ['chalk'],
    })

    expect(result.workspaceYaml).toEqual(result.lockfileYaml.settings)
  })

  it('should carry install-behavior keys from the root pnpm-workspace.yaml', async () => {
    const result = await extractPnpmSubset({
      projectPath: FIXTURE_PNPM_CATALOG,
      packageNames: ['chalk'],
    })

    expect(result.workspaceYaml.allowBuilds).toEqual(['esbuild'])
    expect(result.workspaceYaml.minimumReleaseAge).toBe(1440)
    // Lockfile-checked fields stay out of the generated config
    expect(result.workspaceYaml).not.toHaveProperty('catalog')
    expect(result.workspaceYaml).not.toHaveProperty('catalogs')
    expect(result.workspaceYaml).not.toHaveProperty('overrides')
  })
})

describe('catalogs', () => {
  it('should resolve catalog: specifiers to the catalog entry specifier', async () => {
    const result = await extractPnpmSubset({
      projectPath: FIXTURE_PNPM_CATALOG,
      packageNames: ['chalk', 'ms'],
    })

    // chalk uses the default catalog, ms uses the named catalog "tools"
    expect(result.packageJson.dependencies.chalk).toBe('^4.1.2')
    expect(result.packageJson.dependencies.ms).toBe('^2.1.3')
    expect(result.lockfileYaml.importers['.'].dependencies!.chalk.specifier).toBe('^4.1.2')
    expect(result.lockfileYaml.importers['.'].dependencies!.ms.specifier).toBe('^2.1.3')
    expect(result.lockfileYaml).not.toHaveProperty('catalogs')
  })

  it('should install the catalog-pinned versions without catalog definitions', async () => {
    const result = await extractPnpmSubset({
      projectPath: FIXTURE_PNPM_CATALOG,
      packageNames: ['chalk', 'ms'],
    })

    installSubset('lockfile-subset-pnpm-catalog-', result, (tmpDir) => {
      const installed = JSON.parse(
        readFileSync(join(tmpDir, 'node_modules', 'chalk', 'package.json'), 'utf8'),
      )
      expect(installed.version).toBe('4.1.2')
    })
  }, 30000)
})

describe('patchedDependencies', () => {
  it('should carry only the patches whose packages are in the subset', async () => {
    const result = await extractPnpmSubset({
      projectPath: FIXTURE_PNPM_PATCHED,
      packageNames: ['chalk'],
    })

    // ansi-styles (transitive dep of chalk) is patched; ms is patched too but not extracted
    expect(Object.keys(result.lockfileYaml.patchedDependencies ?? {})).toEqual(['ansi-styles@4.3.0'])
    expect(result.workspaceYaml.patchedDependencies).toEqual({
      'ansi-styles@4.3.0': 'patches/ansi-styles@4.3.0.patch',
    })
    expect(result.patchFiles).toHaveLength(1)
    expect(result.patchFiles[0].relativePath).toBe('patches/ansi-styles@4.3.0.patch')
  })

  it('should carry patches of direct dependencies', async () => {
    const result = await extractPnpmSubset({
      projectPath: FIXTURE_PNPM_PATCHED,
      packageNames: ['chalk', 'ms'],
    })

    expect(Object.keys(result.lockfileYaml.patchedDependencies ?? {}).sort()).toEqual([
      'ansi-styles@4.3.0',
      'ms@2.1.3',
    ])
    expect(result.patchFiles).toHaveLength(2)
  })

  it('should install with the patch applied', async () => {
    const result = await extractPnpmSubset({
      projectPath: FIXTURE_PNPM_PATCHED,
      packageNames: ['chalk'],
    })

    installSubset('lockfile-subset-pnpm-patched-', result, (tmpDir) => {
      const pnpmDir = join(tmpDir, 'node_modules', '.pnpm')
      const patchedDir = readdirSync(pnpmDir).find((d) => d.startsWith('ansi-styles@4.3.0_patch_hash='))
      expect(patchedDir).toBeDefined()
      const installedSource = readFileSync(
        join(pnpmDir, patchedDir!, 'node_modules', 'ansi-styles', 'index.js'),
        'utf8',
      )
      expect(installedSource).toContain('lockfile-subset-test-patch ansi-styles')
    })
  }, 30000)
})

describe('pnpm install integration', () => {
  it('should produce a lockfile that pnpm install --frozen-lockfile accepts', async () => {
    const result = await extractPnpmSubset({
      projectPath: FIXTURE_PNPM_V9,
      packageNames: ['chalk', 'ms'],
    })

    installSubset('lockfile-subset-pnpm-test-', result, (tmpDir) => {
      // Verify installed versions match what the importer resolved to in the lockfile
      const resolved: Record<string, string> = {}
      for (const [name, info] of Object.entries(
        result.lockfileYaml.importers['.'].dependencies ?? {},
      )) {
        resolved[name] = info.version
      }
      for (const name of Object.keys(result.packageJson.dependencies)) {
        const pkgJson = JSON.parse(
          readFileSync(join(tmpDir, 'node_modules', name, 'package.json'), 'utf8'),
        )
        expect(pkgJson.version).toBe(resolved[name])
      }
    })
  }, 30000)
})
