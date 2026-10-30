import { hitsBuilding, type CityLayout, type MapFile, type Vec2 } from '../world/layout.ts'

export type Axis = 'ew' | 'ns'
export type Lamp = 'red' | 'yellow' | 'green'

export type Lane = {
  id: number
  name: string
  rank: number
  pts: Vec2[]
  cum: number[]
  length: number
  next: number[]
  back: number
  signal: number | null
  stopAt: number
  axis: Axis
}

export type SignalHead = {
  x: number
  z: number
  yaw: number
  axis: Axis
}

export type Signal = {
  id: number
  x: number
  z: number
  heads: SignalHead[]
}

export type SignBlade = {
  name: string
  yaw: number
}

export type SignPost = {
  x: number
  z: number
  blades: SignBlade[]
}

export type RoadNetwork = {
  lanes: Lane[]
  signals: Signal[]
  signs: SignPost[]
}

const DRIVE = new Set(['primary', 'secondary', 'tertiary', 'residential', 'unclassified'])
const RANK: Record<string, number> = { primary: 4, secondary: 3, tertiary: 2, residential: 1, unclassified: 1 }
const JOIN = 8
const CLUSTER = 12

type Run = {
  name: string
  kind: string
  rank: number
  width: number
  pts: Vec2[]
  cum: number[]
  length: number
}

/** Lanes, signals, and corner signs from the downtown centerlines. */
export function buildNetwork(layout: CityLayout): RoadNetwork {
  const runs = driveable(layout.file)
  const marks = runs.map((run) => [0, run.length])
  const cells = new Map<string, number[]>()
  const segs: { run: number; a: number }[] = []
  for (let r = 0; r < runs.length; r++) {
    const run = runs[r]!
    for (let a = 0; a < run.pts.length - 1; a++) {
      const id = segs.length
      segs.push({ run: r, a })
      const p = run.pts[a]!
      const q = run.pts[a + 1]!
      const minX = Math.floor(Math.min(p.x, q.x) / 24) - 1
      const maxX = Math.floor(Math.max(p.x, q.x) / 24) + 1
      const minZ = Math.floor(Math.min(p.z, q.z) / 24) - 1
      const maxZ = Math.floor(Math.max(p.z, q.z) / 24) + 1
      for (let gx = minX; gx <= maxX; gx++) {
        for (let gz = minZ; gz <= maxZ; gz++) {
          const key = `${gx},${gz}`
          const bucket = cells.get(key) ?? []
          bucket.push(id)
          cells.set(key, bucket)
        }
      }
    }
  }
  const seen = new Set<string>()
  for (const bucket of cells.values()) {
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        const left = segs[bucket[i]!]!
        const right = segs[bucket[j]!]!
        if (left.run === right.run) continue
        const key = left.run < right.run ? `${bucket[i]}:${bucket[j]}` : `${bucket[j]}:${bucket[i]}`
        if (seen.has(key)) continue
        seen.add(key)
        const a = runs[left.run]!
        const b = runs[right.run]!
        const hit = closest(
          a.pts[left.a]!,
          a.pts[left.a + 1]!,
          b.pts[right.a]!,
          b.pts[right.a + 1]!,
        )
        if (hit.dist > JOIN) continue
        marks[left.run]!.push(a.cum[left.a]! + hit.t * (a.cum[left.a + 1]! - a.cum[left.a]!))
        marks[right.run]!.push(b.cum[right.a]! + hit.u * (b.cum[right.a + 1]! - b.cum[right.a]!))
      }
    }
  }

  const lanes: Lane[] = []
  for (let r = 0; r < runs.length; r++) {
    const run = runs[r]!
    const cuts = mergeMarks(marks[r]!)
    for (let c = 0; c < cuts.length - 1; c++) {
      const d0 = cuts[c]!
      const d1 = cuts[c + 1]!
      if (d1 - d0 < 14) continue
      const forward = sliceRun(run, d0, d1)
      const backward = [...forward].reverse()
      const offset = Math.min(Math.max(run.width * 0.22, 1.7), 3.4)
      pushPair(lanes, layout, run, offsetPolyline(forward, offset, layout), offsetPolyline(backward, offset, layout))
    }
  }
  linkLanes(lanes)
  const { signals, signs } = placeJunctions(layout, lanes)
  return { lanes, signals, signs }
}

