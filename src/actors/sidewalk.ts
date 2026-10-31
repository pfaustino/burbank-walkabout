import type { MapPath } from '../world/layout.ts'

export type WalkPoint = { x: number; z: number }

type Node = { x: number; z: number; to: number[] }

/** `cells` buckets node ids by LINK-sized cell, keyed "cx,cz". */
export type SidewalkGraph = { nodes: Node[]; cells?: Map<string, number[]> }

const STEP = 7
const LINK = 9

/** Sidewalk polylines joined where they meet, so a walker can turn a corner. */
export function buildSidewalks(paths: readonly MapPath[]): SidewalkGraph {
  const nodes: Node[] = []
  for (const path of paths) {
    const pts = pairs(path.pts)
    if (pts.length < 2) continue
    let prev = -1
    let along = 0
    let nextAt = 0
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!
      const b = pts[i]!
      const dx = b.x - a.x
      const dz = b.z - a.z
      const len = Math.hypot(dx, dz)
      if (len < 0.05) continue
      while (along + len >= nextAt - 1e-6) {
        const t = (nextAt - along) / len
        const clamped = Math.max(0, Math.min(1, t))
        const node = { x: a.x + dx * clamped, z: a.z + dz * clamped, to: [] as number[] }
        const id = nodes.length
        nodes.push(node)
        if (prev >= 0) link(nodes, prev, id)
        prev = id
        nextAt += STEP
        if (clamped >= 1) break
      }
      along += len
    }
  }
  const cell = LINK
  const buckets = new Map<string, number[]>()
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!
    const key = `${Math.floor(node.x / cell)},${Math.floor(node.z / cell)}`
    const list = buckets.get(key)
    if (list) list.push(i)
    else buckets.set(key, [i])
  }
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!
    const cx = Math.floor(node.x / cell)
    const cz = Math.floor(node.z / cell)
    for (let ox = -1; ox <= 1; ox++) {
      for (let oz = -1; oz <= 1; oz++) {
        const list = buckets.get(`${cx + ox},${cz + oz}`)
        if (!list) continue
        for (const other of list) {
          if (other <= i) continue
          const b = nodes[other]!
          if (Math.hypot(b.x - node.x, b.z - node.z) > LINK) continue
          link(nodes, i, other)
        }
      }
    }
  }
  return { nodes, cells: buckets }
}

/** Points from where someone is standing to the sidewalk nearest the goal. */
export function routeSidewalk(graph: SidewalkGraph, x: number, z: number, gx: number, gz: number): WalkPoint[] {
  const count = graph.nodes.length
  if (count === 0) return []
  const start = nearestNode(graph, x, z)
  const goal = nearestNode(graph, gx, gz)
  if (start < 0 || goal < 0) return []
  if (start === goal) return [{ x, z }, nodePoint(graph, goal)]
  const came = new Int32Array(count)
  came.fill(-1)
  const score = new Float64Array(count)
  score.fill(Infinity)
  score[start] = 0
  const open = [start]
  const listed = new Uint8Array(count)
  listed[start] = 1
  const goalNode = graph.nodes[goal]!
  while (open.length > 0) {
    let pick = 0
    let best = Infinity
    for (let i = 0; i < open.length; i++) {
      const id = open[i]!
      const node = graph.nodes[id]!
      const rank = score[id]! + Math.hypot(node.x - goalNode.x, node.z - goalNode.z)
      if (rank < best) {
        best = rank
        pick = i
      }
    }
    const current = open[pick]!
    open.splice(pick, 1)
    listed[current] = 0
    if (current === goal) break
    const node = graph.nodes[current]!
    for (const next of node.to) {
      const other = graph.nodes[next]!
      const step = score[current]! + Math.hypot(other.x - node.x, other.z - node.z)
      if (step >= score[next]!) continue
      came[next] = current
      score[next] = step
      if (listed[next]) continue
      open.push(next)
      listed[next] = 1
    }
  }
  if (!Number.isFinite(score[goal]!)) return []
  const path: WalkPoint[] = []
  let cursor = goal
  for (let guard = 0; guard < count && cursor >= 0; guard++) {
    path.push(nodePoint(graph, cursor))
    if (cursor === start) break
    cursor = came[cursor]!
  }
  path.reverse()
  const first = path[0]
  if (first && Math.hypot(first.x - x, first.z - z) > 0.4) path.unshift({ x, z })
  return path
}

function nodePoint(graph: SidewalkGraph, id: number): WalkPoint {
  const node = graph.nodes[id]!
  return { x: node.x, z: node.z }
}

/** Rings of cells to search before giving up on the grid and scanning every node. */
const RING_LIMIT = 40

/** Closest node, lowest index on a tie. `scan` skips the grid; tests use it to prove the two agree. */
export function nearestNode(graph: SidewalkGraph, x: number, z: number, scan = false): number {
  if (scan || !graph.cells) return scanNearest(graph, x, z)
  const cx = Math.floor(x / LINK)
  const cz = Math.floor(z / LINK)
  let best = -1
  let bestD = Infinity
  for (let r = 0; r <= RING_LIMIT; r++) {
    for (let ox = -r; ox <= r; ox++) {
      const edge = Math.abs(ox) === r
      for (let oz = -r; oz <= r; oz += edge || r === 0 ? 1 : 2 * r) {
        const list = graph.cells.get(`${cx + ox},${cz + oz}`)
        if (!list) continue
        for (const i of list) {
          const node = graph.nodes[i]!
          const d = Math.hypot(node.x - x, node.z - z)
          if (d < bestD || (d === bestD && i < best)) {
            bestD = d
            best = i
          }
        }
      }
    }
    if (best >= 0 && bestD <= r * LINK) return best
  }
  return scanNearest(graph, x, z)
}

function scanNearest(graph: SidewalkGraph, x: number, z: number): number {
  let best = -1
  let bestD = Infinity
  for (let i = 0; i < graph.nodes.length; i++) {
    const node = graph.nodes[i]!
    const d = Math.hypot(node.x - x, node.z - z)
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

function link(nodes: Node[], a: number, b: number): void {
  const left = nodes[a]
  const right = nodes[b]
  if (!left || !right || a === b) return
  if (!left.to.includes(b)) left.to.push(b)
  if (!right.to.includes(a)) right.to.push(a)
}

function pairs(flat: number[]): WalkPoint[] {
  const pts: WalkPoint[] = []
  for (let i = 0; i < flat.length; i += 2) {
    const x = flat[i] ?? 0
    const z = flat[i + 1] ?? 0
    const last = pts[pts.length - 1]
    if (last && Math.hypot(x - last.x, z - last.z) < 0.4) continue
    pts.push({ x, z })
  }
  return pts
}
