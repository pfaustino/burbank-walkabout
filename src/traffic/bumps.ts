import { hitsBuilding, type CityLayout } from '../world/layout.ts'
import { BodyGrid, CAR_HALF_LENGTH, CAR_HALF_WIDTH, capsuleContact, type Disc } from './bodies.ts'
import type { CarSim } from './trafficSim.ts'

export type CarHit = {
  x: number
  z: number
  /** Closing speed along the contact, in meters per second. */
  impact: number
}

const REACH = CAR_HALF_LENGTH * 2 + 2
const SLOP = 0.04
const SPEED_MIN = -6
const SPEED_MAX = 22
const BODY = CAR_HALF_WIDTH + 0.1

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
    let slot = slots[i]
    if (!slot) {
      slot = { x: 0, z: 0, r: CAR_HALF_WIDTH, len: CAR_HALF_LENGTH, index: i }
      slots[i] = slot
    }
    slot.x = car.x
    slot.z = car.z
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
      const contact = capsuleContact(car.x, car.z, car.yaw, CAR_HALF_LENGTH, CAR_HALF_WIDTH, other)
      if (contact.gap >= -SLOP) return
      const { nx, nz } = contact
      let kick = 0
      if (impulses) kick = pushSpeeds(car, mate, nx, nz, restitution, hits)
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

function pushSpeeds(a: CarSim, b: CarSim, nx: number, nz: number, restitution: number, hits: CarHit[]): number {
  const vax = Math.sin(a.yaw) * a.speed
  const vaz = Math.cos(a.yaw) * a.speed
  const vbx = Math.sin(b.yaw) * b.speed
  const vbz = Math.cos(b.yaw) * b.speed
  const rel = (vax - vbx) * nx + (vaz - vbz) * nz
  if (rel >= -0.2) return 0
  const impulse = -(1 + restitution) * rel * 0.5
  a.speed = clamp(along(vax + impulse * nx, vaz + impulse * nz, a.yaw))
  b.speed = clamp(along(vbx - impulse * nx, vbz - impulse * nz, b.yaw))
  a.coast = 0.55
  b.coast = 0.55
  const impact = -rel
  hits.push({ x: (a.x + b.x) * 0.5, z: (a.z + b.z) * 0.5, impact })
  return Math.min(2.4, impact * 0.14)
}

function along(vx: number, vz: number, yaw: number): number {
  return vx * Math.sin(yaw) + vz * Math.cos(yaw)
}

function shove(car: CarSim, dx: number, dz: number, layout: CityLayout): void {
  if (dx === 0 && dz === 0) return
  let mx = dx
  let mz = dz
  if (hitsBuilding(layout, car.x + mx, car.z + mz, BODY)) {
    if (!hitsBuilding(layout, car.x + dx, car.z, BODY)) mz = 0
    else if (!hitsBuilding(layout, car.x, car.z + dz, BODY)) mx = 0
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
