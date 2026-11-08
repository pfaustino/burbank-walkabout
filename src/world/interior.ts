/** Procedural rooms, placed far from Burbank so the street stays where you left it. */

import * as THREE from 'three'
import { createFigure, type Figure } from '../actors/figure.ts'
import type { PersonVoice } from '../actors/peopleSim.ts'
import { greetingLine, localReply } from '../dialog/fallback.ts'
import type { Disc } from '../traffic/bodies.ts'
import { buildingsNear, type CityLayout, type MapBuilding } from './layout.ts'
import type { Business } from './storefronts.ts'

export type InteriorKind = 'office' | 'restaurant' | 'residential' | 'shop' | 'civic' | 'hotel'

export type Entrance = {
  index: number
  x: number
  z: number
  name: string
  dist: number
}

export type InteriorPerson = {
  id: string
  name: string
  voice: PersonVoice
  role: string
  x: number
  z: number
  yaw: number
  shirt: string
  pants: string
  skin: string
  hair: string
}

export type InteriorPlan = {
  kind: InteriorKind
  title: string
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  doorX: number
  doorZ: number
  enterX: number
  enterZ: number
  people: InteriorPerson[]
  blockers: Disc[]
}

export type InteriorScene = {
  group: THREE.Group
  plan: InteriorPlan
  figures: Figure[]
}

/** How close you must stand to a street door. */
export const DOOR_REACH = 2.4
/** How close you must stand to the inside of the door to leave. */
export const EXIT_REACH = 1.45

const ROOM_ORIGIN = 80_000

const ROOM: Record<InteriorKind, { w: number; d: number }> = {
  residential: { w: 8, d: 10 },
  restaurant: { w: 12, d: 14 },
  office: { w: 14, d: 16 },
  shop: { w: 10, d: 12 },
  civic: { w: 16, d: 18 },
  hotel: { w: 11, d: 16 },
}

const LABEL: Record<InteriorKind, string> = {
  office: 'Office',
  restaurant: 'Restaurant',
  residential: 'Home',
  shop: 'Shop',
  civic: 'Civic building',
  hotel: 'Hotel lobby',
}

const ROLE: Record<InteriorKind, string> = {
  office: 'I work in this office.',
  restaurant: 'I work the floor here.',
  residential: 'I live here.',
  shop: 'I work the counter.',
  civic: 'I work the front desk.',
  hotel: 'I work the lobby.',
}

const BUSINESS_KIND: Record<string, InteriorKind> = {
  restaurant: 'restaurant',
  fast_food: 'restaurant',
  cafe: 'restaurant',
  bakery: 'restaurant',
  bar: 'restaurant',
  pub: 'restaurant',
  ice_cream: 'restaurant',
  food_court: 'restaurant',
  biergarten: 'restaurant',
  hotel: 'hotel',
  hostel: 'hotel',
  motel: 'hotel',
  library: 'civic',
  townhall: 'civic',
  school: 'civic',
  university: 'civic',
  college: 'civic',
  clinic: 'civic',
  hospital: 'civic',
  place_of_worship: 'civic',
  community_centre: 'civic',
  police: 'civic',
  fire_station: 'civic',
  museum: 'civic',
  theatre: 'civic',
  cinema: 'civic',
  courthouse: 'civic',
  post_office: 'civic',
}

const THEME: Record<InteriorKind, { floor: number; wall: number; ceil: number }> = {
  office: { floor: 0xc5c8cc, wall: 0xe6e2da, ceil: 0xd4d0c8 },
  restaurant: { floor: 0x8d5a3c, wall: 0xf0e2cc, ceil: 0xe4d2b8 },
  residential: { floor: 0xb08968, wall: 0xf6f0e6, ceil: 0xe7dccb },
  shop: { floor: 0xd5d0c4, wall: 0xf7f7f5, ceil: 0xe6e6e2 },
  civic: { floor: 0xc8c2b6, wall: 0xf3efe4, ceil: 0xe2d9c8 },
  hotel: { floor: 0x7a3e48, wall: 0xf4efe6, ceil: 0xe6d8c4 },
}

