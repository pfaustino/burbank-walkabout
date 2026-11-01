import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { staysDrawn, type DrawSpot } from '../world/drawRange.ts'
import type { CarModel } from './trafficSim.ts'

export type CarDesc = {
  id: string
  model: CarModel
  color: string
  x: number
  z: number
  yaw: number
}

const KEEP = new Set(['Windows', 'Black', 'Grey', 'Headlights', 'TailLights', 'Material.007'])
const BEAMS = 8
const BEAM_OFFSET: Record<CarModel, { y: number; z: number }> = {
  sedan: { y: 0.47, z: 2.06 },
  sport: { y: 0.47, z: 1.89 },
  suv: { y: 0.62, z: 1.99 },
  taxi: { y: 0.46, z: 2.17 },
  van: { y: 0.72, z: 2.45 },
  motorcycle: { y: 0.72, z: 1.15 },
}

type DrawnCar = {
  root: THREE.Group
  yaw: number
  shown: boolean
  mats: THREE.Material[]
  lamps: THREE.MeshStandardMaterial[]
}

let templates: Record<CarModel, THREE.Group> | null = null

export async function preloadCars(): Promise<void> {
  if (templates) return
  const loader = new GLTFLoader()
  const base = import.meta.env.BASE_URL
  const [sedan, suv, sport, taxi] = await Promise.all([
    loader.loadAsync(`${base}models/sedan.glb`),
    loader.loadAsync(`${base}models/suv.glb`),
    loader.loadAsync(`${base}models/sport.glb`),
    loader.loadAsync(`${base}models/taxi.glb`),
  ])
  templates = {
    sedan: ground(sedan.scene),
    suv: ground(suv.scene),
    sport: ground(sport.scene),
    taxi: ground(taxi.scene),
    van: ground(buildVan()),
    motorcycle: ground(buildMotorcycle()),
  }
}

export class CarSet {
  private readonly cars = new Map<string, DrawnCar>()
  private readonly scene: THREE.Scene
  private readonly beams: THREE.SpotLight[] = []
  private night = 0

  constructor(scene: THREE.Scene) {
    this.scene = scene
    for (let i = 0; i < BEAMS; i++) {
      const beam = new THREE.SpotLight(0xfff1c4, 0, 24, 0.5, 0.45, 2)
      beam.castShadow = false
      beam.visible = false
      this.scene.add(beam, beam.target)
      this.beams.push(beam)
    }
  }

  /** `amount` is 0 at noon and 1 after dark. Headlamp glass and the nearest beams follow it. */
  setNight(amount: number): void {
    this.night = amount
    const glow = amount * 2.6
    for (const car of this.cars.values()) {
      for (const lamp of car.lamps) lamp.emissiveIntensity = glow
    }
  }

  follow(x: number, z: number): void {
    if (this.night < 0.04) {
      for (const beam of this.beams) beam.visible = false
      return
    }
    const nearest = nearestCars(this.cars, x, z, this.beams.length)
    for (let i = 0; i < this.beams.length; i++) {
      const beam = this.beams[i]!
      const car = nearest[i]
      if (!car) {
        beam.visible = false
        continue
      }
      const model = car.root.userData.model as CarModel
      const pose = BEAM_OFFSET[model] ?? BEAM_OFFSET.sedan
      const fx = Math.sin(car.yaw)
      const fz = Math.cos(car.yaw)
      const px = car.root.position.x
      const pz = car.root.position.z
      beam.visible = true
      beam.intensity = this.night * 28
      beam.position.set(px + fx * pose.z, pose.y, pz + fz * pose.z)
      beam.target.position.set(px + fx * (pose.z + 14), 0.15, pz + fz * (pose.z + 14))
    }
  }

