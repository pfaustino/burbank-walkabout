import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { CityLayout, MapBuilding } from './layout.ts'
import { TILE_REACH, TILE_SIZE, tileGroup, tileKeyAt } from './tiles.ts'

type TileBucket = {
  parks: { ring: number[] }[]
  ribbons: { runs: { pts: number[]; width: number }[]; y: number; material: THREE.Material }[]
  buildings: MapBuilding[]
  labels: { text: string; x: number; y: number; z: number; width: number }[]
}

/** Build the blocks near `origin` now. Further tiles are built when `syncCity` runs. */
export function buildCityMesh(layout: CityLayout): THREE.Group {
  const group = new THREE.Group()
  group.name = 'burbank'
  const { bounds } = layout.file

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ),
    new THREE.MeshStandardMaterial({ color: 0xb7a88a, roughness: 1 }),
  )
  ground.rotation.x = -Math.PI / 2
  ground.position.set((bounds.minX + bounds.maxX) / 2, 0, (bounds.minZ + bounds.maxZ) / 2)
  ground.receiveShadow = true
  group.add(ground)

  const buckets = new Map<string, TileBucket>()
  const take = (x: number, z: number): TileBucket => {
    const key = tileKeyAt(x, z)
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = { parks: [], ribbons: [], buildings: [], labels: [] }
      buckets.set(key, bucket)
    }
    return bucket
  }

  for (const park of layout.file.parks) {
    const [cx, cz] = ringCenter(park.ring)
    take(cx, cz).parks.push(park)
  }

  const ribbons: [runs: { pts: number[]; width: number }[], y: number, material: THREE.Material][] = [
    [layout.file.roads.map((road) => ({ pts: road.pts, width: road.w + 5.2 })), 0.03, ribbonMaterial(0xcfc6ba, 0.95)],
    [layout.file.roads.map((road) => ({ pts: road.pts, width: road.w })), 0.05, ribbonMaterial(0x3a3f46, 0.92)],
    [
      layout.file.roads
        .filter((road) => road.kind === 'primary' || road.kind === 'secondary')
        .map((road) => ({ pts: road.pts, width: 0.16 })),
      0.06,
      ribbonMaterial(0xd7c15a, 0.7),
    ],
  ]
  for (const [runs, y, material] of ribbons) {
    for (const part of segmentsByTile(runs)) {
      take(part.x, part.z).ribbons.push({ runs: part.runs, y, material })
    }
  }

  for (const building of layout.buildings) {
    take((building.minX + building.maxX) / 2, (building.minZ + building.maxZ) / 2).buildings.push(building)
  }

  const labeled = new Set<string>()
  for (const road of layout.file.roads) {
    if (!road.name || labeled.has(road.name)) continue
    if (road.kind !== 'primary' && road.kind !== 'secondary' && road.kind !== 'tertiary') continue
    if (road.pts.length < 8) continue
    const mid = road.pts.length / 2
    const index = mid - (mid % 2)
    labeled.add(road.name)
    const x = road.pts[index] ?? 0
    const z = road.pts[index + 1] ?? 0
    take(x, z).labels.push({ text: shortRoad(road.name), x, y: 3.2, z, width: 7 })
  }

  for (const mark of layout.landmarks) {
    if (!mark.name) continue
    const x = mark.door?.[0] ?? (mark.minX + mark.maxX) / 2
    const z = mark.door?.[1] ?? (mark.minZ + mark.maxZ) / 2
    take(x, z).labels.push({
      text: mark.name,
      x,
      y: mark.h + 4,
      z,
      width: Math.max(14, mark.name.length * 0.85),
    })
  }

  const tiles = new Map<string, THREE.Group>()
  const grass = new THREE.MeshStandardMaterial({ color: 0x7f9a62, roughness: 1 })
  const roofMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 })
  const wallMats = new Map<number, THREE.MeshStandardMaterial>()

  const buildKey = (key: string): void => {
    const bucket = buckets.get(key)
    if (!bucket) return
    const [tx, tz] = key.split(',').map(Number)
    const tile = tileGroup(group, tiles, ((tx ?? 0) + 0.5) * TILE_SIZE, ((tz ?? 0) + 0.5) * TILE_SIZE)
    for (const park of bucket.parks) {
      const shape = shapeFromRing(park.ring)
      if (!shape) continue
      const yard = new THREE.Mesh(new THREE.ShapeGeometry(shape), grass)
      yard.rotation.x = -Math.PI / 2
      yard.position.y = 0.025
      yard.receiveShadow = true
      tile.add(yard)
    }
    for (const ribbon of bucket.ribbons) {
      const geometry = ribbonGeometry(ribbon.runs, ribbon.y)
      if (!geometry) continue
      const mesh = new THREE.Mesh(geometry, ribbon.material)
      mesh.receiveShadow = true
      tile.add(mesh)
    }
    const roofs: THREE.BufferGeometry[] = []
    const walls = new Map<number, THREE.BufferGeometry[]>()
    for (const building of bucket.buildings) {
      const shape = shapeFromRing(building.ring)
      if (!shape) continue
      let geometry: THREE.BufferGeometry
      try {
        geometry = new THREE.ExtrudeGeometry(shape, { depth: building.h, bevelEnabled: false })
      } catch {
        continue
      }
      geometry.rotateX(-Math.PI / 2)
      const floors = floorsForHeight(building.h, ringArea(building.ring))
      const color = new THREE.Color(paintOf(building))
      const roof = sliceGroup(geometry, 0)
      const wall = sliceGroup(geometry, 1)
      geometry.dispose()
      if (roof) roofs.push(paint(roof, color))
      if (wall) {
        writeFacadeUvs(wall, building.h)
        const list = walls.get(floors) ?? []
        list.push(paint(wall, color))
        walls.set(floors, list)
      }
    }
    if (roofs.length > 0) addMerged(tile, roofs, roofMat)
    for (const [floors, parts] of walls) {
      let material = wallMats.get(floors)
      if (!material) {
        material = new THREE.MeshStandardMaterial({ vertexColors: true, map: facadeTexture(floors), roughness: 0.86 })
        wallMats.set(floors, material)
      }
      addMerged(tile, parts, material)
    }
    for (const label of bucket.labels) tile.add(labelSprite(label.text, label.x, label.y, label.z, label.width))
    tile.userData.tileBox = new THREE.Box3().setFromObject(tile)
  }

  const sync = (x: number, z: number): void => {
    for (const key of buckets.keys()) {
      if (tileInReach(key, x, z, TILE_REACH)) {
        if (!tiles.has(key)) buildKey(key)
        continue
      }
      if (tiles.has(key) && !tileInReach(key, x, z, TILE_REACH + 600)) releaseTile(tiles, key)
    }
    group.userData.cityTiles = [...tiles.values()]
  }

  group.userData.syncCity = sync
  sync(layout.file.spawn.x, layout.file.spawn.z)
  return group
}

