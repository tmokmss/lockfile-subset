import { describe, it, expect } from 'vitest'
import { isWildcard, matchesPattern, expandWildcards } from '../src/wildcard.js'

describe('wildcard', () => {
  describe('isWildcard', () => {
    it('detects patterns containing *', () => {
      expect(isWildcard('@aws-sdk/*')).toBe(true)
      expect(isWildcard('*-loader')).toBe(true)
      expect(isWildcard('chalk')).toBe(false)
      expect(isWildcard('@prisma/client')).toBe(false)
    })
  })

  describe('matchesPattern', () => {
    it('does exact match without *', () => {
      expect(matchesPattern('chalk', 'chalk')).toBe(true)
      expect(matchesPattern('chalk', 'chalk-cli')).toBe(false)
    })

    it('matches prefix wildcards', () => {
      expect(matchesPattern('@aws-sdk/*', '@aws-sdk/client-s3')).toBe(true)
      expect(matchesPattern('@aws-sdk/*', '@aws-sdk/')).toBe(true)
      expect(matchesPattern('@aws-sdk/*', '@aws-cdk/core')).toBe(false)
    })

    it('matches suffix wildcards', () => {
      expect(matchesPattern('*-loader', 'css-loader')).toBe(true)
      expect(matchesPattern('*-loader', 'loader')).toBe(false)
    })

    it('matches middle wildcards', () => {
      expect(matchesPattern('foo*bar', 'foo-x-bar')).toBe(true)
      expect(matchesPattern('foo*bar', 'foobar')).toBe(true)
      expect(matchesPattern('foo*bar', 'foo')).toBe(false)
    })

    it('rejects patterns with multiple *', () => {
      expect(() => matchesPattern('*-*-loader', 'a-b-loader')).toThrow(/only one wildcard/)
    })
  })

  describe('expandWildcards', () => {
    const available = ['chalk', 'ms', '@prisma/client', '@prisma/engines', 'sharp']

    it('passes literal names through', () => {
      expect(expandWildcards(['chalk', 'sharp'], available)).toEqual(['chalk', 'sharp'])
    })

    it('expands wildcard against available names', () => {
      expect(expandWildcards(['@prisma/*'], available)).toEqual(['@prisma/client', '@prisma/engines'])
    })

    it('mixes literals and wildcards, deduplicating', () => {
      const result = expandWildcards(['chalk', '@prisma/*', '@prisma/client'], available)
      expect(result).toEqual(['chalk', '@prisma/client', '@prisma/engines'])
    })

    it('throws when wildcard matches nothing', () => {
      expect(() => expandWildcards(['@aws-sdk/*'], available)).toThrow(/did not match/)
    })
  })
})
