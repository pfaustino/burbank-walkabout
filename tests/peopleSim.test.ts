import { describe, expect, it } from 'vitest'
import mapJson from '../data/map.json'
import peopleJson from '../data/people.json'
import { createPeople, stepPeople, type PeopleFile } from '../src/actors/peopleSim.ts'
import { createSeededRng } from '../src/util/seededRng.ts'
import { buildLayout, hitsBuilding, type MapFile } from '../src/world/layout.ts'

describe('sidewalk walkers', () => {
  it('stays out of buildings for a minute', () => {
    const layout = buildLayout(mapJson as MapFile)
    const file = peopleJson as PeopleFile
    const rng = createSeededRng(7)
    const people = createPeople(layout, file, rng)
    expect(people).toHaveLength(file.people.length)
    for (let t = 0; t < 60; t += 0.05) stepPeople(people, layout, file.speed, 0.05, rng)
    for (const person of people) {
      expect(hitsBuilding(layout, person.x, person.z, 0.3)).toBe(false)
      expect(person.x).toBeGreaterThan(layout.file.bounds.minX)
      expect(person.x).toBeLessThan(layout.file.bounds.maxX)
      expect(person.z).toBeGreaterThan(layout.file.bounds.minZ)
      expect(person.z).toBeLessThan(layout.file.bounds.maxZ)
    }
  })

  it('stands still while addressed and walks again after release', () => {
    const layout = buildLayout(mapJson as MapFile)
    const file = peopleJson as PeopleFile
    const rng = createSeededRng(3)
    const people = createPeople(layout, file, rng)
    const heldId = people[0]!.id
    const stopped = people.find((person) => person.id === heldId)!
    const parked = { x: stopped.x, z: stopped.z }
    const held = new Set([heldId])
    for (let t = 0; t < 3; t += 0.05) stepPeople(people, layout, file.speed, 0.05, rng, held)
    expect(stopped.x).toBe(parked.x)
    expect(stopped.z).toBe(parked.z)
    held.delete(heldId)
    for (let t = 0; t < 3; t += 0.05) stepPeople(people, layout, file.speed, 0.05, rng, held)
    const moved = Math.hypot(stopped.x - parked.x, stopped.z - parked.z)
    expect(moved).toBeGreaterThan(1)
  })
})
