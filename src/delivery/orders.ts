import type { RoadNetwork } from '../traffic/network.ts'
import { nearestOnLane, sampleLane } from '../traffic/network.ts'
import { hitsBuilding, type CityLayout, type MapBuilding } from '../world/layout.ts'
import type { Business } from '../world/storefronts.ts'

export type DeliveryFile = {
  haloRadius: number
  parkSpeed: number
  minPickup: number
  maxPickup: number
  minTrip: number
  maxTrip: number
  roadReach: number
  houseHeight: number
  gap: number
  fare: number
  tipMin: number
  tipMax: number
  /** Seconds or faster pays the full tip. */
  tipFast: number
  /** Seconds or slower pays the smallest tip. */
  tipSlow: number
  kinds: string[]
  customers: string[]
}

export type Spot = { x: number; z: number }

export type DeliveryOrder = {
  customer: string
  business: string
  pickup: Spot
  dropoff: Spot
}

export type DropPhase = 'pickup' | 'dropoff'

export function orderLine(order: DeliveryOrder, phase: DropPhase): string {
  if (phase === 'pickup') return `Order for ${order.customer} at ${order.business}`
  return `Deliver to ${order.customer}`
}

/** Fare plus a tip. The tip is the max at tipFast seconds and the min at tipSlow. */
export function deliveryPay(seconds: number, file: DeliveryFile): { fare: number; tip: number; total: number } {
  const span = Math.max(1, file.tipSlow - file.tipFast)
  const rush = Math.max(0, Math.min(1, (file.tipSlow - seconds) / span))
  const tip = Math.round(file.tipMin + (file.tipMax - file.tipMin) * rush)
  return { fare: file.fare, tip, total: file.fare + tip }
}

/** Stopped in a car, inside the halo. Driving through does not count. */
export function parkedOn(
  driving: boolean,
  speed: number,
  x: number,
  z: number,
  spot: Spot,
  radius: number,
  parkSpeed: number,
): boolean {
  if (!driving || Math.abs(speed) > parkSpeed) return false
  return Math.hypot(x - spot.x, z - spot.z) <= radius
}

export function curbPoint(network: RoadNetwork, layout: CityLayout, x: number, z: number, reach: number): Spot | null {
  if (network.lanes.length === 0) return null
  const hit = nearestOnLane(network.lanes, x, z)
  const lane = network.lanes[hit.lane]
  if (!lane) return null
  const spot = sampleLane(lane, hit.dist)
  if (Math.hypot(spot.x - x, spot.z - z) > reach) return null
  if (hitsBuilding(layout, spot.x, spot.z, 1.2)) return null
  return { x: spot.x, z: spot.z }
}

export function planDelivery(
  layout: CityLayout,
  network: RoadNetwork,
  businesses: readonly Business[],
  player: Spot,
  rng: () => number,
  file: DeliveryFile,
  avoidCustomer = '',
): DeliveryOrder | null {
  const kinds = new Set(file.kinds)
  const shops = businesses.filter((business) => kinds.has(business.kind) && usableName(business.name))
  const near = shops.filter((business) => {
    const dist = Math.hypot(business.x - player.x, business.z - player.z)
    return dist >= file.minPickup && dist <= file.maxPickup
  })
  shuffle(near, rng)
  const houses = residential(layout, businesses, file.houseHeight)
  const tries = Math.min(near.length, 10)
  for (let i = 0; i < tries; i++) {
    const business = near[i]!
    const pickup = curbPoint(network, layout, business.x, business.z, file.roadReach)
    if (!pickup) continue
    const dropoff = houseSpot(houses, pickup, network, layout, rng, file)
    if (!dropoff) continue
    return {
      customer: pickName(file.customers, rng, avoidCustomer),
      business: business.name.trim(),
      pickup,
      dropoff,
    }
  }
  return null
}

function houseSpot(
  houses: readonly MapBuilding[],
  pickup: Spot,
  network: RoadNetwork,
  layout: CityLayout,
  rng: () => number,
  file: DeliveryFile,
): Spot | null {
  const band: MapBuilding[] = []
  for (const house of houses) {
    const center = buildingCenter(house)
    const dist = Math.hypot(center.x - pickup.x, center.z - pickup.z)
    if (dist < file.minTrip || dist > file.maxTrip) continue
    band.push(house)
  }
  shuffle(band, rng)
  const tries = Math.min(band.length, 16)
  for (let i = 0; i < tries; i++) {
    const center = buildingCenter(band[i]!)
    const spot = curbPoint(network, layout, center.x, center.z, file.roadReach)
    if (!spot) continue
    const trip = Math.hypot(spot.x - pickup.x, spot.z - pickup.z)
    if (trip < file.minTrip || trip > file.maxTrip) continue
    return spot
  }
  return null
}

function residential(layout: CityLayout, businesses: readonly Business[], maxHeight: number): MapBuilding[] {
  const houses: MapBuilding[] = []
  for (const building of layout.buildings) {
    if (building.h > maxHeight) continue
    const width = building.maxX - building.minX
    const depth = building.maxZ - building.minZ
    if (width < 6 || depth < 6 || width * depth > 900) continue
    if (hostsShop(building, businesses)) continue
    houses.push(building)
  }
  return houses
}

function hostsShop(building: MapBuilding, businesses: readonly Business[]): boolean {
  for (const business of businesses) {
    if (business.x < building.minX - 1 || business.x > building.maxX + 1) continue
    if (business.z < building.minZ - 1 || business.z > building.maxZ + 1) continue
    return true
  }
  return false
}

function buildingCenter(building: MapBuilding): Spot {
  return { x: (building.minX + building.maxX) / 2, z: (building.minZ + building.maxZ) / 2 }
}

function usableName(name: string): boolean {
  const trimmed = name.trim()
  if (trimmed.length < 3) return false
  return !/^\d+$/.test(trimmed)
}

function pickName(names: readonly string[], rng: () => number, avoid: string): string {
  if (names.length === 0) return 'A neighbor'
  if (names.length === 1) return names[0]!
  for (let i = 0; i < 6; i++) {
    const name = names[Math.floor(rng() * names.length)] ?? names[0]!
    if (name !== avoid) return name
  }
  return names[0]!
}

function shuffle<T>(items: T[], rng: () => number): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const swap = items[i]!
    items[i] = items[j]!
    items[j] = swap
  }
}