  sync(list: CarDesc[], dt: number, snapId: string | null, view?: DrawSpot): void {
    if (!templates) return
    const seen = new Set<string>()
    const k = 1 - Math.exp(-dt * 8)
    for (const desc of list) {
      seen.add(desc.id)
      let car = this.cars.get(desc.id)
      if (!car || car.root.userData.model !== desc.model || car.root.userData.color !== desc.color) {
        if (car) this.drop(desc.id, car)
        car = this.spawn(desc)
        this.cars.set(desc.id, car)
      }
      const root = car.root
      const show = !view || desc.id === snapId || staysDrawn(desc.x, desc.z, view.x, view.z, view.reach, car.shown)
      car.shown = show
      if (!show) {
        root.position.set(desc.x, 0, desc.z)
        root.rotation.y = desc.yaw
        car.yaw = desc.yaw
        if (root.parent) this.scene.remove(root)
        continue
      }
      if (!root.parent) this.scene.add(root)
      if (desc.id === snapId) {
        root.position.set(desc.x, 0, desc.z)
        root.rotation.y = desc.yaw
        car.yaw = desc.yaw
      } else {
        root.position.x += (desc.x - root.position.x) * k
        root.position.z += (desc.z - root.position.z) * k
        car.yaw = dampAngle(car.yaw, desc.yaw, k)
        root.rotation.y = car.yaw
      }
    }
    for (const [id, car] of this.cars) {
      if (seen.has(id)) continue
      this.drop(id, car)
    }
  }

  dispose(): void {
    for (const [id, car] of this.cars) this.drop(id, car)
    for (const beam of this.beams) {
      this.scene.remove(beam, beam.target)
      beam.dispose()
    }
    this.beams.length = 0
  }

  private spawn(desc: CarDesc): DrawnCar {
    const source = templates?.[desc.model]
    if (!source) throw new Error('Call preloadCars() before creating cars')
    const root = source.clone(true)
    root.userData.model = desc.model
    root.userData.color = desc.color
    root.position.set(desc.x, 0, desc.z)
    root.rotation.y = desc.yaw
    const mats: THREE.Material[] = []
    const lamps: THREE.MeshStandardMaterial[] = []
    const paint = desc.model !== 'taxi'
    root.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return
      obj.castShadow = true
      obj.receiveShadow = true
      const list = Array.isArray(obj.material) ? obj.material : [obj.material]
      const next = list.map((material) => {
        const copy = material.clone()
        mats.push(copy)
        if (copy instanceof THREE.MeshStandardMaterial && copy.name === 'Headlights') {
          copy.emissive.setHex(0xfff2cc)
          copy.emissiveIntensity = this.night * 2.6
          lamps.push(copy)
        } else if (paint && copy instanceof THREE.MeshStandardMaterial && !KEEP.has(copy.name)) {
          copy.color.set(desc.color)
        }
        return copy
      })
      obj.material = next.length === 1 ? next[0]! : next
    })
    return { root, yaw: desc.yaw, shown: false, mats, lamps }
  }

  private drop(id: string, car: DrawnCar): void {
    this.scene.remove(car.root)
    for (const material of car.mats) material.dispose()
    this.cars.delete(id)
  }
}

function buildVan(): THREE.Group {
  const group = new THREE.Group()
  const paint = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.08 })
  const glass = new THREE.MeshStandardMaterial({ name: 'Windows', color: 0x1a2836, roughness: 0.2, metalness: 0.2 })
  const dark = new THREE.MeshStandardMaterial({ name: 'Black', color: 0x1c1e22, roughness: 0.7 })
  const lamp = new THREE.MeshStandardMaterial({ name: 'Headlights', color: 0xfff6df, roughness: 0.3 })
  const tail = new THREE.MeshStandardMaterial({ name: 'TailLights', color: 0x9a1c1c, roughness: 0.4 })
  group.add(block(1.95, 1.55, 3.05, paint, 0, 1.32, -0.62))
  group.add(block(1.82, 0.72, 1.55, paint, 0, 0.9, 1.58))
  const windshield = block(1.62, 0.62, 0.06, glass, 0, 1.28, 1.15)
  windshield.rotation.x = -0.55
  group.add(windshield)
  group.add(block(1.45, 0.38, 0.06, glass, 0, 1.55, -2.12))
  group.add(block(0.28, 0.14, 0.06, lamp, -0.58, 0.72, 2.34))
  group.add(block(0.28, 0.14, 0.06, lamp, 0.58, 0.72, 2.34))
  group.add(block(0.22, 0.14, 0.05, tail, -0.68, 0.82, -2.14))
  group.add(block(0.22, 0.14, 0.05, tail, 0.68, 0.82, -2.14))
  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.24, 12)
  wheelGeo.rotateZ(Math.PI / 2)
  for (const x of [-0.92, 0.92]) {
    for (const z of [-1.45, 1.55]) {
      const wheel = new THREE.Mesh(wheelGeo, dark)
      wheel.position.set(x, 0.36, z)
      wheel.castShadow = true
      wheel.receiveShadow = true
      group.add(wheel)
    }
  }
  return group
}

