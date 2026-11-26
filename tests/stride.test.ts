import { describe, expect, it } from 'vitest'
import { footfalls } from '../src/actors/stride.ts'

describe('footfalls', () => {
  it('plants twice in one walk cycle, at the halfway point and the end', () => {
    expect(footfalls(0.2, 0.4, 1)).toBe(0)
    expect(footfalls(0.4, 0.6, 1)).toBe(1)
    expect(footfalls(0.8, 1, 1)).toBe(1)
    let time = 0
    let plants = 0
    for (let i = 0; i < 20; i++) {
      const next = time + 0.05
      plants += footfalls(time, next, 1)
      time = next % 1
    }
    expect(plants).toBe(2)
  })

  it('counts a plant when the clip wraps, and two when a long frame crosses both feet', () => {
    expect(footfalls(0.9, 0.04, 1)).toBe(1)
    expect(footfalls(0.4, 1.1, 1)).toBe(2)
    expect(footfalls(0.2, 0.2, 1)).toBe(0)
    expect(footfalls(0.2, 0.4, 0)).toBe(0)
  })
})
