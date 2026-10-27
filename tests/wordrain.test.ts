import { describe, expect, it } from 'vitest'
import { collectWords } from '../src/ui/WordRain.ts'

describe('word stream', () => {
  it('keeps the readable words and drops the filler', () => {
    expect(collectWords("I'm walking to City Hall on Olive.")).toEqual(['Walking', 'City', 'Hall', 'Olive'])
  })
})
