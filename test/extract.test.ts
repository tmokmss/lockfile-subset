import { describe, it, expect } from 'vitest'
import { extractSubset } from '../src/extract.js'
import { writeOutput } from '../src/write.js'
import { execSync } from 'child_process'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const FIXTURE_DIR = join(import.meta.dirname, 'fixtures', 'basic')

describe('extractSubset', () => {
  it('should extract a single package with no transitive deps', async () => {
    const result = await extractSubset({
      projectPath: FIXTURE_DIR,
      packageNames: ['chalk'],
    })

    expect(result.packageJson.dependencies).toHaveProperty('chalk')
    expect(result.collected.length).toBeGreaterThanOrEqual(1)
    expect(result.collected.some((c) => c.name === 'chalk')).toBe(true)
    expect(result.lockfileJson.lockfileVersion).toBe(3)
    expect(result.lockfileJson.packages['']).toBeDefined()
  })

  it('should extract a package with transitive deps', async () => {
    const result = await extractSubset({
      projectPath: FIXTURE_DIR,
      packageNames: ['prisma'],
    })

    expect(result.packageJson.dependencies).toHaveProperty('prisma')
    // prisma has many transitive deps
    expect(result.collected.length).toBeGreaterThan(5)

    // Should include known transitive deps
    const names = result.collected.map((c) => c.name)
    expect(names).toContain('@prisma/engines')
    expect(names).toContain('@prisma/config')
  })

  it('should extract multiple packages', async () => {
    const result = await extractSubset({
      projectPath: FIXTURE_DIR,
      packageNames: ['chalk', 'prisma'],
    })

    expect(result.packageJson.dependencies).toHaveProperty('chalk')
    expect(result.packageJson.dependencies).toHaveProperty('prisma')
  })

  it('should throw for unknown package', async () => {
    await expect(
      extractSubset({
        projectPath: FIXTURE_DIR,
        packageNames: ['nonexistent-package-xyz'],
      }),
    ).rejects.toThrow('not found in lockfile')
  })

  it('should not include devDependencies packages in transitive deps', async () => {
    const result = await extractSubset({
      projectPath: FIXTURE_DIR,
      packageNames: ['chalk'],
    })

    // typescript is a devDependency, should not appear when extracting chalk
    const names = result.collected.map((c) => c.name)
    expect(names).not.toContain('typescript')
  })
})

describe('npm ci integration', () => {
  it('should produce a lockfile that npm ci accepts', async () => {
    const result = await extractSubset({
      projectPath: FIXTURE_DIR,
      packageNames: ['chalk', 'prisma'],
    })

    const tmpDir = mkdtempSync(join(tmpdir(), 'lockfile-subset-test-'))

    try {
      writeOutput(tmpDir, result)

      // npm ci should succeed
      execSync('npm ci', { cwd: tmpDir, stdio: 'pipe' })

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