function tileInReach(key: string, x: number, z: number, reach: number): boolean {
  const [tx, tz] = key.split(',').map(Number)
  const minX = (tx ?? 0) * TILE_SIZE
  const minZ = (tz ?? 0) * TILE_SIZE
  const dx = Math.max(minX - x, 0, x - (minX + TILE_SIZE))
  const dz = Math.max(minZ - z, 0, z - (minZ + TILE_SIZE))
  return dx * dx + dz * dz < reach * reach
}

function releaseTile(tiles: Map<string, THREE.Group>, key: string): void {
  const tile = tiles.get(key)
  if (!tile) return
  tile.removeFromParent()
  tile.traverse((obj) => {
    if (obj instanceof THREE.Mesh) obj.geometry.dispose()
    if (!(obj instanceof THREE.Sprite)) return
    const material = obj.material
    if (!(material instanceof THREE.SpriteMaterial)) return
    material.map?.dispose()
    material.dispose()
  })
  tiles.delete(key)
}

function ringCenter(flat: number[]): [number, number] {
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (let i = 0; i + 1 < flat.length; i += 2) {
    const x = flat[i] ?? 0
    const z = flat[i + 1] ?? 0
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minZ = Math.min(minZ, z)
    maxZ = Math.max(maxZ, z)
  }
  return [(minX + maxX) / 2, (minZ + maxZ) / 2]
}

/** Split runs at segment granularity by the tile under each segment's midpoint. */
function segmentsByTile(
  runs: { pts: number[]; width: number }[],
): { x: number; z: number; runs: { pts: number[]; width: number }[] }[] {
  const byTile = new Map<string, { x: number; z: number; runs: { pts: number[]; width: number }[] }>()
  for (const run of runs) {
    for (let i = 0; i < run.pts.length - 2; i += 2) {
      const pts = run.pts.slice(i, i + 4)
      const x = ((pts[0] ?? 0) + (pts[2] ?? 0)) / 2
      const z = ((pts[1] ?? 0) + (pts[3] ?? 0)) / 2
      const key = tileKeyAt(x, z)
      let entry = byTile.get(key)
      if (!entry) {
        entry = { x, z, runs: [] }
        byTile.set(key, entry)
      }
      entry.runs.push({ pts, width: run.width })
    }
  }
  return [...byTile.values()]
}

