import { nearestOnLane, sampleLane, type Lane, type RoadNetwork } from '../traffic/network.ts'

export type RoadRoute = {
  lanes: number[]
  enter: number
  exit: number
  length: number
  goalX: number
  goalZ: number
}

export type RoadCue = {
  x: number
  z: number
  yaw: number
  remain: number
}

const OFF = 28
const BACK = 22
const LEAD = 14
const FROM_START = -2

type HeapItem = { id: number; g: number; f: number }

/** Shortest drive from the player to the stop, along the same lanes the cars use. */
export function buildRoute(network: RoadNetwork, fromX: number, fromZ: number, toX: number, toZ: number): RoadRoute | null {
  const lanes = network.lanes
  if (lanes.length === 0) return null
  const from = nearestOnLane(lanes, fromX, fromZ)
  const to = nearestOnLane(lanes, toX, toZ)
  const startLane = lanes[from.lane]
  const goalLane = lanes[to.lane]
  if (!startLane || !goalLane) return null
  if (from.lane === to.lane && to.dist + 4 >= from.dist) {
    return finish([from.lane], from.dist, to.dist, lanes, toX, toZ)
  }

  const g = new Float64Array(lanes.length)
  const prev = new Int32Array(lanes.length)
  g.fill(Number.POSITIVE_INFINITY)
  prev.fill(-1)
  const heap: HeapItem[] = []
  const leave = Math.max(0, startLane.length - from.dist)
  for (const nxt of startLane.next) {
    const lane = lanes[nxt]
    if (!lane || nxt === from.lane) continue
    const cost = leave
    if (cost >= g[nxt]!) continue
    g[nxt] = cost
    prev[nxt] = FROM_START
    push(heap, { id: nxt, g: cost, f: cost })
  }

  const closed = new Uint8Array(lanes.length)
  let found = false
  let pops = 0
  const cap = lanes.length * 8 + 8
  while (heap.length > 0 && pops < cap) {
    const item = pop(heap)
    pops++
    if (!item || item.g !== g[item.id]) continue
    if (item.id === to.lane) {
      found = true
      break
    }
    if (closed[item.id]) continue
    closed[item.id] = 1
    const lane = lanes[item.id]
    if (!lane) continue
    for (const nxt of lane.next) {
      const next = lanes[nxt]
      if (!next) continue
      const cost = item.g + lane.length
      if (cost >= g[nxt]!) continue
      g[nxt] = cost
      prev[nxt] = item.id
      push(heap, { id: nxt, g: cost, f: cost })
    }
  }
  if (!found) return null

  const path: number[] = []
  let cursor = to.lane
  let linked = false
  for (let n = 0; n < lanes.length + 2; n++) {
    path.push(cursor)
    const parent = prev[cursor] ?? -1
    if (parent === FROM_START) {
      path.push(from.lane)
      linked = true
      break
    }
    if (parent < 0) return null
    cursor = parent
  }
  if (!linked) return null
  path.reverse()
  return finish(path, from.dist, to.dist, lanes, toX, toZ)
}

/** The arrow for where the player is on this route. Null when they have left it. */
export function cueOnRoute(network: RoadNetwork, route: RoadRoute, x: number, z: number, cursor: number): { cue: RoadCue; cursor: number } | null {
  const lanes = network.lanes
  let bestScore = Infinity
  let bestAlong = 0
  let bestDist = 0
  let bestIndex = -1
  for (let i = 0; i < route.lanes.length; i++) {
    const lane = lanes[route.lanes[i]!]
    if (!lane) continue
    const hit = project(lane, x, z)
    if (hit.gap > OFF) continue
    const along = alongRoute(route, lanes, i, hit.dist)
    const behind = Math.max(0, cursor - along)
    const score = hit.gap + behind * 2
    if (score >= bestScore) continue
    bestScore = score
    bestAlong = along
    bestDist = hit.dist
    bestIndex = i
  }
  if (bestIndex < 0) return null
  if (bestAlong < cursor - BACK) return null
  const nextCursor = Math.max(cursor, bestAlong)
  const lane = lanes[route.lanes[bestIndex]!]
  if (!lane) return null
  const remain = Math.max(0, route.length - bestAlong)
  const pose = aheadOnRoute(route, lanes, bestIndex, bestDist, LEAD)
  return { cue: { x: pose.x, z: pose.z, yaw: pose.yaw, remain }, cursor: nextCursor }
}

