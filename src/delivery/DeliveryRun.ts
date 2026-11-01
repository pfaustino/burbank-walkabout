import * as THREE from 'three'
import { createFigure, type Figure } from '../actors/figure.ts'
import { shirtForName } from '../net/protocol.ts'
import type { RoadNetwork } from '../traffic/network.ts'
import type { Hud } from '../ui/Hud.ts'
import type { CityLayout } from '../world/layout.ts'
import type { Business } from '../world/storefronts.ts'
import {
  deliveryPay,
  fareBreak,
  formatDistance,
  orderLine,
  parkedOn,
  planDelivery,
  planTaxi,
  taxiLine,
  taxiPay,
  type DeliveryFile,
  type DeliveryOrder,
  type DropPhase,
  type Spot,
  type TaxiRide,
} from './orders.ts'
import { buildRoute, cueOnRoute, routeLine, type RoadCue, type RoadRoute } from './route.ts'

const PICKUP = 0xffc107
const DROPOFF = 0x3ddc84
const HAIL = 0x3d9eff

export class DeliveryRun {
  private order: DeliveryOrder | null = null
  private ride: TaxiRide | null = null
  private passenger: Figure | null = null
  private wantTaxi = true
  private deliveries = true
  private fares = true
  private lastCustomer = ''
  private phase: DropPhase | 'gap' = 'gap'
  private wait = 0.6
  private readonly arrow: THREE.Group
  private readonly arrowStraight: THREE.Group
  private readonly arrowBend: THREE.Group
  private readonly arrowFace: THREE.MeshBasicMaterial
  private route: RoadRoute | null = null
  private routeCursor = 0
  private routeKey = ''
  private routeTime = 1
  private trailRoute: RoadRoute | null = null
  private trailPoints: { x: number; z: number }[] = []
  private readonly halo: THREE.Group
  private readonly haloMats: THREE.MeshBasicMaterial[]
  private spin = 0
  private elapsed = 0
  private readonly scene: THREE.Scene
  private readonly layout: CityLayout
  private readonly network: RoadNetwork
  private readonly businesses: readonly Business[]
  private readonly hud: Hud
  private readonly rng: () => number
  private readonly file: DeliveryFile

