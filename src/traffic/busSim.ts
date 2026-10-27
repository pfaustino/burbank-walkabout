import trafficJson from '../../data/traffic.json'
import { BUS_HALF_LENGTH, BUS_HALF_WIDTH, overlapsCapsule } from './bodies.ts'
import { lamps, sampleLane, type Lamp, type Lane, type RoadNetwork } from './network.ts'

export type BusFile = {
  count: number
  cruise: number
  dwell: number
  stopEvery: number
  colors: string[]
}

export type BusSim = {
  id: string
  color: string
  lane: number
  dist: number
  speed: number
  x: number
  z: number
  yaw: number
  dwell: number
  nextStop: number
  /** Seconds stopped by another vehicle, off a red light. */
  wait?: number
  /** Seconds to stay back after giving way to a bus that was crossed. */
  hold?: number
}

const BUS_LENGTH = BUS_HALF_LENGTH * 2
const HALF = BUS_HALF_LENGTH

export function createBuses(network: RoadNetwork, file: BusFile, rng: () => number): BusSim[] {
  const major = network.lanes.filter((lane) => lane.rank >= 3 && lane.length > 80)
  const pool = major.length > 0 ? major : network.lanes.filter((lane) => lane.length > 40)
  if (pool.length === 0 || file.count < 1) return []
  let slots = stopsAlong(pool, 120)
  if (slots.length < file.count) slots = stopsAlong(pool, 55)
  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const swap = slots[i]!
    slots[i] = slots[j]!
    slots[j] = swap
  }
  const buses: BusSim[] = []
  for (let i = 0; i < file.count && i < slots.length; i++) {
    const slot = slots[i]!
    const lane = network.lanes[slot.lane]
    if (!lane) continue
    const bus: BusSim = {
      id: `b${buses.length + 1}`,
      color: file.colors[i % file.colors.length] ?? '#e07a3d',
      lane: lane.id,
      dist: slot.dist,
      speed: file.cruise,
      x: 0,
      z: 0,
      yaw: 0,
      dwell: 0,
      nextStop: slot.dist + 40 + rng() * file.stopEvery,
    }
    place(bus, lane)
    buses.push(bus)
  }
  return buses
}

export function stepBuses(
  buses: BusSim[],
  network: RoadNetwork,
  file: BusFile,
  time: number,
  dt: number,
  rng: () => number,
  obstacles: { x: number; z: number; id?: string }[],
): void {
  const phase = lamps(time, trafficJson.green, trafficJson.yellow)
  const byLane = new Map<number, BusSim[]>()
  for (const bus of buses) {
    const list = byLane.get(bus.lane) ?? []
    list.push(bus)
    byLane.set(bus.lane, list)
  }
  for (const list of byLane.values()) list.sort((a, b) => a.dist - b.dist)

  for (const bus of buses) {
    const lane = network.lanes[bus.lane]
    if (!lane) continue
    let desired = file.cruise
    const lamp = lane.axis === 'ew' ? phase.ew : phase.ns
    desired = Math.min(desired, lightLimit(lane, bus, lamp))
    desired = Math.min(desired, followLimit(bus, lane, byLane, network))
    desired = Math.min(desired, stopLimit(bus, lane, file))
    const people = someoneAhead(bus, obstacles, true)
    const vehicles = !people && someoneAhead(bus, obstacles, false)
    if (people || (vehicles && (bus.wait ?? 0) < 3)) desired = 0
    if (bus.dwell > 0) {
      bus.dwell = Math.max(0, bus.dwell - dt)
      desired = 0
    }
    if ((bus.hold ?? 0) > 0) {
      bus.hold = Math.max(0, (bus.hold ?? 0) - dt)
      desired = 0
    }
    const rate = desired >= bus.speed ? 5 : 11
    const step = rate * dt
    bus.speed += Math.max(-step, Math.min(step, desired - bus.speed))
    if (bus.speed < 0.05) bus.speed = 0
    const gap = lane.stopAt - bus.dist
    const redWait = lane.signal !== null && mustStop(lamp, gap, 0) && gap < 22 && gap > -1.5
    if (redWait || bus.dwell > 0 || !vehicles) bus.wait = 0
    else bus.wait = (bus.wait ?? 0) + dt
    const holding = lane.signal !== null && mustStop(lamp, gap, bus.speed) && gap < 1
    if (!holding && bus.dwell <= 0 && (bus.hold ?? 0) <= 0) bus.dist += bus.speed * dt
    if (bus.dist >= lane.length - 0.05) {
      const overflow = bus.dist - lane.length
      bus.lane = chooseNext(lane, network.lanes, rng)
      bus.dist = Math.max(0, overflow)
      bus.nextStop = bus.dist + file.stopEvery
    }
    const nextLane = network.lanes[bus.lane] ?? lane
    place(bus, nextLane)
  }
  untieKnots(buses, network, dt)
}

function place(bus: BusSim, lane: Lane): void {
  const pose = sampleLane(lane, Math.max(0, bus.dist - HALF))
  bus.x = pose.x
  bus.z = pose.z
  bus.yaw = pose.yaw
}