function buildMotorcycle(): THREE.Group {
  const group = new THREE.Group()
  const paint = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0.25 })
  const dark = new THREE.MeshStandardMaterial({ name: 'Black', color: 0x1c1e22, roughness: 0.65 })
  const glass = new THREE.MeshStandardMaterial({ name: 'Windows', color: 0x1a2836, roughness: 0.15, metalness: 0.3 })
  const lamp = new THREE.MeshStandardMaterial({ name: 'Headlights', color: 0xfff6df, roughness: 0.3 })
  const tail = new THREE.MeshStandardMaterial({ name: 'TailLights', color: 0x9a1c1c, roughness: 0.4 })
  const wheelGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.12, 12)
  wheelGeo.rotateZ(Math.PI / 2)
  for (const z of [-0.72, 0.78]) {
    const wheel = new THREE.Mesh(wheelGeo, dark)
    wheel.position.set(0, 0.32, z)
    wheel.castShadow = true
    wheel.receiveShadow = true
    group.add(wheel)
  }
  group.add(block(0.16, 0.14, 1.35, dark, 0, 0.42, 0.05))
  group.add(block(0.28, 0.22, 0.42, dark, 0, 0.48, 0.05))
  group.add(block(0.32, 0.22, 0.55, paint, 0, 0.72, 0.28))
  group.add(block(0.28, 0.12, 0.42, dark, 0, 0.78, -0.22))
  group.add(block(0.46, 0.06, 0.08, dark, 0, 0.92, 0.62))
  group.add(block(0.06, 0.28, 0.06, dark, -0.16, 0.78, 0.62))
  group.add(block(0.06, 0.28, 0.06, dark, 0.16, 0.78, 0.62))
  group.add(block(0.22, 0.28, 0.04, glass, 0, 0.98, 0.72))
  group.add(block(0.16, 0.12, 0.08, lamp, 0, 0.62, 1.05))
  group.add(block(0.1, 0.08, 0.05, tail, 0, 0.7, -0.95))
  return group
}

function block(
  w: number,
  h: number,
  d: number,
  material: THREE.Material,
  x: number,
  y: number,
  z: number,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material)
  mesh.position.set(x, y, z)
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

function ground(scene: THREE.Group): THREE.Group {
  scene.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(scene)
  scene.position.y -= box.min.y
  return scene
}

function nearestCars(cars: Map<string, DrawnCar>, x: number, z: number, count: number): DrawnCar[] {
  const best: { car: DrawnCar; d: number }[] = []
  for (const car of cars.values()) {
    if (!car.root.parent) continue
    const dx = car.root.position.x - x
    const dz = car.root.position.z - z
    const d = dx * dx + dz * dz
    if (best.length < count) {
      best.push({ car, d })
      if (best.length === count) best.sort((a, b) => a.d - b.d)
      continue
    }
    if (d >= best[best.length - 1]!.d) continue
    best[best.length - 1] = { car, d }
    best.sort((a, b) => a.d - b.d)
  }
  return best.map((entry) => entry.car)
}

function dampAngle(current: number, target: number, t: number): number {
  let delta = target - current
  while (delta > Math.PI) delta -= Math.PI * 2
  while (delta < -Math.PI) delta += Math.PI * 2
  return current + delta * t
}
