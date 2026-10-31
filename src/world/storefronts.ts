import * as THREE from 'three'
import type { CityLayout, MapBuilding } from './layout.ts'
import { sealTiles, tileGroup } from './tiles.ts'

export type Business = {
  name: string
  x: number
  z: number
  kind: string
}

export type StoreSign = {
  name: string
  x: number
  z: number
  y: number
  yaw: number
  width: number
  color: number
}

type Wall = {
  ax: number
  az: number
  bx: number
  bz: number
  mx: number
  mz: number
  nx: number
  nz: number
  tx: number
  tz: number
  length: number
}

type RoadSeg = {
  ax: number
  az: number
  bx: number
  bz: number
  tx: number
  tz: number
  half: number
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

const BOARDS = [0x1c3a5f, 0x7a1f2b, 0x1e4d3a, 0x2c241c, 0x3d2a55]
const SHOP_FIRST = ['Palm', 'Valley', 'Golden', 'Olive', 'Magnolia', 'Civic', 'Front', 'North', 'Sunny', 'Little', 'Metro', 'Plaza', 'Corner', 'Oak', 'Harbor', 'Cedar', 'Union', 'Pioneer', 'Linden', 'Burbank']
const SHOP_SECOND = ['Books', 'Cleaners', 'Dental', 'Tailors', 'Cafe', 'Market', 'Studio', 'Realty', 'Bakery', 'Florist', 'Optics', 'Salon', 'Deli', 'Hardware', 'Pharmacy', 'Gallery', 'Shoes', 'Music', 'Printing', 'Jewelry', 'Travel', 'Gifts', 'Coffee', 'Bikes', 'Law']

/** A name on every street-facing building, and several when the block has more than one business. */
export function planStoreSigns(layout: CityLayout, businesses: readonly Business[]): StoreSign[] {
  const buckets = new Map<number, Business[]>()
  for (const business of businesses) {
    if (!usableName(business.name)) continue
    const index = hostBuilding(layout, business.x, business.z)
    if (index < 0) continue
    const list = buckets.get(index) ?? []
    list.push(business)
    buckets.set(index, list)
  }

  const segs = roadSegments(layout)
  const signs: StoreSign[] = []
  for (let i = 0; i < layout.buildings.length; i++) {
    const building = layout.buildings[i]!
    const walls = buildingWalls(building)
    if (walls.length === 0) continue
    const facing = walls.filter((wall) => facesRoad(wall, segs))
    const longest = walls.reduce((best, wall) => (wall.length > best.length ? wall : best))
    const sides = facing.length > 0 ? facing : longest.length >= 4 ? [longest] : []
    if (sides.length === 0) continue
    const primary = sides.reduce((best, wall) => (wall.length > best.length ? wall : best))
    const names = facadeNames(building, primary, buckets.get(i) ?? [])
    if (names.length === 0) continue
    for (const wall of sides) {
      const room = wall.length * 0.82
      const fit = Math.min(names.length, 5, Math.max(1, Math.floor((room + 0.7) / 4.1)))
      for (const spot of spread(names.slice(0, fit), wall)) signs.push(placeSign(building, wall, spot))
    }
  }
  return signs
}

export function buildStoreSigns(layout: CityLayout, businesses: readonly Business[]): THREE.Group {
  const group = new THREE.Group()
  group.name = 'storefronts'
  const materials = new Map<string, THREE.MeshStandardMaterial>()
  const geometries = new Map<string, THREE.PlaneGeometry>()
  const tiles = new Map<string, THREE.Group>()
  for (const sign of planStoreSigns(layout, businesses)) {
    const key = `${sign.color}:${sign.name}`
    let mat = materials.get(key)
    if (!mat) {
      const texture = signTexture(sign.name, sign.color)
      mat = new THREE.MeshStandardMaterial({
        map: texture,
        emissive: 0xffffff,
        emissiveMap: texture,
        emissiveIntensity: 0.42,
        roughness: 0.55,
      })
      materials.set(key, mat)
    }
    const height = Math.min(1.45, Math.max(0.9, sign.width * 0.2))
    const geoKey = `${sign.width.toFixed(2)}:${height.toFixed(2)}`
    let geo = geometries.get(geoKey)
    if (!geo) {
      geo = new THREE.PlaneGeometry(sign.width, height)
      geometries.set(geoKey, geo)
    }
    const board = new THREE.Group()
    board.name = sign.name
    board.position.set(sign.x, sign.y, sign.z)
    board.rotation.y = sign.yaw
    const front = new THREE.Mesh(geo, mat)
    front.position.z = 0.02
    const back = new THREE.Mesh(geo, mat)
    back.position.z = -0.02
    back.scale.x = -1
    board.add(front, back)
    tileGroup(group, tiles, sign.x, sign.z).add(board)
  }
  sealTiles(tiles)
  return group
}

export function disposeStoreSigns(group: THREE.Group): void {
  const materials = new Set<THREE.Material>()
  const geometries = new Set<THREE.BufferGeometry>()
  group.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return
    geometries.add(obj.geometry)
    const mat = obj.material
    if (Array.isArray(mat)) mat.forEach((entry) => materials.add(entry))
    else materials.add(mat)
  })
  for (const geometry of geometries) geometry.dispose()
  for (const material of materials) {
    const mapped = material as THREE.MeshStandardMaterial
    mapped.map?.dispose()
    material.dispose()
  }
}