/** Back the bus that should give way out of a crossing bus, so a locked pair can separate. */
function untieKnots(buses: BusSim[], network: RoadNetwork, dt: number): void {
  const step = Math.min(6, 8 * dt)
  for (let i = 0; i < buses.length; i++) {
    const a = buses[i]!
    for (let j = i + 1; j < buses.length; j++) {
      const b = buses[j]!
      if (Math.hypot(a.x - b.x, a.z - b.z) > BUS_LENGTH) continue
      if (!busHits(a, b)) continue
      const back = yielder(a, b)
      const ahead = back === a ? b : a
      const lane = network.lanes[back.lane]
      if (!lane) continue
      back.dist = Math.max(0, back.dist - step)
      back.speed = 0
      back.hold = Math.max(back.hold ?? 0, 1.8)
      place(back, lane)
      ahead.wait = Math.max(ahead.wait ?? 0, 3.1)
      if (!busHits(a, b)) continue
      const goLane = network.lanes[ahead.lane]
      if (!goLane || back.dist > 0.05) continue
      ahead.dist = Math.min(goLane.length - 0.1, ahead.dist + step)
      ahead.speed = Math.max(ahead.speed, 3)
      place(ahead, goLane)
    }
  }
}

function busHits(a: BusSim, b: BusSim): boolean {
  return overlapsCapsule(a.x, a.z, a.yaw, HALF, BUS_HALF_WIDTH, {
    x: b.x,
    z: b.z,
    r: BUS_HALF_WIDTH,
    yaw: b.yaw,
    len: HALF,
  })
}

function yielder(a: BusSim, b: BusSim): BusSim {
  const dot = Math.sin(a.yaw) * Math.sin(b.yaw) + Math.cos(a.yaw) * Math.cos(b.yaw)
  if (dot > 0.7) {
    const ahead = (b.x - a.x) * Math.sin(a.yaw) + (b.z - a.z) * Math.cos(a.yaw)
    return ahead > 0 ? a : b
  }
  return a.id > b.id ? a : b
}

function stopsAlong(lanes: Lane[], gap: number): { lane: number; dist: number }[] {
  const slots: { lane: number; dist: number }[] = []
  for (const lane of lanes) {
    const usable = lane.length - 28
    if (usable < 24) continue
    const count = Math.max(1, Math.floor(usable / gap))
    for (let i = 0; i < count; i++) slots.push({ lane: lane.id, dist: 18 + (usable * (i + 0.5)) / count })
  }
  return slots
}

function lightLimit(lane: Lane, bus: BusSim, lamp: Lamp): number {
  if (lane.signal === null) return Infinity
  const gap = lane.stopAt - bus.dist
  if (gap < -2 || gap > 34) return Infinity
  if (!mustStop(lamp, gap, bus.speed)) return Infinity
  if (gap < 1.3) return 0
  return gap * 1.05
}

function mustStop(lamp: Lamp, gap: number, speed: number): boolean {
  if (lamp === 'red') return true
  if (lamp === 'yellow') return gap > Math.max(4, speed * 0.6)
  return false
}

function followLimit(bus: BusSim, lane: Lane, byLane: Map<number, BusSim[]>, network: RoadNetwork): number {
  const list = byLane.get(bus.lane) ?? []
  for (const other of list) {
    if (other.dist <= bus.dist) continue
    const gap = other.dist - bus.dist
    if (gap < 24) return gap < BUS_LENGTH + 3 ? 0 : other.speed * 0.9
    break
  }
  if (lane.length - bus.dist > 18) return Infinity
  const nextId = lane.next[0] ?? lane.back
  const ahead = (byLane.get(nextId) ?? []).find((other) => other.dist < HALF + 8)
  if (!ahead) return Infinity
  const gap = lane.length - bus.dist + ahead.dist
  return gap < BUS_LENGTH + 2 ? 0 : network.lanes[nextId] ? ahead.speed : Infinity
}

function stopLimit(bus: BusSim, lane: Lane, file: BusFile): number {
  let gap = bus.nextStop - bus.dist
  if (gap < -3) {
    bus.nextStop = bus.dist + file.stopEvery
    gap = bus.nextStop - bus.dist
  }
  const nearSignal = lane.signal !== null && Math.abs(lane.stopAt - bus.dist) < 18
  if (nearSignal || lane.length - bus.nextStop < 22) return Infinity
  if (gap > 26) return Infinity
  if (gap < 1 && bus.speed < 0.45) {
    bus.dwell = file.dwell
    bus.nextStop = bus.dist + file.stopEvery
    return 0
  }
  return Math.max(0, gap) * 0.42
}

function someoneAhead(bus: BusSim, obstacles: { x: number; z: number; id?: string }[], peopleOnly: boolean): boolean {
  const fx = Math.sin(bus.yaw)
  const fz = Math.cos(bus.yaw)
  for (const obstacle of obstacles) {
    const car = obstacle.id?.startsWith('car:') === true
    if (peopleOnly && car) continue
    if (!peopleOnly && !car) continue
    const dx = obstacle.x - bus.x
    const dz = obstacle.z - bus.z
    const ahead = dx * fx + dz * fz
    const side = dx * fz - dz * fx
    const near = dx * dx + dz * dz
    if (obstacle.id === 'you' && near < 30 && ahead > -3) return true
    if (Math.abs(side) < 2.2 && ahead > -5 && ahead < 16 && (ahead > 0.4 || near < 36)) return true
  }
  return false
}

function chooseNext(lane: Lane, lanes: Lane[], rng: () => number): number {
  const major = lane.next.filter((id) => (lanes[id]?.rank ?? 0) >= 2)
  const options = major.length > 0 ? major : lane.next
  if (options.length === 0) return lane.back
  return options[Math.floor(rng() * options.length)] ?? lane.back
}