export function sampleLane(lane: Lane, dist: number): { x: number; z: number; yaw: number } {
  const clamped = Math.max(0, Math.min(dist, Math.max(0, lane.length - 0.01)))
  let i = 0
  while (i < lane.cum.length - 2 && lane.cum[i + 1]! < clamped) i++
  const span = (lane.cum[i + 1] ?? lane.length) - (lane.cum[i] ?? 0) || 1
  const t = (clamped - (lane.cum[i] ?? 0)) / span
  const a = lane.pts[i] ?? lane.pts[0]!
  const b = lane.pts[i + 1] ?? a
  const x = a.x + (b.x - a.x) * t
  const z = a.z + (b.z - a.z) * t
  return { x, z, yaw: Math.atan2(b.x - a.x, b.z - a.z) }
}

export function nearestOnLane(lanes: Lane[], x: number, z: number): { lane: number; dist: number } {
  let bestLane = 0
  let bestDist = 0
  let best = Infinity
  for (const lane of lanes) {
    for (let i = 0; i < lane.pts.length - 1; i++) {
      const a = lane.pts[i]!
      const b = lane.pts[i + 1]!
      const dx = b.x - a.x
      const dz = b.z - a.z
      const len2 = dx * dx + dz * dz || 1
      const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / len2, 0, 1)
      const px = a.x + dx * t
      const pz = a.z + dz * t
      const d = Math.hypot(x - px, z - pz)
      if (d < best) {
        best = d
        bestLane = lane.id
        bestDist = (lane.cum[i] ?? 0) + Math.hypot(px - a.x, pz - a.z)
      }
    }
  }
  return { lane: bestLane, dist: bestDist }
}

export function lamps(time: number, green: number, yellow: number): { ew: Lamp; ns: Lamp } {
  const cycle = (green + yellow) * 2
  const t = ((time % cycle) + cycle) % cycle
  if (t < green) return { ew: 'green', ns: 'red' }
  if (t < green + yellow) return { ew: 'yellow', ns: 'red' }
  if (t < green * 2 + yellow) return { ew: 'red', ns: 'green' }
  return { ew: 'red', ns: 'yellow' }
}

function driveable(file: MapFile): Run[] {
  const runs: Run[] = []
  for (const road of file.roads) {
    if (!DRIVE.has(road.kind) || road.pts.length < 4) continue
    const pts = pairs(road.pts)
    const cum = [0]
    for (let i = 1; i < pts.length; i++) {
      cum.push(cum[i - 1]! + Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.z - pts[i - 1]!.z))
    }
    const length = cum[cum.length - 1] ?? 0
    if (length < 20) continue
    runs.push({
      name: road.name || 'Street',
      kind: road.kind,
      rank: RANK[road.kind] ?? 1,
      width: road.w,
      pts,
      cum,
      length,
    })
  }
  return runs
}

function pushPair(lanes: Lane[], layout: CityLayout, run: Run, forwardPts: Vec2[], backPts: Vec2[]): void {
  const forward = makeLane(lanes.length, run, forwardPts)
  const back = makeLane(lanes.length + 1, run, backPts)
  if (forward.length < 12 || back.length < 12) return
  if (laneBlocked(layout, forward) || laneBlocked(layout, back)) return
  forward.back = back.id
  back.back = forward.id
  lanes.push(forward, back)
}

function makeLane(id: number, run: Run, pts: Vec2[]): Lane {
  const clean = thin(pts)
  const cum = [0]
  for (let i = 1; i < clean.length; i++) {
    cum.push(cum[i - 1]! + Math.hypot(clean[i]!.x - clean[i - 1]!.x, clean[i]!.z - clean[i - 1]!.z))
  }
  const length = cum[cum.length - 1] ?? 0
  const heading = sampleHeading(clean, cum, length)
  return {
    id,
    name: run.name,
    rank: run.rank,
    pts: clean,
    cum,
    length,
    next: [],
    back: id,
    signal: null,
    stopAt: length,
    axis: Math.abs(heading.x) >= Math.abs(heading.z) ? 'ew' : 'ns',
  }
}

function laneBlocked(layout: CityLayout, lane: Lane): boolean {
  const steps = 4
  for (let i = 1; i < steps; i++) {
    const spot = sampleLane(lane, (lane.length * i) / steps)
    if (hitsBuilding(layout, spot.x, spot.z, 0.7)) return true
  }
  return false
}