function placeSign(building: MapBuilding, wall: Wall, spot: { name: string; along: number; width: number }): StoreSign {
  return {
    name: spot.name,
    x: wall.mx + wall.nx * 0.42 + wall.tx * spot.along,
    z: wall.mz + wall.nz * 0.42 + wall.tz * spot.along,
    y: Math.min(Math.max(2.2, building.h * 0.62), 5.6),
    yaw: Math.atan2(wall.nx, wall.nz),
    width: spot.width,
    color: BOARDS[hash(spot.name) % BOARDS.length] ?? BOARDS[0]!,
  }
}

function spread(names: string[], wall: Wall): { name: string; along: number; width: number }[] {
  const gap = 0.7
  const raw = names.map((name) => Math.min(9, Math.max(3.4, Math.min(name.length, 36) * 0.28)))
  const total = raw.reduce((sum, width) => sum + width, 0) + gap * Math.max(0, names.length - 1)
  const room = Math.max(3.4, wall.length * 0.82)
  const scale = total > room ? room / total : 1
  let cursor = -(total * scale) / 2
  return names.map((name, index) => {
    const width = raw[index]! * scale
    const along = cursor + width / 2
    cursor += width + gap * scale
    return { name, along, width }
  })
}

function nearestNames(list: readonly Business[], wall: Wall, count: number): string[] {
  const ordered = [...list].sort((a, b) => {
    const da = (a.x - wall.mx) ** 2 + (a.z - wall.mz) ** 2
    const db = (b.x - wall.mx) ** 2 + (b.z - wall.mz) ** 2
    return da - db
  })
  const names: string[] = []
  for (const business of ordered) {
    if (names.some((name) => name.toLowerCase() === business.name.toLowerCase())) continue
    names.push(business.name)
    if (names.length >= count) break
  }
  return names
}

function facadeNames(building: MapBuilding, wall: Wall, tenants: readonly Business[]): string[] {
  const fit = Math.min(5, Math.max(1, Math.floor(wall.length / 11)))
  const names: string[] = []
  if (building.name && usableName(building.name)) names.push(building.name)
  for (const name of nearestNames(tenants, wall, fit)) {
    if (names.some((have) => have.toLowerCase() === name.toLowerCase())) continue
    names.push(name)
  }
  if (names.length === 0) {
    if (wall.length < 8 || building.h < 4) return []
    return [inventedName(building)]
  }
  return names.slice(0, fit)
}

function inventedName(building: MapBuilding): string {
  const n = hash(`${Math.round(building.minX)}:${Math.round(building.minZ)}:${building.h}`)
  const first = SHOP_FIRST[n % SHOP_FIRST.length] ?? SHOP_FIRST[0]!
  const second = SHOP_SECOND[(n >>> 8) % SHOP_SECOND.length] ?? SHOP_SECOND[0]!
  return `${first} ${second}`
}

function usableName(name: string): boolean {
  const clean = name.trim()
  if (clean.length < 3 || clean.length > 42) return false
  if (/^\d+$/.test(clean)) return false
  if (/^(yes|building|shop|office)$/i.test(clean)) return false
  return true
}

function hostBuilding(layout: CityLayout, x: number, z: number): number {
  let inside = -1
  let nearest = -1
  let best = 12
  for (let i = 0; i < layout.buildings.length; i++) {
    const building = layout.buildings[i]!
    if (x < building.minX - 12 || x > building.maxX + 12 || z < building.minZ - 12 || z > building.maxZ + 12) continue
    if (pointInRing(x, z, building.ring)) {
      inside = i
      break
    }
    const dist = distToRing(x, z, building.ring)
    if (dist < best) {
      best = dist
      nearest = i
    }
  }
  return inside >= 0 ? inside : nearest
}

function buildingWalls(building: MapBuilding): Wall[] {
  const ring = building.ring
  if (ring.length < 6) return []
  const edges: Wall[] = []
  for (let i = 0; i < ring.length; i += 2) {
    const j = (i + 2) % ring.length
    const ax = ring[i] ?? 0
    const az = ring[i + 1] ?? 0
    const bx = ring[j] ?? 0
    const bz = ring[j + 1] ?? 0
    const edge = makeWall(ax, az, bx, bz, ring)
    if (edge && edge.length >= 1.2) edges.push(edge)
  }
  const merged: Wall[] = []
  let run: Wall | null = null
  const flush = (): void => {
    if (run && run.length >= 6) merged.push(run)
    run = null
  }
  for (const edge of edges) {
    if (run && colinear(run, edge)) run = makeWall(run.ax, run.az, edge.bx, edge.bz, ring) ?? run
    else {
      flush()
      run = edge
    }
  }
  flush()
  if (merged.length > 1 && colinear(merged[merged.length - 1]!, merged[0]!)) {
    const joined = makeWall(merged[merged.length - 1]!.ax, merged[merged.length - 1]!.az, merged[0]!.bx, merged[0]!.bz, ring)
    merged.pop()
    if (joined && joined.length >= 6) merged[0] = joined
  }
  return merged
}

