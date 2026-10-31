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

/** A house number, or the middle of a named street when no number is given. */
export function findAddress(query: string, addresses: readonly AddressPin[], roads: readonly MapRoad[]): { x: number; z: number } | null {
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
