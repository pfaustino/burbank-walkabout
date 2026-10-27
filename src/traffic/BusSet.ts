import * as THREE from 'three'

type BusView = {
  root: THREE.Group
  wheels: THREE.Object3D[]
  paint: THREE.MeshStandardMaterial
}

type BusDesc = {
  id: string
  color: string
  x: number
  z: number
  yaw: number
  speed: number
}

let template: THREE.Group | null = null

export class BusSet {
  private readonly buses = new Map<string, BusView>()
  private readonly scene: THREE.Scene

  constructor(scene: THREE.Scene) {
    this.scene = scene
  }

  sync(list: BusDesc[], dt: number): void {
    const seen = new Set<string>()
    for (const desc of list) {
      seen.add(desc.id)
      let bus = this.buses.get(desc.id)
      if (!bus) {
        bus = spawn(desc)
        this.buses.set(desc.id, bus)
        this.scene.add(bus.root)
      }
      bus.root.position.set(desc.x, 0, desc.z)
      bus.root.rotation.y = desc.yaw
      const spin = (desc.speed * dt) / 0.46
      for (const wheel of bus.wheels) wheel.rotation.x += spin
    }
    for (const [id, bus] of this.buses) {
      if (seen.has(id)) continue
      this.drop(id, bus)
    }
  }

  dispose(): void {
    for (const [id, bus] of this.buses) this.drop(id, bus)
    if (!template) return
    const geometries = new Set<THREE.BufferGeometry>()
    const materials = new Set<THREE.Material>()
    template.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return
      geometries.add(obj.geometry)
      const list = Array.isArray(obj.material) ? obj.material : [obj.material]
      for (const material of list) materials.add(material)
    })
    for (const geometry of geometries) geometry.dispose()
    for (const material of materials) {
      if (material instanceof THREE.MeshStandardMaterial) material.map?.dispose()
      material.dispose()
    }
    template = null
  }

  private drop(id: string, bus: BusView): void {
    this.scene.remove(bus.root)
    bus.paint.dispose()
    this.buses.delete(id)
  }
}

function spawn(desc: BusDesc): BusView {
  const root = busTemplate().clone(true)
  root.position.set(desc.x, 0, desc.z)
  root.rotation.y = desc.yaw
  const paint = new THREE.MeshStandardMaterial({ color: desc.color, roughness: 0.55, metalness: 0.04 })
  const wheels: THREE.Object3D[] = []
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return
    if (obj.userData.role === 'paint') obj.material = paint
    if (obj.userData.role === 'wheel') wheels.push(obj)
  })
  return { root, wheels, paint }
}

function busTemplate(): THREE.Group {
  if (template) return template
  const group = new THREE.Group()
  group.name = 'bus'
  const paint = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.04 })
  const glass = new THREE.MeshStandardMaterial({ color: 0x1a2836, roughness: 0.25, metalness: 0.15 })
  const dark = new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.7 })
  const trim = new THREE.MeshStandardMaterial({ color: 0x2a2e33, roughness: 0.6, metalness: 0.2 })
  const sign = new THREE.MeshStandardMaterial({ map: signTexture(), roughness: 0.7 })

  const body = box(2.5, 2.15, 10.2, paint, 0, 1.75, 0)
  body.userData.role = 'paint'
  const stripe = box(2.54, 0.22, 10.22, trim, 0, 1.15, 0)
  const windows = box(2.56, 0.7, 6.6, glass, 0, 2.08, -0.35)
  const windshield = box(2.15, 0.85, 0.08, glass, 0, 1.95, 5.08)
  const board = box(1.55, 0.34, 0.06, sign, 0, 2.62, 5.02)
  group.add(body, stripe, windows, windshield, board)

  const wheelGeo = new THREE.CylinderGeometry(0.46, 0.46, 0.28, 10)
  wheelGeo.rotateZ(Math.PI / 2)
  for (const x of [-1.05, 1.05]) {
    for (const z of [-3.15, 3.15]) {
      const wheel = new THREE.Mesh(wheelGeo, dark)
      wheel.position.set(x, 0.46, z)
      wheel.castShadow = true
      wheel.userData.role = 'wheel'
      group.add(wheel)
    }
  }
  template = group
  return group
}

function box(
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

function signTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 64
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.fillStyle = '#14180f'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#f2c14a'
    ctx.font = '700 36px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('BURBANK', 128, 34)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}
