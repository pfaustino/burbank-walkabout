import * as THREE from 'three'
import { helicopterPose, type AirPose, type Tour } from './helicopterSim.ts'

const HOVER = 16

export class Helicopter {
  readonly root = new THREE.Group()
  pose: AirPose = { x: 0, y: 40, z: 0, yaw: 0, roll: 0 }
  private readonly tour: Tour
  private readonly craft = new THREE.Group()
  private readonly mainRotor: THREE.Group
  private readonly tailRotor: THREE.Group
  private readonly blot: THREE.Mesh
  private mode: 'tour' | 'summon' | 'ridden' | 'depart' = 'tour'
  private readonly goal = { x: 0, y: HOVER, z: 0 }

  constructor(tour: Tour) {
    this.tour = tour
    this.root.name = 'helicopter'
    const built = buildCraft()
    this.craft.add(built.body)
    this.mainRotor = built.mainRotor
    this.tailRotor = built.tailRotor
    this.craft.scale.setScalar(1.8)
    this.craft.add(this.mainRotor, this.tailRotor)
    this.blot = new THREE.Mesh(
      new THREE.CircleGeometry(7, 16),
      new THREE.MeshBasicMaterial({ color: 0x14202c, transparent: true, opacity: 0.28, depthWrite: false }),
    )
    this.blot.rotation.x = -Math.PI / 2
    this.blot.position.y = 0.2
    this.root.add(this.craft, this.blot)
    this.update(0, 0, null)
  }

  get incoming(): boolean {
    return this.mode === 'summon'
  }

  get arrived(): boolean {
    if (this.mode !== 'summon') return false
    return Math.hypot(this.pose.x - this.goal.x, this.pose.z - this.goal.z) < 5 && Math.abs(this.pose.y - this.goal.y) < 2
  }

  /** Fly to a hover above the player. */
  aim(x: number, z: number): void {
    this.goal.x = x
    this.goal.z = z
    this.goal.y = HOVER
    if (this.mode !== 'ridden') this.mode = 'summon'
  }

  board(): void {
    this.mode = 'ridden'
  }

  release(): void {
    if (this.mode === 'ridden') this.mode = 'depart'
  }

  update(dt: number, time: number, rider: AirPose | null): void {
    if (rider && this.mode === 'ridden') {
      this.pose = rider
    } else if (this.mode === 'tour') {
      this.pose = helicopterPose(this.tour, time)
    } else {
      const target = this.mode === 'depart' ? helicopterPose(this.tour, time) : this.goal
      this.pose = flyToward(this.pose, target, 52 * dt)
      if (this.mode === 'depart' && Math.hypot(this.pose.x - target.x, this.pose.y - target.y, this.pose.z - target.z) < 10) {
        this.mode = 'tour'
      }
    }
    this.craft.position.set(this.pose.x, this.pose.y, this.pose.z)
    this.craft.rotation.order = 'YXZ'
    this.craft.rotation.set(0.08, this.pose.yaw, this.pose.roll)
    this.mainRotor.rotation.y = time * 28
    this.tailRotor.rotation.z = time * 36
    this.blot.position.x = this.pose.x
    this.blot.position.z = this.pose.z
  }

  dispose(): void {
    const geometries = new Set<THREE.BufferGeometry>()
    const materials = new Set<THREE.Material>()
    this.root.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return
      geometries.add(obj.geometry)
      const list = Array.isArray(obj.material) ? obj.material : [obj.material]
      for (const material of list) materials.add(material)
    })
    for (const geometry of geometries) geometry.dispose()
    for (const material of materials) material.dispose()
  }
}

function flyToward(pose: AirPose, target: { x: number; y: number; z: number }, step: number): AirPose {
  const dx = target.x - pose.x
  const dy = target.y - pose.y
  const dz = target.z - pose.z
  const dist = Math.hypot(dx, dy, dz)
  if (dist < 0.05) return { ...pose, x: target.x, y: target.y, z: target.z, roll: pose.roll * 0.8 }
  const scale = Math.min(1, step / dist)
  const flat = Math.hypot(dx, dz) || 1
  return {
    x: pose.x + dx * scale,
    y: pose.y + dy * scale,
    z: pose.z + dz * scale,
    yaw: Math.atan2(dx, dz),
    roll: THREE.MathUtils.clamp((dx / flat) * 0.15, -0.25, 0.25),
  }
}

function buildCraft(): { body: THREE.Group; mainRotor: THREE.Group; tailRotor: THREE.Group } {
  const body = new THREE.Group()
  const shell = new THREE.MeshStandardMaterial({ color: 0xf4f7fb, roughness: 0.45, metalness: 0.08 })
  const glass = new THREE.MeshStandardMaterial({ color: 0x163044, roughness: 0.2, metalness: 0.2 })
  const accent = new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.5 })
  const dark = new THREE.MeshStandardMaterial({ color: 0x22262c, roughness: 0.6, metalness: 0.25 })

  body.add(part(1.7, 1.25, 2.5, shell, 0, 1.45, 0.35))
  body.add(part(1.35, 0.7, 0.9, glass, 0, 1.55, 1.45))
  body.add(part(0.32, 0.32, 3.5, shell, 0, 1.55, -2.15))
  body.add(part(0.1, 0.75, 0.55, accent, 0, 1.95, -3.75))
  body.add(part(1.15, 0.08, 2.2, dark, -0.55, 0.42, 0.2))
  body.add(part(1.15, 0.08, 2.2, dark, 0.55, 0.42, 0.2))
  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(0.1, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0x3a1010, emissive: 0xff2a2a, emissiveIntensity: 1.4 }),
  )
  beacon.position.set(0, 2.15, 0.2)
  body.add(beacon)

  const mainRotor = new THREE.Group()
  mainRotor.position.set(0, 2.35, 0.2)
  mainRotor.add(part(7.2, 0.045, 0.22, dark, 0, 0, 0, false))
  mainRotor.add(part(0.22, 0.045, 7.2, dark, 0, 0, 0, false))

  const tailRotor = new THREE.Group()
  tailRotor.position.set(0.18, 1.95, -3.75)
  tailRotor.add(part(0.04, 1.15, 0.1, dark, 0, 0, 0, false))
  tailRotor.add(part(0.04, 0.1, 1.15, dark, 0, 0, 0, false))
  return { body, mainRotor, tailRotor }
}

function part(
  w: number,
  h: number,
  d: number,
  material: THREE.Material,
  x: number,
  y: number,
  z: number,
  shadow = true,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material)
  mesh.position.set(x, y, z)
  mesh.castShadow = shadow
  mesh.receiveShadow = true
  return mesh
}
