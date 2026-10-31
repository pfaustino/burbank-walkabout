import * as THREE from 'three'

/** City meshes are cut into square tiles so far-off blocks skip both the main and shadow passes. */
export const TILE_SIZE = 400
/** Beyond the farthest fog (900 m), so hiding a tile never changes what is on screen. */
export const TILE_REACH = 1000

export function tileKeyAt(x: number, z: number): string {
  return `${Math.floor(x / TILE_SIZE)},${Math.floor(z / TILE_SIZE)}`
}

/** The group for the tile under (x, z), created on first use as a child of `root`. */
export function tileGroup(root: THREE.Group, tiles: Map<string, THREE.Group>, x: number, z: number): THREE.Group {
  const key = tileKeyAt(x, z)
  let tile = tiles.get(key)
  if (!tile) {
    tile = new THREE.Group()
    tile.name = `tile ${key}`
    tiles.set(key, tile)
    root.add(tile)
  }
  return tile
}

/** Record each tile's footprint once its contents are in place. Content may hang past the tile edge. */
export function sealTiles(tiles: Map<string, THREE.Group>): void {
  for (const tile of tiles.values()) tile.userData.tileBox = new THREE.Box3().setFromObject(tile)
}

export function showNearbyTiles(root: THREE.Object3D, x: number, z: number, reach = TILE_REACH): void {
  for (const child of root.children) {
    const box = child.userData.tileBox as THREE.Box3 | undefined
    if (!box) continue
    const dx = Math.max(box.min.x - x, 0, x - box.max.x)
    const dz = Math.max(box.min.z - z, 0, z - box.max.z)
    child.visible = dx * dx + dz * dz < reach * reach
  }
}
