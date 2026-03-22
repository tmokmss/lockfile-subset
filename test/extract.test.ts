import { describe, it, expect } from 'vitest'
import { extractSubset } from '../src/extract.js'
import { writeOutput } from '../src/write.js'
import { execSync } from 'child_process'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const FIXTURE_BASIC = join(import.meta.dirname, 'fixtures', 'basic')
const FIXTURE_V1 = join(import.meta.dirname, 'fixtures', 'lockfile-v1')
const FIXTURE_V2 = join(import.meta.dirname, 'fixtures', 'lockfile-v2')
const FIXTURE_V3 = join(import.meta.dirname, 'fixtures', 'lockfile-v3')

describe('extractSubset', () => {
  it('should extract a single package with no transitive deps', async () => {
    const result = await extractSubset({
      projectPath: FIXTURE_BASIC,
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
      projectPath: FIXTURE_BASIC,
      packageNames: ['prisma'],
    })

    expect(result.packageJson.dependencies).toHaveProperty('prisma')
    expect(result.collected.length).toBeGreaterThan(5)

    const names = result.collected.map((c) => c.name)
    expect(names).toContain('@prisma/engines')
    expect(names).toContain('@prisma/config')
  })

  it('should extract multiple packages', async () => {
    const result = await extractSubset({
      projectPath: FIXTURE_BASIC,
      packageNames: ['chalk', 'prisma'],
    })

    expect(result.packageJson.dependencies).toHaveProperty('chalk')
    expect(result.packageJson.dependencies).toHaveProperty('prisma')
  })

  it('should throw for unknown package', async () => {
    await expect(
      extractSubset({
        projectPath: FIXTURE_BASIC,
        packageNames: ['nonexistent-package-xyz'],
      }),
    ).rejects.toThrow('not found in lockfile')
  })

  it('should not include devDependencies packages in transitive deps', async () => {
    const result = await extractSubset({
      projectPath: FIXTURE_BASIC,
      packageNames: ['chalk'],
    })

    const names = result.collected.map((c) => c.name)
    expect(names).not.toContain('typescript')
  })
})

describe('lockfile version support', () => {
  it('should reject lockfile v1', async () => {
    await expect(
      extractSubset({
        projectPath: FIXTURE_V1,
        packageNames: ['chalk'],
      }),
    ).rejects.toThrow('not supported')
  })

  it('should extract from lockfile v2', async () => {
    const result = await extractSubset({
      projectPath: FIXTURE_V2,
      packageNames: ['chalk'],
    })

    expect(result.packageJson.dependencies).toHaveProperty('chalk')
    const names = result.collected.map((c) => c.name)
    expect(names).toContain('chalk')
    // chalk@4 has transitive deps (ansi-styles, supports-color, etc.)
    expect(result.collected.length).toBeGreaterThan(1)
    expect(result.lockfileJson.lockfileVersion).toBe(3)
  })

  it('should extract from lockfile v3', async () => {
    const result = await extractSubset({
      projectPath: FIXTURE_V3,
      packageNames: ['chalk'],
    })

    expect(result.packageJson.dependencies).toHaveProperty('chalk')
    const names = result.collected.map((c) => c.name)
    expect(names).toContain('chalk')
    expect(result.collected.length).toBeGreaterThan(1)
    expect(result.lockfileJson.lockfileVersion).toBe(3)
  })

  it('should not include devDependencies in v2 extraction', async () => {
    const result = await extractSubset({
      projectPath: FIXTURE_V2,
      packageNames: ['chalk'],
    })

    const names = result.collected.map((c) => c.name)
    expect(names).not.toContain('semver')
  })

  it('should not include devDependencies in v3 extraction', async () => {
    const result = await extractSubset({
      projectPath: FIXTURE_V3,
      packageNames: ['chalk'],
    })

    const names = result.collected.map((c) => c.name)
    expect(names).not.toContain('semver')
  })
})

describe('npm ci integration', () => {
  it('should produce a lockfile that npm ci accepts (from v2 source)', async () => {
    const result = await extractSubset({
      projectPath: FIXTURE_V2,
      packageNames: ['chalk', 'ms'],
    })

    const tmpDir = mkdtempSync(join(tmpdir(), 'lockfile-subset-test-'))

    try {
      writeOutput(tmpDir, result)
      execSync('npm ci', { cwd: tmpDir, stdio: 'pipe' })

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

  it('should produce a lockfile that npm ci accepts (from v3 source)', async () => {
    const result = await extractSubset({
      projectPath: FIXTURE_V3,
      packageNames: ['chalk', 'ms'],
    })

    const tmpDir = mkdtempSync(join(tmpdir(), 'lockfile-subset-test-'))

    try {
      writeOutput(tmpDir, result)
      execSync('npm ci', { cwd: tmpDir, stdio: 'pipe' })

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
