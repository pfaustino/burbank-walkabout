import { BodyGrid, CAR_HALF_LENGTH, CAR_HALF_WIDTH, overlapsCapsule, type Disc } from './bodies.ts'
import type { Lamp, Lane, RoadNetwork } from './network.ts'
import { lamps, nearestOnLane, sampleLane } from './network.ts'

export type CarModel = 'sedan' | 'suv' | 'sport' | 'taxi'

export type CarSim = {
  id: string
  model: CarModel
  color: string
  lane: number
  dist: number
  speed: number
  x: number
  z: number
  yaw: number
  driver: string | null
  /** Seconds spent stopped off a red light. High values get to creep through a jam. */
  wait?: number
  /** Seconds the post-hit speed is allowed to carry the car down the lane. */
  coast?: number
  /** Sideways shove left over from a bump, in meters. It fades back onto the lane. */
  knockX?: number
  knockZ?: number
  /** Seconds left on a cut-off honk. Fresh values are above 1.4. */
  horn?: number
}

/** True when a driven car is close in front and this car should brake and honk. */
export function cutsOff(ahead: number, side: number, speed: number, half: number): boolean {
  return speed > 3 && ahead > 0.5 && ahead < 10 && Math.abs(side) < half + 1.5
}

export type TrafficFile = {
  count: number
  /** How many of those cars stay near the player. The rest remain out in the city. */
  nearby: number
  cruise: number
  green: number
  yellow: number
  enterRange: number
  driveMax: number
  driveBoost: number
  /** Share of a hit that bounces back. 0 is a dead shove, 1 is a full bounce. */
  restitution: number
  /** Closing speed, in meters per second, that plays a crunch. */
  crunch: number
  colors: string[]
}

const MODELS: CarModel[] = ['sedan', 'suv', 'sport', 'taxi', 'sedan']
const trafficGrid = new BodyGrid()
const bodyPool: Body[] = []

type Body = Disc & { priority: boolean; order: number; wait: number }

const PATIENCE = 3

export function createTraffic(network: RoadNetwork, file: TrafficFile, rng: () => number): CarSim[] {
  const cars: CarSim[] = []
  const lanes = network.lanes.filter((lane) => lane.length > 40)
  if (lanes.length === 0) return cars
  const nextDist = lanes.map(() => 16 + rng() * 24)
  let placed = true
  while (cars.length < file.count && placed) {
    placed = false
    for (let i = 0; i < lanes.length && cars.length < file.count; i++) {
      const lane = lanes[i]!
      let dist = nextDist[i] ?? lane.length
      const gap = 40 + rng() * 22
      while (dist < lane.length - 16 && lane.signal !== null && dist > lane.stopAt - 12 && dist < lane.stopAt + 6) dist += 8
      if (dist >= lane.length - 16) {
        nextDist[i] = lane.length
        continue
      }
      const model = MODELS[Math.floor(rng() * MODELS.length)] ?? 'sedan'
      const spot = sampleLane(lane, dist)
      cars.push({
        id: `c${cars.length + 1}`,
        model,
        color: model === 'taxi' ? '#f2c21a' : file.colors[Math.floor(rng() * file.colors.length)] ?? '#2457c5',
        lane: lane.id,
        dist,
        speed: file.cruise * (0.85 + rng() * 0.2),
        x: spot.x,
        z: spot.z,
        yaw: spot.yaw,
        driver: null,
      })
      nextDist[i] = dist + gap
      placed = true
    }
  }
  return cars
}

/** Move driverless cars that have fallen far behind the player onto a lane nearby, until `cap` are close. */
export function gatherTraffic(
  cars: CarSim[],
  network: RoadNetwork,
  x: number,
  z: number,
  reach: number,
  rng: () => number,
  cap: number,
): void {
  const lanes = network.lanes.filter((lane) => lane.length > 40)
  if (lanes.length === 0 || cap < 1) return
  const reach2 = reach * reach
  let nearby = 0
  for (const car of cars) {
    if (car.driver) continue
    const dx = car.x - x
    const dz = car.z - z
    if (dx * dx + dz * dz < reach2) nearby++
  }
  if (nearby >= cap) return
  const keep = reach * 0.72
  for (const car of cars) {
    if (nearby >= cap) break
    if (car.driver) continue
    const dx = car.x - x
    const dz = car.z - z
    if (dx * dx + dz * dz < reach2) continue
    for (let attempt = 0; attempt < 12; attempt++) {
      const lane = lanes[Math.floor(rng() * lanes.length)]
      if (!lane) continue
      const dist = 16 + rng() * Math.max(0, lane.length - 32)
      const spot = sampleLane(lane, dist)
      if (Math.hypot(spot.x - x, spot.z - z) > keep) continue
      const crowded = cars.some((other) => other !== car && other.lane === lane.id && Math.abs(other.dist - dist) < 28)
      if (crowded) continue
      car.lane = lane.id
      car.dist = dist
      car.x = spot.x
      car.z = spot.z
      car.yaw = spot.yaw
      car.knockX = 0
      car.knockZ = 0
      nearby++
      break
    }
  }
}

