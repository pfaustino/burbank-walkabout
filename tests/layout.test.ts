import { describe, expect, it } from 'vitest'
import mapJson from '../data/map.json'
import peopleJson from '../data/people.json'
import type { PeopleFile } from '../src/actors/peopleSim.ts'
import {
  BODY_RADIUS,
  aimBuilding,
  buildLayout,
  describePlace,
  hitsBuilding,
  mapBrief,
  nearbySpot,
  sidewalkLoop,
  slide,
  type MapFile,
} from '../src/world/layout.ts'

const layout = buildLayout(mapJson as MapFile)
const people = peopleJson as PeopleFile

describe('downtown layout', () => {
  it('keeps the spawn and every doorway on open ground', () => {
    expect(hitsBuilding(layout, layout.file.spawn.x, layout.file.spawn.z, BODY_RADIUS)).toBe(false)
    for (const mark of layout.landmarks) {
      const x = mark.door?.[0] ?? 0
      const z = mark.door?.[1] ?? 0
      expect(hitsBuilding(layout, x, z, BODY_RADIUS)).toBe(false)
    }
  })

  it('finds City Hall when the look points at the door', () => {
    const hall = layout.landmarks.find((mark) => mark.name === 'Burbank City Hall')
    expect(hall?.door).toBeTruthy()
    const doorX = hall!.door![0]
    const doorZ = hall!.door![1]
    const cx = (hall!.minX + hall!.maxX) / 2
    const cz = (hall!.minZ + hall!.maxZ) / 2
    const dx = cx - doorX
    const dz = cz - doorZ
    const len = Math.hypot(dx, dz)
    const hit = aimBuilding(layout, doorX, 2, doorZ, dx / len, 0, dz / len)
    expect(hit?.name).toBe('Burbank City Hall')
    expect(hitsBuilding(layout, hit!.x, hit!.z, 0.2)).toBe(false)
    expect(aimBuilding(layout, doorX, 2, doorZ, 0, 1, 0)).toBeNull()
  })

  it('stops a walk into City Hall', () => {
    const hall = layout.landmarks.find((mark) => mark.name === 'Burbank City Hall')
    expect(hall).toBeTruthy()
    const cx = (hall!.minX + hall!.maxX) / 2
    const cz = (hall!.minZ + hall!.maxZ) / 2
    expect(hitsBuilding(layout, cx, cz, 0.2)).toBe(true)
    const next = slide(layout, cx, cz, hall!.door?.[0] ?? cx, hall!.door?.[1] ?? cz, BODY_RADIUS)
    expect(hitsBuilding(layout, next.x, next.z, BODY_RADIUS)).toBe(false)
    expect(Math.hypot(next.x - cx, next.z - cz)).toBeGreaterThan(1)
  })

  it('names Olive Avenue and the real landmarks', () => {
    expect(mapBrief(layout)).toContain('Olive Avenue')
    expect(mapBrief(layout)).toContain('Burbank City Hall')
    const hall = layout.landmarks.find((mark) => mark.name === 'Burbank City Hall')
    const place = describePlace(layout, hall!.door?.[0] ?? 0, hall!.door?.[1] ?? 0)
    expect(place).toContain('City Hall')
    const mall = layout.landmarks.find((mark) => mark.name === 'Burbank Town Center')
    expect(describePlace(layout, mall!.door?.[0] ?? 0, mall!.door?.[1] ?? 0)).toContain('Town Center')
  })

  it('stands beside a person without entering a building', () => {
    for (const person of people.people) {
      const loop = sidewalkLoop(layout, person.street, person.part)
      expect(loop.length).toBeGreaterThan(3)
      const index = Math.round(person.at * (loop.length - 1))
      const spot = nearbySpot(layout, loop[index]!.x, loop[index]!.z)
      expect(hitsBuilding(layout, spot.x, spot.z, BODY_RADIUS)).toBe(false)
      expect(Math.hypot(spot.x - loop[index]!.x, spot.z - loop[index]!.z)).toBeLessThan(3)
    }
  })
})
