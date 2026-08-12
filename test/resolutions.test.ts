import { describe, it, expect } from 'vitest'
import { applyResolutions, parseResolutions } from '../src/resolutions.js'

describe('parseResolutions', () => {
  it('should return an empty list when there are no resolutions', () => {
    expect(parseResolutions(undefined)).toEqual([])
    expect(parseResolutions({})).toEqual([])
  })

  it('should parse an unscoped pattern', () => {
    expect(parseResolutions({ 'ansi-styles': '3.2.1' })).toEqual([
      { from: undefined, to: { name: 'ansi-styles', range: undefined }, spec: 'npm:3.2.1' },
    ])
  })

  it('should parse a parent-scoped pattern', () => {
    expect(parseResolutions({ 'chalk/ansi-styles': '3.2.1' })).toEqual([
      {
        from: { name: 'chalk', range: undefined },
        to: { name: 'ansi-styles', range: undefined },
        spec: 'npm:3.2.1',
      },
    ])
  })

  it('should keep scoped package names intact on both sides', () => {
    expect(parseResolutions({ '@babel/core/@types/node': '20.0.0' })).toEqual([
      {
        from: { name: '@babel/core', range: undefined },
        to: { name: '@types/node', range: undefined },
        spec: 'npm:20.0.0',
      },
    ])
  })

  it('should treat a "**/" prefix as unscoped', () => {
    expect(parseResolutions({ '**/ansi-styles': '3.2.1' })[0].from).toBeUndefined()
  })

  it('should parse ranges on both sides', () => {
    expect(parseResolutions({ 'chalk@^4/ansi-styles@^4.1.0': '3.2.1' })).toEqual([
      { from: { name: 'chalk', range: '^4' }, to: { name: 'ansi-styles', range: '^4.1.0' }, spec: 'npm:3.2.1' },
    ])
  })

  it('should keep an explicit protocol instead of assuming npm:', () => {
    const spec = 'patch:left-pad@npm%3A1.3.0#./patches/left-pad.patch'
    expect(parseResolutions({ 'left-pad': spec })[0].spec).toBe(spec)
  })
})

describe('applyResolutions', () => {
  const parent = { name: 'chalk', range: 'npm:4.1.2' }

  it('should leave the descriptor untouched when there are no patterns', () => {
    expect(applyResolutions('ansi-styles@npm:^4.1.0', parent, [])).toBe('ansi-styles@npm:^4.1.0')
  })

  it('should rewrite a descriptor matched by an unscoped pattern', () => {
    const patterns = parseResolutions({ 'ansi-styles': '3.2.1' })
    expect(applyResolutions('ansi-styles@npm:^4.1.0', parent, patterns)).toBe('ansi-styles@npm:3.2.1')
  })

  it('should rewrite a descriptor matched by its parent', () => {
    const patterns = parseResolutions({ 'chalk/ansi-styles': '3.2.1' })
    expect(applyResolutions('ansi-styles@npm:^4.1.0', parent, patterns)).toBe('ansi-styles@npm:3.2.1')
  })

  it('should not rewrite a descriptor reached through another parent', () => {
    const patterns = parseResolutions({ 'chalk/ansi-styles': '3.2.1' })
    const other = { name: 'wrap-ansi', range: 'npm:7.0.0' }
    expect(applyResolutions('ansi-styles@npm:^4.1.0', other, patterns)).toBe('ansi-styles@npm:^4.1.0')
  })

  it('should not rewrite an unrelated package', () => {
    const patterns = parseResolutions({ 'ansi-styles': '3.2.1' })
    expect(applyResolutions('supports-color@npm:^7.1.0', parent, patterns)).toBe('supports-color@npm:^7.1.0')
  })

  it('should compare ranges without the npm: protocol', () => {
    const patterns = parseResolutions({ 'chalk@4.1.2/ansi-styles@npm:^4.1.0': '3.2.1' })
    expect(applyResolutions('ansi-styles@npm:^4.1.0', parent, patterns)).toBe('ansi-styles@npm:3.2.1')
  })

  it('should skip a pattern whose target range does not match', () => {
    const patterns = parseResolutions({ 'ansi-styles@^3.0.0': '3.2.1' })
    expect(applyResolutions('ansi-styles@npm:^4.1.0', parent, patterns)).toBe('ansi-styles@npm:^4.1.0')
  })

  it('should skip a pattern whose parent range does not match', () => {
    const patterns = parseResolutions({ 'chalk@^3/ansi-styles': '3.2.1' })
    expect(applyResolutions('ansi-styles@npm:^4.1.0', parent, patterns)).toBe('ansi-styles@npm:^4.1.0')
  })

  it('should prefer a parent-scoped pattern over an unscoped one', () => {
    const patterns = parseResolutions({ 'ansi-styles': '4.2.0', 'chalk/ansi-styles': '3.2.1' })
    expect(applyResolutions('ansi-styles@npm:^4.1.0', parent, patterns)).toBe('ansi-styles@npm:3.2.1')
  })

  it('should apply an unscoped pattern to a root dependency with no parent range', () => {
    const patterns = parseResolutions({ chalk: '4.1.0' })
    expect(applyResolutions('chalk@npm:^4.1.2', { name: 'my-app' }, patterns)).toBe('chalk@npm:4.1.0')
  })
})
