/** Flat discs and capsules used for street collision. y is ignored; the city is a ground plane. */

export type Disc = {
  x: number
  z: number
  /** Half-width, or the full radius when `len` is omitted. */
  r: number
  id?: string
  yaw?: number
  /** Half-length along yaw. Omit for a person-sized circle. */
  len?: number
}

export const PERSON_RADIUS = 0.45
/** Matches the car meshes. The capsule tip is length + width, which is the bumper. */
export const CAR_HALF_WIDTH = 0.9
export const CAR_HALF_LENGTH = 1.2
export const BUS_HALF_WIDTH = 1.35
export const BUS_HALF_LENGTH = 5.5

const CELL = 8
const ORIGIN = 4096
const SPAN = 8192
const PERSON_GAP = 0.9

export class BodyGrid {
  private readonly buckets = new Map<number, Disc[]>()
  private readonly used: number[] = []

  clear(): void {
    for (const key of this.used) {
      const list = this.buckets.get(key)
      if (list) list.length = 0
    }
    this.used.length = 0
  }

  add(disc: Disc): void {
    const key = cellKey(disc.x, disc.z)
    let list = this.buckets.get(key)
    if (!list) {
      list = []
      this.buckets.set(key, list)
    }
    if (list.length === 0) this.used.push(key)
    list.push(disc)
  }

  near(x: number, z: number, reach: number, fn: (disc: Disc) => void): void {
    const minX = Math.floor((x - reach) / CELL)
    const maxX = Math.floor((x + reach) / CELL)
    const minZ = Math.floor((z - reach) / CELL)
    const maxZ = Math.floor((z + reach) / CELL)
    for (let cx = minX; cx <= maxX; cx++) {
      for (let cz = minZ; cz <= maxZ; cz++) {
        const list = this.buckets.get((cx + ORIGIN) * SPAN + (cz + ORIGIN))
        if (!list) continue
        for (let i = 0; i < list.length; i++) fn(list[i]!)
      }
    }
  }
}

const peopleGrid = new BodyGrid()
const blockGrid = new BodyGrid()
const scratch: Disc[] = []

/** Push sidewalk people off one another, then out of the blocking capsules. */
export function separatePeople(xy: Float32Array, blocks: readonly Disc[]): void {
  const n = xy.length >> 1
  for (let pass = 0; pass < 2; pass++) {
    peopleGrid.clear()
    for (let i = 0; i < n; i++) {
      let disc = scratch[i]
      if (!disc) {
        disc = { x: 0, z: 0, r: PERSON_RADIUS, id: String(i) }
        scratch[i] = disc
      }
      disc.x = xy[i * 2]!
      disc.z = xy[i * 2 + 1]!
      peopleGrid.add(disc)
    }
    for (let i = 0; i < n; i++) {
      const disc = scratch[i]!
      let x = disc.x
      let z = disc.z
      peopleGrid.near(x, z, 1.2, (other) => {
        if (other === disc) return
        const dx = x - other.x
        const dz = z - other.z
        const dist = Math.hypot(dx, dz) || 0.001
        if (dist >= PERSON_GAP) return
        const push = (PERSON_GAP - dist) * 0.5
        x += (dx / dist) * push
        z += (dz / dist) * push
      })
      xy[i * 2] = x
      xy[i * 2 + 1] = z
    }
  }
  pushClear(xy, blocks)
}

/** Move each person out of any capsule they overlap. */
export function pushClear(xy: Float32Array, blocks: readonly Disc[]): void {
  if (blocks.length === 0) return
  blockGrid.clear()
  for (const block of blocks) blockGrid.add(block)
  const n = xy.length >> 1
  for (let i = 0; i < n; i++) {
    let x = xy[i * 2]!
    let z = xy[i * 2 + 1]!
    blockGrid.near(x, z, 12, (block) => {
      const out = escapeCircle(block, x, z, PERSON_RADIUS)
      if (!out) return
      x += out.x
      z += out.z
    })
    xy[i * 2] = x
    xy[i * 2 + 1] = z
  }
}

export function hitsBody(discs: readonly Disc[], x: number, z: number, radius: number, ignore?: string | null): boolean {
  for (const disc of discs) {
    if (ignore && disc.id === ignore) continue
    if (overlapsCapsule(x, z, 0, 0, radius, disc)) return true
  }
  return false
}

export function slideClear(
  discs: readonly Disc[],
  x: number,
  z: number,
  nx: number,
  nz: number,
  radius: number,
  ignore?: string | null,
): { x: number; z: number } {
  if (!hitsBody(discs, nx, nz, radius, ignore)) return { x: nx, z: nz }
  if (!hitsBody(discs, nx, z, radius, ignore)) return { x: nx, z }
  if (!hitsBody(discs, x, nz, radius, ignore)) return { x, z: nz }
  if (hitsBody(discs, x, z, radius, ignore)) {
    const out = pushOutOf(discs, x, z, radius, ignore)
    if (out.hit) return { x: out.x, z: out.z }
  }
  return { x, z }
}

export function pushOutOf(
  discs: readonly Disc[],
  x: number,
  z: number,
  radius: number,
  ignore?: string | null,
): { x: number; z: number; hit: boolean } {
  let hit = false
  for (let pass = 0; pass < 2; pass++) {
    for (const disc of discs) {
      if (ignore && disc.id === ignore) continue
      const out = escapeCircle(disc, x, z, radius)
      if (!out) continue
      x += out.x
      z += out.z
      hit = true
    }
  }
  return { x, z, hit }
}