function paint(geometry: THREE.BufferGeometry, color: THREE.Color): THREE.BufferGeometry {
  const count = geometry.attributes.position?.count ?? 0
  const colors = new Float32Array(count * 3)
  for (let i = 0; i < colors.length; i += 3) {
    colors[i] = color.r
    colors[i + 1] = color.g
    colors[i + 2] = color.b
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  return geometry
}

function shapeFromRing(flat: number[]): THREE.Shape | null {
  if (flat.length < 6) return null
  let area = 0
  const points: THREE.Vector2[] = []
  for (let i = 0; i < flat.length; i += 2) {
    const x = flat[i] ?? 0
    const z = flat[i + 1] ?? 0
    const j = (i + 2) % flat.length
    area += x * (flat[j + 1] ?? 0) - (flat[j] ?? 0) * z
    points.push(new THREE.Vector2(x, -z))
  }
  if (area > 0) points.reverse()
  return new THREE.Shape(points)
}

function ribbonGeometry(runs: { pts: number[]; width: number }[], y: number): THREE.BufferGeometry | null {
  const positions: number[] = []
  for (const run of runs) {
    const half = run.width / 2
    for (let i = 0; i < run.pts.length - 2; i += 2) {
      const x0 = run.pts[i] ?? 0
      const z0 = run.pts[i + 1] ?? 0
      const x1 = run.pts[i + 2] ?? 0
      const z1 = run.pts[i + 3] ?? 0
      const dx = x1 - x0
      const dz = z1 - z0
      const len = Math.hypot(dx, dz)
      if (len < 0.05) continue
      const ux = dx / len
      const uz = dz / len
      const pad = half
      const sx = x0 - ux * pad
      const sz = z0 - uz * pad
      const ex = x1 + ux * pad
      const ez = z1 + uz * pad
      const nx = -uz * half
      const nz = ux * half
      const ax = sx - nx
      const az = sz - nz
      const bx = sx + nx
      const bz = sz + nz
      const cx = ex + nx
      const cz = ez + nz
      const dx2 = ex - nx
      const dz2 = ez - nz
      positions.push(ax, y, az, bx, y, bz, cx, y, cz, ax, y, az, cx, y, cz, dx2, y, dz2)
    }
  }
  if (positions.length === 0) return null
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  const normals = new Float32Array(positions.length)
  for (let i = 1; i < normals.length; i += 3) normals[i] = 1
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  return geometry
}

function ribbonMaterial(color: number, roughness: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, side: THREE.DoubleSide })
}

function shortRoad(name: string): string {
  return name.replace('Boulevard', 'Blvd').replace('Avenue', 'Ave').replace('Street', 'St')
}

function labelSprite(text: string, x: number, y: number, z: number, width: number): THREE.Sprite {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 128
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = 'rgba(12, 22, 32, 0.78)'
    roundRect(ctx, 12, 16, canvas.width - 24, canvas.height - 32, 18)
    ctx.fill()
    ctx.fillStyle = '#f6f1e6'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = text.length > 22 ? '600 40px sans-serif' : '600 48px sans-serif'
    ctx.fillText(text.slice(0, 32), canvas.width / 2, canvas.height / 2)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }))
  sprite.position.set(x, y, z)
  sprite.scale.set(width, width * 0.25, 1)
  sprite.renderOrder = 2
  return sprite
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

const FLOOR_HEIGHT = 3.2
/** A one-story house, roof included, is usually under this. */
const HOUSE_SECOND_STORY = 7
/** Bigger than this is a block or an apartment, not a house. */
const HOUSE_AREA = 400
const BAY_WIDTH = 3.6
const HOUSE_COLORS = [
  '#f4efe4',
  '#e7d7b8',
  '#f7f3ea',
  '#d8c09a',
  '#c48b62',
  '#c46a4a',
  '#e4c2a4',
  '#d7b8b0',
  '#c9d3c3',
  '#b7c4bc',
  '#c5d0d8',
  '#d5d8dc',
  '#e6d48a',
  '#f0e2c8',
]
const STORED_HOUSE = new Set(['#e4d0b4', '#d8c2a4', '#efe0c8', '#d7c4a4', '#d9c7ae', '#e4d3bc', '#cfc6ba'])

