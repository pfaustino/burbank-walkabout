import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { CityLayout } from './layout.ts'

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

  const grass = new THREE.MeshStandardMaterial({ color: 0x7f9a62, roughness: 1 })
  for (const park of layout.file.parks) {
    const shape = shapeFromRing(park.ring)
    if (!shape) continue
    const yard = new THREE.Mesh(new THREE.ShapeGeometry(shape), grass)
    yard.rotation.x = -Math.PI / 2
    yard.position.y = 0.025
    yard.receiveShadow = true
    group.add(yard)
  }

  const sidewalk = ribbonGeometry(
    layout.file.roads.map((road) => ({ pts: road.pts, width: road.w + 5.2 })),
    0.03,
  )
  const asphalt = ribbonGeometry(
    layout.file.roads.map((road) => ({ pts: road.pts, width: road.w })),
    0.05,
  )
  const lanes = ribbonGeometry(
    layout.file.roads
      .filter((road) => road.kind === 'primary' || road.kind === 'secondary')
      .map((road) => ({ pts: road.pts, width: 0.16 })),
    0.06,
  )
  group.add(meshFrom(sidewalk, 0xcfc6ba, 0.95))
  group.add(meshFrom(asphalt, 0x3a3f46, 0.92))
  if (lanes) group.add(meshFrom(lanes, 0xd7c15a, 0.7))

  const roofs = new Map<string, THREE.BufferGeometry[]>()
  const walls = new Map<string, THREE.BufferGeometry[]>()
  for (const building of layout.buildings) {
    const shape = shapeFromRing(building.ring)
    if (!shape) continue
    let geometry: THREE.BufferGeometry
    try {
      geometry = new THREE.ExtrudeGeometry(shape, { depth: building.h, bevelEnabled: false })
    } catch {
      continue
    }
    geometry.rotateX(-Math.PI / 2)
    const floors = floorsForHeight(building.h)
    const color = paintOf(building)
    const roof = sliceGroup(geometry, 0)
    const wall = sliceGroup(geometry, 1)
    geometry.dispose()
    if (roof) pushPart(roofs, color, roof)
    if (wall) {
      writeFacadeUvs(wall, building.h)
      pushPart(walls, `${floors}|${color}`, wall)
    }
  }

  for (const [color, parts] of roofs) addMerged(group, parts, new THREE.MeshStandardMaterial({ color, roughness: 0.92 }))
  for (const [key, parts] of walls) {
    const split = key.indexOf('|')
    const floors = Number(key.slice(0, split))
    const color = key.slice(split + 1)
    addMerged(
      group,
      parts,
      new THREE.MeshStandardMaterial({
        color,
        map: facadeTexture(floors),
        roughness: 0.86,
      }),
    )
  }

  const labeled = new Set<string>()
  for (const road of layout.file.roads) {
    if (!road.name || labeled.has(road.name)) continue
    if (road.kind !== 'primary' && road.kind !== 'secondary' && road.kind !== 'tertiary') continue
    if (road.pts.length < 8) continue
    const mid = road.pts.length / 2
    const index = mid - (mid % 2)
    labeled.add(road.name)
    group.add(labelSprite(shortRoad(road.name), road.pts[index] ?? 0, 3.2, road.pts[index + 1] ?? 0, 7))
  }

  for (const mark of layout.landmarks) {
    if (!mark.name) continue
    const x = mark.door?.[0] ?? (mark.minX + mark.maxX) / 2
    const z = mark.door?.[1] ?? (mark.minZ + mark.maxZ) / 2
    group.add(labelSprite(mark.name, x, mark.h + 4, z, Math.max(14, mark.name.length * 0.85)))
  }

  return group
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

function meshFrom(geometry: THREE.BufferGeometry | null, color: number, roughness: number): THREE.Mesh {
  const mesh = new THREE.Mesh(
    geometry ?? new THREE.BufferGeometry(),
    new THREE.MeshStandardMaterial({ color, roughness, side: THREE.DoubleSide }),
  )
  mesh.receiveShadow = true
  return mesh
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

function floorsForHeight(height: number): number {
  return Math.min(18, Math.max(1, Math.round(height / FLOOR_HEIGHT)))
}

function paintOf(building: { h: number; c: string; ring: number[] }): string {
  if (building.h > 12 || !STORED_HOUSE.has(building.c.toLowerCase())) return building.c
  let hash = 2166136261
  for (let i = 0; i < building.ring.length; i++) {
    hash = Math.imul(hash ^ Math.round((building.ring[i] ?? 0) * 10), 16777619)
  }
  return HOUSE_COLORS[(hash >>> 0) % HOUSE_COLORS.length] ?? building.c
}

function pushPart(buckets: Map<string, THREE.BufferGeometry[]>, key: string, geometry: THREE.BufferGeometry): void {
  const list = buckets.get(key) ?? []
  list.push(geometry)
  buckets.set(key, list)
}

function addMerged(group: THREE.Group, parts: THREE.BufferGeometry[], material: THREE.Material): void {
  const merged = mergeGeometries(parts, false)
  for (const part of parts) part.dispose()
  if (!merged) {
    material.dispose()
    return
  }
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
