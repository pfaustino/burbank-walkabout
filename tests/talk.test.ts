import { describe, expect, it } from 'vitest'
import { localReply } from '../src/dialog/fallback.ts'
import { cleanName, parseClientMessage, shirtForName } from '../src/net/protocol.ts'

describe('talk', () => {
  it('keeps a bare hello short', () => {
    const hellos = Array.from({ length: 24 }, (_, i) => localReply({ id: `c${i}`, name: 'Sam' }, 'Hi', 'Olive Avenue'))
    expect(hellos.some((line) => line.length <= 6)).toBe(true)
    expect(hellos.every((line) => !/question|assist|help/i.test(line))).toBe(true)
    expect(localReply({ id: 'c3', name: 'Sam' }, 'Where is the library?', 'Olive Avenue')).toContain('Glenoaks')
  })

  it('answers how-are-you with a mood', () => {
    expect(localReply({ id: 'sam', name: 'Sam Reyes' }, 'How are you?', 'Olive Avenue')).toBe('Worse. Keep walking.')
    expect(localReply({ id: 'c1', name: 'Pat' }, 'How are you?', 'Olive Avenue')).not.toMatch(/^Hey|^Hi/)
  })

  it('answers City Hall from the local script', () => {
    const line = localReply({ id: 'june', name: 'June Alvarez' }, 'Where is City Hall?', 'Olive Avenue')
    expect(line).toContain('Olive Avenue')
    expect(line).toContain('City Hall')
  })

  it('parses a sidewalk question and drops junk', () => {
    expect(parseClientMessage({ type: 'talk', npcId: 'june', text: ' hello ', x: 1, z: 2 })).toEqual({
      type: 'talk',
      npcId: 'june',
      text: 'hello',
      x: 1,
      z: 2,
    })
    expect(parseClientMessage({ type: 'talk', npcId: 'june', text: '   ', x: 1, z: 2 })).toBeNull()
    expect(parseClientMessage({ type: 'talk', npcId: 'c4', text: 'hello', x: 1, z: 2, t: 3.5 })).toMatchObject({
      npcId: 'c4',
      t: 3.5,
    })
    expect(parseClientMessage({ type: 'move', x: 1, z: 2 })).toBeNull()
  })

  it('cleans names', () => {
    expect(cleanName('  Pat <rick>  ')).toBe('Pat rick')
    expect(cleanName('***')).toBe('Walker')
    expect(shirtForName('Patrick')).toMatch(/^#/)
  })
})
