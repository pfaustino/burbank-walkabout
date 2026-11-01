import type { MapRoad } from '../world/layout.ts'

export type AddressPin = { n: string; s: string; x: number; z: number }

const ALIAS: Record<string, string> = {
  n: 'north',
  s: 'south',
  e: 'east',
  w: 'west',
  st: 'street',
  ave: 'avenue',
  av: 'avenue',
  blvd: 'boulevard',
  dr: 'drive',
  rd: 'road',
  ln: 'lane',
  ct: 'court',
  pl: 'place',
  hwy: 'highway',
  pkwy: 'parkway',
}

const OPTIONAL = new Set([
  'north',
  'south',
  'east',
  'west',
  'street',
  'avenue',
  'boulevard',
  'drive',
  'road',
  'lane',
  'court',
  'place',
  'highway',
  'parkway',
])

const CROSSING = /\s+(?:and|at)\s+|\s*&\s*/i
/** Centerlines farther apart than this are not the same junction. */
const MEET = 36

/** A house number, the middle of a named street, or where two streets meet. */
export function findAddress(query: string, addresses: readonly AddressPin[], roads: readonly MapRoad[]): { x: number; z: number } | null {
  const pieces = query.split(CROSSING)
  if (pieces.length === 2) return findCrossing(pieces[0] ?? '', pieces[1] ?? '', roads)
  if (pieces.length > 2) return null
  const { number, words: queryWords } = splitQuery(query)
  if (queryWords.length === 0) return null
  if (number) {
    let best: AddressPin | null = null
    let bestScore = 0
    for (const address of addresses) {
      if (!numberMatches(number, address.n)) continue
      const score = streetScore(queryWords, words(address.s))
      if (score > bestScore) {
        bestScore = score
        best = address
      }
    }
    return best ? { x: best.x, z: best.z } : null
  }
  let bestPts: number[] | null = null
  let bestScore = 0
  let bestLen = 0
  for (const road of roads) {
    if (!road.name) continue
    const score = streetScore(queryWords, words(road.name))
    const len = polylineLength(road.pts)
    if (score > bestScore || (score === bestScore && score > 0 && len > bestLen)) {
      bestScore = score
      bestLen = len
      bestPts = road.pts
    }
  }
  return bestPts ? halfway(bestPts) : null
}

function findCrossing(left: string, right: string, roads: readonly MapRoad[]): { x: number; z: number } | null {
  const leftWords = words(left)
  const rightWords = words(right)
  if (leftWords.length === 0 || rightWords.length === 0) return null
  if (requiredKey(leftWords) === requiredKey(rightWords)) return null
  const sideA = matchingRoads(leftWords, roads)
  const sideB = matchingRoads(rightWords, roads)
  if (sideA.length === 0 || sideB.length === 0) return null
  let bestDist = MEET
  let best: { x: number; z: number } | null = null
  for (const roadA of sideA) {
    for (const roadB of sideB) {
      if (roadA === roadB || roadA.name === roadB.name) continue
      const hit = polylinesNear(roadA.pts, roadB.pts, bestDist)
      if (!hit || hit.dist > bestDist) continue
      bestDist = hit.dist
      best = { x: hit.x, z: hit.z }
    }
  }
  return best
}

function matchingRoads(queryWords: string[], roads: readonly MapRoad[]): MapRoad[] {
  const found: MapRoad[] = []
  for (const road of roads) {
    if (!road.name || road.kind === 'service' || road.kind === 'pedestrian') continue
    if (streetScore(queryWords, words(road.name)) > 0) found.push(road)
  }
  return found
}

function requiredKey(tokens: string[]): string {
  return tokens.filter((word) => !OPTIONAL.has(word)).join(' ')
}

