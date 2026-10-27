import mapJson from '../data/map.json'
import trafficJson from '../data/traffic.json'
import { createSeededRng } from '../src/util/seededRng.ts'
import { hitsBuilding, buildLayout, type MapFile } from '../src/world/layout.ts'
import { buildNetwork, lamps, sampleLane } from '../src/traffic/network.ts'
import { createTraffic, stepTraffic, type CarSim, type TrafficFile } from '../src/traffic/trafficSim.ts'
import { stepBuses, type BusFile, type BusSim } from '../src/traffic/busSim.ts'
import { BUS_HALF_LENGTH, BUS_HALF_WIDTH, overlapsCapsule, slideClear } from '../src/traffic/bodies.ts'
import busesJson from '../data/buses.json'
import { describe, expect, it } from 'vitest'

const file = trafficJson as TrafficFile
const layout = buildLayout(mapJson as MapFile)
const network = buildNetwork(layout)

describe('traffic', () => {
  it('builds a connected street grid with lights and corner signs', () => {
    expect(network.lanes.length).toBeGreaterThan(20)
    expect(network.signals.length).toBeGreaterThan(4)
    expect(network.signs.length).toBeGreaterThan(8)
    const named = network.signs.flatMap((post) => post.blades.map((blade) => blade.name))
    expect(named.some((name) => name.includes('Olive'))).toBe(true)
    expect(named.some((name) => name.includes('San Fernando') || name.includes('Magnolia'))).toBe(true)
    const doubled = network.signs.filter((post) => {
      const stems = new Set(post.blades.map((blade) => blade.name.replace(/^(North|South|East|West) /, '')))
      return post.blades.length >= 2 && stems.size < 2
    })
    expect(doubled).toHaveLength(0)
    for (const lane of network.lanes) {
      expect(lane.next.length + (lane.back === lane.id ? 0 : 1)).toBeGreaterThan(0)
    }
  })

  it('stops for red and drives through green', () => {
    const lane = network.lanes.find((entry) => entry.signal !== null && entry.length > 40)
    expect(lane).toBeTruthy()
    const redTime = lane!.axis === 'ew' ? file.green + file.yellow + 1 : 1
    const greenTime = lane!.axis === 'ew' ? 1 : file.green + file.yellow + 1
    expect(lamps(redTime, file.green, file.yellow)[lane!.axis]).toBe('red')
    expect(lamps(greenTime, file.green, file.yellow)[lane!.axis]).toBe('green')

    const stopped = carOn(lane!.id, lane!.stopAt - 12)
    for (let t = 0; t < 4; t += 0.05) {
      stepTraffic([stopped], network, file, redTime + t, 0.05, () => 0.2, [])
    }
    expect(stopped.dist).toBeLessThanOrEqual(lane!.stopAt + 0.6)

    const moving = carOn(lane!.id, lane!.stopAt - 8)
    for (let t = 0; t < 3; t += 0.05) {
      stepTraffic([moving], network, file, greenTime, 0.05, () => 0.2, [])
    }
    const crossed = moving.lane !== lane!.id || moving.dist > lane!.stopAt + 4
    expect(crossed).toBe(true)
  })

  it('stops for a car or person ahead, and ignores someone off to the side', () => {
    const lane = network.lanes.find((entry) => entry.signal === null && entry.length > 100)
    expect(lane).toBeTruthy()
    const dist = 48
    const pose = sampleLane(lane!, dist)
    const fx = Math.sin(pose.yaw)
    const fz = Math.cos(pose.yaw)
    const sideX = fz
    const sideZ = -fx

    const blocked = carOn(lane!.id, dist)
    blocked.x = pose.x
    blocked.z = pose.z
    blocked.yaw = pose.yaw
    blocked.speed = 8
    const lead = carOn(lane!.id, dist + 20)
    lead.id = 'c-lead'
    lead.driver = 'hold'
    lead.x = pose.x + fx * 3.2
    lead.z = pose.z + fz * 3.2
    lead.yaw = pose.yaw
    lead.speed = 0
    stepTraffic([lead, blocked], network, file, 2, 0.05, () => 0.2, [])
    expect(blocked.dist).toBe(dist)

    const walker = carOn(lane!.id, dist)
    walker.id = 'c-walker'
    walker.x = pose.x
    walker.z = pose.z
    walker.yaw = pose.yaw
    walker.speed = 8
    stepTraffic([walker], network, file, 2, 0.05, () => 0.2, [
      { x: pose.x + fx * 3.2, z: pose.z + fz * 3.2, r: 0.45, id: 'you' },
    ])
    expect(walker.dist).toBe(dist)

    const clear = carOn(lane!.id, dist)
    clear.id = 'c-clear'
    clear.x = pose.x
    clear.z = pose.z
    clear.yaw = pose.yaw
    clear.speed = 8
    stepTraffic([clear], network, file, 2, 0.05, () => 0.2, [
      { x: pose.x + sideX * 6, z: pose.z + sideZ * 6, r: 0.45, id: 'c-side' },
    ])
    expect(clear.dist).toBeGreaterThan(dist)
  })

  it('pulls apart cars that are sitting on the same spot', () => {
    const lane = network.lanes.find((entry) => entry.signal === null && entry.length > 80)
    expect(lane).toBeTruthy()
    const dist = 36
    const pose = sampleLane(lane!, dist)
    const nose = carOn(lane!.id, dist)
    nose.x = pose.x
    nose.z = pose.z
    nose.yaw = pose.yaw
    nose.speed = 0
    const piled = carOn(lane!.id, dist)
    piled.id = 'c-pile'
    piled.x = pose.x
    piled.z = pose.z
    piled.yaw = pose.yaw
    piled.speed = 0
    for (let t = 0; t < 2; t += 0.05) stepTraffic([nose, piled], network, file, t, 0.05, () => 0.2, [])
    expect(Math.hypot(nose.x - piled.x, nose.z - piled.z)).toBeGreaterThan(3)
  })

  it('keeps cars on the roadway', () => {
    const cars = createTraffic(network, file, createSeededRng(5))
    expect(cars.length).toBe(file.count)
    const rng = createSeededRng(9)
    for (let t = 0; t < 12; t += 0.05) stepTraffic(cars, network, file, t, 0.05, rng, [])
    for (const car of cars) expect(hitsBuilding(layout, car.x, car.z, 0.45)).toBe(false)
  })

  it('does not leave cars stopped in the intersections', () => {
    const cars = createTraffic(network, file, createSeededRng(5))
    const rng = createSeededRng(9)
    const stoppedFor = new Map<string, number>()
    for (let t = 0; t < 50; t += 0.05) {
      stepTraffic(cars, network, file, t, 0.05, rng, [])
      for (const car of cars) {
        const lane = network.lanes[car.lane]
        const gap = lane && lane.signal != null ? lane.stopAt - car.dist : 999
        const atLight = gap > -2 && gap < 18
        if (car.speed < 0.2 && !atLight) stoppedFor.set(car.id, (stoppedFor.get(car.id) ?? 0) + 0.05)
        else stoppedFor.set(car.id, 0)
      }
    }
    const jammed = cars.filter((car) => (stoppedFor.get(car.id) ?? 0) > 8)
    expect(jammed.length).toBeLessThan(12)
  })

  it('pulls two crossed buses apart', () => {
    const pair = crossingBuses()
    expect(pair).toBeTruthy()
    const buses = pair!
    expect(busOverlap(buses[0]!, buses[1]!)).toBe(true)
    const file = busesJson as BusFile
    for (let t = 0; t < 2; t += 0.05) stepBuses(buses, network, file, t, 0.05, () => 0.2, [])
    expect(busOverlap(buses[0]!, buses[1]!)).toBe(false)
    expect(Math.hypot(buses[0]!.x - buses[1]!.x, buses[0]!.z - buses[1]!.z)).toBeGreaterThan(4)
  })

  it('steps two people apart when they start on the same point', () => {
    const moved = slideClear([{ x: 1, z: 2, r: 0.45, id: 'p1' }], 1, 2, 1, 2, 0.45)
    expect(Math.hypot(moved.x - 1, moved.z - 2)).toBeGreaterThan(0.8)
  })
})

