import { describe, it, expect } from 'vitest'
import { expandWildcards } from '../src/wildcard.js'

describe('expandWildcards', () => {
  const available = ['chalk', 'ms', '@prisma/client', '@prisma/engines', 'sharp', 'css-loader']

  it('passes literal names through unchanged', () => {
    expect(expandWildcards(['chalk', 'sharp'], available)).toEqual(['chalk', 'sharp'])
  })

  it('expands a prefix wildcard', () => {
    expect(expandWildcards(['@prisma/*'], available)).toEqual(['@prisma/client', '@prisma/engines'])
  })

  it('expands a suffix wildcard', () => {
    expect(expandWildcards(['*-loader'], available)).toEqual(['css-loader'])
  })

  it('expands a middle wildcard', () => {
    expect(expandWildcards(['c*k'], available)).toEqual(['chalk'])
  })

  it('mixes literals and wildcards, deduplicating', () => {
    const result = expandWildcards(['chalk', '@prisma/*', '@prisma/client'], available)
    expect(result).toEqual(['chalk', '@prisma/client', '@prisma/engines'])
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