function linkLanes(lanes: Lane[]): void {
  const ends: { lane: number; at: 'start' | 'end'; x: number; z: number }[] = []
  for (const lane of lanes) {
    const a = lane.pts[0]!
    const b = lane.pts[lane.pts.length - 1]!
    ends.push({ lane: lane.id, at: 'start', x: a.x, z: a.z })
    ends.push({ lane: lane.id, at: 'end', x: b.x, z: b.z })
  }
  const ids = cluster(ends, CLUSTER)
  const groups = new Map<number, number[]>()
  for (let i = 0; i < ends.length; i++) {
    const id = ids[i]!
    const list = groups.get(id) ?? []
    list.push(i)
    groups.set(id, list)
  }
  for (const group of groups.values()) {
    const starts: number[] = []
    for (const index of group) {
      const end = ends[index]!
      if (end.at === 'start') starts.push(end.lane)
    }
    for (const index of group) {
      const end = ends[index]!
      if (end.at !== 'end') continue
      const lane = lanes[end.lane]
      if (!lane) continue
      for (const start of starts) if (start !== lane.id) lane.next.push(start)
    }
  }
}

function placeJunctions(layout: CityLayout, lanes: Lane[]): { signals: Signal[]; signs: SignPost[] } {
  const ends: { lane: number; at: 'start' | 'end'; x: number; z: number }[] = []
  for (const lane of lanes) {
    const a = lane.pts[0]!
    const b = lane.pts[lane.pts.length - 1]!
    ends.push({ lane: lane.id, at: 'start', x: a.x, z: a.z })
    ends.push({ lane: lane.id, at: 'end', x: b.x, z: b.z })
  }
  const ids = cluster(ends, CLUSTER)
  const groups = new Map<number, number[]>()
  for (let i = 0; i < ends.length; i++) {
    const list = groups.get(ids[i]!) ?? []
    list.push(i)
    groups.set(ids[i]!, list)
  }

  const signals: Signal[] = []
  const signs: SignPost[] = []
  let signalId = 0
  for (const group of groups.values()) {
    let x = 0
    let z = 0
    const names = new Map<string, { rank: number; yaw: number }>()
    let arrivals = 0
    let bestRank = 0
    for (const index of group) {
      const end = ends[index]!
      x += end.x
      z += end.z
      const lane = lanes[end.lane]!
      bestRank = Math.max(bestRank, lane.rank)
      const heading = end.at === 'end' ? endHeading(lane) : startHeading(lane)
      if (lane.name && !lane.name.startsWith('Alley')) {
        const known = names.get(lane.name)
        if (!known || lane.rank > known.rank) names.set(lane.name, { rank: lane.rank, yaw: Math.atan2(heading.x, heading.z) })
      }
      if (end.at === 'end') arrivals++
    }
    x /= group.length
    z /= group.length
    if (distinctStems(names) < 2) adoptCrossing(lanes, names, x, z)
    const lit = bestRank >= 2 && arrivals >= 3 && names.size >= 2
    if (lit) {
      const heads: SignalHead[] = []
      for (const index of group) {
        const end = ends[index]!
        if (end.at !== 'end') continue
        const lane = lanes[end.lane]!
        if (lane.length < 20) continue
        lane.signal = signalId
        lane.stopAt = Math.max(8, lane.length - 9)
        const heading = endHeading(lane)
        lane.axis = Math.abs(heading.x) >= Math.abs(heading.z) ? 'ew' : 'ns'
        const stop = sampleLane(lane, lane.stopAt)
        const side = sidewalk(layout, stop.x, stop.z, heading)
        if (side) heads.push({ x: side.x, z: side.z, yaw: Math.atan2(-heading.x, -heading.z), axis: lane.axis })
      }
      if (heads.length > 0) signals.push({ id: signalId, x, z, heads })
      signalId++
    }
    if (names.size < 2) continue
    let spot = corner(layout, x, z, [...names.values()].map((entry) => entry.yaw))
    if (!spot && !hitsBuilding(layout, x, z, 0.35)) spot = { x, z }
    if (!spot) continue
    if (signs.some((post) => Math.hypot(post.x - spot.x, post.z - spot.z) < 16)) continue
    const blades = pickBlades(names)
    if (blades.length === 0) continue
    signs.push({ x: spot.x, z: spot.z, blades })
  }
  return { signals, signs }
}

function streetStem(name: string): string {
  return name.replace(/^(North|South|East|West) /, '')
}

function distinctStems(names: Map<string, { rank: number; yaw: number }>): number {
  return new Set([...names.keys()].map(streetStem)).size
}

function adoptCrossing(lanes: Lane[], names: Map<string, { rank: number; yaw: number }>, x: number, z: number): void {
  const stems = new Set([...names.keys()].map(streetStem))
  let best: { name: string; rank: number; yaw: number; dist: number } | null = null
  for (const lane of lanes) {
    if (!lane.name || lane.name.startsWith('Alley')) continue
    if (stems.has(streetStem(lane.name))) continue
    const hit = closestOnLane(lane, x, z)
    if (!hit || hit.dist > 11) continue
    if (!best || lane.rank > best.rank || (lane.rank === best.rank && hit.dist < best.dist)) {
      best = { name: lane.name, rank: lane.rank, yaw: hit.yaw, dist: hit.dist }
    }
  }
  if (best) names.set(best.name, { rank: best.rank, yaw: best.yaw })
}

