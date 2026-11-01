import { describe, expect, it } from 'vitest'
import { defaultSettings, parseSettings } from '../src/ui/settings'

describe('pause menu settings', () => {
  it('keeps the current look and volume when nothing is saved', () => {
    expect(parseSettings(null)).toEqual(defaultSettings())
  })

  it('keeps a saved mix and drops values the menu does not offer', () => {
    const settings = parseSettings(
      JSON.stringify({
        ambient: 0.2,
        music: 2,
        sfx: -1,
        shadows: 'off',
        distance: 0.1,
        quality: 'nope',
      }),
    )
    expect(settings.ambient).toBe(0.2)
    expect(settings.music).toBe(1)
    expect(settings.sfx).toBe(0)
    expect(settings.shadows).toBe('off')
    expect(settings.distance).toBe(0.45)
    expect(settings.quality).toBe('high')
  })
})
