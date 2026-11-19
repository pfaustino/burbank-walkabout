import { BODY_RADIUS, hitsBuilding, type CityLayout } from '../world/layout.ts'

const LOCATION_KEY = 'burbank-location'

export interface SavedLocation {
  x: number
  z: number
  yaw?: number
}

/** Parse and validate a saved location against the city bounds and buildings. */
export function resolveSavedLocation(layout: CityLayout, raw: string | null): SavedLocation {
  const fallback: SavedLocation = { x: layout.file.spawn.x, z: layout.file.spawn.z }
  if (!raw) return fallback
  try {
    const parsed = JSON.parse(raw) as Partial<SavedLocation> | null
    if (!parsed || typeof parsed !== 'object') return fallback
    const { x, z, yaw } = parsed
    if (typeof x !== 'number' || !Number.isFinite(x) || typeof z !== 'number' || !Number.isFinite(z)) {
      return fallback
    }
    const { bounds } = layout.file
    if (x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ) {
      return fallback
    }
    const spot = clearBuilding(layout, x, z)
    return {
      x: spot.x,
      z: spot.z,
      yaw: typeof yaw === 'number' && Number.isFinite(yaw) ? yaw : undefined,
    }
  } catch {
    return fallback
  }
}

function clearBuilding(layout: CityLayout, x: number, z: number): { x: number; z: number } {
  if (!hitsBuilding(layout, x, z, BODY_RADIUS)) return { x, z }
  for (let radius = 2; radius <= 60; radius += 4) {
    for (let step = 0; step < 12; step++) {
      const angle = (step / 12) * Math.PI * 2
      const nx = x + Math.cos(angle) * radius
      const nz = z + Math.sin(angle) * radius
      if (!hitsBuilding(layout, nx, nz, BODY_RADIUS)) return { x: nx, z: nz }
    }
  }
  return { x: layout.file.spawn.x, z: layout.file.spawn.z }
}

/** Load the player's last known street location, falling back to the city spawn. */
export function loadLastLocation(layout: CityLayout): SavedLocation {
  try {
    return resolveSavedLocation(layout, localStorage.getItem(LOCATION_KEY))
  } catch {
    return { x: layout.file.spawn.x, z: layout.file.spawn.z }
  }
}

/** Persist the player's current street location and facing yaw. */
export function saveLastLocation(x: number, z: number, yaw: number): void {
  if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(yaw)) return
  try {
    localStorage.setItem(LOCATION_KEY, JSON.stringify({ x, z, yaw }))
  } catch {
    // Private browsing or quota limits can refuse storage.
  }
}