function closestOnLane(lane: Lane, x: number, z: number): { dist: number; yaw: number } | null {
  let best = Infinity
  let yaw = 0
  for (let i = 1; i < lane.pts.length; i++) {
    const a = lane.pts[i - 1]!
    const b = lane.pts[i]!
    const dx = b.x - a.x
    const dz = b.z - a.z
    const len2 = dx * dx + dz * dz
    if (len2 < 1e-6) continue
    const t = Math.min(1, Math.max(0, ((x - a.x) * dx + (z - a.z) * dz) / len2))
    const dist = Math.hypot(a.x + dx * t - x, a.z + dz * t - z)
    if (dist < best) {
      best = dist
      yaw = Math.atan2(dx, dz)
    }
  }
  return Number.isFinite(best) ? { dist: best, yaw } : null
}

function pickBlades(names: Map<string, { rank: number; yaw: number }>): SignBlade[] {
  const ranked = [...names.entries()].sort((a, b) => b[1].rank - a[1].rank || a[0].localeCompare(b[0]))
  const blades: SignBlade[] = []
  const stems = new Set<string>()
  for (const [name, info] of ranked) {
    const stem = streetStem(name)
    if (stems.has(stem)) continue
    stems.add(stem)
    blades.push({ name, yaw: info.yaw })
    if (blades.length === 2) break
  }
  return blades
}

function sidewalk(layout: CityLayout, x: number, z: number, heading: Vec2): Vec2 | null {
  const rx = heading.z
  const rz = -heading.x
  for (const dist of [4.2, 5.4, -4.2, 3.2]) {
    const sx = x + rx * dist
    const sz = z + rz * dist
    if (!hitsBuilding(layout, sx, sz, 0.35)) return { x: sx, z: sz }
  }
  return null
}

function corner(layout: CityLayout, x: number, z: number, yaws: number[]): Vec2 | null {
  const dirs: Vec2[] = []
  for (let i = 0; i < yaws.length; i++) {
    for (let j = i + 1; j < yaws.length; j++) {
      const ax = Math.sin(yaws[i]!)
      const az = Math.cos(yaws[i]!)
      const bx = Math.sin(yaws[j]!)
      const bz = Math.cos(yaws[j]!)
      const lx = ax + bx
      const lz = az + bz
      const len = Math.hypot(lx, lz)
      if (len < 0.2) continue
      dirs.push({ x: lx / len, z: lz / len }, { x: -lx / len, z: -lz / len })
    }
  }
  dirs.push({ x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 })
  for (const dist of [9, 7, 11, 5.5, 4]) {
    for (const dir of dirs) {
      const sx = x + dir.x * dist
      const sz = z + dir.z * dist
      if (!hitsBuilding(layout, sx, sz, 0.4)) return { x: sx, z: sz }
    }
  }
  return null
}

function endHeading(lane: Lane): Vec2 {
  return sampleHeading(lane.pts, lane.cum, lane.length)
}

function startHeading(lane: Lane): Vec2 {
  const a = lane.pts[0]!
  const b = lane.pts[Math.min(1, lane.pts.length - 1)]!
  const len = Math.hypot(b.x - a.x, b.z - a.z) || 1
  return { x: (b.x - a.x) / len, z: (b.z - a.z) / len }
}

function sampleHeading(pts: Vec2[], cum: number[], length: number): Vec2 {
  const dist = Math.max(0, length - 6)
  let i = 0
  while (i < cum.length - 2 && cum[i + 1]! < dist) i++
  const a = pts[i]!
  const b = pts[Math.min(i + 1, pts.length - 1)]!
  const len = Math.hypot(b.x - a.x, b.z - a.z) || 1
  return { x: (b.x - a.x) / len, z: (b.z - a.z) / len }
}

function offsetPolyline(pts: Vec2[], amount: number, layout: CityLayout): Vec2[] {
  const out: Vec2[] = []
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[Math.max(0, i - 1)]!
    const next = pts[Math.min(pts.length - 1, i + 1)]!
    let tx = next.x - prev.x
    let tz = next.z - prev.z
    const len = Math.hypot(tx, tz) || 1
    tx /= len
    tz /= len
    // Three.js is right-handed with +z south, so this perpendicular is the
    // right-hand lane as the chase camera looks along travel.
    let x = pts[i]!.x - tz * amount
    let z = pts[i]!.z + tx * amount
    if (hitsBuilding(layout, x, z, 0.8)) {
      x = pts[i]!.x
      z = pts[i]!.z
    }
    const last = out[out.length - 1]
    if (last && Math.hypot(x - last.x, z - last.z) < 0.8) continue
    out.push({ x, z })
  }
  return out.length >= 2 ? out : pts
}

