import { describe, it, expect } from 'vitest'
import { expandWildcards } from '../src/wildcard.js'

describe('expandWildcards', () => {
  const available = [
    'chalk',
    'ms',
    '@prisma/client',
    '@prisma/engines',
    '@prisma/config',
    'sharp',
    'css-loader',
    'sass-loader',
    'babel-loader',
  ]

  it('passes literal names through unchanged', () => {
    expect(expandWildcards(['chalk', 'sharp'], available)).toEqual(['chalk', 'sharp'])
  })

  it('expands a prefix wildcard matching multiple packages', () => {
    expect(expandWildcards(['@prisma/*'], available)).toEqual([
      '@prisma/client',
      '@prisma/engines',
      '@prisma/config',
    ])
  })

  it('expands a suffix wildcard matching multiple packages', () => {
    expect(expandWildcards(['*-loader'], available)).toEqual([
      'css-loader',
      'sass-loader',
      'babel-loader',
    ])
  })

  it('expands a middle wildcard', () => {
    expect(expandWildcards(['c*k'], available)).toEqual(['chalk'])
  })

  it('expands "*" to every available name', () => {
    expect(expandWildcards(['*'], available)).toEqual(available)
  })

  it('combines multiple wildcards, deduplicating overlaps', () => {
    const result = expandWildcards(['@prisma/*', '*-loader', '@prisma/config'], available)
    expect(result).toEqual([
      '@prisma/client',
      '@prisma/engines',
      '@prisma/config',
      'css-loader',
      'sass-loader',
      'babel-loader',
    ])
  })

  it('mixes literals and wildcards, deduplicating', () => {
    const result = expandWildcards(['chalk', '@prisma/*', '@prisma/client'], available)
    expect(result).toEqual(['chalk', '@prisma/client', '@prisma/engines', '@prisma/config'])
  })

  it('throws when a wildcard matches nothing', () => {
    expect(() => expandWildcards(['@aws-sdk/*'], available)).toThrow(/did not match/)
  })

  it('rejects patterns with multiple *', () => {
    expect(() => expandWildcards(['*-*-loader'], available)).toThrow(/only one wildcard/)
  })

  it('accepts an iterator for available names', () => {
    const iter = ['chalk', 'sharp'].values()
    expect(expandWildcards(['c*'], iter)).toEqual(['chalk'])
  })
})
