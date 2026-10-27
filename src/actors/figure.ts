import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js'
import type { PersonVoice } from './peopleSim.ts'

export type Figure = {
  root: THREE.Group
  update(dt: number, speed: number): void
  setBubble(text: string | null): void
  dispose(): void
}

type BodyColors = {
  shirt: string
  pants: string
  skin: string
  hair: string
  shoes?: string
}

type ClipSet = {
  scene: THREE.Group
  idle: THREE.AnimationClip
  walk: THREE.AnimationClip
  run: THREE.AnimationClip
}

const TARGET_HEIGHT = 1.72
const SHOE = '#1c1c1c'

const COLOR_SLOT: Record<string, keyof BodyColors | 'socks'> = {
  Shirt: 'shirt',
  Pants: 'pants',
  Socks: 'socks',
  Skin: 'skin',
  Hair: 'hair',
  HairBase: 'hair',
  Shoes: 'shoes',
}

let bodies: Record<PersonVoice, ClipSet> | null = null

/** Load the shared man and woman meshes once, before any figure is built. */
export async function preloadFigures(): Promise<void> {
  if (bodies) return
  const loader = new GLTFLoader()
  const base = import.meta.env.BASE_URL
  const [man, woman] = await Promise.all([
    loader.loadAsync(`${base}models/man.glb`),
    loader.loadAsync(`${base}models/woman.glb`),
  ])
  separateMaleShoes(man.scene)
  bodies = {
    male: prepare(man.scene, man.animations),
    female: prepare(woman.scene, woman.animations),
  }
}

export function createFigure(
  opts: BodyColors & { name: string; voice: PersonVoice; showName: boolean; castShadow?: boolean },
): Figure {
  if (!bodies) throw new Error('Call preloadFigures() before creating people')
  const source = bodies[opts.voice]
  const model = cloneSkeleton(source.scene)
  const materials = paint(model, opts)
  const mixer = new THREE.AnimationMixer(model)
  const actions = {
    idle: loop(mixer.clipAction(source.idle)),
    walk: loop(mixer.clipAction(source.walk)),
    run: loop(mixer.clipAction(source.run)),
  }
  let mode: keyof typeof actions = 'idle'
  actions.idle.play()

  const root = new THREE.Group()
  root.name = opts.name
  root.add(model)

  const name = opts.showName ? nameSprite(opts.name) : null
  if (name) root.add(name)
  const bubble = nameSprite('')
  bubble.position.y = TARGET_HEIGHT + 0.62
  bubble.scale.set(3.1, 0.62, 1)
  bubble.visible = false
  root.add(bubble)

  return {
    root,
    update(dt, speed) {
      const next: keyof typeof actions = speed > 3.2 ? 'run' : speed > 0.35 ? 'walk' : 'idle'
      if (next !== mode) {
        actions[next].reset().fadeIn(0.18).play()
        actions[mode].fadeOut(0.18)
        mode = next
      }
      const action = actions[mode]
      if (mode === 'walk') action.timeScale = THREE.MathUtils.clamp(speed / 1.35, 0.85, 1.45)
      if (mode === 'run') action.timeScale = THREE.MathUtils.clamp(speed / 4.2, 0.9, 1.55)
      mixer.update(dt)
    },
    setBubble(text) {
      const mat = bubble.material
      if (!text) {
        bubble.visible = false
        return
      }
      mat.map?.dispose()
      const texture = speechTexture(text)
      mat.map = texture
      mat.needsUpdate = true
      bubble.visible = true
      materials.push(texture)
    },
    dispose() {
      mixer.stopAllAction()
      for (const item of materials) item.dispose()
      const nameMat = name?.material
      nameMat?.map?.dispose()
      nameMat?.dispose()
      bubble.material.map?.dispose()
      bubble.material.dispose()
    },
  }
}

/** The man file stores the shoes in the Eyes primitive. Split them so shoe color leaves the eyes alone. */
function separateMaleShoes(root: THREE.Object3D): void {
  const found: THREE.SkinnedMesh[] = []
  root.traverse((obj) => {
    if (obj instanceof THREE.SkinnedMesh) found.push(obj)
  })
  for (const mesh of found) {
    const material = mesh.material
    if (Array.isArray(material) || material.name !== 'Eyes' || !mesh.geometry.index) continue
    const head = mesh.skeleton.bones.findIndex((bone) => bone.name === 'Head')
    if (head < 0) continue
    const geo = mesh.geometry
    const index = geo.index
    const skinIndex = geo.getAttribute('skinIndex')
    const skinWeight = geo.getAttribute('skinWeight')
    if (!index || !skinIndex || !skinWeight) continue
    const eyeVert = new Uint8Array(skinIndex.count)
    for (let i = 0; i < skinIndex.count; i++) {
      let best = 0
      let weight = -1
      for (let k = 0; k < skinWeight.itemSize; k++) {
        const w = skinWeight.getComponent(i, k)
        if (w > weight) {
          weight = w
          best = skinIndex.getComponent(i, k)
        }
      }
      eyeVert[i] = best === head ? 1 : 0
    }
    const eyeTris: number[] = []
    const shoeTris: number[] = []
    for (let t = 0; t < index.count; t += 3) {
      const tri = [index.getX(t), index.getX(t + 1), index.getX(t + 2)]
      const eyes = (eyeVert[tri[0]!] ?? 0) + (eyeVert[tri[1]!] ?? 0) + (eyeVert[tri[2]!] ?? 0)
      ;(eyes >= 2 ? eyeTris : shoeTris).push(tri[0]!, tri[1]!, tri[2]!)
    }
    if (shoeTris.length === 0) continue
    const shoes = new THREE.SkinnedMesh(sliceGeometry(geo, shoeTris), material.clone())
    shoes.material.name = 'Shoes'
    shoes.name = `${mesh.name}_Shoes`
    shoes.bind(mesh.skeleton, mesh.bindMatrix)
    mesh.parent?.add(shoes)
    mesh.geometry = sliceGeometry(geo, eyeTris)
    geo.dispose()
  }
}

