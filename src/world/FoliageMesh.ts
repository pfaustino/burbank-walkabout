import { Tree } from '@dgreenheck/ez-tree'
import * as THREE from 'three'
import { placeFoliage, type FoliageFile, type Plant } from './foliage.ts'
import type { CityLayout } from './layout.ts'

const STREET_HEIGHT = 8.2
const CHUNK = 160
const PRESETS = ['Oak Small', 'Ash Small'] as const

export function buildFoliage(
  layout: CityLayout,
  file: FoliageFile,
  rng: () => number,
): { root: THREE.Group; update(time: number): void; dispose(): void } {
  const plants = placeFoliage(layout, file, rng)
  const root = new THREE.Group()
  root.name = 'foliage'
  const trees = plants.filter((plant) => plant.kind === 'tree')
  const bushes = plants.filter((plant) => plant.kind === 'bush')
  const meshes: THREE.InstancedMesh[] = []
  const leafMats: THREE.MeshPhongMaterial[] = []

  PRESETS.forEach((preset, variant) => {
    const placed = trees.filter((plant) => plant.variant === variant)
    const built = streetTree(preset)
    const branches = instancePlants(built.branches, built.branchMat, placed, false)
    const leaves = instancePlants(built.leaves, built.leafMat, placed, false)
    for (const mesh of [...branches, ...leaves]) {
      meshes.push(mesh)
      root.add(mesh)
    }
    if (leaves.length > 0) leafMats.push(built.leafMat)
  })

  const shrub = new THREE.SphereGeometry(0.62, 6, 5)
  shrub.translate(0, 0.48, 0)
  const bushMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 })
  for (const mesh of instancePlants(shrub, bushMat, bushes, true, [0x347a3e, 0x4e9650])) {
    meshes.push(mesh)
    root.add(mesh)
  }

  return {
    root,
    update(time: number) {
      for (const material of leafMats) {
        const shader = material.userData.shader as { uniforms?: { uTime?: { value: number } } } | undefined
        if (shader?.uniforms?.uTime) shader.uniforms.uTime.value = time
      }
    },
    dispose() {
      const geometries = new Set<THREE.BufferGeometry>()
      const materials = new Set<THREE.Material>()
      for (const mesh of meshes) {
        geometries.add(mesh.geometry)
        if (!Array.isArray(mesh.material)) materials.add(mesh.material)
      }
      for (const geometry of geometries) geometry.dispose()
      for (const material of materials) disposeMaterial(material)
    },
  }
}

function streetTree(preset: string): {
  branches: THREE.BufferGeometry
  leaves: THREE.BufferGeometry
  branchMat: THREE.MeshPhongMaterial
  leafMat: THREE.MeshPhongMaterial
} {
  const tree = new Tree()
  tree.loadPreset(preset)
  lighten(tree)
  const branchMat = tree.branchesMesh.material
  const leafMat = tree.leavesMesh.material
  if (!(branchMat instanceof THREE.MeshPhongMaterial) || !(leafMat instanceof THREE.MeshPhongMaterial)) {
    throw new Error('EZ-Tree did not build phong materials')
  }
  const branches = tree.branchesMesh.geometry
  const leaves = tree.leavesMesh.geometry
  copyUv2(branches)
  fitStreet(branches, leaves)
  cloneBark(branchMat)
  if (leafMat.map) {
    leafMat.map = leafMat.map.clone()
    leafMat.map.premultiplyAlpha = false
    leafMat.map.needsUpdate = true
    leafMat.userData.ownsMap = true
  }
  enableInstancedWind(leafMat)
  tree.branchesMesh.geometry = new THREE.BufferGeometry()
  tree.leavesMesh.geometry = new THREE.BufferGeometry()
  return { branches, leaves, branchMat, leafMat }
}

function lighten(tree: Tree): void {
  const branch = tree.options.branch
  branch.levels = Math.min(branch.levels, 3)
  branch.sections[0] = Math.min(branch.sections[0], 8)
  branch.sections[1] = Math.min(branch.sections[1], 5)
  branch.sections[2] = Math.min(branch.sections[2], 4)
  branch.segments[0] = Math.min(branch.segments[0], 5)
  branch.segments[1] = Math.min(branch.segments[1], 4)
  branch.segments[2] = Math.min(branch.segments[2], 3)
  branch.children[0] = Math.min(branch.children[0], 5)
  branch.children[1] = Math.min(branch.children[1], 3)
  branch.children[2] = Math.min(branch.children[2], 2)
  const leaves = tree.options.leaves
  leaves.count = Math.max(8, Math.min(leaves.count, 12))
  leaves.size *= 1.85
  tree.generate()
}

