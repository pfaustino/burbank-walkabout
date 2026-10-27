import { afterEach, describe, expect, it } from 'vitest'
import peopleJson from '../data/people.json'
import { fishSpeech, referenceFor } from '../server/fish.ts'

describe('fish audio', () => {
  const previous = process.env.FISH_AUDIO_API_KEY

  afterEach(() => {
    if (previous === undefined) delete process.env.FISH_AUDIO_API_KEY
    else process.env.FISH_AUDIO_API_KEY = previous
  })

  it('gives every person a different voice', () => {
    const ids = peopleJson.people.map((person) => referenceFor(person.id, person.voice as 'female' | 'male'))
    expect(ids.every((id) => Boolean(id))).toBe(true)
    expect(new Set(ids).size).toBe(peopleJson.people.length)
  })

  it('stays quiet when no key is set', async () => {
    delete process.env.FISH_AUDIO_API_KEY
    expect(await fishSpeech('hello', 'female')).toBeNull()
  })
})
