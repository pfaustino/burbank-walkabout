import mapJson from '../data/map.json'
import trafficJson from '../data/traffic.json'
import { createSeededRng } from '../src/util/seededRng.ts'
import { hitsBuilding, buildLayout, type MapFile } from '../src/world/layout.ts'
import { buildNetwork, lamps, sampleLane } from '../src/traffic/network.ts'
import { bumpCars } from '../src/traffic/bumps.ts'
import { wallBounce } from '../src/player/Walker.ts'
import { asideStep } from '../src/actors/peopleSim.ts'
import { createTraffic, cutsOff, gatherTraffic, stepTraffic, type CarSim, type TrafficFile } from '../src/traffic/trafficSim.ts'
import { stepBuses, type BusFile, type BusSim } from '../src/traffic/busSim.ts'
import { BUS_HALF_LENGTH, BUS_HALF_WIDTH, CAR_HALF_LENGTH, CAR_HALF_WIDTH, overlapsCapsule, slideClear } from '../src/traffic/bodies.ts'
import busesJson from '../data/buses.json'
import { describe, expect, it } from 'vitest'

const file = trafficJson as TrafficFile
const layout = buildLayout(mapJson as MapFile)
const network = buildNetwork(layout)

describe('traffic', () => {
  it('brakes and steps aside when a car cuts through', () => {
    expect(cutsOff(3, 0.4, 8, 1.8)).toBe(true)
    expect(cutsOff(18, 0, 8, 1.8)).toBe(false)
    expect(cutsOff(3, 0, 1, 1.8)).toBe(false)
    const moved = asideStep(0, 4, { x: 0, z: 0, yaw: 0, speed: 10 })
    expect(Math.abs(moved.x)).toBeGreaterThan(1.5)
    expect(asideStep(12, 4, { x: 0, z: 0, yaw: 0, speed: 10 })).toEqual({ x: 12, z: 4 })
  })

  it('bounces a car back off a building', () => {
    const hit = wallBounce(12)
    expect(hit).not.toBeNull()
    expect(hit!.speed).toBeCloseTo(-5.4)
    expect(hit!.kick).toBeCloseTo(1.68)
    expect(wallBounce(-8)!.speed).toBeGreaterThan(0)
    expect(wallBounce(1)).toBeNull()
  })

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

  it('keeps each direction on the right side of the center line', () => {
    const roads = layout.file.roads.filter((road) =>
      ['primary', 'secondary', 'tertiary', 'residential', 'unclassified'].includes(road.kind),
    )
    let checked = 0
    for (const lane of network.lanes) {
      const pose = sampleLane(lane, lane.length * 0.5)
      const tz = Math.cos(pose.yaw)
      if (Math.abs(tz) < 0.85) continue
      const center = nearestRoadPoint(roads, pose.x, pose.z)
      if (center.dist > 6) continue
      const screenRight = -tz
      const shifted = (pose.x - center.x) * screenRight
      expect(shifted).toBeGreaterThan(0.8)
      checked++
      if (checked > 12) break
    }
    expect(checked).toBeGreaterThan(3)
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

  it('waits at the line when the far side of the crossing is stopped', () => {
    const lane = network.lanes.find((entry) => entry.signal !== null && entry.next.length > 0 && entry.length > 50)
    expect(lane).toBeTruthy()
    const greenTime = lane!.axis === 'ew' ? 1 : file.green + file.yellow + 1
    const exits = new Set<number>(lane!.next)
    if (lane!.back !== lane!.id) exits.add(lane!.back)
    const held: CarSim[] = []
    for (const id of exits) {
      const pose = sampleLane(network.lanes[id]!, 4)
      const blocker = carOn(id, 4)
      blocker.id = `held-${id}`
      blocker.speed = 0
      blocker.driver = 'hold'
      blocker.x = pose.x
      blocker.z = pose.z
      blocker.yaw = pose.yaw
      held.push(blocker)
    }
    const pose = sampleLane(lane!, lane!.stopAt - 6)
    const car = carOn(lane!.id, lane!.stopAt - 6)
    car.speed = 8
    car.x = pose.x
    car.z = pose.z
    car.yaw = pose.yaw
    for (let t = 0; t < 3; t += 0.05) {
      stepTraffic([car, ...held], network, file, greenTime, 0.05, () => 0.2, [])
    }
    expect(car.lane).toBe(lane!.id)
    expect(car.dist).toBeLessThanOrEqual(lane!.stopAt + 0.8)
  })

  it('stops pulling cars in once the neighborhood is full', () => {
    const lane = network.lanes.find((entry) => entry.length > 80)
    expect(lane).toBeTruthy()
    const spot = sampleLane(lane!, lane!.length * 0.5)
    const near = carOn(lane!.id, lane!.length * 0.5)
    near.x = spot.x
    near.z = spot.z
    const far: CarSim[] = []
    for (let i = 0; i < 24; i++) {
      const car = carOn(lane!.id, 30)
      car.id = `far-${i}`
      car.x = spot.x + 4000
      car.z = spot.z + 4000
      far.push(car)
    }
    gatherTraffic([near, ...far], network, spot.x, spot.z, 560, createSeededRng(3), 4)
    const nearby = [near, ...far].filter((car) => Math.hypot(car.x - spot.x, car.z - spot.z) < 560)
    expect(nearby.length).toBeGreaterThan(1)
    expect(nearby.length).toBeLessThanOrEqual(4)
    expect(far.some((car) => car.x === spot.x + 4000)).toBe(true)
  })

  it('shoves both cars when one drives into the other', () => {
    const lane = network.lanes.find((entry) => entry.signal === null && entry.length > 80)
    expect(lane).toBeTruthy()
    const rearPose = sampleLane(lane!, 30)
    const fx = Math.sin(rearPose.yaw)
    const fz = Math.cos(rearPose.yaw)
    const gap = CAR_HALF_LENGTH * 2 + 0.5
    const rear = carOn(lane!.id, 30)
    rear.x = rearPose.x
    rear.z = rearPose.z
    rear.yaw = rearPose.yaw
    rear.speed = 10
    const front = carOn(lane!.id, 30 + gap)
    front.id = 'c-front'
    front.x = rearPose.x + fx * gap
    front.z = rearPose.z + fz * gap
    front.yaw = rearPose.yaw
    front.speed = 0
    const hits = bumpCars([rear, front], layout, file.restitution)
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0]!.impact).toBeGreaterThan(file.crunch)
    expect(front.speed).toBeGreaterThan(3)
    expect(rear.speed).toBeLessThan(8)
    expect(
      overlapsCapsule(rear.x, rear.z, rear.yaw, CAR_HALF_LENGTH, CAR_HALF_WIDTH, {
        x: front.x,
        z: front.z,
        yaw: front.yaw,
        r: CAR_HALF_WIDTH,
        len: CAR_HALF_LENGTH,
      }),
    ).toBe(false)
    const shoved = (front.x - (rearPose.x + fx * gap)) * fx + (front.z - (rearPose.z + fz * gap)) * fz
    const recoil = (rearPose.x - rear.x) * fx + (rearPose.z - rear.z) * fz
    expect(shoved).toBeGreaterThan(0.8)
    expect(Math.abs(shoved - recoil)).toBeLessThan(0.25)

    const deep = carOn(lane!.id, 30)
    deep.id = 'c-deep'
    deep.x = rearPose.x + fx * 2.6
    deep.z = rearPose.z + fz * 2.6
    deep.yaw = rearPose.yaw
    deep.speed = 0
    rear.x = rearPose.x
    rear.z = rearPose.z
    rear.speed = 10
    const deepHits = bumpCars([rear, deep], layout, file.restitution)
    expect(deepHits.length).toBeGreaterThan(0)
    expect(deep.speed).toBeGreaterThan(3)
  })

  it('keeps a sideways bump beside the lane, then lets it fade', () => {
    const lane = network.lanes.find((entry) => entry.signal === null && entry.length > 80)
    expect(lane).toBeTruthy()
    const car = carOn(lane!.id, 36)
    car.speed = 0
    stepTraffic([car], network, file, 1, 0.05, () => 0.2, [])
    car.speed = 0
    car.knockX = 2
    car.knockZ = 0
    stepTraffic([car], network, file, 1, 0.05, () => 0.2, [])
    const pose = sampleLane(network.lanes[car.lane] ?? lane!, car.dist)
    const off = Math.hypot(car.x - pose.x, car.z - pose.z)
    expect(off).toBeGreaterThan(1.4)
    expect(off).toBeLessThan(2)
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

function nearestRoadPoint(
  roads: { pts: number[] }[],
  x: number,
  z: number,
): { x: number; z: number; dist: number } {
  let best = Infinity
  let px = x
  let pz = z
  for (const road of roads) {
    for (let i = 0; i < road.pts.length - 2; i += 2) {
      const ax = road.pts[i] ?? 0
      const az = road.pts[i + 1] ?? 0
      const bx = road.pts[i + 2] ?? 0
      const bz = road.pts[i + 3] ?? 0
      const dx = bx - ax
      const dz = bz - az
      const len2 = dx * dx + dz * dz || 1
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2))
      const qx = ax + dx * t
      const qz = az + dz * t
      const dist = Math.hypot(x - qx, z - qz)
      if (dist < best) {
        best = dist
        px = qx
        pz = qz
      }
    }
  }
  return { x: px, z: pz, dist: best }
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