/** Window rows. A house stays one story until it clears the roof line at 7 m. */
export function floorsForHeight(height: number, area: number): number {
  if (area < HOUSE_AREA) {
    if (height < HOUSE_SECOND_STORY) return 1
    const steps = Math.floor((height - HOUSE_SECOND_STORY) / FLOOR_HEIGHT + 1e-6)
    return Math.min(18, 2 + Math.max(0, steps))
  }
  return Math.min(18, Math.max(1, Math.round(height / FLOOR_HEIGHT)))
}

function ringArea(ring: number[]): number {
  let area = 0
  for (let i = 0; i < ring.length; i += 2) {
    const j = (i + 2) % ring.length
    area += (ring[i] ?? 0) * (ring[j + 1] ?? 0) - (ring[j] ?? 0) * (ring[i + 1] ?? 0)
  }
  return Math.abs(area) / 2
}

function paintOf(building: { h: number; c: string; ring: number[] }): string {
  if (building.h > 12 || !STORED_HOUSE.has(building.c.toLowerCase())) return building.c
  let hash = 2166136261
  for (let i = 0; i < building.ring.length; i++) {
    hash = Math.imul(hash ^ Math.round((building.ring[i] ?? 0) * 10), 16777619)
  }
  return HOUSE_COLORS[(hash >>> 0) % HOUSE_COLORS.length] ?? building.c
}

function addMerged(group: THREE.Group, parts: THREE.BufferGeometry[], material: THREE.Material): void {
  const merged = mergeGeometries(parts, false)
  for (const part of parts) part.dispose()
  if (!merged) return
  const mesh = new THREE.Mesh(merged, material)
  mesh.castShadow = true
  mesh.receiveShadow = true
  group.add(mesh)
}

function sliceGroup(geometry: THREE.BufferGeometry, materialIndex: number): THREE.BufferGeometry | null {
  const group = geometry.groups.find((entry) => entry.materialIndex === materialIndex)
  if (!group || group.count < 3) return null
  const position = geometry.attributes.position
  const normal = geometry.attributes.normal
  if (!position) return null
  const start = group.start * 3
  const end = (group.start + group.count) * 3
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.Float32BufferAttribute(position.array.slice(start, end), 3))
  if (normal) out.setAttribute('normal', new THREE.Float32BufferAttribute(normal.array.slice(start, end), 3))
  out.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(group.count * 2), 2))
  return out
}

/** Map each wall across an integer number of window bays and exactly one texture height. */
function writeFacadeUvs(geometry: THREE.BufferGeometry, height: number): void {
  const position = geometry.attributes.position
  const uv = geometry.attributes.uv
  if (!position || !uv) return
  const count = position.count
  for (let i = 0; i + 5 < count; i += 6) {
    let ax = position.getX(i)
    let az = position.getZ(i)
    let bx = ax
    let bz = az
    for (let k = 1; k < 6; k++) {
      const x = position.getX(i + k)
      const z = position.getZ(i + k)
      if (Math.hypot(x - ax, z - az) > 0.05) {
        bx = x
        bz = z
        break
      }
    }
    const len = Math.hypot(bx - ax, bz - az)
    const bays = len < 1.8 ? 0 : Math.max(1, Math.round(len / BAY_WIDTH))
    const dx = len > 0.05 ? (bx - ax) / len : 1
    const dz = len > 0.05 ? (bz - az) / len : 0
    for (let k = 0; k < 6; k++) {
      const x = position.getX(i + k)
      const y = position.getY(i + k)
      const z = position.getZ(i + k)
      const along = (x - ax) * dx + (z - az) * dz
      const u = bays === 0 ? 0.04 : (along / (len || 1)) * bays
      const v = height > 0 ? y / height : 0
      uv.setXY(i + k, u, Math.min(1, Math.max(0, v)))
    }
  }
  uv.needsUpdate = true
}

function facadeTexture(floors: number): THREE.CanvasTexture {
  const cached = facadeCache.get(floors)
  if (cached) return cached
  const row = 64
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = row * floors
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    for (let floor = 0; floor < floors; floor++) {
      const y = floor * row
      ctx.fillStyle = '#5d6c78'
      ctx.fillRect(10, y + 16, 18, 28)
      ctx.fillRect(36, y + 16, 18, 28)
      ctx.fillStyle = '#ddd8d0'
      ctx.fillRect(0, y + row - 4, canvas.width, 4)
    }
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.needsUpdate = true
  facadeCache.set(floors, texture)
  return texture
}

const facadeCache = new Map<number, THREE.CanvasTexture>()
