import { hitsBuilding, type CityLayout } from './layout.ts'

export type FoliageFile = {
  spacing: Record<string, number>
  parkSpacing: number
}

export type Plant = {
  kind: 'tree' | 'bush'
  variant: number
  x: number
  z: number
  scale: number
  yaw: number
}

const TREE_KINDS = new Set(['primary', 'secondary', 'tertiary', 'residential', 'unclassified'])
const ROAD_CELL = 32
const ROAD_PAD = 2.2

export function placeFoliage(layout: CityLayout, file: FoliageFile, rng: () => number): Plant[] {
  const plants: Plant[] = []
  const grid = new Map<string, Plant[]>()
  const roads = roadIndex(layout.file.roads)
  const bounds = layout.file.bounds
  const paved = (x: number, z: number): boolean => onAsphalt(roads, x, z)

  const free = (x: number, z: number, minDist: number): boolean => {
    const gx = Math.floor(x / 4)
    const gz = Math.floor(z / 4)
    const reach = Math.ceil(minDist / 4)
    for (let dx = -reach; dx <= reach; dx++) {
      for (let dz = -reach; dz <= reach; dz++) {
        const list = grid.get(`${gx + dx},${gz + dz}`)
        if (!list) continue
        for (const plant of list) {
          if (Math.hypot(plant.x - x, plant.z - z) < minDist) return false
        }
      }
    }
    return true
  }

  const add = (kind: 'tree' | 'bush', x: number, z: number, scale: number): boolean => {
    if (x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ) return false
    const minDist = kind === 'tree' ? 7.5 : 2.2
    const radius = kind === 'tree' ? 0.7 : 0.35
    if (!free(x, z, minDist) || hitsBuilding(layout, x, z, radius)) return false
    const plant: Plant = {
      kind,
      variant: rng() < 0.45 ? 1 : 0,
      x,
      z,
      scale,
      yaw: rng() * Math.PI * 2,
    }
    plants.push(plant)
    const key = `${Math.floor(x / 4)},${Math.floor(z / 4)}`
    const list = grid.get(key) ?? []
    list.push(plant)
    grid.set(key, list)
    return true
  }

  for (const road of layout.file.roads) {
    const spacing = file.spacing[road.kind]
    if (!spacing || spacing < 4) continue
    const bushOnly = road.kind === 'pedestrian'
    if (!bushOnly && !TREE_KINDS.has(road.kind)) continue
    forEachSample(road.pts, spacing, rng() * spacing, (x, z, tx, tz) => {
      const half = road.w / 2
      for (const side of [1, -1]) {
        const ox = tz * side
        const oz = -tx * side
        if (bushOnly) {
          add('bush', x + ox * (half + 1.3), z + oz * (half + 1.3), 0.55 + rng() * 0.4)
          continue
        }
        const treeX = x + ox * (half + 4.2)
        const treeZ = z + oz * (half + 4.2)
        if (paved(treeX, treeZ)) continue
        const planted = add('tree', treeX, treeZ, 0.85 + rng() * 0.5)
        if (!planted) add('bush', x + ox * (half + 1.6), z + oz * (half + 1.6), 0.5 + rng() * 0.35)
      }
    })
  }

  const parkStep = Math.max(4, file.parkSpacing)
  for (const park of layout.file.parks) {
    const box = ringBounds(park.ring)
    for (let x = box.minX + parkStep * 0.5; x < box.maxX; x += parkStep) {
      for (let z = box.minZ + parkStep * 0.5; z < box.maxZ; z += parkStep) {
        const px = x + (rng() - 0.5) * 1.4
        const pz = z + (rng() - 0.5) * 1.4
        if (!pointInRing(px, pz, park.ring)) continue
        if (rng() < 0.42 && !paved(px, pz)) add('tree', px, pz, 0.95 + rng() * 0.45)
        else add('bush', px, pz, 0.7 + rng() * 0.45)
      }
    }
  }
  return plants
}

type RoadSeg = { x0: number; z0: number; x1: number; z1: number; half: number }

function roadIndex(roads: { kind: string; w: number; pts: number[] }[]): Map<string, RoadSeg[]> {
  const grid = new Map<string, RoadSeg[]>()
  for (const road of roads) {
    if (road.kind === 'pedestrian' || road.w < 2) continue
    const half = road.w / 2
    const reach = half + ROAD_PAD
    for (let i = 0; i < road.pts.length - 2; i += 2) {
      const x0 = road.pts[i] ?? 0
      const z0 = road.pts[i + 1] ?? 0
      const x1 = road.pts[i + 2] ?? 0
      const z1 = road.pts[i + 3] ?? 0
      const seg = { x0, z0, x1, z1, half }
      const minX = Math.floor((Math.min(x0, x1) - reach) / ROAD_CELL)
      const maxX = Math.floor((Math.max(x0, x1) + reach) / ROAD_CELL)
      const minZ = Math.floor((Math.min(z0, z1) - reach) / ROAD_CELL)
      const maxZ = Math.floor((Math.max(z0, z1) + reach) / ROAD_CELL)
      for (let gx = minX; gx <= maxX; gx++) {
        for (let gz = minZ; gz <= maxZ; gz++) {
          const key = `${gx},${gz}`
          const list = grid.get(key) ?? []
          list.push(seg)
          grid.set(key, list)
        }
      }
    }
  }
  return grid
}

function onAsphalt(grid: Map<string, RoadSeg[]>, x: number, z: number): boolean {
  const list = grid.get(`${Math.floor(x / ROAD_CELL)},${Math.floor(z / ROAD_CELL)}`)
  if (!list) return false
  for (const seg of list) {
    if (distToSegment(x, z, seg.x0, seg.z0, seg.x1, seg.z1) < seg.half + ROAD_PAD) return true
  }
  return false
}

function distToSegment(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax
  const dz = bz - az
  const len2 = dx * dx + dz * dz
  if (len2 < 1e-6) return Math.hypot(x - ax, z - az)
  const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / len2))
  return Math.hypot(x - (ax + dx * t), z - (az + dz * t))
}

function forEachSample(
  pts: number[],
  spacing: number,
  start: number,
  visit: (x: number, z: number, tx: number, tz: number) => void,
): void {
  let carried = start
  for (let i = 0; i < pts.length - 2; i += 2) {
    const x0 = pts[i] ?? 0
    const z0 = pts[i + 1] ?? 0
    const x1 = pts[i + 2] ?? 0
    const z1 = pts[i + 3] ?? 0
    const len = Math.hypot(x1 - x0, z1 - z0)
    if (len < 0.05) continue
    const tx = (x1 - x0) / len
    const tz = (z1 - z0) / len
    let dist = carried
    while (dist <= len) {
      visit(x0 + tx * dist, z0 + tz * dist, tx, tz)
      dist += spacing
    }
    carried = dist - len
  }
}

function ringBounds(ring: number[]): { minX: number; maxX: number; minZ: number; maxZ: number } {
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

function pointInRing(x: number, z: number, ring: number[]): boolean {
  let inside = false
  const count = ring.length / 2
  for (let i = 0, j = count - 1; i < count; j = i++) {
    const ax = ring[i * 2] ?? 0
    const az = ring[i * 2 + 1] ?? 0
    const bx = ring[j * 2] ?? 0
    const bz = ring[j * 2 + 1] ?? 0
    const crosses = az > z !== bz > z
    if (crosses && x < ((bx - ax) * (z - az)) / (bz - az || 1) + ax) inside = !inside
  }
  return inside
}