const FIRST = ['Ada', 'Luis', 'Nora', 'Theo', 'Mina', 'Oscar', 'Ruth', 'Felix', 'Inez', 'Hana', 'Vince', 'Cora', 'Jules', 'Bess', 'Omar', 'Leah']
const LAST = ['Cole', 'Park', 'Nguyen', 'Shah', 'Ortiz', 'Berg', 'Cho', 'Walsh', 'Dunn', 'Patel', 'Brooks', 'Ito', 'Vega', 'Holm', 'Tran', 'Moss']
const SHIRT = ['#2f5d8c', '#8c3d3d', '#3d6b4f', '#c4a35a', '#4a4e69', '#6b4c7a']
const PANTS = ['#243044', '#3a342c', '#1e2a36', '#3d3a44']
const SKIN = ['#e0b090', '#c68642', '#8d5524', '#f1c9a5', '#6b3f2a']
const HAIR = ['#2a2118', '#1a1a1a', '#5a3820', '#c4a574', '#3a2a22']

const WOOD = 0x8a5a3a
const CLOTH = 0x355e52
const LINEN = 0xe7e0d4
const COUNTER = 0xd8d2c6
const BENCH = 0x6e5844

type Prop = { x: number; z: number; w: number; d: number; h: number; color: number }

type Spot = { x: number; z: number }

export function nearestEntrance(layout: CityLayout, x: number, z: number): Entrance | null {
  let best: Entrance | null = null
  for (const index of buildingsNear(layout, x, z, 14)) {
    const building = layout.buildings[index]
    if (!building || building.ring.length < 6) continue
    const span = Math.max(building.maxX - building.minX, building.maxZ - building.minZ)
    if (span < 2) continue
    const spot = standOf(building, x, z)
    if (!spot) continue
    const dist = Math.hypot(spot.x - x, spot.z - z)
    if (best && dist >= best.dist) continue
    best = { index, x: spot.x, z: spot.z, name: building.name ?? '', dist }
  }
  return best
}

export function classifyBuilding(building: MapBuilding, businesses: readonly Business[]): { kind: InteriorKind; title: string } {
  const named = namedKind(`${building.name ?? ''} ${building.blurb ?? ''}`)
  if (named) return { kind: named, title: building.name || LABEL[named] }
  const biz = businessAt(building, businesses)
  if (biz) return { kind: kindFromBusiness(biz.kind), title: building.name || biz.name || LABEL[kindFromBusiness(biz.kind)] }
  const kind = kindFromSize(building)
  return { kind, title: building.name || LABEL[kind] }
}

export function planInterior(index: number, kind: InteriorKind, title: string): InteriorPlan {
  const size = ROOM[kind]
  const cx = ROOM_ORIGIN
  const cz = ROOM_ORIGIN
  const minX = cx - size.w / 2
  const maxX = cx + size.w / 2
  const minZ = cz - size.d / 2
  const maxZ = cz + size.d / 2
  const doorX = cx
  const doorZ = minZ + 0.7
  const props = furnish(kind)
  const blockers = props.map((prop, i) => furnitureDisc(cx + prop.x, cz + prop.z, prop.w, prop.d, `furn-${i}`))
  const rng = mulberry((index + 1) * 97 + kind.charCodeAt(0))
  const spots = occupy(kind).slice(0, headcount(kind, rng))
  const used = new Set<string>()
  const people = spots.map((spot, n) => {
    const name = personName(rng, used)
    const person: InteriorPerson = {
      id: `in-${index}-${n}`,
      name,
      voice: rng() < 0.5 ? 'female' : 'male',
      role: ROLE[kind],
      x: cx + spot.x,
      z: cz + spot.z,
      yaw: Math.PI,
      shirt: pick(rng, SHIRT),
      pants: pick(rng, PANTS),
      skin: pick(rng, SKIN),
      hair: pick(rng, HAIR),
    }
    blockers.push({ x: person.x, z: person.z, r: 0.42, id: person.id })
    return person
  })
  return {
    kind,
    title,
    minX,
    maxX,
    minZ,
    maxZ,
    doorX,
    doorZ,
    enterX: cx,
    enterZ: minZ + 4.6,
    people,
    blockers,
  }
}

export function indoorReply(person: { id: string; name: string; role: string }, text: string, place: string): string {
  const greet = greetingLine(person, text)
  if (greet) return greet
  const q = text.trim().toLowerCase()
  if (/who are you|your name|what do you do|what is this place|where am i/.test(q)) {
    return `I'm ${person.name}. ${person.role} This is ${place}.`
  }
  if (/how are you|how'?s it going|hows it going|what'?s up|whats up/.test(q)) {
    return `All right. ${person.role}`
  }
  const street = localReply(person, text, place)
  if (street.startsWith("I'm heading along")) return `${person.role} It's quiet in ${place} right now.`
  return street
}

