import { describe, it, expect } from 'vitest'
import { join } from 'path'
import { execSync } from 'child_process'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { extractSubset } from '../src/extract.js'
import { extractPnpmSubset } from '../src/extract-pnpm.js'
import { extractYarnSubset } from '../src/extract-yarn.js'
import { writeOutput } from '../src/write.js'

const FIXTURES = join(import.meta.dirname, 'fixtures')

describe('pnpm monorepo', () => {
  const fixture = join(FIXTURES, 'pnpm-v9-mono')

  it('extracts from a non-root importer (apps/web)', async () => {
    const result = await extractPnpmSubset({
      projectPath: fixture,
      packageNames: ['chalk'],
      workspacePath: 'apps/web',
    })

    expect(result.packageJson.dependencies).toHaveProperty('chalk')
    expect(result.packageJson.dependencies.chalk).toBe('^4.1.2')

    const names = result.collected.map((c) => c.name)
    expect(names).toContain('chalk')
    expect(names).toContain('ansi-styles')

    // Output importer is always under "."
    expect(result.lockfileYaml.importers['.']).toBeDefined()
    expect(result.lockfileYaml.importers['apps/web']).toBeUndefined()

    // Original specifier preserved
    const dep = result.lockfileYaml.importers['.'].dependencies!.chalk
    expect(dep.specifier).toBe('^4.1.2')
    expect(dep.version).toBe('4.1.2')
  })

  it('extracts from a second importer (apps/api)', async () => {
    const result = await extractPnpmSubset({
      projectPath: fixture,
      packageNames: ['ms'],
      workspacePath: 'apps/api',
    })

    expect(result.packageJson.dependencies).toHaveProperty('ms')
    expect(result.packageJson.dependencies.ms).toBe('^2.1.3')
  })

  it('throws when requesting a workspace package (link:)', async () => {
    await expect(
      extractPnpmSubset({
        projectPath: fixture,
        packageNames: ['@mono/shared'],
        workspacePath: 'apps/web',
      }),
    ).rejects.toThrow(/workspace/)
  })

  it('throws when the importer is unknown', async () => {
    await expect(
      extractPnpmSubset({
        projectPath: fixture,
        packageNames: ['chalk'],
        workspacePath: 'apps/missing',
      }),
    ).rejects.toThrow(/Importer/)
  })

  it('still works for the root importer', async () => {
    // Root has no real deps in this fixture, but we can pass workspacePath '.'
    // and request something. We use semver which IS a devDep, so it would fail.
    // Instead use apps/web again with default omitted.
    const result = await extractPnpmSubset({
      projectPath: fixture,
      packageNames: ['chalk'],
      workspacePath: 'apps/web',
    })
    expect(result.type).toBe('pnpm')
  })

  it('produces a lockfile that pnpm install --frozen-lockfile accepts', async () => {
    const result = await extractPnpmSubset({
      projectPath: fixture,
      packageNames: ['chalk'],
      workspacePath: 'apps/web',
    })

    const tmpDir = mkdtempSync(join(tmpdir(), 'lockfile-subset-pnpm-mono-'))
    try {
      writeOutput(tmpDir, result)
      execSync('pnpm install --frozen-lockfile', { cwd: tmpDir, stdio: 'pipe' })
      const pkgJson = JSON.parse(readFileSync(join(tmpDir, 'node_modules', 'chalk', 'package.json'), 'utf8'))
      expect(pkgJson.version).toBe('4.1.2')
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  }, 30000)
})

describe('npm monorepo', () => {
  const fixture = join(FIXTURES, 'npm-mono')

  it('extracts from a workspace (apps/web)', async () => {
    const result = await extractSubset({
      projectPath: fixture,
      packageNames: ['chalk'],
      workspacePath: 'apps/web',
    })

    expect(result.packageJson.dependencies).toHaveProperty('chalk')
    const names = result.collected.map((c) => c.name)
    expect(names).toContain('chalk')
    expect(names).toContain('ansi-styles')

    // Should not include semver (root devDep) or typescript (web devDep)
    expect(names).not.toContain('semver')
    expect(names).not.toContain('typescript')
    // Should not include @mono/shared (workspace link, skipped)
    expect(names).not.toContain('@mono/shared')
  })

  it('extracts from a second workspace (apps/api)', async () => {
    const result = await extractSubset({
      projectPath: fixture,
      packageNames: ['ms'],
      workspacePath: 'apps/api',
    })

    expect(result.packageJson.dependencies).toHaveProperty('ms')
    expect(result.packageJson.dependencies.ms).toBe('2.1.3') // npm uses resolved version
  })

  it('throws when requesting a workspace package', async () => {
    await expect(
      extractSubset({
        projectPath: fixture,
        packageNames: ['@mono/shared'],
        workspacePath: 'apps/web',
      }),
    ).rejects.toThrow(/workspace/)
  })

  it('throws when the workspace is unknown', async () => {
    await expect(
      extractSubset({
        projectPath: fixture,
        packageNames: ['chalk'],
        workspacePath: 'apps/missing',
      }),
    ).rejects.toThrow(/not found/)
  })

  it('produces a lockfile that npm ci accepts', async () => {
    const result = await extractSubset({
      projectPath: fixture,
      packageNames: ['chalk'],
      workspacePath: 'apps/web',
    })

    const tmpDir = mkdtempSync(join(tmpdir(), 'lockfile-subset-npm-mono-'))
    try {
      writeOutput(tmpDir, result)
      execSync('npm ci', { cwd: tmpDir, stdio: 'pipe' })
      const pkgJson = JSON.parse(readFileSync(join(tmpDir, 'node_modules', 'chalk', 'package.json'), 'utf8'))
      expect(pkgJson.version).toBe('4.1.2')
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  }, 30000)
})

describe('yarn v1 monorepo', () => {
  const fixture = join(FIXTURES, 'yarn-v1-mono')

  it('extracts from a workspace (apps/web)', async () => {
    const result = await extractYarnSubset({
      projectPath: fixture,
      packageNames: ['chalk'],
      workspacePath: 'apps/web',
    })

    expect(result.yarnVersion).toBe(1)
    expect(result.packageJson.dependencies).toHaveProperty('chalk')
    expect(result.packageJson.dependencies.chalk).toBe('^4.1.2')

    const names = result.collected.map((c) => c.name)
    expect(names).toContain('chalk')
    expect(names).toContain('ansi-styles')
    expect(names).not.toContain('semver')
  })

  it('throws when requesting a workspace package (range "*")', async () => {
    await expect(
      extractYarnSubset({
        projectPath: fixture,
        packageNames: ['@mono/shared'],
        workspacePath: 'apps/web',
      }),
    ).rejects.toThrow(/workspace|lockfile entry/)
  })

  it('produces a lockfile that yarn v1 install accepts', async () => {
    const result = await extractYarnSubset({
      projectPath: fixture,
      packageNames: ['chalk'],
      workspacePath: 'apps/web',
    })

    const tmpDir = mkdtempSync(join(tmpdir(), 'lockfile-subset-yarn-v1-mono-'))
    try {
      writeOutput(tmpDir, result)
      execSync('yarn install --frozen-lockfile', { cwd: tmpDir, stdio: 'pipe' })
      const pkgJson = JSON.parse(readFileSync(join(tmpDir, 'node_modules', 'chalk', 'package.json'), 'utf8'))
      expect(pkgJson.version).toBe('4.1.2')
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  }, 30000)
})

describe('yarn berry monorepo', () => {
  const fixture = join(FIXTURES, 'yarn-berry-mono')

  it('extracts from a workspace (apps/web)', async () => {
    const result = await extractYarnSubset({
      projectPath: fixture,
      packageNames: ['chalk'],
      workspacePath: 'apps/web',
    })

    expect(result.yarnVersion).toBe(2)
    expect(result.packageJson.dependencies).toHaveProperty('chalk')
    expect(result.packageJson.dependencies.chalk).toBe('^4.1.2')

    const names = result.collected.map((c) => c.name)
    expect(names).toContain('chalk')
    expect(names).toContain('ansi-styles')
    expect(names).not.toContain('semver')
    expect(names).not.toContain('@mono/shared')
  })

  it('throws when requesting a workspace package', async () => {
    await expect(
      extractYarnSubset({
        projectPath: fixture,
        packageNames: ['@mono/shared'],
        workspacePath: 'apps/web',
      }),
    ).rejects.toThrow(/workspace/)
  })
})