function busOverlap(a: BusSim, b: BusSim): boolean {
  return overlapsCapsule(a.x, a.z, a.yaw, BUS_HALF_LENGTH, BUS_HALF_WIDTH, {
    x: b.x,
    z: b.z,
    r: BUS_HALF_WIDTH,
    yaw: b.yaw,
    len: BUS_HALF_LENGTH,
  })
}

function crossingBuses(): [BusSim, BusSim] | null {
  for (const lane of network.lanes) {
    if (lane.signal === null || lane.length < 20) continue
    for (const other of network.lanes) {
      if (other.id <= lane.id || other.signal !== lane.signal || other.axis === lane.axis) continue
      const startA = Math.max(1, lane.stopAt - 8)
      const startB = Math.max(1, other.stopAt - 8)
      const endA = Math.min(lane.length - 1, lane.stopAt + 16)
      const endB = Math.min(other.length - 1, other.stopAt + 16)
      for (let dist = startA; dist < endA; dist += 4) {
        const pose = sampleLane(lane, dist)
        for (let far = startB; far < endB; far += 4) {
          const there = sampleLane(other, far)
          const a = parkedBus('b1', lane.id, dist + BUS_HALF_LENGTH)
          const b = parkedBus('b2', other.id, far + BUS_HALF_LENGTH)
          a.x = pose.x
          a.z = pose.z
          a.yaw = pose.yaw
          b.x = there.x
          b.z = there.z
          b.yaw = there.yaw
          if (!busOverlap(a, b)) continue
          return [a, b]
        }
      }
    }
  }
  return null
}

function parkedBus(id: string, lane: number, dist: number): BusSim {
  return {
    id,
    color: '#e07a3d',
    lane,
    dist,
    speed: 0,
    x: 0,
    z: 0,
    yaw: 0,
    dwell: 0,
    nextStop: dist + 400,
  }
}

function carOn(lane: number, dist: number): CarSim {
  return {
    id: 'c-test',
    model: 'sedan' as const,
    color: '#2457c5',
    lane,
    dist,
    speed: 10,
    x: 0,
    z: 0,
    yaw: 0,
    driver: null,
  }
}