function sliceGeometry(source: THREE.BufferGeometry, tris: number[]): THREE.BufferGeometry {
  const map = new Map<number, number>()
  const index: number[] = []
  for (const src of tris) {
    let dst = map.get(src)
    if (dst === undefined) {
      dst = map.size
      map.set(src, dst)
    }
    index.push(dst)
  }
  const order = [...map.keys()]
  const geo = new THREE.BufferGeometry()
  for (const name of ['position', 'normal', 'skinIndex', 'skinWeight'] as const) {
    const attr = source.getAttribute(name)
    if (!attr) continue
    const item = attr.itemSize
    const array = new (attr.array.constructor as new (length: number) => typeof attr.array)(order.length * item)
    for (let i = 0; i < order.length; i++) {
      const src = order[i]!
      for (let k = 0; k < item; k++) array[i * item + k] = attr.getComponent(src, k)
    }
    geo.setAttribute(name, new THREE.BufferAttribute(array, item))
  }
  geo.setIndex(index)
  return geo
}

function prepare(scene: THREE.Group, clips: THREE.AnimationClip[]): ClipSet {
  scene.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(scene)
  const height = box.max.y - box.min.y
  const scale = TARGET_HEIGHT / height
  scene.scale.multiplyScalar(scale)
  scene.position.y -= box.min.y * scale
  return {
    scene,
    idle: clipNamed(clips, 'idle'),
    walk: clipNamed(clips, 'walk'),
    run: clipNamed(clips, 'run'),
  }
}

function clipNamed(clips: THREE.AnimationClip[], suffix: string): THREE.AnimationClip {
  const clip = clips.find((entry) => new RegExp(`[_|]${suffix}$`, 'i').test(entry.name))
  if (!clip) throw new Error(`Character file has no ${suffix} animation`)
  return clip
}

function loop(action: THREE.AnimationAction): THREE.AnimationAction {
  action.setLoop(THREE.LoopRepeat, Infinity)
  action.clampWhenFinished = false
  return action
}

function paint(
  model: THREE.Object3D,
  colors: BodyColors & { castShadow?: boolean },
): { dispose(): void }[] {
  const made: { dispose(): void }[] = []
  const shadow = colors.castShadow !== false
  model.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return
    obj.castShadow = shadow
    obj.frustumCulled = !shadow
    const list = Array.isArray(obj.material) ? obj.material : [obj.material]
    const painted = list.map((material) => recolor(material, colors, made))
    obj.material = painted.length === 1 ? painted[0]! : painted
  })
  return made
}

function recolor(
  source: THREE.Material,
  colors: BodyColors,
  made: { dispose(): void }[],
): THREE.Material {
  const material = source.clone()
  made.push(material)
  if (!(material instanceof THREE.MeshStandardMaterial)) return material
  const slot = COLOR_SLOT[material.name]
  if (!slot) return material
  material.color.set(tint(colors, slot))
  material.metalness = 0
  material.roughness = slot === 'skin' ? 0.62 : 0.74
  return material
}

/** The man mesh has no shoe piece. His socks are the shoes. Named people keep black shoes and pants-colored socks. */
function tint(colors: BodyColors, slot: keyof BodyColors | 'shoes' | 'socks'): string {
  if (slot === 'shoes') return colors.shoes ?? SHOE
  if (slot === 'socks') return colors.shoes ?? colors.pants
  return colors[slot]
}

function nameSprite(name: string): THREE.Sprite {
  const texture = speechTexture(name, false)
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false })
  const sprite = new THREE.Sprite(material)
  sprite.position.y = TARGET_HEIGHT + 0.28
  sprite.scale.set(2.4, 0.42, 1)
  sprite.renderOrder = 3
  return sprite
}

function speechTexture(text: string, bubble = true): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 96
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    if (text) {
      ctx.fillStyle = bubble ? 'rgba(255, 250, 240, 0.94)' : 'rgba(12, 18, 24, 0.55)'
      ctx.fillRect(8, 18, 496, 60)
      ctx.fillStyle = bubble ? '#1c2430' : '#f4efe4'
      ctx.font = bubble ? '600 28px sans-serif' : '600 32px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(text.slice(0, 42), 256, 48)
    }
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}
