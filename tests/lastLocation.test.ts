import { describe, expect, it } from 'vitest'
import mapJson from '../data/map.json'
import { resolveSavedLocation } from '../src/player/lastLocation.ts'
import { BODY_RADIUS, buildLayout, hitsBuilding, type MapFile } from '../src/world/layout.ts'

const layout = buildLayout(mapJson as MapFile)

describe('last location persistence', () => {
  it('restores a valid saved position and yaw', () => {
    const spot = layout.landmarks[0]?.door
    expect(spot).toBeDefined()
    const [x, z] = spot!
    const restored = resolveSavedLocation(layout, JSON.stringify({ x, z, yaw: 1.25 }))
    expect(restored).toEqual({ x, z, yaw: 1.25 })
  })

  it('falls back to default spawn on missing, corrupt, or out-of-bounds data', () => {
    const spawn = { x: layout.file.spawn.x, z: layout.file.spawn.z }
    expect(resolveSavedLocation(layout, null)).toEqual(spawn)
    expect(resolveSavedLocation(layout, '{bad json')).toEqual(spawn)
    expect(resolveSavedLocation(layout, JSON.stringify({ x: 999999, z: 999999 }))).toEqual(spawn)
  })

  it('steps out if the saved spot is inside a building', () => {
    const b = layout.buildings[0]!
    const cx = (b.minX + b.maxX) / 2
    const cz = (b.minZ + b.maxZ) / 2
    const restored = resolveSavedLocation(layout, JSON.stringify({ x: cx, z: cz, yaw: 0.5 }))
    expect(hitsBuilding(layout, restored.x, restored.z, BODY_RADIUS)).toBe(false)
    expect(restored.yaw).toBe(0.5)
  })
})