export function createInterior(index: number, building: MapBuilding, businesses: readonly Business[]): InteriorScene {
  const found = classifyBuilding(building, businesses)
  const plan = planInterior(index, found.kind, found.title)
  const group = buildRoom(plan)
  const figures = plan.people.map((person) => {
    const fig = createFigure({
      name: person.name,
      voice: person.voice,
      shirt: person.shirt,
      pants: person.pants,
      skin: person.skin,
      hair: person.hair,
      showName: true,
      castShadow: false,
    })
    fig.root.position.set(person.x, 0, person.z)
    fig.root.rotation.y = person.yaw
    group.add(fig.root)
    return fig
  })
  return { group, plan, figures }
}

export function disposeInterior(scene: InteriorScene): void {
  for (const fig of scene.figures) {
    scene.group.remove(fig.root)
    fig.dispose()
  }
  scene.group.removeFromParent()
  scene.group.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    mesh.geometry?.dispose()
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined
    if (!material) return
    if (Array.isArray(material)) {
      for (const item of material) item.dispose()
      return
    }
    const mapped = material as THREE.Material & { map?: THREE.Texture | null }
    mapped.map?.dispose()
    material.dispose()
  })
}

function buildRoom(plan: InteriorPlan): THREE.Group {
  const group = new THREE.Group()
  group.name = 'interior'
  const theme = THEME[plan.kind]
  const w = plan.maxX - plan.minX
  const d = plan.maxZ - plan.minZ
  const cx = (plan.minX + plan.maxX) / 2
  const cz = (plan.minZ + plan.maxZ) / 2
  const wallH = 2.9
  const thick = 0.22
  const gap = 1.4
  const side = (w - gap) / 2
  addBox(group, w + 4, 0.1, d + 4, cx, 0.05, cz, theme.floor, false)
  addBox(group, w, 0.08, d, cx, 3.05, cz, theme.ceil, true)
  addBox(group, side, wallH, thick, cx - (gap / 2 + side / 2), wallH / 2, plan.minZ, theme.wall, true)
  addBox(group, side, wallH, thick, cx + (gap / 2 + side / 2), wallH / 2, plan.minZ, theme.wall, true)
  addBox(group, 0.12, 2.3, 0.16, cx - 0.7, 1.15, plan.minZ, 0x5c3a24, true)
  addBox(group, 0.12, 2.3, 0.16, cx + 0.7, 1.15, plan.minZ, 0x5c3a24, true)
  addBox(group, 1.52, 0.16, 0.16, cx, 2.28, plan.minZ, 0x5c3a24, true)
  addBox(group, w, wallH, thick, cx, wallH / 2, plan.maxZ, theme.wall, true)
  addBox(group, thick, wallH, d, plan.minX, wallH / 2, cz, theme.wall, true)
  addBox(group, thick, wallH, d, plan.maxX, wallH / 2, cz, theme.wall, true)
  addBox(group, 1.3, 0.03, 0.8, plan.doorX, 0.12, plan.doorZ, 0x6a3b2a, false)
  for (const prop of furnish(plan.kind)) {
    addBox(group, prop.w, prop.h, prop.d, cx + prop.x, prop.h / 2, cz + prop.z, prop.color, false)
  }
  const lamp = new THREE.PointLight(0xfff4e5, 50, 28, 2)
  lamp.position.set(cx, 2.55, cz)
  group.add(lamp)
  const sign = doorSign()
  sign.position.set(plan.doorX, 2.15, plan.doorZ)
  group.add(sign)
  return group
}

function addBox(
  group: THREE.Group,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  color: number,
  doubleSide: boolean,
): void {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshLambertMaterial({ color, side: doubleSide ? THREE.DoubleSide : THREE.FrontSide }),
  )
  mesh.position.set(x, y, z)
  mesh.castShadow = false
  mesh.receiveShadow = true
  group.add(mesh)
}

function doorSign(): THREE.Sprite {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 64
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.fillStyle = 'rgba(20,16,12,0.88)'
    ctx.fillRect(0, 0, 256, 64)
    ctx.fillStyle = '#f4efe6'
    ctx.font = '600 36px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('Door', 128, 32)
  }
  const map = new THREE.CanvasTexture(canvas)
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false }))
  sprite.scale.set(1.6, 0.4, 1)
  return sprite
}