function sliceRun(run: Run, d0: number, d1: number): Vec2[] {
  const pts = [pointAt(run, d0)]
  for (let i = 1; i < run.pts.length - 1; i++) {
    if (run.cum[i]! > d0 + 0.4 && run.cum[i]! < d1 - 0.4) pts.push(run.pts[i]!)
  }
  pts.push(pointAt(run, d1))
  return pts
}

function pointAt(run: Run, dist: number): Vec2 {
  let i = 0
  while (i < run.cum.length - 2 && run.cum[i + 1]! < dist) i++
  const span = (run.cum[i + 1] ?? run.length) - (run.cum[i] ?? 0) || 1
  const t = (dist - (run.cum[i] ?? 0)) / span
  const a = run.pts[i]!
  const b = run.pts[i + 1] ?? a
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }
}

function mergeMarks(marks: number[]): number[] {
  const sorted = [...marks].sort((a, b) => a - b)
  const merged = [sorted[0] ?? 0]
  for (const mark of sorted) {
    if (mark - merged[merged.length - 1]! > 9) merged.push(mark)
  }
  return merged
}

function thin(pts: Vec2[]): Vec2[] {
  const out: Vec2[] = []
  for (const pt of pts) {
    const last = out[out.length - 1]
    if (last && Math.hypot(pt.x - last.x, pt.z - last.z) < 1.2) continue
    out.push(pt)
  }
  if (out.length < 2 && pts.length >= 2) return [pts[0]!, pts[pts.length - 1]!]
  return out
}

function cluster(points: { x: number; z: number }[], radius: number): number[] {
  const parent = points.map((_, index) => index)
  const find = (index: number): number => {
    let cursor = index
    while (parent[cursor] !== cursor) {
      parent[cursor] = parent[parent[cursor]!]!
      cursor = parent[cursor]!
    }
    return cursor
  }
  const unite = (a: number, b: number): void => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[rb] = ra
  }
  const grid = new Map<string, number[]>()
  for (let i = 0; i < points.length; i++) {
    const gx = Math.floor(points[i]!.x / radius)
    const gz = Math.floor(points[i]!.z / radius)
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const list = grid.get(`${gx + dx},${gz + dz}`)
        if (!list) continue
        for (const j of list) {
          if (Math.hypot(points[i]!.x - points[j]!.x, points[i]!.z - points[j]!.z) <= radius) unite(i, j)
        }
      }
    }
    const key = `${gx},${gz}`
    const bucket = grid.get(key) ?? []
    bucket.push(i)
    grid.set(key, bucket)
  }
  const compact = new Map<number, number>()
  return points.map((_, index) => {
    const root = find(index)
    let id = compact.get(root)
    if (id === undefined) {
      id = compact.size
      compact.set(root, id)
    }
    return id
  })
}

function closest(a: Vec2, b: Vec2, c: Vec2, d: Vec2): { dist: number; t: number; u: number } {
  const abx = b.x - a.x
  const abz = b.z - a.z
  const cdx = d.x - c.x
  const cdz = d.z - c.z
  const acx = c.x - a.x
  const acz = c.z - a.z
  const ab2 = abx * abx + abz * abz
  const cd2 = cdx * cdx + cdz * cdz
  const abcd = abx * cdx + abz * cdz
  const abac = abx * acx + abz * acz
  const cdac = cdx * acx + cdz * acz
  const denom = ab2 * cd2 - abcd * abcd
  let t = ab2 > 1e-6 ? clamp(abac / ab2, 0, 1) : 0
  let u = 0
  if (denom > 1e-4) t = clamp((abcd * cdac + abac * cd2) / denom, 0, 1)
  if (cd2 > 1e-6) u = clamp((abcd * t - cdac) / cd2, 0, 1)
  if (ab2 > 1e-6) t = clamp((abcd * u + abac) / ab2, 0, 1)
  const px = a.x + abx * t
  const pz = a.z + abz * t
  const qx = c.x + cdx * u
  const qz = c.z + cdz * u
  return { dist: Math.hypot(px - qx, pz - qz), t, u }
}

function pairs(flat: number[]): Vec2[] {
  const points: Vec2[] = []
  for (let i = 0; i < flat.length; i += 2) points.push({ x: flat[i] ?? 0, z: flat[i + 1] ?? 0 })
  return points
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