export function parkOnLane(car: CarSim, network: RoadNetwork): void {
  const spot = nearestOnLane(network.lanes, car.x, car.z)
  const lane = network.lanes[spot.lane]
  if (!lane) return
  const pose = sampleLane(lane, spot.dist)
  car.lane = lane.id
  car.dist = spot.dist
  car.x = pose.x
  car.z = pose.z
  car.yaw = pose.yaw
  car.speed = 0
  car.driver = null
}

export function stepTraffic(
  cars: CarSim[],
  network: RoadNetwork,
  file: TrafficFile,
  time: number,
  dt: number,
  rng: () => number,
  obstacles: readonly Disc[],
): void {
  const phase = lamps(time, file.green, file.yellow)
  const byLane = new Map<number, CarSim[]>()
  trafficGrid.clear()
  for (let i = 0; i < cars.length; i++) {
    const car = cars[i]!
    const body = takeBody(i)
    body.x = car.x
    body.z = car.z
    body.r = CAR_HALF_WIDTH
    body.len = CAR_HALF_LENGTH
    body.yaw = car.yaw
    body.id = car.id
    body.priority = car.driver !== null
    body.order = i
    body.wait = car.wait ?? 0
    trafficGrid.add(body)
    if (car.driver) continue
    const list = byLane.get(car.lane) ?? []
    list.push(car)
    byLane.set(car.lane, list)
  }
  for (let i = 0; i < obstacles.length; i++) {
    const obstacle = obstacles[i]!
    const body = takeBody(cars.length + i)
    body.x = obstacle.x
    body.z = obstacle.z
    body.r = obstacle.r
    body.len = obstacle.len
    body.yaw = obstacle.yaw
    body.id = obstacle.id
    body.priority = true
    body.order = -1
    body.wait = 0
    trafficGrid.add(body)
  }
  for (const list of byLane.values()) list.sort((a, b) => a.dist - b.dist)

  for (let i = 0; i < cars.length; i++) {
    const car = cars[i]!
    if (car.driver) continue
    if ((car.horn ?? 0) > 0) car.horn = Math.max(0, (car.horn ?? 0) - dt)
    const self = bodyPool[i]!
    const lane = network.lanes[car.lane]
    if (!lane) continue
    let desired = file.cruise
    const lamp = lane.axis === 'ew' ? phase.ew : phase.ns
    desired = Math.min(desired, lightSpeed(lane, car, lamp))
    desired = Math.min(desired, followSpeed(car, lane, byLane, network))
    let hard = yieldStop(car, self, trafficGrid, (speed) => {
      desired = Math.min(desired, speed)
    })
    if ((car.wait ?? 0) > PATIENCE) desired = Math.min(desired, 4.5)
    const holdAt = junctionHold(lane)
    if (car.dist > holdAt - 24 && !hasClearExit(lane, cars)) {
      const holdGap = holdAt - car.dist
      desired = Math.min(desired, holdGap < 1.1 ? 0 : holdGap * 1.15)
    }
    if ((car.coast ?? 0) > 0) {
      car.coast = Math.max(0, (car.coast ?? 0) - dt)
      hard = false
      desired = Math.max(desired, car.speed)
    } else if (hard) desired = 0
    const rate = desired >= car.speed ? 7 : 14
    const step = rate * dt
    car.speed += Math.max(-step, Math.min(step, desired - car.speed))
    if (car.speed < 0.05) car.speed = 0
    const gap = lane.stopAt - car.dist
    const holding = lane.signal !== null && mustStop(lamp, gap, car.speed) && gap < 0.8
    let nextLane = car.lane
    let nextDist = car.dist
    if (!holding && !hard) nextDist += car.speed * dt
    if (nextDist >= lane.length - 0.05) {
      const overflow = nextDist - lane.length
      const exit = chooseNext(lane, network.lanes, rng, cars)
      if (exit === null) {
        nextLane = car.lane
        nextDist = car.dist > holdAt ? car.dist : Math.min(nextDist, holdAt)
        car.speed = 0
      } else {
        nextLane = exit
        nextDist = Math.max(0, overflow)
      }
    }
    const moved = nextLane !== car.lane || nextDist !== car.dist
    const pose = sampleLane(network.lanes[nextLane] ?? lane, moved ? nextDist : car.dist)
    const blocked = moved && poseHits(pose.x, pose.z, pose.yaw, self, trafficGrid)
    if (blocked) {
      car.speed = 0
      const stay = sampleLane(lane, car.dist)
      car.x = stay.x
      car.z = stay.z
      car.yaw = stay.yaw
    } else {
      car.lane = nextLane
      car.dist = nextDist
      car.x = pose.x
      car.z = pose.z
      car.yaw = pose.yaw
    }
    const redWait = lane.signal !== null && mustStop(lamp, gap, 0) && gap < 22 && gap > -1.5
    if (redWait) car.wait = 0
    else if (hard || blocked || car.speed < 0.25) car.wait = (car.wait ?? 0) + dt
    else car.wait = Math.max(0, (car.wait ?? 0) - dt)
    fadeKnock(car, dt)
    self.x = car.x
    self.z = car.z
    self.yaw = car.yaw
    self.wait = car.wait ?? 0
  }
}

