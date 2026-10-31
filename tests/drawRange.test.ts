import { describe, expect, it } from 'vitest'
import { staysDrawn } from '../src/world/drawRange.ts'

describe('staysDrawn', () => {
  it('shows inside the reach and hides past the hold band', () => {
    expect(staysDrawn(100, 0, 0, 0, 140, false)).toBe(true)
    expect(staysDrawn(150, 0, 0, 0, 140, false)).toBe(false)
    expect(staysDrawn(160, 0, 0, 0, 140, true)).toBe(true)
    expect(staysDrawn(190, 0, 0, 0, 140, true)).toBe(false)
  })
})