function furnish(kind: InteriorKind): Prop[] {
  if (kind === 'residential') {
    return [
      { x: 0, z: 3.4, w: 2.2, d: 0.85, h: 0.72, color: CLOTH },
      { x: 0, z: 1.6, w: 1.2, d: 0.7, h: 0.48, color: WOOD },
      { x: 2.3, z: 3.3, w: 1.3, d: 2, h: 0.5, color: LINEN },
    ]
  }
  if (kind === 'restaurant') {
    return [
      { x: -2.4, z: -1, w: 1.1, d: 1.1, h: 0.75, color: WOOD },
      { x: 2.4, z: -1, w: 1.1, d: 1.1, h: 0.75, color: WOOD },
      { x: -2.4, z: 2.2, w: 1.1, d: 1.1, h: 0.75, color: WOOD },
      { x: 2.4, z: 2.2, w: 1.1, d: 1.1, h: 0.75, color: WOOD },
      { x: 0, z: 5.6, w: 5, d: 0.8, h: 1.05, color: COUNTER },
    ]
  }
  if (kind === 'office') {
    return [
      { x: -3.6, z: 1.5, w: 1.5, d: 0.75, h: 0.75, color: WOOD },
      { x: 0, z: 1.5, w: 1.5, d: 0.75, h: 0.75, color: WOOD },
      { x: 3.6, z: 1.5, w: 1.5, d: 0.75, h: 0.75, color: WOOD },
    ]
  }
  if (kind === 'shop') {
    return [
      { x: -4.2, z: 0, w: 0.45, d: 3.5, h: 1.7, color: WOOD },
      { x: 4.2, z: 0, w: 0.45, d: 3.5, h: 1.7, color: WOOD },
      { x: 0, z: 4.4, w: 3.2, d: 0.7, h: 1.05, color: COUNTER },
    ]
  }
  if (kind === 'civic') {
    return [
      { x: -3.2, z: -1, w: 1.8, d: 0.55, h: 0.48, color: BENCH },
      { x: 3.2, z: -1, w: 1.8, d: 0.55, h: 0.48, color: BENCH },
      { x: 0, z: 6.8, w: 3.6, d: 0.8, h: 0.95, color: WOOD },
    ]
  }
  return [
    { x: -2.4, z: -1.2, w: 1.6, d: 0.7, h: 0.7, color: CLOTH },
    { x: 2.4, z: -1.2, w: 1.6, d: 0.7, h: 0.7, color: CLOTH },
    { x: 0, z: 6.2, w: 3.2, d: 0.75, h: 1.05, color: COUNTER },
  ]
}

function occupy(kind: InteriorKind): Spot[] {
  if (kind === 'residential') return [{ x: -2.4, z: 0.3 }, { x: -2.2, z: 3 }]
  if (kind === 'restaurant') return [{ x: -4.2, z: 0.4 }, { x: 4.2, z: 2.4 }, { x: 0, z: 4.3 }]
  if (kind === 'office') return [{ x: -3.6, z: 0.2 }, { x: 0, z: 0.2 }, { x: 3.6, z: 0.2 }]
  if (kind === 'shop') return [{ x: 0, z: 3.3 }, { x: -2, z: -0.4 }]
  if (kind === 'civic') return [{ x: 0, z: 5.6 }, { x: -5.5, z: 1.5 }]
  return [{ x: 0, z: 5 }, { x: 0, z: 0.8 }]
}

function headcount(kind: InteriorKind, rng: () => number): number {
  if (kind === 'residential') return rng() < 0.45 ? 1 : 2
  if (kind === 'restaurant' || kind === 'office') return 3
  return 2
}

function furnitureDisc(x: number, z: number, w: number, d: number, id: string): Disc {
  const alongX = w >= d
  const r = (alongX ? d : w) / 2
  const len = Math.max(0, (alongX ? w : d) / 2 - r)
  return { x, z, r, len, yaw: alongX ? Math.PI / 2 : 0, id }
}

function namedKind(text: string): InteriorKind | null {
  const name = text.toLowerCase()
  if (/\binn\b|hotel|motel/.test(name)) return 'hotel'
  if (/library|school|church|museum|hospital|courthouse|city hall|\bhall\b|temple|mosque|synagogue/.test(name)) return 'civic'
  if (/restaurant|cafe|café|coffee|grill|diner|bakery|bistro|\bbar\b|\bpub\b/.test(name)) return 'restaurant'
  if (/market|mall|store|shop|pharmacy|boutique/.test(name)) return 'shop'
  return null
}

function kindFromBusiness(kind: string): InteriorKind {
  return BUSINESS_KIND[kind] ?? 'shop'
}

function kindFromSize(building: MapBuilding): InteriorKind {
  const area = (building.maxX - building.minX) * (building.maxZ - building.minZ)
  if (building.h >= 11 || area >= 900) return 'office'
  if (area >= 220 && building.h >= 5) return 'shop'
  return 'residential'
}