  constructor(
    scene: THREE.Scene,
    layout: CityLayout,
    network: RoadNetwork,
    businesses: readonly Business[],
    hud: Hud,
    rng: () => number,
    file: DeliveryFile,
  ) {
    this.scene = scene
    this.layout = layout
    this.network = network
    this.businesses = businesses
    this.hud = hud
    this.rng = rng
    this.file = file
    this.arrowFace = new THREE.MeshBasicMaterial({
      color: PICKUP,
      fog: false,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    const arrow = buildArrow(this.arrowFace)
    this.arrow = arrow.group
    this.arrowStraight = arrow.straight
    this.arrowBend = arrow.bend
    this.arrow.visible = false
    this.haloMats = [
      new THREE.MeshBasicMaterial({ color: PICKUP, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }),
      new THREE.MeshBasicMaterial({ color: PICKUP, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false }),
      new THREE.MeshBasicMaterial({ color: PICKUP, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }),
    ]
    this.halo = buildHalo(this.haloMats)
    this.halo.visible = false
    this.scene.add(this.arrow, this.halo)
  }

  /** Turn each kind of job on or off. A job already on screen drops when its kind is turned off. */
  setModes(deliveries: boolean, fares: boolean): void {
    this.deliveries = deliveries
    this.fares = fares
    const dropDelivery = this.order !== null && !deliveries
    const dropFare = this.ride !== null && !fares
    if (dropDelivery || dropFare) {
      this.order = null
      this.ride = null
      this.clearPassenger()
      this.phase = 'gap'
      this.elapsed = 0
      this.hide()
      this.hud.setOrder(null)
    }
    if (this.phase === 'gap' && (deliveries || fares)) this.wait = 0
  }

  /** The drive drawn on the maps. Empty while no job is on screen. */
  get trail(): { points: readonly { x: number; z: number }[]; dropoff: boolean } | null {
    if (this.phase === 'gap' || !this.route) return null
    if (this.trailRoute !== this.route) {
      this.trailRoute = this.route
      this.trailPoints = routeLine(this.network.lanes, this.route)
    }
    return { points: this.trailPoints, dropoff: this.phase === 'dropoff' }
  }

  get marker(): { x: number; z: number; dropoff: boolean } | null {
    const spot = this.goal()
    if (!spot || (!this.order && !this.ride)) return null
    return { x: spot.x, z: spot.z, dropoff: this.phase === 'dropoff' }
  }

  update(dt: number, pose: { x: number; z: number; driving: boolean; speed: number }): void {
    this.spin += dt
    if (this.phase !== 'gap') this.elapsed += dt
    if (this.phase === 'gap') {
      this.wait -= dt
      this.hide()
      if (this.wait <= 0 && (this.deliveries || this.fares)) this.offer(pose)
      return
    }
    const spot = this.goal()
    if ((!this.order && !this.ride) || !spot) return
    this.placeCue(dt, pose.x, pose.z, spot, pose.speed)
    this.wave(dt, pose.x, pose.z)
    if (!parkedOn(pose.driving, pose.speed, pose.x, pose.z, spot, this.file.haloRadius, this.file.parkSpeed)) return
    if (this.phase === 'pickup') {
      this.phase = 'dropoff'
      this.clearPassenger()
      if (this.ride) this.showRide(this.ride, 'dropoff')
      else if (this.order) this.show(this.order, 'dropoff')
      return
    }
    const pay = this.ride ? taxiPay(this.elapsed, this.file) : deliveryPay(this.elapsed, this.file)
    this.hud.addPay(pay.fare, pay.tip)
    this.order = null
    this.ride = null
    this.phase = 'gap'
    this.wait = fareBreak(this.rng, this.file)
    this.elapsed = 0
    this.hide()
    this.hud.setOrder(null)
  }

  dispose(): void {
    this.clearPassenger()
    this.scene.remove(this.arrow, this.halo)
    disposeDrawn(this.arrow)
    disposeDrawn(this.halo)
  }

  private offer(pose: Spot): void {
    const taxiFirst = this.fares && this.deliveries ? this.wantTaxi : this.fares
    if (this.fares && this.deliveries) this.wantTaxi = !this.wantTaxi
    if (taxiFirst && this.tryTaxi(pose)) return
    if (this.deliveries && this.tryDelivery(pose)) return
    if (!taxiFirst && this.fares && this.tryTaxi(pose)) return
    this.wait = 2
  }

  private tryTaxi(pose: Spot): boolean {
    const ride = planTaxi(this.layout, this.network, pose, this.rng, this.file, this.lastCustomer)
    if (!ride) return false
    this.order = null
    this.ride = ride
    this.lastCustomer = ride.passenger
    this.phase = 'pickup'
    this.elapsed = 0
    this.showRide(ride, 'pickup')
    this.seatPassenger(ride)
    return true
  }

  private tryDelivery(pose: Spot): boolean {
    const order = planDelivery(this.layout, this.network, this.businesses, pose, this.rng, this.file, this.lastCustomer)
    if (!order) return false
    this.ride = null
    this.clearPassenger()
    this.order = order
    this.lastCustomer = order.customer
    this.phase = 'pickup'
    this.elapsed = 0
    this.show(order, 'pickup')
    return true
  }

  private goal(): Spot | null {
    if (this.ride) return this.phase === 'dropoff' ? this.ride.dropoff : this.ride.pickup
    if (!this.order) return null
    return this.phase === 'dropoff' ? this.order.dropoff : this.order.pickup
  }

  private showRide(ride: TaxiRide, phase: DropPhase): void {
    const color = phase === 'dropoff' ? DROPOFF : HAIL
    this.tintArrow(color)
    for (const mat of this.haloMats) mat.color.setHex(color)
    this.hud.setOrder(taxiLine(ride, phase), phase === 'dropoff')
  }

  private seatPassenger(ride: TaxiRide): void {
    this.clearPassenger()
    const figure = createFigure({
      name: ride.passenger,
      voice: ride.passenger.length % 2 === 0 ? 'female' : 'male',
      shirt: shirtForName(ride.passenger),
      pants: '#243044',
      skin: '#e0b090',
      hair: '#2a2118',
      showName: true,
    })
    figure.root.position.set(ride.stand.x, 0, ride.stand.z)
    this.scene.add(figure.root)
    this.passenger = figure
  }

  private wave(dt: number, x: number, z: number): void {
    const ride = this.ride
    const figure = this.passenger
    if (!ride || !figure || this.phase !== 'pickup') return
    figure.root.position.set(ride.stand.x, 0, ride.stand.z)
    figure.root.rotation.y = Math.atan2(x - ride.stand.x, z - ride.stand.z)
    figure.update(dt, 0)
  }

  private clearPassenger(): void {
    const figure = this.passenger
    if (!figure) return
    this.scene.remove(figure.root)
    figure.dispose()
    this.passenger = null
  }

  private show(order: DeliveryOrder, phase: DropPhase): void {
    const color = phase === 'dropoff' ? DROPOFF : PICKUP
    this.tintArrow(color)
    for (const mat of this.haloMats) mat.color.setHex(color)
    this.hud.setOrder(orderLine(order, phase), phase === 'dropoff')
  }

  private hide(): void {
    this.arrow.visible = false
    this.halo.visible = false
  }

  private tintArrow(color: number): void {
    this.arrowFace.color.setHex(color)
  }

  private placeCue(dt: number, x: number, z: number, spot: Spot, speed: number): void {
    const cue = this.guide(dt, x, z, spot, speed)
    this.arrow.visible = true
    this.arrow.position.set(cue.x, 0.28, cue.z)
    this.arrow.rotation.set(0, cue.yaw, 0)
    const flip = cue.turn < 0 ? -1 : 1
    this.arrow.scale.set(1.6 * flip, 1.6, 1.6)
    this.arrowStraight.visible = cue.turn === 0
    this.arrowBend.visible = cue.turn !== 0
    this.hud.setOrderDistance(formatDistance(cue.remain))
    this.halo.visible = true
    const pulse = 1 + Math.sin(this.spin * 3.4) * 0.05
    this.halo.position.set(spot.x, 0.12, spot.z)
    this.halo.scale.set(pulse, 1, pulse)
    const ring = this.haloMats[0]
    const disc = this.haloMats[1]
    const column = this.haloMats[2]
    if (ring) ring.opacity = 0.72 + Math.sin(this.spin * 4) * 0.18
    if (disc) disc.opacity = 0.22 + Math.sin(this.spin * 4) * 0.08
    if (column) column.opacity = 0.12 + Math.sin(this.spin * 2.2) * 0.05
  }

  /** Follow the current drive, and search again if the player leaves it or the stop changes. */
  private guide(dt: number, x: number, z: number, spot: Spot, speed: number): RoadCue {
    this.routeTime += dt
    const key = `${spot.x.toFixed(1)},${spot.z.toFixed(1)}`
    if (key !== this.routeKey) {
      this.routeKey = key
      this.route = buildRoute(this.network, x, z, spot.x, spot.z)
      this.routeCursor = 0
      this.routeTime = 0
    }
    const route = this.route
    if (route) {
      const step = cueOnRoute(this.network, route, x, z, this.routeCursor, speed)
      if (step) {
        this.routeCursor = step.cursor
        return step.cue
      }
    }
    if (this.routeTime > 0.75) {
      this.route = buildRoute(this.network, x, z, spot.x, spot.z)
      this.routeCursor = 0
      this.routeTime = 0
      const again = this.route ? cueOnRoute(this.network, this.route, x, z, 0, speed) : null
      if (again) {
        this.routeCursor = again.cursor
        return again.cue
      }
    }
    const dx = spot.x - x
    const dz = spot.z - z
    const dist = Math.hypot(dx, dz)
    const lead = Math.min(26, Math.max(4, dist))
    const scale = dist > 0.01 ? lead / dist : 0
    return { x: x + dx * scale, z: z + dz * scale, yaw: Math.atan2(dx, dz), remain: dist, turn: 0 }
  }
}

function disposeDrawn(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.Material>()
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return
    geometries.add(node.geometry)
    const list = Array.isArray(node.material) ? node.material : [node.material]
    for (const material of list) materials.add(material)
  })
  for (const geometry of geometries) geometry.dispose()
  for (const material of materials) material.dispose()
}

