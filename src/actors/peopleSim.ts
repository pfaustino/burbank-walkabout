import { hitsBuilding, sidewalkLoop, type CityLayout } from '../world/layout.ts'

export type PersonVoice = 'female' | 'male'

export type PersonDef = {
  id: string
  name: string
  voice: PersonVoice
  shirt: string
  pants: string
  skin: string
  hair: string
  street: string
  part: number
  at: number
  persona: string
}

export type PeopleFile = {
  speed: number
  talkRange: number
  hearRange: number
  people: PersonDef[]
}

export type PersonSim = {
  id: string
  street: string
  part: number
  x: number
  z: number
  yaw: number
  waypoint: number
  dir: number
  pause: number
}

export function createPeople(layout: CityLayout, file: PeopleFile, rng: () => number): PersonSim[] {
  const people: PersonSim[] = []
  for (const entry of file.people) {
    const loop = sidewalkLoop(layout, entry.street, entry.part)
    if (loop.length < 2) continue
    const index = Math.round(entry.at * (loop.length - 1))
    const dir = index >= loop.length - 1 ? -1 : 1
    const nextIndex = Math.min(loop.length - 1, Math.max(0, index + dir))
    const start = loop[index]!
    const next = loop[nextIndex]!
    people.push({
      id: entry.id,
      street: entry.street,
      part: entry.part,
      x: start.x,
      z: start.z,
      yaw: Math.atan2(next.x - start.x, next.z - start.z),
      waypoint: nextIndex,
      dir,
      pause: 0.8 + rng() * 1.6,
    })
  }
  return people
}

export function stepPeople(
  people: PersonSim[],
  layout: CityLayout,
  speed: number,
  dt: number,
  rng: () => number,
  held?: ReadonlySet<string>,
): void {
  for (const person of people) {
    if (held?.has(person.id)) continue
    const loop = sidewalkLoop(layout, person.street, person.part)
    if (loop.length < 2) continue
    if (person.pause > 0) {
      person.pause -= dt
      continue
    }
    const target = loop[Math.min(loop.length - 1, Math.max(0, person.waypoint))]!
    const dx = target.x - person.x
    const dz = target.z - person.z
    const dist = Math.hypot(dx, dz)
    if (dist < 0.35) {
      let next = person.waypoint + person.dir
      if (next < 0 || next >= loop.length) {
        person.dir *= -1
        next = person.waypoint + person.dir
      }
      person.waypoint = next
      person.pause = 0.2 + rng() * 0.45
      continue
    }
    const step = Math.min(dist, speed * dt)
    const nx = person.x + (dx / dist) * step
    const nz = person.z + (dz / dist) * step
    if (hitsBuilding(layout, nx, nz, 0.3)) {
      person.dir *= -1
      person.waypoint = Math.min(loop.length - 1, Math.max(0, person.waypoint + person.dir))
      person.pause = 0.3
      continue
    }
    person.x = nx
    person.z = nz
    person.yaw = Math.atan2(dx, dz)
  }
}