/** Closest point between two polylines, when they come within maxDist. */
function polylinesNear(a: number[], b: number[], maxDist: number): { dist: number; x: number; z: number } | null {
  let best: { dist: number; x: number; z: number } | null = null
  for (let i = 0; i < a.length - 2; i += 2) {
    const ax = a[i] ?? 0
    const az = a[i + 1] ?? 0
    const bx = a[i + 2] ?? ax
    const bz = a[i + 3] ?? az
    for (let j = 0; j < b.length - 2; j += 2) {
      const hit = segmentsNear(ax, az, bx, bz, b[j] ?? 0, b[j + 1] ?? 0, b[j + 2] ?? 0, b[j + 3] ?? 0)
      if (hit.dist > maxDist) continue
      if (!best || hit.dist < best.dist) best = hit
    }
  }
  return best
}

function segmentsNear(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
  dx: number,
  dz: number,
): { dist: number; x: number; z: number } {
  const rx = bx - ax
  const rz = bz - az
  const sx = dx - cx
  const sz = dz - cz
  const qx = ax - cx
  const qz = az - cz
  const rr = rx * rx + rz * rz
  const ss = sx * sx + sz * sz
  const rs = rx * sx + rz * sz
  const qr = qx * rx + qz * rz
  const qs = qx * sx + qz * sz
  const denom = rr * ss - rs * rs
  let t = denom !== 0 ? (rs * qs - ss * qr) / denom : 0
  t = t < 0 ? 0 : t > 1 ? 1 : t
  let u = ss !== 0 ? (t * rs + qs) / ss : 0
  if (u < 0 || u > 1) {
    u = u < 0 ? 0 : 1
    t = rr !== 0 ? (u * rs - qr) / rr : 0
    t = t < 0 ? 0 : t > 1 ? 1 : t
  }
  const x1 = ax + t * rx
  const z1 = az + t * rz
  const x2 = cx + u * sx
  const z2 = cz + u * sz
  return { dist: Math.hypot(x1 - x2, z1 - z2), x: (x1 + x2) / 2, z: (z1 + z2) / 2 }
}

function splitQuery(raw: string): { number: string; words: string[] } {
  const tokens = words(raw)
  const first = tokens[0] ?? ''
  if (tokens.length >= 2 && /^\d+[a-z]?$/.test(first)) return { number: first, words: tokens.slice(1) }
  return { number: '', words: tokens }
}

function words(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => ALIAS[word] ?? word)
}

function numbers(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter((token) => /\d/.test(token))
}

function numberMatches(query: string, stored: string): boolean {
  return numbers(stored).includes(query)
}

/** How well the query names this street. Directions and suffixes may be left out. */
function streetScore(queryWords: string[], streetWords: string[]): number {
  let required = 0
  let hit = 0
  for (const word of queryWords) {
    const optional = OPTIONAL.has(word)
    if (!optional) required += 1
    if (streetWords.includes(word)) hit += 1
    else if (!optional) return 0
  }
  if (required === 0) return 0
  return hit * 10 - streetWords.length
}

function polylineLength(pts: number[]): number {
  let total = 0
  for (let i = 0; i < pts.length - 2; i += 2) {
    total += Math.hypot((pts[i + 2] ?? 0) - (pts[i] ?? 0), (pts[i + 3] ?? 0) - (pts[i + 1] ?? 0))
  }
  return total
}

function halfway(pts: number[]): { x: number; z: number } | null {
  const total = polylineLength(pts)
  let left = total / 2
  for (let i = 0; i < pts.length - 2; i += 2) {
    const ax = pts[i] ?? 0
    const az = pts[i + 1] ?? 0
    const bx = pts[i + 2] ?? ax
    const bz = pts[i + 3] ?? az
    const len = Math.hypot(bx - ax, bz - az)
    if (left <= len) {
      const t = len > 0 ? left / len : 0
      return { x: ax + (bx - ax) * t, z: az + (bz - az) * t }
    }
    left -= len
  }
  if (pts.length < 2) return null
  return { x: pts[pts.length - 2] ?? 0, z: pts[pts.length - 1] ?? 0 }
}
