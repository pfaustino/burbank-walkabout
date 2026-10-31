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

const PICKUP = 0xffc107
const DROPOFF = 0x3ddc84
const HAIL = 0x3d9eff

export class DeliveryRun {
  private order: DeliveryOrder | null = null
  private ride: TaxiRide | null = null
  private passenger: Figure | null = null
  private wantTaxi = true
  private lastCustomer = ''
  private phase: DropPhase | 'gap' = 'gap'
  private wait = 0.6
  private readonly arrow: THREE.Group
  private readonly arrowFace: THREE.MeshBasicMaterial
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
    this.arrowFace = new THREE.MeshBasicMaterial({ color: PICKUP, fog: false })
    this.arrow = buildArrow(this.arrowFace)
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
      if (this.wait <= 0) this.offer(pose)
      return
    }
    const spot = this.goal()
    if ((!this.order && !this.ride) || !spot) return
    this.placeCue(pose.x, pose.z, spot)
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
    const taxi = this.wantTaxi
    this.wantTaxi = !this.wantTaxi
    if (taxi) {
      const ride = planTaxi(this.layout, this.network, pose, this.rng, this.file, this.lastCustomer)
      if (ride) {
        this.order = null
        this.ride = ride
        this.lastCustomer = ride.passenger
        this.phase = 'pickup'
        this.elapsed = 0
        this.showRide(ride, 'pickup')
        this.seatPassenger(ride)
        return
      }
    }
    const order = planDelivery(this.layout, this.network, this.businesses, pose, this.rng, this.file, this.lastCustomer)
    if (!order) {
      this.wait = 2
      return
    }
    this.ride = null
    this.clearPassenger()
    this.order = order
    this.lastCustomer = order.customer
    this.phase = 'pickup'
    this.elapsed = 0
    this.show(order, 'pickup')
  }

  private goal(): Spot | null {
    if (this.ride) return this.phase === 'dropoff' ? this.ride.dropoff : this.ride.pickup
    if (!this.order) return null
    return this.phase === 'dropoff' ? this.order.dropoff : this.order.pickup
  }

  private showRide(ride: TaxiRide, phase: DropPhase): void {
    const color = phase === 'dropoff' ? DROPOFF : HAIL
    this.arrowFace.color.setHex(color)
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
    this.arrowFace.color.setHex(color)
    for (const mat of this.haloMats) mat.color.setHex(color)
    this.hud.setOrder(orderLine(order, phase), phase === 'dropoff')
  }

  private hide(): void {
    this.arrow.visible = false
    this.halo.visible = false
  }

  private placeCue(x: number, z: number, spot: Spot): void {
    const dx = spot.x - x
    const dz = spot.z - z
    const yaw = Math.atan2(dx, dz)
    this.arrow.visible = true
    this.arrow.position.set(x, 3.15 + Math.sin(this.spin * 3) * 0.16, z)
    this.arrow.rotation.order = 'YXZ'
    this.arrow.rotation.y = yaw
    this.arrow.rotation.x = -0.42
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

function buildArrow(face: THREE.MeshBasicMaterial): THREE.Group {
  const group = new THREE.Group()
  group.name = 'delivery-arrow'
  const shaft = new THREE.BoxGeometry(0.7, 0.18, 2.1)
  const head = new THREE.ConeGeometry(0.95, 1.5, 4)
  const shade = new THREE.MeshBasicMaterial({ color: 0x1a1208, fog: false })
  const backShaft = new THREE.Mesh(shaft, shade)
  const backHead = new THREE.Mesh(head, shade)
  const frontShaft = new THREE.Mesh(shaft, face)
  const frontHead = new THREE.Mesh(head, face)
  backShaft.position.set(0, -0.08, -0.35)
  frontShaft.position.set(0, 0, -0.35)
  backHead.position.set(0, -0.08, 1.15)
  frontHead.position.set(0, 0, 1.15)
  for (const mesh of [backHead, frontHead]) mesh.rotation.x = Math.PI / 2
  group.add(backShaft, backHead, frontShaft, frontHead)
  group.scale.setScalar(0.36)
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
