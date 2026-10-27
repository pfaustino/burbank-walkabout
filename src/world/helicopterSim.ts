export type AirPose = {
  x: number
  y: number
  z: number
  yaw: number
  roll: number
}

export type Tour = {
  x: number
  z: number
  rx: number
  rz: number
}

type Box = { minX: number; maxX: number; minZ: number; maxZ: number }

/** A loop that passes the named downtown places. */
export function tourOver(marks: Box[], fallback: { x: number; z: number }): Tour {
  if (marks.length === 0) return { x: fallback.x, z: fallback.z, rx: 160, rz: 110 }
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const mark of marks) {
    const x = (mark.minX + mark.maxX) / 2
    const z = (mark.minZ + mark.maxZ) / 2
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minZ = Math.min(minZ, z)
    maxZ = Math.max(maxZ, z)
  }
  return {
    x: (minX + maxX) / 2,
    z: (minZ + maxZ) / 2,
    rx: Math.max(140, (maxX - minX) / 2 + 50),
    rz: Math.max(100, (maxZ - minZ) / 2 + 50),
  }
}

/** Nose points along the tangent of the tour. */
export function helicopterPose(tour: Tour, time: number): AirPose {
  const angle = time * 0.14
  const x = tour.x + Math.cos(angle) * tour.rx
  const z = tour.z + Math.sin(angle) * tour.rz
  const dx = -Math.sin(angle) * tour.rx
  const dz = Math.cos(angle) * tour.rz
  return {
    x,
    y: 64 + Math.sin(angle * 2) * 5,
    z,
    yaw: Math.atan2(dx, dz),
    roll: Math.sin(angle) * 0.2,
  }
}
