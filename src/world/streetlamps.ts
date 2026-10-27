import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { hitsBuilding, type CityLayout } from './layout.ts'

export type LampPost = { x: number; z: number; yaw: number }

const SPACING = 34
const GLOW = 10

/** Sidewalk lamp posts along named streets, kept off the roadway and out of buildings. */
export function planLamps(layout: CityLayout): LampPost[] {
  const posts: LampPost[] = []
  for (const road of layout.file.roads) {
    if (road.kind !== 'primary' && road.kind !== 'secondary' && road.kind !== 'tertiary') continue
    if (!road.name || /Alley|Frontage|Lot/.test(road.name)) continue
    walkRoad(layout, road.pts, road.w * 0.5 + 1.15, posts)
  }
  return posts
}

export class StreetLamps {
  readonly root = new THREE.Group()
  private readonly posts: LampPost[]
  private readonly bulbs: THREE.InstancedMesh | null
  private readonly glow: THREE.PointLight[] = []
  private night = 0

  constructor(layout: CityLayout) {
    this.posts = planLamps(layout)
    this.root.name = 'streetlamps'
    const count = this.posts.length
    if (count === 0) {
      this.bulbs = null
      return
    }
    const pole = lampPole()
    const poles = new THREE.InstancedMesh(
      pole,
      new THREE.MeshStandardMaterial({ color: 0x2a2e32, roughness: 0.62, metalness: 0.28 }),
      count,
    )
    const bulbGeo = new THREE.SphereGeometry(0.18, 10, 8)
    bulbGeo.translate(0, 5.05, 0.7)
    this.bulbs = new THREE.InstancedMesh(
      bulbGeo,
      new THREE.MeshStandardMaterial({
        color: 0x3a3328,
        emissive: 0xffc56a,
        emissiveIntensity: 0,
        roughness: 0.4,
      }),
      count,
    )
    const dummy = new THREE.Object3D()
    for (let i = 0; i < count; i++) {
      const post = this.posts[i]!
      dummy.position.set(post.x, 0, post.z)
      dummy.rotation.y = post.yaw
      dummy.updateMatrix()
      poles.setMatrixAt(i, dummy.matrix)
      this.bulbs.setMatrixAt(i, dummy.matrix)
    }
    poles.instanceMatrix.needsUpdate = true
    this.bulbs.instanceMatrix.needsUpdate = true
    this.root.add(poles, this.bulbs)
    for (let i = 0; i < GLOW; i++) {
      const light = new THREE.PointLight(0xffc98a, 0, 22, 2)
      light.castShadow = false
      light.visible = false
      this.glow.push(light)
      this.root.add(light)
    }
  }

  /** `amount` is 0 at noon and 1 in full night. */
  setNight(amount: number): void {
    this.night = amount
    if (!this.bulbs) return
    const material = this.bulbs.material
    if (material instanceof THREE.MeshStandardMaterial) material.emissiveIntensity = amount * 1.8
  }

  follow(x: number, z: number): void {
    if (!this.bulbs || this.glow.length === 0) return
    if (this.night < 0.04) {
      for (const light of this.glow) light.visible = false
      return
    }
    const nearest = nearestPosts(this.posts, x, z, this.glow.length)
    for (let i = 0; i < this.glow.length; i++) {
      const light = this.glow[i]!
      const post = nearest[i]
      if (!post) {
        light.visible = false
        continue
      }
      light.visible = true
      const reach = 0.7
      light.position.set(
        post.x + Math.sin(post.yaw) * reach,
        5.05,
        post.z + Math.cos(post.yaw) * reach,
      )
      light.intensity = this.night * 14
    }
  }

  dispose(): void {
    this.root.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return
      obj.geometry.dispose()
      const material = obj.material
      if (Array.isArray(material)) material.forEach((entry) => entry.dispose())
      else material.dispose()
    })
  }
}

function walkRoad(layout: CityLayout, pts: number[], side: number, posts: LampPost[]): void {
  let traveled = 0
  let nextLeft = 14
  let nextRight = 14 + SPACING / 2
  for (let i = 0; i < pts.length - 2; i += 2) {
    const ax = pts[i] ?? 0
    const az = pts[i + 1] ?? 0
    const bx = pts[i + 2] ?? 0
    const bz = pts[i + 3] ?? 0
    const dx = bx - ax
    const dz = bz - az
    const len = Math.hypot(dx, dz)
    if (len < 0.4) continue
    const tx = dx / len
    const tz = dz / len
    const end = traveled + len
    while (nextLeft < end || nextRight < end) {
      const left = nextLeft <= nextRight
      const at = left ? nextLeft : nextRight
      if (at >= end) break
      const along = at - traveled
      const px = ax + tx * along
      const pz = az + tz * along
      const rx = tz
      const rz = -tx
      const flip = left ? -1 : 1
      tryAdd(layout, posts, px + rx * side * flip, pz + rz * side * flip, Math.atan2(-rx * flip, -rz * flip))
      if (left) nextLeft += SPACING
      else nextRight += SPACING
    }
    traveled = end
  }
}

function tryAdd(layout: CityLayout, posts: LampPost[], x: number, z: number, yaw: number): void {
  if (hitsBuilding(layout, x, z, 0.4)) return
  for (let i = 0; i < posts.length; i++) {
    const post = posts[i]!
    const dx = post.x - x
    const dz = post.z - z
    if (dx * dx + dz * dz < 144) return
  }
  posts.push({ x, z, yaw })
}

function nearestPosts(posts: LampPost[], x: number, z: number, count: number): LampPost[] {
  const best: { post: LampPost; d: number }[] = []
  for (const post of posts) {
    const dx = post.x - x
    const dz = post.z - z
    const d = dx * dx + dz * dz
    if (best.length < count) {
      best.push({ post, d })
      if (best.length === count) best.sort((a, b) => a.d - b.d)
      continue
    }
    if (d >= best[best.length - 1]!.d) continue
    best[best.length - 1] = { post, d }
    best.sort((a, b) => a.d - b.d)
  }
  return best.map((entry) => entry.post)
}

function lampPole(): THREE.BufferGeometry {
  const shaft = new THREE.CylinderGeometry(0.09, 0.11, 5.2, 8)
  shaft.translate(0, 2.6, 0)
  const arm = new THREE.BoxGeometry(0.08, 0.07, 0.85)
  arm.translate(0, 5.12, 0.32)
  return mergeGeometries([shaft, arm]) ?? shaft
}
