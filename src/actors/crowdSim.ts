import type { PersonVoice } from './peopleSim.ts'
import type { CityLayout, Vec2 } from '../world/layout.ts'

export type CrowdFile = {
  count: number
  speed: number
}

/** Shared with the city server so a talk can find the same person. */
export const CROWD_SEED = 0xc0de

export type CrowdPerson = {
  loop: number
  offset: number
  speed: number
  phase: number
  voice: PersonVoice
  name: string
  shirt: number
  pants: number
  skin: number
  hair: number
  shoes: number
}

type CrowdLoop = {
  pts: Vec2[]
  cum: number[]
  length: number
}

export type CrowdWorld = {
  people: CrowdPerson[]
  loops: CrowdLoop[]
}

const SHIRTS = [0xc45c26, 0x1d1d1d, 0x3d6b8c, 0x1f4d3a, 0xe6dcc8, 0x6b3a2a, 0x2f5d50, 0x3a3f73, 0x8c3d4a, 0x2457c5, 0xf2f2f2, 0x6d3b86]
const PANTS = [0x243044, 0x2c3338, 0x3e4a34, 0x4a3b32, 0x1c1c1c, 0x5c5346, 0x1e3a5f]
const SKINS = [0xd4a574, 0x8d5a3c, 0xc48a62, 0xe0b090, 0x6b3f2a, 0xe8c4a8, 0xc6865a]
const HAIRS = [0x3a2a18, 0x1a120e, 0x1c1c1c, 0x2a2118, 0x4a3020, 0xc4b49a, 0x6a2a22, 0x8a8a8a]
const SHOES = [0x1c1c1c, 0xf2f2f2, 0x6b3a2a, 0x1e3a5f, 0x8c3d4a, 0xc4a574, 0x3a3f4a]
const FEMALE = ['Maya', 'Elena', 'Nora', 'Hana', 'Ivy', 'Leah', 'Sofia', 'Clara', 'Nina', 'Ruby', 'Willa', 'Greta', 'Paige', 'Thea', 'Lila', 'Mara', 'Celia', 'Vera', 'Noor', 'Esme', 'Adele', 'Freya', 'Iris', 'Joan']
const MALE = ['Owen', 'Felix', 'Hugo', 'Andre', 'Nico', 'Ellis', 'Jonah', 'Caleb', 'Miles', 'Theo', 'Arun', 'Diego', 'Malik', 'Simon', 'Peter', 'Colin', 'Ravi', 'Evan', 'Victor', 'Omar', 'Isaac', 'Leon', 'Grant', 'Wes']
const LAST = ['Cho', 'Patel', 'Brooks', 'Diaz', 'Kim', 'Walsh', 'Singh', 'Berg', 'Costa', 'Park', 'Adler', 'Santos', 'Novak', 'Keller', 'Ibarra', 'Frost', 'Holland', 'Okada', 'Bauer', 'Silva', 'Navarro', 'Ellison', 'Duval', 'Hart', 'Kaplan', 'Moreau', 'Sato', 'Bennett', 'Crowley', 'Lang', 'Peters', 'Solano', 'Voss', 'Yamamoto', 'Delgado', 'Hoffman', 'McKay', 'Rahman', 'Vogel', 'Estes']
const RESERVED = new Set(['June Alvarez', 'Marcus Bell', 'Priya Shah', 'Luis Ortega', 'Aisha Coleman', 'Kenji Mori', 'Rosa Nguyen', 'Sam Reyes'])

export function crowdId(index: number): string {
  return `c${index}`
}

export function crowdIndex(id: string): number | null {
  if (id.length < 2 || id[0] !== 'c') return null
  let n = 0
  for (let i = 1; i < id.length; i++) {
    const code = id.charCodeAt(i)
    if (code < 48 || code > 57) return null
    n = n * 10 + (code - 48)
  }
  return n
}

/** Extra sidewalk walkers. Poses are a function of time, so they stay cheap and do not drift. */
export function createCrowd(layout: CityLayout, file: CrowdFile, rng: () => number): CrowdWorld {
  const loops = loopsFrom(layout)
  const people: CrowdPerson[] = []
  const usedNames = new Set<string>(RESERVED)
  const total = loops.reduce((sum, loop) => sum + loop.length, 0)
  if (loops.length === 0 || total < 8 || file.count < 1) return { people, loops }
  const step = total / file.count
  let loopIndex = 0
  let into = rng() * Math.min(step, loops[0]!.length)
  for (let i = 0; i < file.count; i++) {
    const loop = loops[loopIndex]
    if (!loop) break
    const voice: PersonVoice = rng() < 0.5 ? 'female' : 'male'
    people.push({
      loop: loopIndex,
      offset: into,
      speed: file.speed * (0.82 + rng() * 0.36),
      phase: rng() * Math.PI * 2,
      voice,
      name: personName(i, voice, usedNames),
      shirt: SHIRTS[Math.floor(rng() * SHIRTS.length)] ?? SHIRTS[0]!,
      pants: PANTS[Math.floor(rng() * PANTS.length)] ?? PANTS[0]!,
      skin: SKINS[Math.floor(rng() * SKINS.length)] ?? SKINS[0]!,
      hair: HAIRS[Math.floor(rng() * HAIRS.length)] ?? HAIRS[0]!,
      shoes: SHOES[Math.floor(rng() * SHOES.length)] ?? SHOES[0]!,
    })
    let left = step
    while (left > 0 && loopIndex < loops.length) {
      const room = loops[loopIndex]!.length - into
      if (left < room) {
        into += left
        left = 0
      } else {
        left -= room
        loopIndex++
        into = 0
      }
    }
  }
  return { people, loops }
}

