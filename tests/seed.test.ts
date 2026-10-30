import { describe, expect, it } from 'vitest'
import { sessionSeed } from '../src/util/seededRng.ts'

describe('session seed', () => {
  it('uses the clock so two times are two games', () => {
    expect(sessionSeed(1_700_000_000_123)).toBe(1_700_000_000_123 >>> 0)
    expect(sessionSeed(1_700_000_000_123)).not.toBe(sessionSeed(1_700_000_005_000))
  })
})
