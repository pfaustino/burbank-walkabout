import type { WalkPoint } from './sidewalk.ts'

export type PlaceOffer = { name: string; x: number; z: number }

type Shop = { name: string; x: number; z: number; kind: string }

const INVITE =
  /\b(let's|lets|let us|come with|follow me|walk with|i'll take you|ill take you|i'll show|ill show|show you|this way|we should|we can go|come on|turn left|turn right|go to|head to|grab a|get some|go get|for coffee|some coffee|get coffee)\b/i

/** A place they actually offered to walk to, or nothing if they only mentioned it. */
export function offeredPlace(text: string, shops: readonly Shop[], from: { x: number; z: number }): PlaceOffer | null {
  const hay = text.toLowerCase()
  if (!INVITE.test(hay)) return null
  let named: Shop | null = null
  for (const shop of shops) {
    if (!mentions(hay, shop.name)) continue
    if (!named || shop.name.length > named.name.length) named = shop
  }
  if (named) return { name: named.name, x: named.x, z: named.z }
  if (!/\b(coffee|cafe)\b/.test(hay)) return null
  let nearest: Shop | null = null
  let best = Infinity
  for (const shop of shops) {
    if (shop.kind !== 'cafe') continue
    const d = Math.hypot(shop.x - from.x, shop.z - from.z)
    if (d < best) {
      best = d
      nearest = shop
    }
  }
  return nearest ? { name: nearest.name, x: nearest.x, z: nearest.z } : null
}

export type Errand = {
  x: number
  z: number
  yaw: number
  route: WalkPoint[]
  at: number
  goalX: number
  goalZ: number
  place: string
  moving: boolean
}

const LEAD = 3
const WAIT = 6.5
const DROP = 22
const ARRIVE = 2.4

/** Walk the route just ahead of the player. Wait if they fall behind. */
export function stepErrand(errand: Errand, dt: number, px: number, pz: number): 'walk' | 'wait' | 'done' | 'drop' {
  const goalD = Math.hypot(errand.goalX - errand.x, errand.goalZ - errand.z)
  const last = errand.route[errand.route.length - 1]
  const atEnd = errand.at >= errand.route.length || (last !== undefined && Math.hypot(last.x - errand.x, last.z - errand.z) < ARRIVE)
  if (atEnd || goalD < ARRIVE) {
    errand.moving = false
    return 'done'
  }
  const gap = Math.hypot(px - errand.x, pz - errand.z)
  const playerAhead = Math.hypot(px - errand.goalX, pz - errand.goalZ) + 3 < goalD
  if (gap > DROP && !playerAhead) {
    errand.moving = false
    return 'drop'
  }
  if (gap > WAIT && !playerAhead) {
    errand.yaw = Math.atan2(px - errand.x, pz - errand.z)
    errand.moving = false
    return 'wait'
  }
  let left = LEAD * Math.max(0, dt)
  while (left > 0 && errand.at < errand.route.length) {
    const point = errand.route[errand.at]!
    const dx = point.x - errand.x
    const dz = point.z - errand.z
    const dist = Math.hypot(dx, dz)
    if (dist < 0.15) {
      errand.at += 1
      continue
    }
    const step = Math.min(left, dist)
    errand.x += (dx / dist) * step
    errand.z += (dz / dist) * step
    errand.yaw = Math.atan2(dx, dz)
    left -= step
    if (step >= dist - 1e-6) errand.at += 1
  }
  errand.moving = true
  return 'walk'
}

function mentions(hay: string, name: string): boolean {
  const needle = name.toLowerCase()
  if (needle.length < 4) return false
  let from = 0
  while (from < hay.length) {
    const at = hay.indexOf(needle, from)
    if (at < 0) return false
    const before = at === 0 || !/[a-z0-9]/i.test(hay.charAt(at - 1))
    const afterAt = at + needle.length
    const after = afterAt >= hay.length || !/[a-z0-9]/i.test(hay.charAt(afterAt))
    if (before && after) return true
    from = at + 1
  }
  return false
}
