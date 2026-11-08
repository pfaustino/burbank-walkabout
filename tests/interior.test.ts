import { overlapsCapsule } from '../src/traffic/bodies.ts'
import { atBuilding, indoorReply, interiorGuest, interiorPersona, nearestEntrance, planInterior, classifyBuilding, type InteriorKind } from '../src/world/interior.ts'
import type { CityLayout, MapBuilding } from '../src/world/layout.ts'
import type { Business } from '../src/world/storefronts.ts'
import { describe, expect, it } from 'vitest'

const KINDS: InteriorKind[] = ['office', 'restaurant', 'residential', 'shop', 'civic', 'hotel']

function box(x: number, z: number, w: number, d: number, extra: Partial<MapBuilding> = {}): MapBuilding {
  const minX = x - w / 2
  const maxX = x + w / 2
  const minZ = z - d / 2
  const maxZ = z + d / 2
  return {
    h: 6,
    c: '#ccc',
    ring: [minX, minZ, maxX, minZ, maxX, maxZ, minX, maxZ],
    minX,
    maxX,
    minZ,
    maxZ,
    ...extra,
  }
}

function layoutOf(buildings: MapBuilding[]): CityLayout {
  return {
    buildings,
    landmarks: [],
    file: {
      name: 'test',
      credit: '',
      spawn: { x: 0, z: 0 },
      bounds: { minX: -400, maxX: 400, minZ: -400, maxZ: 400 },
      buildings: [],
      roads: [],
      paths: [],
      parks: [],
    },
  }
}

describe('building interiors', () => {
  it('classifies halls, houses, towers, and the business inside', () => {
    expect(classifyBuilding(box(0, 0, 20, 16, { name: 'Burbank City Hall', h: 10 }), []).kind).toBe('civic')
    expect(classifyBuilding(box(0, 0, 12, 10, { name: 'Olive Inn', h: 8 }), []).kind).toBe('hotel')
    expect(classifyBuilding(box(0, 0, 9, 10, { h: 5 }), []).kind).toBe('residential')
    expect(classifyBuilding(box(0, 0, 18, 18, { h: 16 }), []).kind).toBe('office')
    expect(classifyBuilding(box(0, 0, 20, 16, { h: 6 }), []).kind).toBe('shop')
    const cafe: Business = { name: 'Counter Coffee', x: 0, z: 0, kind: 'cafe' }
    const found = classifyBuilding(box(0, 0, 9, 10, { h: 5 }), [cafe])
    expect(found.kind).toBe('restaurant')
    expect(found.title).toBe('Counter Coffee')
  })

  it('keeps the same room for the same building', () => {
    const first = planInterior(12, 'office', 'Office')
    const again = planInterior(12, 'office', 'Office')
    expect(again.people.map((person) => person.name)).toEqual(first.people.map((person) => person.name))
    expect(first.people.length).toBeGreaterThan(0)
  })

  it('puts people inside, clear of the furniture and the door', () => {
    for (const kind of KINDS) {
      const plan = planInterior(3, kind, kind)
      expect(plan.people.length).toBeGreaterThan(0)
      expect(plan.enterZ).toBeGreaterThan(plan.minZ + 1)
      expect(plan.enterZ).toBeLessThan(plan.maxZ)
      const fromDoor = Math.hypot(plan.enterX - plan.doorX, plan.enterZ - plan.doorZ)
      expect(fromDoor).toBeGreaterThan(2.2)
      expect(fromDoor).toBeLessThan(5)
      for (const disc of plan.blockers) {
        expect(overlapsCapsule(plan.enterX, plan.enterZ, 0, 0, 0.45, disc)).toBe(false)
      }
      for (const person of plan.people) {
        expect(person.x).toBeGreaterThan(plan.minX + 0.8)
        expect(person.x).toBeLessThan(plan.maxX - 0.8)
        expect(person.z).toBeGreaterThan(plan.minZ + 0.8)
        expect(person.z).toBeLessThan(plan.maxZ - 0.8)
        expect(Math.hypot(person.x - plan.doorX, person.z - plan.doorZ)).toBeGreaterThan(2)
        for (const disc of plan.blockers) {
          if (disc.id === person.id) continue
          expect(overlapsCapsule(person.x, person.z, 0, 0, 0.42, disc)).toBe(false)
        }
      }
    }
    const home = planInterior(1, 'residential', 'Home')
    const hall = planInterior(1, 'civic', 'Hall')
    expect(hall.maxX - hall.minX).toBeGreaterThan(home.maxX - home.minX)
  })

  it('rebuilds the same indoor person from their id', () => {
    const hall = box(0, 0, 20, 16, { name: 'Burbank City Hall', h: 10, door: [0, -12] })
    const layout = layoutOf([hall])
    const plan = planInterior(0, 'civic', 'Burbank City Hall')
    const guest = interiorGuest(layout, [], 'in-0-0')
    expect(guest?.person.name).toBe(plan.people[0]?.name)
    expect(guest?.person.voice).toBe(plan.people[0]?.voice)
    expect(guest?.title).toBe('Burbank City Hall')
    expect(interiorPersona(plan.people[0]!, 'Burbank City Hall')).toContain('You work the front desk.')
    expect(interiorGuest(layout, [], 'in-0-9')).toBeNull()
    expect(interiorGuest(layout, [], 'june')).toBeNull()
    expect(atBuilding(hall, 0, -12, 6.5)).toBe(true)
    expect(atBuilding(hall, 80, 80, 6.5)).toBe(false)
  })

  it('answers as the person in the room', () => {
    const line = indoorReply({ id: 'in-1-0', name: 'Nora Cho', role: 'I live here.' }, 'who are you', 'Home')
    expect(line).toContain('Nora Cho')
    expect(line).toContain('I live here.')
  })

  it('finds the nearest outside door and ignores a sliver', () => {
    const hall = box(0, 0, 10, 10, { name: 'Library', door: [0, -8] })
    const shed = box(30, 0, 1, 1)
    const layout = layoutOf([hall, shed])
    const atDoor = nearestEntrance(layout, 0, -8)
    expect(atDoor?.index).toBe(0)
    expect(atDoor?.name).toBe('Library')
    expect(atDoor?.z).toBeCloseTo(-8, 0)
    expect(nearestEntrance(layout, 0, -30)).toBeNull()
    expect(nearestEntrance(layout, 30, 0)).toBeNull()
    const wall = nearestEntrance(layout, 0, -6.2)
    expect(wall).not.toBeNull()
    expect(wall!.z).toBeLessThan(hall.minZ)
  })
})
