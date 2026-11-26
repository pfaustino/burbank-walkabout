import { hitsBuilding, type CityLayout } from '../world/layout.ts'
import { BodyGrid, capsuleContact, type Disc } from './bodies.ts'
import { vehicleHalf, type CarSim } from './trafficSim.ts'

export type CarHit = {
  x: number
  z: number
  /** Closing speed along the contact, in meters per second. */
  impact: number
}

const REACH = 8
const SLOP = 0.04
const SPEED_MIN = -6
const SPEED_MAX = 22
/** Tangential grip. A sideswipe drags the other car along the blow, not only on the normal. */
const MU = 0.55
const SLIDE_CAP = 16
const SPIN_INERTIA = 3.2
const SPIN_CAP = 6

type Slot = Disc & { index: number }

const grid = new BodyGrid()
const slots: Slot[] = []

/** Separate overlapping cars and share the hit so each one shoves the other. */
export function bumpCars(cars: CarSim[], layout: CityLayout, restitution: number): CarHit[] {
  const hits: CarHit[] = []
  separate(cars, layout, restitution, true, hits)
  separate(cars, layout, restitution, false, hits)
  return hits
}

function separate(cars: CarSim[], layout: CityLayout, restitution: number, impulses: boolean, hits: CarHit[]): void {
  grid.clear()
  for (let i = 0; i < cars.length; i++) {
    const car = cars[i]!
    const size = vehicleHalf(car.model)
    let slot = slots[i]
    if (!slot) {
      slot = { x: 0, z: 0, r: size.w, len: size.len, index: i }
      slots[i] = slot
    }
    slot.x = car.x
    slot.z = car.z
    slot.r = size.w
    slot.len = size.len
    slot.yaw = car.yaw
    slot.index = i
    grid.add(slot)
  }
  for (let i = 0; i < cars.length; i++) {
    const car = cars[i]!
    const self = slots[i]!
    grid.near(car.x, car.z, REACH, (found) => {
      const other = found as Slot
      if (other.index <= i) return
      const mate = cars[other.index]!
      const contact = capsuleContact(car.x, car.z, car.yaw, self.len ?? 0, self.r, other)
      if (contact.gap >= -SLOP) return
      const { nx, nz } = contact
      let kick = 0
      if (impulses) {
        kick = pushSpeeds(car, mate, contact, restitution, hits)
        throwDriver(car, layout)
        throwDriver(mate, layout)
      }
      const push = Math.max(0, -contact.gap) * 0.5 + kick
      shove(car, nx * push, nz * push, layout)
      shove(mate, -nx * push, -nz * push, layout)
      self.x = car.x
      self.z = car.z
      other.x = mate.x
      other.z = mate.z
    })
  }
}

function pushSpeeds(
  a: CarSim,
  b: CarSim,
  contact: { nx: number; nz: number; px: number; pz: number; qx: number; qz: number },
  restitution: number,
  hits: CarHit[],
): number {
  const { nx, nz, px, pz, qx, qz } = contact
  const vax = Math.sin(a.yaw) * a.speed
  const vaz = Math.cos(a.yaw) * a.speed
  const vbx = Math.sin(b.yaw) * b.speed
  const vbz = Math.cos(b.yaw) * b.speed
  const rel = (vax - vbx) * nx + (vaz - vbz) * nz
  if (rel >= -0.2) return 0
  const tx = -nz
  const tz = nx
  const relT = (vax - vbx) * tx + (vaz - vbz) * tz
  const jN = -(1 + restitution) * rel * 0.5
  const limit = MU * jN
  let jT = -relT * 0.5
  if (jT > limit) jT = limit
  else if (jT < -limit) jT = -limit
  const ix = jN * nx + jT * tx
  const iz = jN * nz + jT * tz
  a.speed = clamp(along(vax + ix, vaz + iz, a.yaw))
  b.speed = clamp(along(vbx - ix, vbz - iz, b.yaw))
  const impact = -rel
  const drama = 1 + Math.min(2.4, (impact * impact) / 160)
  giveSlide(a, ix, iz, drama)
  giveSlide(b, -ix, -iz, drama)
  giveSpin(a, px, pz, ix, iz, drama)
  giveSpin(b, qx, qz, -ix, -iz, drama)
  a.coast = 0.55
  b.coast = 0.55
  hits.push({ x: (a.x + b.x) * 0.5, z: (a.z + b.z) * 0.5, impact })
  return Math.min(3.2, impact * 0.07 * drama)
}

