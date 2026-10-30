import { describe, expect, it } from 'vitest'
import { IDLE_RPM, newGearbox, stepGearbox } from '../src/audio/engineSynth.ts'

describe('engine gearbox', () => {
  it('idles at rest and revs up then drops when it shifts', () => {
    const box = newGearbox()
    for (let i = 0; i < 60; i++) stepGearbox(box, 0, 0, 1 / 60)
    expect(box.rpm).toBeCloseTo(IDLE_RPM, 0)

    let speed = 0
    let peak = 0
    let drops = 0
    let last = box.rpm
    for (let i = 0; i < 240; i++) {
      speed = Math.min(16, speed + 8 / 60)
      const rpm = stepGearbox(box, speed, 1, 1 / 60)
      peak = Math.max(peak, rpm)
      if (rpm < last - 40) drops++
      last = rpm
    }
    expect(peak).toBeGreaterThan(3500)
    expect(peak).toBeLessThan(6300)
    expect(box.gear).toBeGreaterThan(1)
    expect(drops).toBeGreaterThan(0)
  })
})
