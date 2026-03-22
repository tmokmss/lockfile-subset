import { describe, it, expect } from 'vitest'
import { extractPnpmSubset } from '../src/extract-pnpm.js'
import { writeOutput } from '../src/write.js'
import { execSync } from 'child_process'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const FIXTURE_PNPM_V9 = join(import.meta.dirname, 'fixtures', 'pnpm-v9')

describe('extractPnpmSubset', () => {
  it('should extract a single package with transitive deps', async () => {
    const result = await extractPnpmSubset({
      projectPath: FIXTURE_PNPM_V9,
      packageNames: ['chalk'],
    })

    expect(result.type).toBe('pnpm')
    expect(result.packageJson.dependencies).toHaveProperty('chalk')
    expect(result.packageJson.dependencies.chalk).toBe('4.1.2')

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

describe('pnpm install integration', () => {
  it('should produce a lockfile that pnpm install --frozen-lockfile accepts', async () => {
    const result = await extractPnpmSubset({
      projectPath: FIXTURE_PNPM_V9,
      packageNames: ['chalk', 'ms'],
    })

    const tmpDir = mkdtempSync(join(tmpdir(), 'lockfile-subset-pnpm-test-'))

    try {
      writeOutput(tmpDir, result)

      // pnpm install --frozen-lockfile should succeed
      execSync('pnpm install --frozen-lockfile', { cwd: tmpDir, stdio: 'pipe' })

      // Verify installed versions match
      for (const [name, version] of Object.entries(result.packageJson.dependencies)) {
        const pkgJson = JSON.parse(
          readFileSync(join(tmpDir, 'node_modules', name, 'package.json'), 'utf8'),
        )
        expect(pkgJson.version).toBe(version)
      }
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  }, 30000)
})
