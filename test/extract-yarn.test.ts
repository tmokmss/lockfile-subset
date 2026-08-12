import { describe, it, expect } from 'vitest'
import { extractYarnSubset } from '../src/extract-yarn.js'
import { writeOutput } from '../src/write.js'
import { execSync } from 'child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const FIXTURE_YARN_V1 = join(import.meta.dirname, 'fixtures', 'yarn-v1')
const FIXTURE_YARN_BERRY = join(import.meta.dirname, 'fixtures', 'yarn-berry')
const FIXTURE_YARN_V1_RESOLUTIONS = join(import.meta.dirname, 'fixtures', 'yarn-v1-resolutions')
const FIXTURE_YARN_BERRY_RESOLUTIONS = join(import.meta.dirname, 'fixtures', 'yarn-berry-resolutions')

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

  it('should expand wildcards against direct dependencies', async () => {
    const result = await extractYarnSubset({
      projectPath: FIXTURE_YARN_V1,
      packageNames: ['c*'],
    })

    expect(result.packageJson.dependencies).toHaveProperty('chalk')
    expect(result.packageJson.dependencies).not.toHaveProperty('ms')
  })

  it('should expand a wildcard matching multiple direct dependencies', async () => {
    const result = await extractYarnSubset({
      projectPath: FIXTURE_YARN_V1,
      packageNames: ['*'],
    })

    expect(Object.keys(result.packageJson.dependencies).sort()).toEqual(['chalk', 'ms'])
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

  it('should expand wildcards against direct dependencies', async () => {
    const result = await extractYarnSubset({
      projectPath: FIXTURE_YARN_BERRY,
      packageNames: ['c*'],
    })

    expect(result.packageJson.dependencies).toHaveProperty('chalk')
    expect(result.packageJson.dependencies).not.toHaveProperty('ms')
  })

  it('should expand a wildcard matching multiple direct dependencies', async () => {
    const result = await extractYarnSubset({
      projectPath: FIXTURE_YARN_BERRY,
      packageNames: ['*'],
    })

    expect(Object.keys(result.packageJson.dependencies).sort()).toEqual(['chalk', 'ms'])
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

describe('resolutions (v1)', () => {
  it('should carry resolutions into the output package.json', async () => {
    const result = await extractYarnSubset({
      projectPath: FIXTURE_YARN_V1_RESOLUTIONS,
      packageNames: ['chalk'],
    })

    expect(result.packageJson.resolutions).toEqual({ 'chalk/ansi-styles': '3.2.1' })
  })

  it('should collect the overridden version and its own deps', async () => {
    const result = await extractYarnSubset({
      projectPath: FIXTURE_YARN_V1_RESOLUTIONS,
      packageNames: ['chalk'],
    })

    expect(result.collected.find((c) => c.name === 'ansi-styles')?.version).toBe('3.2.1')
    expect(result.collected.find((c) => c.name === 'color-convert')?.version).toBe('1.9.3')
  })

  it('should omit resolutions when the project declares none', async () => {
    const result = await extractYarnSubset({
      projectPath: FIXTURE_YARN_V1,
      packageNames: ['chalk'],
    })

    expect(result.packageJson.resolutions).toBeUndefined()
  })
})

describe('resolutions (berry)', () => {
  it('should carry resolutions into the output package.json', async () => {
    const result = await extractYarnSubset({
      projectPath: FIXTURE_YARN_BERRY_RESOLUTIONS,
      packageNames: ['chalk'],
    })

    expect(result.packageJson.resolutions).toEqual({ 'chalk/ansi-styles': '3.2.1' })
  })

  it('should follow the rewritten descriptor into the overridden subtree', async () => {
    const result = await extractYarnSubset({
      projectPath: FIXTURE_YARN_BERRY_RESOLUTIONS,
      packageNames: ['chalk'],
    })

    // The lockfile only has "ansi-styles@npm:3.2.1"; walking chalk's declared
    // "npm:^4.1.0" instead would drop the whole subtree from the subset.
    expect(result.collected.find((c) => c.name === 'ansi-styles')?.version).toBe('3.2.1')
    expect(result.collected.find((c) => c.name === 'color-convert')?.version).toBe('1.9.3')
    expect(result.collected.find((c) => c.name === 'color-name')?.version).toBe('1.1.3')
    expect(result.lockfileContent).toContain('"ansi-styles@npm:3.2.1"')
  })

  it('should omit resolutions when the project declares none', async () => {
    const result = await extractYarnSubset({
      projectPath: FIXTURE_YARN_BERRY,
      packageNames: ['chalk'],
    })

    expect(result.packageJson.resolutions).toBeUndefined()
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

  it('should install the resolved version rather than re-resolving it', async () => {
    const result = await extractYarnSubset({
      projectPath: FIXTURE_YARN_V1_RESOLUTIONS,
      packageNames: ['chalk'],
    })

    const tmpDir = mkdtempSync(join(tmpdir(), 'lockfile-subset-yarn-v1-resolutions-'))

    try {
      writeOutput(tmpDir, result)

      execSync('yarn install --frozen-lockfile', { cwd: tmpDir, stdio: 'pipe' })

      // Without the resolutions field yarn v1 silently ignores the locked
      // 3.2.1 (it does not satisfy chalk's ^4.1.0) and installs 4.x instead.
      const installed = JSON.parse(
        readFileSync(join(tmpDir, 'node_modules', 'ansi-styles', 'package.json'), 'utf8'),
      )
      expect(installed.version).toBe('3.2.1')
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  }, 30000)
})

describe('yarn berry install integration', () => {
  it('should produce a lockfile that yarn install --immutable accepts', async () => {
    const result = await extractYarnSubset({
      projectPath: FIXTURE_YARN_BERRY,
      packageNames: ['chalk', 'ms'],
    })

    const tmpDir = mkdtempSync(join(tmpdir(), 'lockfile-subset-yarn-berry-test-'))

    try {
      writeOutput(tmpDir, result)

      const sourcePkgJson = JSON.parse(readFileSync(join(FIXTURE_YARN_BERRY, 'package.json'), 'utf8'))
      const outPkgJsonPath = join(tmpDir, 'package.json')
      const outPkgJson = JSON.parse(readFileSync(outPkgJsonPath, 'utf8'))
      outPkgJson.packageManager = sourcePkgJson.packageManager
      writeFileSync(outPkgJsonPath, JSON.stringify(outPkgJson, null, 2) + '\n')
      writeFileSync(join(tmpDir, '.yarnrc.yml'), 'nodeLinker: node-modules\nenableTelemetry: false\n')

      execSync('corepack yarn install --immutable', {
        cwd: tmpDir,
        stdio: 'pipe',
        env: { ...process.env, COREPACK_ENABLE_DOWNLOAD_PROMPT: '0' },
      })

      for (const [name, version] of Object.entries(result.packageJson.dependencies)) {
        const pkgJson = JSON.parse(
          readFileSync(join(tmpDir, 'node_modules', name, 'package.json'), 'utf8'),
        )
        expect(pkgJson.version).toBe(version)
      }
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  }, 120000)

  it('should produce a lockfile that yarn install --immutable accepts with resolutions applied', async () => {
    const result = await extractYarnSubset({
      projectPath: FIXTURE_YARN_BERRY_RESOLUTIONS,
      packageNames: ['chalk'],
    })

    const tmpDir = mkdtempSync(join(tmpdir(), 'lockfile-subset-yarn-berry-resolutions-'))

    try {
      writeOutput(tmpDir, result)

      const sourcePkgJson = JSON.parse(
        readFileSync(join(FIXTURE_YARN_BERRY_RESOLUTIONS, 'package.json'), 'utf8'),
      )
      const outPkgJsonPath = join(tmpDir, 'package.json')
      const outPkgJson = JSON.parse(readFileSync(outPkgJsonPath, 'utf8'))
      outPkgJson.packageManager = sourcePkgJson.packageManager
      writeFileSync(outPkgJsonPath, JSON.stringify(outPkgJson, null, 2) + '\n')
      writeFileSync(join(tmpDir, '.yarnrc.yml'), 'nodeLinker: node-modules\nenableTelemetry: false\n')

      execSync('corepack yarn install --immutable', {
        cwd: tmpDir,
        stdio: 'pipe',
        env: { ...process.env, COREPACK_ENABLE_DOWNLOAD_PROMPT: '0' },
      })

      // Berry fails with YN0028 if the manifest and the lockfile disagree about
      // which ansi-styles descriptor chalk resolves to.
      const installed = JSON.parse(
        readFileSync(join(tmpDir, 'node_modules', 'ansi-styles', 'package.json'), 'utf8'),
      )
      expect(installed.version).toBe('3.2.1')
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  }, 120000)
})
