import * as THREE from 'three'
import type { Axis, Lamp, Signal, SignPost } from './network.ts'

const LAMP_COLOR: Record<Lamp, number> = { red: 0xd22522, yellow: 0xe2b01a, green: 0x21a34a }

export function buildSigns(posts: SignPost[]): THREE.Group {
  const group = new THREE.Group()
  group.name = 'street-signs'
  const blades = new Map<string, THREE.MeshStandardMaterial>()
  const poleGeo = new THREE.CylinderGeometry(0.07, 0.08, 3.2, 8)
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x8d9294, roughness: 0.45, metalness: 0.35 })
  for (const post of posts) {
    const root = new THREE.Group()
    root.position.set(post.x, 0, post.z)
    const pole = new THREE.Mesh(poleGeo, poleMat)
    pole.position.y = 1.6
    pole.castShadow = true
    root.add(pole)
    post.blades.forEach((blade, index) => {
      const label = signLabel(blade.name)
      let mat = blades.get(label)
      if (!mat) {
        const art = signArt(label)
        mat = new THREE.MeshStandardMaterial({
          map: art.map,
          emissive: 0xfff8ee,
          emissiveMap: art.glow,
          emissiveIntensity: 0.2,
          roughness: 0.55,
          metalness: 0.02,
        })
        blades.set(label, mat)
      }
      const width = Math.min(4.8, Math.max(2.3, label.length * 0.155))
      const geo = new THREE.PlaneGeometry(width, 0.46)
      const board = new THREE.Group()
      board.position.y = index === 0 ? 2.95 : 2.42
      board.rotation.y = blade.yaw - Math.PI / 2
      const front = new THREE.Mesh(geo, mat)
      front.position.z = 0.02
      front.castShadow = true
      const back = new THREE.Mesh(geo, mat)
      back.position.z = -0.02
      // A negative scale turns the face inside out and the blade disappears from that side.
      back.rotation.y = Math.PI
      back.castShadow = true
      board.add(front, back)
      root.add(board)
    })
    group.add(root)
  }
  group.userData.signGlow = [...blades.values()]
  return group
}

/** White lettering brightens as night comes on. `amount` is 0 at noon and 1 after dark. */
export function setSignGlow(root: THREE.Object3D, amount: number): void {
  const mats = root.userData.signGlow as THREE.MeshStandardMaterial[] | undefined
  if (!mats) return
  const intensity = 0.18 + Math.max(0, Math.min(1, amount)) * 1.85
  for (const mat of mats) mat.emissiveIntensity = intensity
}

export class StreetLights {
  readonly root = new THREE.Group()
  private readonly heads: { axis: Axis; mats: Record<Lamp, THREE.MeshStandardMaterial> }[] = []

  constructor(signals: Signal[]) {
    this.root.name = 'traffic-lights'
    const poleGeo = new THREE.CylinderGeometry(0.08, 0.09, 4.1, 8)
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x2b2e31, roughness: 0.55, metalness: 0.2 })
    const housingGeo = new THREE.BoxGeometry(0.38, 1.15, 0.28)
    const housingMat = new THREE.MeshStandardMaterial({ color: 0x1a1c1e, roughness: 0.6 })
    for (const signal of signals) {
      for (const head of signal.heads) {
        const group = new THREE.Group()
        group.position.set(head.x, 0, head.z)
        group.rotation.y = head.yaw
        const pole = new THREE.Mesh(poleGeo, poleMat)
        pole.position.y = 2.05
        pole.castShadow = true
        const housing = new THREE.Mesh(housingGeo, housingMat)
        housing.position.set(0, 3.55, 0.12)
        housing.castShadow = true
        group.add(pole, housing)
        const mats = {
          red: lampMaterial(LAMP_COLOR.red),
          yellow: lampMaterial(LAMP_COLOR.yellow),
          green: lampMaterial(LAMP_COLOR.green),
        }
        const lamps: Lamp[] = ['red', 'yellow', 'green']
        lamps.forEach((lamp, index) => {
          const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), mats[lamp])
          bulb.position.set(0, 3.9 - index * 0.34, 0.28)
          group.add(bulb)
        })
        this.root.add(group)
        this.heads.push({ axis: head.axis, mats })
      }
    }
  }

  setPhase(phase: { ew: Lamp; ns: Lamp }): void {
    for (const head of this.heads) {
      const on = head.axis === 'ew' ? phase.ew : phase.ns
      for (const lamp of ['red', 'yellow', 'green'] as const) {
        head.mats[lamp].emissiveIntensity = lamp === on ? 2.8 : 0.03
      }
    }
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

export function disposeDrawn(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.Material>()
  const textures = new Set<THREE.Texture>()
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return
    geometries.add(obj.geometry)
    const list = Array.isArray(obj.material) ? obj.material : [obj.material]
    for (const material of list) {
      materials.add(material)
      if (material instanceof THREE.MeshStandardMaterial) {
        if (material.map) textures.add(material.map)
        if (material.emissiveMap && material.emissiveMap !== material.map) textures.add(material.emissiveMap)
      }
    }
  })
  for (const geometry of geometries) geometry.dispose()
  for (const texture of textures) texture.dispose()
  for (const material of materials) material.dispose()
}

export function signLabel(name: string): string {
  return name
    .replace(/^North /, 'N ')
    .replace(/^South /, 'S ')
    .replace(/^East /, 'E ')
    .replace(/^West /, 'W ')
    .replace('Boulevard', 'BLVD')
    .replace('Avenue', 'AVE')
    .replace('Street', 'ST')
    .replace('Drive', 'DR')
    .toUpperCase()
}

function lampMaterial(hex: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0x241f1c,
    emissive: hex,
    emissiveIntensity: 0.03,
    roughness: 0.35,
  })
}

function signArt(label: string): { map: THREE.CanvasTexture; glow: THREE.CanvasTexture } {
  const mapCanvas = document.createElement('canvas')
  mapCanvas.width = 512
  mapCanvas.height = 128
  const glowCanvas = document.createElement('canvas')
  glowCanvas.width = 512
  glowCanvas.height = 128
  paintSign(mapCanvas, label, false)
  paintSign(glowCanvas, label, true)
  const map = new THREE.CanvasTexture(mapCanvas)
  const glow = new THREE.CanvasTexture(glowCanvas)
  map.colorSpace = THREE.SRGBColorSpace
  glow.colorSpace = THREE.SRGBColorSpace
  return { map, glow }
}

function paintSign(canvas: HTMLCanvasElement, label: string, lettersOnly: boolean): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.fillStyle = lettersOnly ? '#000000' : '#0e6a38'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.strokeStyle = lettersOnly ? '#ffffff' : '#f4f7f2'
  ctx.lineWidth = 10
  ctx.strokeRect(8, 8, canvas.width - 16, canvas.height - 16)
  ctx.fillStyle = lettersOnly ? '#ffffff' : '#f7faf6'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = label.length > 18 ? '700 42px sans-serif' : '700 54px sans-serif'
  ctx.fillText(label.slice(0, 28), canvas.width / 2, canvas.height / 2 + 2)
}
