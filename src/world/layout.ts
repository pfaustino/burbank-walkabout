/** Downtown Burbank in local meters. +x is east, +z is north, y is up. */

export type Vec2 = { x: number; z: number }

export type MapBuilding = {
  h: number
  c: string
  name?: string
  blurb?: string
  door?: [number, number]
  ring: number[]
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

export type MapRoad = {
  name: string
  kind: string
  w: number
  pts: number[]
}

export type MapPath = {
  name: string
  pts: number[]
}

export type MapFile = {
  name: string
  credit: string
  spawn: Vec2
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
  buildings: {
    h: number
    c: string
    name?: string
    blurb?: string
    door?: [number, number]
    ring: number[]
  }[]
  roads: MapRoad[]
  paths: MapPath[]
  parks: { name: string; ring: number[] }[]
}

export type CityLayout = {
  file: MapFile
  buildings: MapBuilding[]
  landmarks: MapBuilding[]
}

export const BODY_RADIUS = 0.45

export function buildLayout(file: MapFile): CityLayout {
  const buildings = file.buildings.map((building) => ({ ...building, ...aabb(building.ring) }))
  return {
    file,
    buildings,
    landmarks: buildings.filter((building) => building.name),
  }
}

export function sidewalkLoop(layout: CityLayout, street: string, part = 0): Vec2[] {
  const matches = layout.file.paths.filter((path) => path.name === street)
  matches.sort((a, b) => {
    const delta = polylineLength(b.pts) - polylineLength(a.pts)
    if (Math.abs(delta) > 0.5) return delta
    return (a.pts[0] ?? 0) - (b.pts[0] ?? 0) || (a.pts[1] ?? 0) - (b.pts[1] ?? 0)
  })
  const chosen = matches[part] ?? matches[0]
  return chosen ? pairs(chosen.pts) : []
}

export function hitsBuilding(layout: CityLayout, x: number, z: number, radius: number): boolean {
  for (const building of layout.buildings) {
    if (x < building.minX - radius || x > building.maxX + radius) continue
    if (z < building.minZ - radius || z > building.maxZ + radius) continue
    if (distanceToRing(x, z, building.ring) < radius) return true
  }
  return false
}

/** Move from (x,z) toward (nx,nz), stopping at walls and the map edge. */
export function slide(
  layout: CityLayout,
  x: number,
  z: number,
  nx: number,
  nz: number,
  radius: number,
): Vec2 {
  const direct = tryPoint(layout, nx, nz, radius)
  if (direct) return direct
  const alongX = tryPoint(layout, nx, z, radius)
  if (alongX) return alongX
  const alongZ = tryPoint(layout, x, nz, radius)
  if (alongZ) return alongZ
  return { x, z }
}

/** A free spot about a body's width from someone on the sidewalk. */
export function nearbySpot(layout: CityLayout, x: number, z: number): Vec2 {
  const options = [
    { x, z: z + 1.8 },
    { x, z: z - 1.8 },
    { x: x + 1.8, z },
    { x: x - 1.8, z },
  ]
  for (const option of options) {
    const next = slide(layout, x, z, option.x, option.z, BODY_RADIUS)
    const dist = Math.hypot(next.x - x, next.z - z)
    if (dist > 0.8 && dist < 3 && !hitsBuilding(layout, next.x, next.z, BODY_RADIUS)) return next
  }
  return { x, z }
}

export function describePlace(layout: CityLayout, x: number, z: number): string {
  const road = nearestRoadName(layout, x, z)
  let best: MapBuilding | null = null
  let bestD = 70
  for (const mark of layout.landmarks) {
    const dist = distanceToRing(x, z, mark.ring)
    if (dist < bestD) {
      bestD = dist
      best = mark
    }
  }
  if (best?.name && road) return `${road} · ${best.name}`
  return best?.name || road || layout.file.name
}

export function mapBrief(layout: CityLayout): string {
  const marks = layout.landmarks.map((mark) => `${mark.name} (${mark.blurb})`).join('; ')
  return `You are on foot in downtown Burbank. The streets and building outlines are the real downtown, including Olive Avenue, Magnolia Boulevard, San Fernando Boulevard, Glenoaks Boulevard, and 3rd Street. Places: ${marks}.`
}

function nearestRoadName(layout: CityLayout, x: number, z: number): string {
  let best = ''
  let bestD = 55
  for (const road of layout.file.roads) {
    if (!road.name || road.name.startsWith('Alley')) continue
    const dist = distanceToPolyline(x, z, road.pts)
    if (dist < bestD) {
      bestD = dist
      best = road.name
    }
  }
  return best
}

function tryPoint(layout: CityLayout, x: number, z: number, radius: number): Vec2 | null {
  const next = clampToBounds(layout, x, z, radius)
  if (hitsBuilding(layout, next.x, next.z, radius)) return null
  return next
}

function clampToBounds(layout: CityLayout, x: number, z: number, radius: number): Vec2 {
  const { bounds } = layout.file
  return {
    x: clamp(x, bounds.minX + radius, bounds.maxX - radius),
    z: clamp(z, bounds.minZ + radius, bounds.maxZ - radius),
  }
}

function aabb(ring: number[]): { minX: number; maxX: number; minZ: number; maxZ: number } {
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (let i = 0; i < ring.length; i += 2) {
    const x = ring[i] ?? 0
    const z = ring[i + 1] ?? 0
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minZ = Math.min(minZ, z)
    maxZ = Math.max(maxZ, z)
  }
  return { minX, maxX, minZ, maxZ }
}

function pairs(flat: number[]): Vec2[] {
  const points: Vec2[] = []
  for (let i = 0; i < flat.length; i += 2) points.push({ x: flat[i] ?? 0, z: flat[i + 1] ?? 0 })
  return points
}

function polylineLength(flat: number[]): number {
  let length = 0
  for (let i = 2; i < flat.length; i += 2) {
    length += Math.hypot((flat[i] ?? 0) - (flat[i - 2] ?? 0), (flat[i + 1] ?? 0) - (flat[i - 1] ?? 0))
  }
  return length
}

function distanceToRing(x: number, z: number, ring: number[]): number {
  if (pointInRing(x, z, ring)) return 0
  return distanceToPolyline(x, z, ring, true)
}

function distanceToPolyline(x: number, z: number, flat: number[], closed = false): number {
  let best = Infinity
  const count = flat.length / 2
  if (count < 2) return best
  const last = closed ? count : count - 1
  for (let i = 0; i < last; i++) {
    const a = i * 2
    const b = ((i + 1) % count) * 2
    best = Math.min(best, distanceToSegment(x, z, flat[a] ?? 0, flat[a + 1] ?? 0, flat[b] ?? 0, flat[b + 1] ?? 0))
  }
  return best
}

function distanceToSegment(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax
  const dz = bz - az
  const len2 = dx * dx + dz * dz || 1
  const t = clamp(((x - ax) * dx + (z - az) * dz) / len2, 0, 1)
  return Math.hypot(x - (ax + dx * t), z - (az + dz * t))
}

function pointInRing(x: number, z: number, ring: number[]): boolean {
  let inside = false
  const count = ring.length / 2
  for (let i = 0, j = count - 1; i < count; j = i++) {
    const ax = ring[i * 2] ?? 0
    const az = ring[i * 2 + 1] ?? 0
    const bx = ring[j * 2] ?? 0
    const bz = ring[j * 2 + 1] ?? 0
    const crosses = az > z !== bz > z
    if (crosses && x < ((bx - ax) * (z - az)) / (bz - az) + ax) inside = !inside
  }
  return inside
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