/** A point a few meters ahead, following the route onto the next street. */
function aheadOnRoute(route: RoadRoute, lanes: Lane[], index: number, dist: number, lead: number): { x: number; z: number; yaw: number } {
  let left = lead
  let i = index
  let d = dist
  while (i < route.lanes.length) {
    const lane = lanes[route.lanes[i]!]
    if (!lane) break
    const last = i === route.lanes.length - 1
    const end = last ? route.exit : lane.length
    const room = end - d
    if (left <= room || last) {
      const at = Math.max(0, Math.min(end, d + left))
      const pose = sampleLane(lane, at)
      if (last) {
        const dx = route.goalX - pose.x
        const dz = route.goalZ - pose.z
        if (dx * dx + dz * dz > 0.25 && end - at < 8) return { x: pose.x, z: pose.z, yaw: Math.atan2(dx, dz) }
      }
      return pose
    }
    left -= Math.max(0, room)
    i++
    d = 0
  }
  const lane = lanes[route.lanes[index]!]!
  return sampleLane(lane, dist)
}

/** Points along the drive, from where the route starts to the stop. */
export function routeLine(lanes: readonly Lane[], route: RoadRoute): { x: number; z: number }[] {
  const points: { x: number; z: number }[] = []
  for (let i = 0; i < route.lanes.length; i++) {
    const lane = lanes[route.lanes[i]!]
    if (!lane) continue
    const last = i === route.lanes.length - 1
    const from = i === 0 ? route.enter : 0
    const to = last ? route.exit : lane.length
    appendSpan(points, lane, from, to)
  }
  const end = points[points.length - 1]
  if (!end || Math.hypot(end.x - route.goalX, end.z - route.goalZ) > 4) {
    points.push({ x: route.goalX, z: route.goalZ })
  }
  return points
}

function appendSpan(points: { x: number; z: number }[], lane: Lane, from: number, to: number): void {
  if (to < from) return
  remember(points, sampleLane(lane, from))
  for (let i = 0; i < lane.pts.length; i++) {
    const dist = lane.cum[i] ?? 0
    if (dist <= from + 0.5 || dist >= to - 0.5) continue
    const spot = lane.pts[i]
    if (spot) remember(points, spot)
  }
  remember(points, sampleLane(lane, to))
}

function remember(points: { x: number; z: number }[], spot: { x: number; z: number }): void {
  const prev = points[points.length - 1]
  if (prev && Math.hypot(prev.x - spot.x, prev.z - spot.z) < 1.5) return
  points.push({ x: spot.x, z: spot.z })
}

function finish(ids: number[], enter: number, exit: number, lanes: Lane[], goalX: number, goalZ: number): RoadRoute | null {
  if (ids.length === 0) return null
  let length = 0
  for (let i = 0; i < ids.length; i++) {
    const lane = lanes[ids[i]!]
    if (!lane) return null
    const last = i === ids.length - 1
    if (i === 0 && last) length += Math.max(0, exit - enter)
    else if (i === 0) length += Math.max(0, lane.length - enter)
    else if (last) length += Math.max(0, exit)
    else length += lane.length
  }
  return { lanes: ids, enter, exit, length, goalX, goalZ }
}

function alongRoute(route: RoadRoute, lanes: Lane[], index: number, dist: number): number {
  let along = 0
  for (let i = 0; i < index; i++) {
    const lane = lanes[route.lanes[i]!]
    if (!lane) continue
    along += i === 0 ? Math.max(0, lane.length - route.enter) : lane.length
  }
  if (index === 0) along += dist - route.enter
  else along += dist
  return along
}

function project(lane: Lane, x: number, z: number): { dist: number; gap: number } {
  let best = Infinity
  let dist = 0
  for (let i = 0; i < lane.pts.length - 1; i++) {
    const a = lane.pts[i]!
    const b = lane.pts[i + 1]!
    const dx = b.x - a.x
    const dz = b.z - a.z
    const len2 = dx * dx + dz * dz || 1
    const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / len2, 0, 1)
    const px = a.x + dx * t
    const pz = a.z + dz * t
    const gap = Math.hypot(x - px, z - pz)
    if (gap >= best) continue
    best = gap
    dist = (lane.cum[i] ?? 0) + Math.hypot(px - a.x, pz - a.z)
  }
  return { dist, gap: best }
}

function push(heap: HeapItem[], item: HeapItem): void {
  heap.push(item)
  let i = heap.length - 1
  while (i > 0) {
    const parent = (i - 1) >> 1
    if (heap[parent]!.f <= heap[i]!.f) break
    const swap = heap[parent]!
    heap[parent] = heap[i]!
    heap[i] = swap
    i = parent
  }
}

function pop(heap: HeapItem[]): HeapItem | undefined {
  const top = heap[0]
  const last = heap.pop()
  if (!top || !last) return undefined
  if (heap.length === 0) return last
  heap[0] = last
  let i = 0
  for (;;) {
    const left = i * 2 + 1
    const right = left + 1
    let small = i
    if (left < heap.length && heap[left]!.f < heap[small]!.f) small = left
    if (right < heap.length && heap[right]!.f < heap[small]!.f) small = right
    if (small === i) break
    const swap = heap[small]!
    heap[small] = heap[i]!
    heap[i] = swap
    i = small
  }
  return top
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