function fitStreet(branches: THREE.BufferGeometry, leaves: THREE.BufferGeometry): void {
  branches.computeBoundingBox()
  leaves.computeBoundingBox()
  const box = branches.boundingBox?.clone() ?? new THREE.Box3()
  if (leaves.boundingBox) box.union(leaves.boundingBox)
  const height = Math.max(0.01, box.max.y - Math.min(0, box.min.y))
  const scale = STREET_HEIGHT / height
  branches.scale(scale, scale, scale)
  leaves.scale(scale, scale, scale)
  const drop = box.min.y * scale
  if (drop < -0.01) {
    branches.translate(0, -drop, 0)
    leaves.translate(0, -drop, 0)
  }
  branches.computeBoundingSphere()
  leaves.computeBoundingSphere()
}

function copyUv2(geometry: THREE.BufferGeometry): void {
  const uv = geometry.getAttribute('uv')
  if (uv && !geometry.getAttribute('uv2')) geometry.setAttribute('uv2', uv)
}

function cloneBark(material: THREE.MeshPhongMaterial): void {
  const record = material as unknown as Record<string, unknown>
  for (const key of ['map', 'aoMap', 'normalMap', 'roughnessMap']) {
    const texture = record[key]
    if (texture instanceof THREE.Texture) record[key] = texture.clone()
  }
}

// EZ-Tree's leaf wind shader replaces project_vertex and skips instanceMatrix.
function enableInstancedWind(material: THREE.MeshPhongMaterial): void {
  const inner = material.onBeforeCompile
  material.onBeforeCompile = (shader, renderer) => {
    inner(shader, renderer)
    shader.vertexShader = shader.vertexShader.replace(
      'mvPosition = modelViewMatrix * mvPosition;',
      `#ifdef USE_INSTANCING
      mvPosition = instanceMatrix * mvPosition;
      #endif
      mvPosition = modelViewMatrix * mvPosition;`,
    )
    const wind = shader.uniforms.uWindStrength?.value
    if (wind instanceof THREE.Vector3) wind.set(0.28, 0, 0.28)
    if (shader.uniforms.uWindScale) shader.uniforms.uWindScale.value = 5
    material.userData.shader = shader
  }
  material.customProgramCacheKey = () => 'ez-leaf-instance'
}

function instancePlants(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  plants: Plant[],
  squash: boolean,
  colors?: number[],
): THREE.InstancedMesh[] {
  if (plants.length === 0) {
    geometry.dispose()
    disposeMaterial(material)
    return []
  }
  markChunkBounds(geometry)
  const groups = new Map<string, Plant[]>()
  for (const plant of plants) {
    const key = `${Math.floor(plant.x / CHUNK)},${Math.floor(plant.z / CHUNK)}`
    const list = groups.get(key) ?? []
    list.push(plant)
    groups.set(key, list)
  }
  const meshes: THREE.InstancedMesh[] = []
  const matrix = new THREE.Matrix4()
  const quat = new THREE.Quaternion()
  const pos = new THREE.Vector3()
  const scl = new THREE.Vector3()
  const up = new THREE.Vector3(0, 1, 0)
  for (const [key, group] of groups) {
    const [ix, iz] = key.split(',').map(Number)
    const originX = (ix! + 0.5) * CHUNK
    const originZ = (iz! + 0.5) * CHUNK
    const mesh = new THREE.InstancedMesh(geometry, material, group.length)
    mesh.position.set(originX, 0, originZ)
    mesh.castShadow = false
    mesh.receiveShadow = true
    mesh.frustumCulled = true
    for (let i = 0; i < group.length; i++) {
      const plant = group[i]!
      quat.setFromAxisAngle(up, plant.yaw)
      const flat = squash ? 0.62 : 1
      scl.set(plant.scale, plant.scale * flat, plant.scale)
      pos.set(plant.x - originX, 0, plant.z - originZ)
      matrix.compose(pos, quat, scl)
      mesh.setMatrixAt(i, matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
    if (colors) {
      const tint = new THREE.Color()
      for (let i = 0; i < group.length; i++) {
        mesh.setColorAt(i, tint.setHex(colors[group[i]!.variant] ?? colors[0]!))
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
    meshes.push(mesh)
  }
  return meshes
}

function markChunkBounds(geometry: THREE.BufferGeometry): void {
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, STREET_HEIGHT * 0.5, 0), CHUNK * 0.75 + 6)
}

function disposeMaterial(material: THREE.Material): void {
  if (material instanceof THREE.MeshPhongMaterial && material.name === 'branches') {
    const record = material as unknown as Record<string, unknown>
    for (const key of ['map', 'aoMap', 'normalMap', 'roughnessMap']) {
      const texture = record[key]
      if (texture instanceof THREE.Texture) texture.dispose()
    }
  }
  if (material instanceof THREE.MeshPhongMaterial && material.userData.ownsMap) material.map?.dispose()
  material.dispose()
}
