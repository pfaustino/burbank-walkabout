import mapJson from '../data/map.json'
import { buildRoute, cueOnRoute, routeLine, type RoadRoute } from '../src/delivery/route.ts'
import { buildNetwork, sampleLane, type Lane, type RoadNetwork } from '../src/traffic/network.ts'
import { buildLayout, type MapFile } from '../src/world/layout.ts'
import { describe, expect, it } from 'vitest'

function lane(id: number, ax: number, az: number, bx: number, bz: number, next: number[]): Lane {
  const length = Math.hypot(bx - ax, bz - az)
  return {
    id,
    name: 'Test',
    rank: 1,
    pts: [
      { x: ax, z: az },
      { x: bx, z: bz },
    ],
    cum: [0, length],
    length,
    next,
    back: id,
    signal: null,
    stopAt: length,
    axis: 'ew',
  }
}

function net(lanes: Lane[]): RoadNetwork {
  return { lanes, signals: [], signs: [] }
}

describe('road route', () => {
  const straight = net([
    lane(0, 0, 0, 100, 0, [1]),
    lane(1, 100, 0, 100, 80, []),
  ])

  it('stays on one street when the stop is ahead', () => {
    const route = buildRoute(straight, 10, 0, 80, 0)
    expect(route).not.toBeNull()
    expect(route!.lanes).toEqual([0])
    expect(route!.length).toBeCloseTo(70, 0)
    const cue = cueOnRoute(straight, route!, 10, 1, 0)
    expect(cue).not.toBeNull()
    expect(cue!.cue.x).toBeGreaterThan(20)
    expect(cue!.cue.x).toBeLessThan(30)
    expect(Math.abs(cue!.cue.z)).toBeLessThan(2)
    expect(cue!.cue.turn).toBe(0)
    expect(cue!.cue.remain).toBeGreaterThan(60)
    const line = routeLine(straight.lanes, route!)
    expect(line.length).toBeGreaterThan(1)
    expect(line[0]!.x).toBeCloseTo(10, 0)
    expect(line[line.length - 1]!.x).toBeCloseTo(80, 0)
  })

  it('shows a turn arrow on this street a few seconds before the corner', () => {
    const route = buildRoute(straight, 10, 0, 100, 60)
    expect(route!.lanes).toEqual([0, 1])
    const early = cueOnRoute(straight, route!, 40, 0, 0, 12)
    expect(early!.cue.turn).toBe(0)
    const soon = cueOnRoute(straight, route!, 40, 0, 0, 20)
    expect(soon!.cue.turn).toBe(-1)
    expect(soon!.cue.x).toBeGreaterThan(50)
    expect(soon!.cue.x).toBeLessThan(60)
    expect(Math.abs(soon!.cue.z)).toBeLessThan(2)
    expect(Math.abs(soon!.cue.yaw - Math.PI / 2)).toBeLessThan(0.2)
    const close = cueOnRoute(straight, route!, 90, 1, 0, 12)
    expect(close!.cue.turn).toBe(-1)
    expect(close!.cue.x).toBeGreaterThan(92)
    expect(close!.cue.x).toBeLessThan(100)
    expect(Math.abs(close!.cue.z)).toBeLessThan(2)
  })

  it('marks a left turn when the next street is to the left', () => {
    const left = net([lane(0, 0, 0, 100, 0, [1]), lane(1, 100, 0, 100, -80, [])])
    const route = buildRoute(left, 80, 0, 100, -40)
    const cue = cueOnRoute(left, route!, 80, 0, 0, 12)
    expect(cue!.cue.turn).toBe(1)
    expect(cue!.cue.x).toBeLessThan(100)
  })

  it('goes around the block when the stop is behind you', () => {
    const block = net([
      lane(0, 0, 0, 60, 0, [1]),
      lane(1, 60, 0, 60, 40, [2]),
      lane(2, 60, 40, 0, 40, [3]),
      lane(3, 0, 40, 0, 0, [0]),
    ])
    const route = buildRoute(block, 50, 0, 10, 0)
    expect(route).not.toBeNull()
    expect(route!.lanes).toEqual([0, 1, 2, 3, 0])
    expect(route!.length).toBeGreaterThan(140)
    expect(route!.length).toBeLessThan(180)
  })

  it('returns null when the streets do not connect', () => {
    const split = net([lane(0, 0, 0, 40, 0, []), lane(1, 200, 0, 240, 0, [])])
    expect(buildRoute(split, 5, 0, 220, 0)).toBeNull()
  })

  it('drops the route after the player leaves it', () => {
    const long = net([lane(0, 0, 0, 200, 0, [])])
    const route = buildRoute(long, 10, 0, 180, 0) as RoadRoute
    const step = cueOnRoute(long, route, 80, 0, 0)
    expect(step).not.toBeNull()
    expect(cueOnRoute(long, route, 80, 80, step!.cursor)).toBeNull()
    expect(cueOnRoute(long, route, 20, 0, step!.cursor)).toBeNull()
  })

  it('routes across Burbank on the driving lanes', () => {
    const network = buildNetwork(buildLayout(mapJson as MapFile))
    const goal = network.lanes.find((entry) => {
      if (entry.length < 40) return false
      const pose = sampleLane(entry, entry.length * 0.5)
      return Math.hypot(pose.x - 14.7, pose.z - 128) > 400
    })
    expect(goal).toBeTruthy()
    const there = sampleLane(goal!, goal!.length * 0.5)
    const started = performance.now()
    const route = buildRoute(network, 14.7, 128, there.x, there.z)
    const elapsed = performance.now() - started
    expect(route).not.toBeNull()
    const straight = Math.hypot(there.x - 14.7, there.z - 128)
    expect(route!.length).toBeGreaterThan(straight * 0.9)
    expect(route!.length).toBeLessThan(straight * 3)
    expect(elapsed).toBeLessThan(250)
    const cue = cueOnRoute(network, route!, 14.7, 128, 0)
    expect(cue).not.toBeNull()
    expect(cue!.cue.remain).toBeGreaterThan(100)
  })
})
