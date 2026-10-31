import businessesJson from '../data/businesses.json'
import deliveryJson from '../data/delivery.json'
import mapJson from '../data/map.json'
import { deliveryPay, fareBreak, orderLine, parkedOn, planDelivery, planTaxi, taxiLine, taxiPay, type DeliveryFile } from '../src/delivery/orders.ts'
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

  it('waits up to ten seconds between fares', () => {
    expect(fareBreak(() => 0, file)).toBe(file.gapMin)
    expect(fareBreak(() => 1, file)).toBe(file.gapMax)
    expect(file.gapMin).toBe(0)
    expect(file.gapMax).toBe(10)
    const mid = fareBreak(() => 0.4, file)
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(10)
  })

  it('pays a bigger tip for a faster delivery', () => {
    const fast = deliveryPay(file.tipFast, file)
    const slow = deliveryPay(file.tipSlow, file)
    const mid = deliveryPay((file.tipFast + file.tipSlow) / 2, file)
    expect(fast.fare).toBe(file.fare)
    expect(fast.tip).toBe(file.tipMax)
    expect(slow.tip).toBe(file.tipMin)
    expect(mid.tip).toBeGreaterThan(slow.tip)
    expect(mid.tip).toBeLessThan(fast.tip)
    expect(fast.total).toBe(fast.fare + fast.tip)
    expect(deliveryPay(file.tipFast - 30, file).tip).toBe(file.tipMax)
    expect(deliveryPay(file.tipSlow + 40, file).tip).toBe(file.tipMin)
  })

  it('hails a ride that pays more than a delivery', () => {
    const ride = planTaxi(layout, network, spawn, createSeededRng(0xd45e), file)
    expect(ride).toBeTruthy()
    expect(taxiLine(ride!, 'pickup')).toBe(`${ride!.passenger} is waving for a ride`)
    expect(taxiLine(ride!, 'dropoff')).toBe(`Take ${ride!.passenger} to ${ride!.street}`)
    const trip = Math.hypot(ride!.dropoff.x - ride!.pickup.x, ride!.dropoff.z - ride!.pickup.z)
    expect(trip).toBeGreaterThan(file.minTrip - 1)
    const fast = taxiPay(file.tipFast, file)
    expect(fast.fare).toBeGreaterThan(file.fare)
    expect(fast.tip).toBe(file.taxiTipMax)
    expect(fast.total).toBeGreaterThan(deliveryPay(file.tipFast, file).total)
  })
})