function businessAt(building: MapBuilding, businesses: readonly Business[]): Business | null {
  const cx = (building.minX + building.maxX) / 2
  const cz = (building.minZ + building.maxZ) / 2
  let best: Business | null = null
  let bestD = Infinity
  for (const biz of businesses) {
    if (biz.x < building.minX - 2 || biz.x > building.maxX + 2) continue
    if (biz.z < building.minZ - 2 || biz.z > building.maxZ + 2) continue
    const dist = Math.hypot(biz.x - cx, biz.z - cz)
    if (dist >= bestD) continue
    bestD = dist
    best = biz
  }
  return best
}

function standOf(building: MapBuilding, px: number, pz: number): { x: number; z: number } | null {
  const edge = edgeStand(building, px, pz)
  let best = edge
  let bestD = edge ? Math.hypot(edge.x - px, edge.z - pz) : Infinity
  if (building.door) {
    const door = pushOut(building, building.door[0], building.door[1])
    if (door && !pointInRing(door.x, door.z, building.ring)) {
      const dist = Math.hypot(door.x - px, door.z - pz)
      if (dist < bestD) {
        best = door
        bestD = dist
      }
    }
  }
  if (!best || bestD > DOOR_REACH) return null
  return best
}

function edgeStand(building: MapBuilding, px: number, pz: number): { x: number; z: number } | null {
  const ring = building.ring
  const count = ring.length / 2
  const cx = (building.minX + building.maxX) / 2
  const cz = (building.minZ + building.maxZ) / 2
  let best = Infinity
  let stand: { x: number; z: number } | null = null
  for (let i = 0; i < count; i++) {
    const ax = ring[i * 2] ?? 0
    const az = ring[i * 2 + 1] ?? 0
    const j = (i + 1) % count
    const bx = ring[j * 2] ?? 0
    const bz = ring[j * 2 + 1] ?? 0
    if (Math.hypot(bx - ax, bz - az) < 1.5) continue
    const mx = (ax + bx) / 2
    const mz = (az + bz) / 2
    let nx = az - bz
    let nz = bx - ax
    const nlen = Math.hypot(nx, nz) || 1
    nx /= nlen
    nz /= nlen
    if ((cx - mx) * nx + (cz - mz) * nz > 0) {
      nx = -nx
      nz = -nz
    }
    const spot = pushOut(building, mx + nx * 1.15, mz + nz * 1.15)
    if (!spot || pointInRing(spot.x, spot.z, ring)) continue
    const dist = Math.hypot(spot.x - px, spot.z - pz)
    if (dist >= best) continue
    best = dist
    stand = spot
  }
  return stand
}

function pushOut(building: MapBuilding, x: number, z: number): { x: number; z: number } | null {
  if (!pointInRing(x, z, building.ring)) return { x, z }
  const cx = (building.minX + building.maxX) / 2
  const cz = (building.minZ + building.maxZ) / 2
  let dx = x - cx
  let dz = z - cz
  const len = Math.hypot(dx, dz) || 1
  dx /= len
  dz /= len
  let px = x
  let pz = z
  for (let i = 0; i < 10; i++) {
    px += dx * 0.6
    pz += dz * 0.6
    if (!pointInRing(px, pz, building.ring)) return { x: px, z: pz }
  }
  return null
}

function pointInRing(x: number, z: number, ring: number[]): boolean {
  let inside = false
  const count = ring.length / 2
  for (let i = 0, j = count - 1; i < count; j = i++) {
    const xi = ring[i * 2] ?? 0
    const zi = ring[i * 2 + 1] ?? 0
    const xj = ring[j * 2] ?? 0
    const zj = ring[j * 2 + 1] ?? 0
    const hit = zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi || 1e-9) + xi
    if (hit) inside = !inside
  }
  return inside
}

function personName(rng: () => number, used: Set<string>): string {
  for (let i = 0; i < 8; i++) {
    const name = `${pick(rng, FIRST)} ${pick(rng, LAST)}`
    if (used.has(name)) continue
    used.add(name)
    return name
  }
  const name = `${pick(rng, FIRST)} ${pick(rng, LAST)}`
  used.add(name)
  return name
}

function pick(rng: () => number, list: readonly string[]): string {
  return list[Math.floor(rng() * list.length)] ?? list[0]!
}

function mulberry(seed: number): () => number {
  let s = seed >>> 0 || 1
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}