function fadeKnock(car: CarSim, dt: number): void {
  const fade = Math.exp(-3.2 * dt)
  let kx = (car.knockX ?? 0) * fade
  let kz = (car.knockZ ?? 0) * fade
  if (Math.abs(kx) < 0.04) kx = 0
  if (Math.abs(kz) < 0.04) kz = 0
  car.knockX = kx
  car.knockZ = kz
  car.x += kx
  car.z += kz
}

function lightSpeed(lane: Lane, car: CarSim, lamp: Lamp): number {
  if (lane.signal === null) return Infinity
  const gap = lane.stopAt - car.dist
  if (gap < -1.5 || gap > 26) return Infinity
  if (!mustStop(lamp, gap, car.speed)) return Infinity
  if (gap < 1.1) return 0
  return Math.min(lane.length, gap * 1.15)
}

function mustStop(lamp: Lamp, gap: number, speed: number): boolean {
  if (lamp === 'red') return true
  if (lamp === 'yellow') return gap > Math.max(3.5, speed * 0.55)
  return false
}

function followSpeed(car: CarSim, lane: Lane, byLane: Map<number, CarSim[]>, network: RoadNetwork): number {
  const list = byLane.get(car.lane) ?? []
  for (const other of list) {
    if (other === car || other.dist <= car.dist) continue
    const gap = other.dist - car.dist
    if (gap < 16) {
      if (gap < 6.5) return (car.wait ?? 0) > PATIENCE && (other.wait ?? 0) > PATIENCE ? 3 : 0
      return other.speed * 0.92
    }
    break
  }
  if (lane.length - car.dist > 14) return Infinity
  const nextId = lane.next[0] ?? lane.back
  const ahead = (byLane.get(nextId) ?? []).find((other) => other.dist < 8)
  if (!ahead) return Infinity
  const gap = lane.length - car.dist + ahead.dist
  if ((car.wait ?? 0) > PATIENCE && ahead.speed < 0.3) return 3
  return gap < 7 ? 0 : network.lanes[nextId] ? ahead.speed : Infinity
}

function yieldStop(car: CarSim, self: Body, grid: BodyGrid, slow: (speed: number) => void): boolean {
  let hard = false
  grid.near(car.x, car.z, 14, (other) => {
    if (other === self || hard) return
    const body = other as Body
    const dx = body.x - car.x
    const dz = body.z - car.z
    const fx = Math.sin(car.yaw)
    const fz = Math.cos(car.yaw)
    const ahead = dx * fx + dz * fz
    const side = dx * fz - dz * fx
    const otherLen = body.len ?? 0
    const stopLine = CAR_HALF_LENGTH + otherLen + 1.2
    const reach = stopLine + 3.4
    const half = CAR_HALF_WIDTH + body.r + 0.25
    const overlap = overlapsCapsule(car.x, car.z, car.yaw, CAR_HALF_LENGTH, CAR_HALF_WIDTH, body)
    const close = ahead > 0.35 && ahead < reach && Math.abs(side) < half
    if (body.priority && body.order >= 0 && cutsOff(ahead, side, car.speed, half)) {
      if ((car.horn ?? 0) <= 0) car.horn = 1.8
      if (ahead < 4.5) hard = true
      else slow(Math.max(0, (ahead - stopLine) * 0.35))
    }
    const boarding = body.id === 'you' && ahead > -CAR_HALF_LENGTH && dx * dx + dz * dz < 13
    if (!overlap && !close && !boarding) return
    if (boarding) {
      hard = true
      return
    }
    const stacked = overlap && ahead < 1.2
    const theyYield = yieldsTo(self, body, dx, dz, stacked)
    if (overlap || (ahead < stopLine && !theyYield)) {
      if (!theyYield) hard = true
      return
    }
    if (theyYield) return
    slow(Math.max(0, ahead - stopLine))
  })
  return hard
}