/** True when a capsule (len 0 is a circle) overlaps `other`. */
export function overlapsCapsule(
  x: number,
  z: number,
  yaw: number,
  len: number,
  radius: number,
  other: Disc,
): boolean {
  const otherLen = other.len ?? 0
  const otherYaw = other.yaw ?? 0
  const fx = Math.sin(yaw)
  const fz = Math.cos(yaw)
  const ofx = Math.sin(otherYaw)
  const ofz = Math.cos(otherYaw)
  const dist = segmentDistance(
    x - fx * len,
    z - fz * len,
    x + fx * len,
    z + fz * len,
    other.x - ofx * otherLen,
    other.z - ofz * otherLen,
    other.x + ofx * otherLen,
    other.z + ofz * otherLen,
  )
  return dist < radius + other.r
}

/** Gap between two capsules. Negative means overlap. `nx, nz` pushes the first body away. */
export function capsuleContact(
  x: number,
  z: number,
  yaw: number,
  len: number,
  radius: number,
  other: Disc,
): { gap: number; nx: number; nz: number } {
  const otherLen = other.len ?? 0
  const otherYaw = other.yaw ?? 0
  const fx = Math.sin(yaw)
  const fz = Math.cos(yaw)
  const ofx = Math.sin(otherYaw)
  const ofz = Math.cos(otherYaw)
  const hit = closestSegments(
    x - fx * len,
    z - fz * len,
    x + fx * len,
    z + fz * len,
    other.x - ofx * otherLen,
    other.z - ofz * otherLen,
    other.x + ofx * otherLen,
    other.z + ofz * otherLen,
  )
  let nx = hit.px - hit.qx
  let nz = hit.pz - hit.qz
  let dist = Math.hypot(nx, nz)
  if (dist < 1e-4) {
    nx = x - other.x
    nz = z - other.z
    const center = Math.hypot(nx, nz)
    if (center < 1e-4) {
      nx = fz
      nz = -fx
    } else {
      nx /= center
      nz /= center
    }
    dist = 0
  } else {
    nx /= dist
    nz /= dist
  }
  return { gap: dist - radius - other.r, nx, nz }
}

function escapeCircle(disc: Disc, x: number, z: number, radius: number): { x: number; z: number } | null {
  const len = disc.len ?? 0
  const yaw = disc.yaw ?? 0
  const fx = Math.sin(yaw)
  const fz = Math.cos(yaw)
  const ahead = (x - disc.x) * fx + (z - disc.z) * fz
  const clamped = Math.max(-len, Math.min(len, ahead))
  const ox = x - (disc.x + fx * clamped)
  const oz = z - (disc.z + fz * clamped)
  const dist = Math.hypot(ox, oz)
  const need = radius + disc.r
  if (dist >= need) return null
  if (dist < 1e-4) {
    const ang = nudgeAngle(disc.id)
    return { x: Math.cos(ang) * need, z: Math.sin(ang) * need }
  }
  const push = need - dist
  return { x: (ox / dist) * push, z: (oz / dist) * push }
}

function nudgeAngle(id: string | undefined): number {
  let hash = 0
  const text = id ?? 'x'
  for (let i = 0; i < text.length; i++) hash = (Math.imul(hash, 33) + text.charCodeAt(i)) >>> 0
  return (hash % 360) * (Math.PI / 180)
}

function segmentDistance(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
  dx: number,
  dz: number,
): number {
  const hit = closestSegments(ax, az, bx, bz, cx, cz, dx, dz)
  return Math.hypot(hit.px - hit.qx, hit.pz - hit.qz)
}

/** Closest points on two segments. Handles a parallel pair, such as a nose-to-tail crash. */
function closestSegments(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
  dx: number,
  dz: number,
): { px: number; pz: number; qx: number; qz: number } {
  const d1x = bx - ax
  const d1z = bz - az
  const d2x = dx - cx
  const d2z = dz - cz
  const rx = ax - cx
  const rz = az - cz
  const a = d1x * d1x + d1z * d1z
  const e = d2x * d2x + d2z * d2z
  const f = d2x * rx + d2z * rz
  const c = d1x * rx + d1z * rz
  const b = d1x * d2x + d1z * d2z
  let s = 0
  let t = 0
  if (a <= 1e-8 && e <= 1e-8) {
    s = 0
    t = 0
  } else if (a <= 1e-8) {
    s = 0
    t = clamp(f / e, 0, 1)
  } else if (e <= 1e-8) {
    t = 0
    s = clamp(-c / a, 0, 1)
  } else {
    const denom = a * e - b * b
    s = denom > 1e-8 ? clamp((b * f - c * e) / denom, 0, 1) : clamp(-c / a, 0, 1)
    t = (b * s + f) / e
    if (t < 0) {
      t = 0
      s = clamp(-c / a, 0, 1)
    } else if (t > 1) {
      t = 1
      s = clamp((b - c) / a, 0, 1)
    }
  }
  return { px: ax + d1x * s, pz: az + d1z * s, qx: cx + d2x * t, qz: cz + d2z * t }
}

function cellKey(x: number, z: number): number {
  return (Math.floor(x / CELL) + ORIGIN) * SPAN + (Math.floor(z / CELL) + ORIGIN)
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
