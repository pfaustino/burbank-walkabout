import { knownStation, STATIONS, stepStation } from '../src/audio/radio.ts'
import { describe, expect, it } from 'vitest'

describe('radio', () => {
  it('lists the stations alphabetically, with Off at both ends of the step', () => {
    const names = STATIONS.map((station) => station.name)
    const sorted = [...names].sort((a, b) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' }))
    expect(names).toEqual(sorted)
    expect(stepStation('', 1)).toBe(STATIONS[0]?.id)
    expect(stepStation(STATIONS[0]?.id ?? '', -1)).toBe('')
    expect(stepStation(STATIONS[STATIONS.length - 1]?.id ?? '', 1)).toBe('')
    expect(knownStation('kost')).toBe(true)
    expect(knownStation('nope')).toBe(false)
  })
})