function makeWall(ax: number, az: number, bx: number, bz: number, ring: number[]): Wall | null {
  const dx = bx - ax
  const dz = bz - az
  const length = Math.hypot(dx, dz)
  if (length < 1) return null
  const tx = dx / length
  const tz = dz / length
  let nx = tz
  let nz = -tx
  const mx = (ax + bx) / 2
  const mz = (az + bz) / 2
  if (pointInRing(mx + nx * 0.8, mz + nz * 0.8, ring)) {
    nx = -nx
    nz = -nz
  }
  return { ax, az, bx, bz, mx, mz, nx, nz, tx, tz, length }
}

function colinear(a: Wall, b: Wall): boolean {
  return Math.abs(a.tx * b.tx + a.tz * b.tz) > 0.96 && a.nx * b.nx + a.nz * b.nz > 0.9
}

function roadSegments(layout: CityLayout): RoadSeg[] {
  const segs: RoadSeg[] = []
  for (const road of layout.file.roads) {
    const half = road.w * 0.5
    for (let i = 0; i < road.pts.length - 2; i += 2) {
      const ax = road.pts[i] ?? 0
      const az = road.pts[i + 1] ?? 0
      const bx = road.pts[i + 2] ?? 0
      const bz = road.pts[i + 3] ?? 0
      const dx = bx - ax
      const dz = bz - az
      const length = Math.hypot(dx, dz)
      if (length < 3) continue
      segs.push({
        ax,
        az,
        bx,
        bz,
        tx: dx / length,
        tz: dz / length,
        half,
        minX: Math.min(ax, bx),
        maxX: Math.max(ax, bx),
        minZ: Math.min(az, bz),
        maxZ: Math.max(az, bz),
      })
    }
  }
  return segs
}

/** The wall looks onto a street, not into the block or across the roof. */
function facesRoad(wall: Wall, segs: readonly RoadSeg[]): boolean {
  const reach = 18
  for (const seg of segs) {
    const pad = seg.half + reach
    if (wall.mx < seg.minX - pad || wall.mx > seg.maxX + pad || wall.mz < seg.minZ - pad || wall.mz > seg.maxZ + pad) continue
    const dx = seg.bx - seg.ax
    const dz = seg.bz - seg.az
    const len2 = dx * dx + dz * dz || 1
    const t = Math.max(0, Math.min(1, ((wall.mx - seg.ax) * dx + (wall.mz - seg.az) * dz) / len2))
    const ox = seg.ax + dx * t - wall.mx
    const oz = seg.az + dz * t - wall.mz
    const dist = Math.hypot(ox, oz)
    if (dist < 1.5 || dist > pad) continue
    if ((ox * wall.nx + oz * wall.nz) / dist < 0.75) continue
    if (Math.abs(seg.tx * wall.tx + seg.tz * wall.tz) < 0.7) continue
    return true
  }
  return false
}

function pointInRing(x: number, z: number, ring: number[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 2; i < ring.length; i += 2) {
    const xi = ring[i] ?? 0
    const zi = ring[i + 1] ?? 0
    const xj = ring[j] ?? 0
    const zj = ring[j + 1] ?? 0
    const hit = zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / ((zj - zi) || 1e-9) + xi
    if (hit) inside = !inside
    j = i
  }
  return inside
}

function distToRing(x: number, z: number, ring: number[]): number {
  if (pointInRing(x, z, ring)) return 0
  let best = Infinity
  for (let i = 0; i < ring.length; i += 2) {
    const j = (i + 2) % ring.length
    const ax = ring[i] ?? 0
    const az = ring[i + 1] ?? 0
    const bx = ring[j] ?? 0
    const bz = ring[j + 1] ?? 0
    const dx = bx - ax
    const dz = bz - az
    const len2 = dx * dx + dz * dz || 1
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2))
    best = Math.min(best, Math.hypot(x - (ax + dx * t), z - (az + dz * t)))
  }
  return best
}

function signTexture(name: string, color: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 64
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.strokeStyle = 'rgba(255, 244, 220, 0.8)'
    ctx.lineWidth = 6
    ctx.strokeRect(8, 8, canvas.width - 16, canvas.height - 16)
    ctx.fillStyle = '#f7f1e4'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const label = name.length > 36 ? `${name.slice(0, 34)}…` : name
    let size = 32
    ctx.font = `600 ${size}px sans-serif`
    while (size > 13 && ctx.measureText(label).width > canvas.width - 28) {
      size -= 2
      ctx.font = `600 ${size}px sans-serif`
    }
    ctx.fillText(label, canvas.width / 2, canvas.height / 2 + 2)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

function hash(text: string): number {
  let n = 2166136261
  for (let i = 0; i < text.length; i++) n = Math.imul(n ^ text.charCodeAt(i), 16777619)
  return n >>> 0
}