function buildArrow(face: THREE.MeshBasicMaterial): {
  group: THREE.Group
  straight: THREE.Group
  bend: THREE.Group
} {
  const group = new THREE.Group()
  group.name = 'delivery-arrow'
  const straight = layArrow(straightShape(), face)
  const bend = layArrow(turnShape(), face)
  bend.visible = false
  group.add(straight, bend)
  group.scale.setScalar(1.6)
  return { group, straight, bend }
}

function straightShape(): THREE.Shape {
  const shape = new THREE.Shape()
  shape.moveTo(0, 1.55)
  shape.lineTo(-0.86, 0.18)
  shape.lineTo(-0.34, 0.18)
  shape.lineTo(-0.34, -1.35)
  shape.lineTo(0.34, -1.35)
  shape.lineTo(0.34, 0.18)
  shape.lineTo(0.86, 0.18)
  shape.closePath()
  return shape
}

/** A left turn. The stem runs forward and the head points left. The group flips this for a right turn. */
function turnShape(): THREE.Shape {
  const shape = new THREE.Shape()
  shape.moveTo(-0.34, -2)
  shape.lineTo(-0.34, 0.34)
  shape.lineTo(1.25, 0.34)
  shape.lineTo(1.25, 0.82)
  shape.lineTo(2.15, 0)
  shape.lineTo(1.25, -0.82)
  shape.lineTo(1.25, -0.34)
  shape.lineTo(0.34, -0.34)
  shape.lineTo(0.34, -2)
  shape.closePath()
  return shape
}

function layArrow(shape: THREE.Shape, face: THREE.MeshBasicMaterial): THREE.Group {
  const group = new THREE.Group()
  const front = new THREE.Mesh(new THREE.ShapeGeometry(shape), face)
  front.rotation.x = Math.PI / 2
  front.renderOrder = 5
  group.add(front)
  return group
}

function buildHalo(mats: THREE.MeshBasicMaterial[]): THREE.Group {
  const group = new THREE.Group()
  group.name = 'delivery-halo'
  const ringMat = mats[0] ?? mats[0]!
  const discMat = mats[1] ?? ringMat
  const columnMat = mats[2] ?? ringMat
  const ring = new THREE.Mesh(new THREE.RingGeometry(2.5, 4.3, 48), ringMat)
  const disc = new THREE.Mesh(new THREE.CircleGeometry(2.5, 40), discMat)
  const column = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 4.2, 8, 24, 1, true), columnMat)
  ring.rotation.x = -Math.PI / 2
  disc.rotation.x = -Math.PI / 2
  disc.position.y = -0.02
  column.position.y = 4
  group.add(ring, disc, column)
  return group
}