/** Keep walking from the spot they were held, instead of jumping ahead with the clock. */
export function resumeWalk(person: CrowdPerson, frozen: number, now: number): void {
  person.offset += person.speed * (frozen - now)
}

/** Put them back on the nearest sidewalk where they are actually standing. */
export function rejoinWalk(world: CrowdWorld, index: number, x: number, z: number, now: number): void {
  const person = world.people[index]
  if (!person || world.loops.length === 0) return
  let bestD = Infinity
  let bestLoop = person.loop
  let bestAlong = 0
  for (let i = 0; i < world.loops.length; i++) {
    const hit = closestOn(world.loops[i]!, x, z)
    if (hit.d < bestD) {
      bestD = hit.d
      bestLoop = i
      bestAlong = hit.dist
    }
  }
  person.loop = bestLoop
  person.offset = bestAlong - person.speed * now
}

export function crowdPose(world: CrowdWorld, index: number, time: number): { x: number; z: number; yaw: number } {
  const person = world.people[index]!
  const loop = world.loops[person.loop]!
  const span = loop.length * 2
  let traveled = person.offset + person.speed * time
  traveled = ((traveled % span) + span) % span
  const forward = traveled <= loop.length
  const dist = forward ? traveled : span - traveled
  const pose = sample(loop, Math.min(dist, Math.max(loop.length - 0.05, 0)))
  return { x: pose.x, z: pose.z, yaw: forward ? pose.yaw : pose.yaw + Math.PI }
}

function personName(index: number, voice: PersonVoice, used: Set<string>): string {
  const firsts = voice === 'female' ? FEMALE : MALE
  const span = firsts.length * LAST.length
  for (let k = 0; k < span; k++) {
    const slot = (index * 17 + k) % span
    const name = `${firsts[Math.floor(slot / LAST.length) % firsts.length]!} ${LAST[slot % LAST.length]!}`
    if (used.has(name)) continue
    used.add(name)
    return name
  }
  const fallback = `Walker ${index}`
  used.add(fallback)
  return fallback
}

function loopsFrom(layout: CityLayout): CrowdLoop[] {
  const loops: CrowdLoop[] = []
  for (const path of layout.file.paths) {
    if (path.pts.length < 4) continue
    const pts: Vec2[] = []
    for (let i = 0; i < path.pts.length; i += 2) {
      const x = path.pts[i] ?? 0
      const z = path.pts[i + 1] ?? 0
      const last = pts[pts.length - 1]
      if (last && Math.hypot(x - last.x, z - last.z) < 0.4) continue
      pts.push({ x, z })
    }
    if (pts.length < 2) continue
    const cum = [0]
    for (let i = 1; i < pts.length; i++) {
      cum.push(cum[i - 1]! + Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.z - pts[i - 1]!.z))
    }
    const length = cum[cum.length - 1] ?? 0
    if (length < 8) continue
    loops.push({ pts, cum, length })
  }
  return loops
}

function closestOn(loop: CrowdLoop, x: number, z: number): { dist: number; d: number } {
  let bestD = Infinity
  let bestAlong = 0
  for (let i = 1; i < loop.pts.length; i++) {
    const a = loop.pts[i - 1]!
    const b = loop.pts[i]!
    const dx = b.x - a.x
    const dz = b.z - a.z
    const len2 = dx * dx + dz * dz
    const len = Math.sqrt(len2) || 1
    const t = len2 < 1e-6 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / len2))
    const px = a.x + dx * t
    const pz = a.z + dz * t
    const d = Math.hypot(x - px, z - pz)
    if (d >= bestD) continue
    bestD = d
    bestAlong = (loop.cum[i - 1] ?? 0) + len * t
  }
  return { dist: bestAlong, d: bestD }
}

function sample(loop: CrowdLoop, dist: number): { x: number; z: number; yaw: number } {
  let i = 0
  while (i < loop.cum.length - 2 && loop.cum[i + 1]! < dist) i++
  const span = (loop.cum[i + 1] ?? loop.length) - (loop.cum[i] ?? 0) || 1
  const t = (dist - (loop.cum[i] ?? 0)) / span
  const a = loop.pts[i] ?? loop.pts[0]!
  const b = loop.pts[i + 1] ?? a
  return {
    x: a.x + (b.x - a.x) * t,
    z: a.z + (b.z - a.z) * t,
    yaw: Math.atan2(b.x - a.x, b.z - a.z),
  }
}
