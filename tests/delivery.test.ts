import businessesJson from '../data/businesses.json'
import deliveryJson from '../data/delivery.json'
import mapJson from '../data/map.json'
import { orderLine, parkedOn, planDelivery, type DeliveryFile } from '../src/delivery/orders.ts'
import { buildNetwork } from '../src/traffic/network.ts'
import { createSeededRng } from '../src/util/seededRng.ts'
import { hitsBuilding, buildLayout, type MapFile } from '../src/world/layout.ts'
import type { Business } from '../src/world/storefronts.ts'
import { describe, expect, it } from 'vitest'

const file = deliveryJson as DeliveryFile
const layout = buildLayout(mapJson as MapFile)
const network = buildNetwork(layout)
const businesses = businessesJson as Business[]
const spawn = layout.file.spawn

describe('delivery orders', () => {
  it('names the pickup and then the customer', () => {
    const order = {
      customer: 'June Alvarez',
      business: 'Ameci Pizza',
      pickup: { x: 0, z: 0 },
      dropoff: { x: 10, z: 0 },
    }
    expect(orderLine(order, 'pickup')).toBe('Order for June Alvarez at Ameci Pizza')
    expect(orderLine(order, 'dropoff')).toBe('Deliver to June Alvarez')
  })

  it('completes only when a car is stopped inside the halo', () => {
    const spot = { x: 4, z: 8 }
    expect(parkedOn(true, 0.2, 4.4, 8.2, spot, file.haloRadius, file.parkSpeed)).toBe(true)
    expect(parkedOn(true, 12, 4, 8, spot, file.haloRadius, file.parkSpeed)).toBe(false)
    expect(parkedOn(false, 0, 4, 8, spot, file.haloRadius, file.parkSpeed)).toBe(false)
    expect(parkedOn(true, 0, 20, 8, spot, file.haloRadius, file.parkSpeed)).toBe(false)
  })

  it('sends a downtown order from a restaurant to a house', () => {
    const order = planDelivery(layout, network, businesses, spawn, createSeededRng(0xd45e), file)
    expect(order).toBeTruthy()
    expect(order!.customer.length).toBeGreaterThan(3)
    expect(order!.business.length).toBeGreaterThan(3)
    expect(orderLine(order!, 'pickup')).toBe(`Order for ${order!.customer} at ${order!.business}`)
    const trip = Math.hypot(order!.dropoff.x - order!.pickup.x, order!.dropoff.z - order!.pickup.z)
    expect(trip).toBeGreaterThanOrEqual(file.minTrip)
    expect(trip).toBeLessThanOrEqual(file.maxTrip)
    expect(hitsBuilding(layout, order!.pickup.x, order!.pickup.z, 1)).toBe(false)
    expect(hitsBuilding(layout, order!.dropoff.x, order!.dropoff.z, 1)).toBe(false)
    const fromDoor = Math.hypot(order!.pickup.x - spawn.x, order!.pickup.z - spawn.z)
    expect(fromDoor).toBeGreaterThan(20)
  })
})
