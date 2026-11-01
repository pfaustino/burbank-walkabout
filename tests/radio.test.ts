import { knownStation, stepStation } from '../src/audio/radio.ts'
import { describe, expect, it } from 'vitest'

describe('radio', () => {
  it('steps through the stations and back to off', () => {
    expect(stepStation('', 1)).toBe('kfi')
    expect(stepStation('kfi', -1)).toBe('')
    expect(stepStation('kcrw', 1)).toBe('bbc')
    expect(stepStation('caroline', 1)).toBe('')
    expect(stepStation('cali', 1)).toBe('kpfk')
    expect(stepStation('kpfk', 1)).toBe('laist')
    expect(stepStation('laist', 1)).toBe('kcrw')
    expect(stepStation('klos', 1)).toBe('cali')
    expect(knownStation('kost')).toBe(true)
    expect(knownStation('nope')).toBe(false)
  })
})