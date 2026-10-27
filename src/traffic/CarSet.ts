import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
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
}

type DrawnCar = {
  root: THREE.Group
  yaw: number
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

  sync(list: CarDesc[], dt: number, snapId: string | null): void {
    if (!templates) return
    const seen = new Set<string>()
    const k = 1 - Math.exp(-dt * 8)
    for (const desc of list) {
      seen.add(desc.id)
      let car = this.cars.get(desc.id)
      if (!car || car.root.userData.model !== desc.model) {
        if (car) this.drop(desc.id, car)
        car = this.spawn(desc)
        this.cars.set(desc.id, car)
        this.scene.add(car.root)
      }
      const root = car.root
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
    return { root, yaw: desc.yaw, mats, lamps }
  }

  private drop(id: string, car: DrawnCar): void {
    this.scene.remove(car.root)
    for (const material of car.mats) material.dispose()
    this.cars.delete(id)
  }
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