/** The other AI car should wait. Same-direction followers still wait, unless both have been stuck. */
function yieldsTo(self: Body, other: Body, dx: number, dz: number, stacked: boolean): boolean {
  if (other.priority) return false
  const cross = crossing(self, other)
  const follower = !stacked && following(self, other, dx, dz)
  const bothStuck = self.wait > PATIENCE && other.wait > PATIENCE
  if (follower && !cross && !bothStuck) return false
  if (bothStuck && (cross || follower)) return true
  if (self.wait > PATIENCE && cross && self.wait + 0.05 >= other.wait) return true
  if (follower) return false
  return other.order > self.order
}

function crossing(self: Body, other: Body): boolean {
  const ay = self.yaw ?? 0
  const by = other.yaw ?? ay
  return Math.sin(ay) * Math.sin(by) + Math.cos(ay) * Math.cos(by) < 0.7
}

/** True when the other body is ahead of us, so this car is the follower. */
function following(self: Body, other: Body, dx: number, dz: number): boolean {
  const yaw = other.yaw ?? self.yaw ?? 0
  const theirAhead = -dx * Math.sin(yaw) - dz * Math.cos(yaw)
  return theirAhead <= 0.35
}

function poseHits(x: number, z: number, yaw: number, self: Body, grid: BodyGrid): boolean {
  let hit = false
  const fx = Math.sin(yaw)
  const fz = Math.cos(yaw)
  grid.near(x, z, 14, (other) => {
    if (hit || other === self) return
    const body = other as Body
    if (!overlapsCapsule(x, z, yaw, CAR_HALF_LENGTH, CAR_HALF_WIDTH, body)) return
    const dx = body.x - x
    const dz = body.z - z
    const ahead = dx * fx + dz * fz
    if (yieldsTo(self, body, dx, dz, ahead < 1.2)) return
    hit = true
  })
  return hit
}

function takeBody(index: number): Body {
  let body = bodyPool[index]
  if (!body) {
    body = { x: 0, z: 0, r: 0, priority: false, order: 0, wait: 0 }
    bodyPool[index] = body
  }
  return body
}

/** Stop short of the crossing, at the light if there is one. */
function junctionHold(lane: Lane): number {
  if (lane.signal !== null) return lane.stopAt
  return Math.max(8, lane.length - 10)
}

/** True when a car could leave the crossing onto this lane instead of sitting in it. */
function exitClear(laneId: number, cars: readonly CarSim[]): boolean {
  for (const other of cars) {
    if (other.lane !== laneId) continue
    if (other.dist < 16 && other.speed < 1.5) return false
  }
  return true
}

function hasClearExit(lane: Lane, cars: readonly CarSim[]): boolean {
  const options = lane.next.length > 0 ? lane.next : [lane.back]
  return options.some((id) => id !== lane.id && exitClear(id, cars))
}

function chooseNext(lane: Lane, lanes: Lane[], rng: () => number, cars: readonly CarSim[]): number | null {
  const heading = endHeading(lane)
  const scored = lane.next.map((id) => {
    const next = lanes[id]
    const start = next ? startHeading(next) : heading
    return { id, dot: heading.x * start.x + heading.z * start.z }
  })
  const usable = scored.filter((item) => item.dot > -0.15)
  const pool = (usable.length > 0 ? usable : scored).filter((item) => exitClear(item.id, cars))
  if (pool.length === 0) return lane.back !== lane.id && exitClear(lane.back, cars) ? lane.back : null
  let best = pool[0]!
  let bestScore = -10
  for (const item of pool) {
    const score = item.dot + rng() * 0.45
    if (score > bestScore) {
      bestScore = score
      best = item
    }
  }
  return best.id
}

function endHeading(lane: Lane): { x: number; z: number } {
  const a = lane.pts[Math.max(0, lane.pts.length - 2)]!
  const b = lane.pts[lane.pts.length - 1]!
  const len = Math.hypot(b.x - a.x, b.z - a.z) || 1
  return { x: (b.x - a.x) / len, z: (b.z - a.z) / len }
}

function startHeading(lane: Lane): { x: number; z: number } {
  const a = lane.pts[0]!
  const b = lane.pts[Math.min(1, lane.pts.length - 1)]!
  const len = Math.hypot(b.x - a.x, b.z - a.z) || 1
  return { x: (b.x - a.x) / len, z: (b.z - a.z) / len }
}
