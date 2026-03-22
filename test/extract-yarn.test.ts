import { describe, it, expect } from 'vitest'
import { extractYarnSubset } from '../src/extract-yarn.js'
import { writeOutput } from '../src/write.js'
import { execSync } from 'child_process'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const FIXTURE_YARN_V1 = join(import.meta.dirname, 'fixtures', 'yarn-v1')
const FIXTURE_YARN_BERRY = join(import.meta.dirname, 'fixtures', 'yarn-berry')

describe('extractYarnSubset (v1)', () => {
  it('should extract a single package with transitive deps', async () => {
    const result = await extractYarnSubset({
      projectPath: FIXTURE_YARN_V1,
      packageNames: ['chalk'],
    })

    expect(result.type).toBe('yarn')
    expect(result.yarnVersion).toBe(1)
    expect(result.packageJson.dependencies).toHaveProperty('chalk')
    expect(result.packageJson.dependencies.chalk).toBe('4.1.2')

    const names = result.collected.map((c) => c.name)
    expect(names).toContain('chalk')
    expect(names).toContain('ansi-styles')
    expect(names).toContain('supports-color')
    expect(result.collected.length).toBeGreaterThan(1)
  })

  it('should extract multiple packages', async () => {
    const result = await extractYarnSubset({
      projectPath: FIXTURE_YARN_V1,
      packageNames: ['chalk', 'ms'],
    })

    expect(result.packageJson.dependencies).toHaveProperty('chalk')
    expect(result.packageJson.dependencies).toHaveProperty('ms')
  })

  it('should throw for unknown package', async () => {
    await expect(
      extractYarnSubset({
        projectPath: FIXTURE_YARN_V1,
        packageNames: ['nonexistent-package-xyz'],
      }),
    ).rejects.toThrow('not found in yarn.lock')
  })

  it('should not include devDependencies in transitive deps', async () => {
    const result = await extractYarnSubset({
      projectPath: FIXTURE_YARN_V1,
      packageNames: ['chalk'],
    })

    const names = result.collected.map((c) => c.name)
    expect(names).not.toContain('semver')
  })

  it('should produce valid lockfile content', async () => {
    const result = await extractYarnSubset({
      projectPath: FIXTURE_YARN_V1,
      packageNames: ['chalk'],
    })

    expect(result.lockfileContent).toContain('chalk@4.1.2')
    expect(result.lockfileContent).toContain('ansi-styles')
    expect(result.lockfileContent).not.toContain('semver')
  })
})

describe('extractYarnSubset (berry)', () => {
  it('should extract a single package with transitive deps', async () => {
    const result = await extractYarnSubset({
      projectPath: FIXTURE_YARN_BERRY,
      packageNames: ['chalk'],
    })

    expect(result.type).toBe('yarn')
    expect(result.yarnVersion).toBe(2)
    expect(result.packageJson.dependencies).toHaveProperty('chalk')
    expect(result.packageJson.dependencies.chalk).toBe('4.1.2')

    const names = result.collected.map((c) => c.name)
    expect(names).toContain('chalk')
    expect(names).toContain('ansi-styles')
    expect(names).toContain('supports-color')
    expect(result.collected.length).toBeGreaterThan(1)
  })

  it('should extract multiple packages', async () => {
    const result = await extractYarnSubset({
      projectPath: FIXTURE_YARN_BERRY,
      packageNames: ['chalk', 'ms'],
    })

    expect(result.packageJson.dependencies).toHaveProperty('chalk')
    expect(result.packageJson.dependencies).toHaveProperty('ms')
  })

  it('should throw for unknown package', async () => {
    await expect(
      extractYarnSubset({
        projectPath: FIXTURE_YARN_BERRY,
        packageNames: ['nonexistent-package-xyz'],
      }),
    ).rejects.toThrow('not found in yarn.lock')
  })

  it('should not include devDependencies in transitive deps', async () => {
    const result = await extractYarnSubset({
      projectPath: FIXTURE_YARN_BERRY,
      packageNames: ['chalk'],
    })

    const names = result.collected.map((c) => c.name)
    expect(names).not.toContain('semver')
  })

  it('should produce valid lockfile content', async () => {
    const result = await extractYarnSubset({
      projectPath: FIXTURE_YARN_BERRY,
      packageNames: ['chalk'],
    })

    expect(result.lockfileContent).toContain('chalk@npm:4.1.2')
    expect(result.lockfileContent).toContain('ansi-styles')
    expect(result.lockfileContent).not.toContain('semver')
  })
})

describe('yarn v1 install integration', () => {
  it('should produce a lockfile that yarn install --frozen-lockfile accepts', async () => {
    const result = await extractYarnSubset({
      projectPath: FIXTURE_YARN_V1,
      packageNames: ['chalk', 'ms'],
    })

    const tmpDir = mkdtempSync(join(tmpdir(), 'lockfile-subset-yarn-v1-test-'))

    try {
      writeOutput(tmpDir, result)

      execSync('yarn install --frozen-lockfile', { cwd: tmpDir, stdio: 'pipe' })

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