/** Keep the part of the hit that is not along the car's nose, and grow it with closing speed. */
function giveSlide(car: CarSim, dvx: number, dvz: number, drama: number): void {
  const fx = Math.sin(car.yaw)
  const fz = Math.cos(car.yaw)
  const forward = dvx * fx + dvz * fz
  let x = (car.slideX ?? 0) + (dvx - fx * forward) * drama
  let z = (car.slideZ ?? 0) + (dvz - fz * forward) * drama
  const mag = Math.hypot(x, z)
  if (mag > SLIDE_CAP) {
    x *= SLIDE_CAP / mag
    z *= SLIDE_CAP / mag
  }
  car.slideX = x
  car.slideZ = z
}

/** Turn the car with an off-center blow. The rate is the moment of the velocity change. */
function giveSpin(car: CarSim, cx: number, cz: number, dvx: number, dvz: number, drama: number): void {
  const rx = cx - car.x
  const rz = cz - car.z
  const yawRate = ((rz * dvx - rx * dvz) * drama) / SPIN_INERTIA
  const bite = Math.max(-0.85, Math.min(0.85, yawRate * 0.16))
  if (car.driver) {
    car.yaw += bite
    car.spin = 0
    car.yawOff = 0
    return
  }
  const spin = Math.max(-SPIN_CAP, Math.min(SPIN_CAP, (car.spin ?? 0) + yawRate))
  const yawOff = Math.max(-1.25, Math.min(1.25, (car.yawOff ?? 0) + bite))
  car.spin = spin
  car.yawOff = yawOff
  car.yaw += bite
}

/** The driven car is not pulled back onto a lane, so spend the sideways velocity now. */
function throwDriver(car: CarSim, layout: CityLayout): void {
  if (!car.driver) return
  let dx = (car.slideX ?? 0) * 0.22
  let dz = (car.slideZ ?? 0) * 0.22
  const mag = Math.hypot(dx, dz)
  if (mag > 3.6) {
    const scale = 3.6 / mag
    dx *= scale
    dz *= scale
  }
  shove(car, dx, dz, layout)
  car.slideX = 0
  car.slideZ = 0
  car.spin = 0
  car.yawOff = 0
}

function along(vx: number, vz: number, yaw: number): number {
  return vx * Math.sin(yaw) + vz * Math.cos(yaw)
}

function shove(car: CarSim, dx: number, dz: number, layout: CityLayout): void {
  if (dx === 0 && dz === 0) return
  let mx = dx
  let mz = dz
  const body = vehicleHalf(car.model).w + 0.1
  if (hitsBuilding(layout, car.x + mx, car.z + mz, body)) {
    if (!hitsBuilding(layout, car.x + dx, car.z, body)) mz = 0
    else if (!hitsBuilding(layout, car.x, car.z + dz, body)) mx = 0
    else return
  }
  if (car.driver) {
    car.x += mx
    car.z += mz
    return
  }
  const fx = Math.sin(car.yaw)
  const fz = Math.cos(car.yaw)
  const forward = mx * fx + mz * fz
  car.dist += forward
  car.knockX = (car.knockX ?? 0) + (mx - fx * forward)
  car.knockZ = (car.knockZ ?? 0) + (mz - fz * forward)
  car.x += mx
  car.z += mz
}

function clamp(speed: number): number {
  return Math.max(SPEED_MIN, Math.min(SPEED_MAX, speed))
}
