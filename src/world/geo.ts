/** Same origin the map bake uses. +x is east, +z is south. */
const LAT0 = 34.183
const LON0 = -118.308
const MX = 111_320 * Math.cos((LAT0 * Math.PI) / 180)
const MZ = 110_540

export function toLatLon(x: number, z: number): { lat: number; lng: number } {
  return { lat: LAT0 - z / MZ, lng: LON0 + x / MX }
}

/** Degrees clockwise from north. `east` is +x, `south` is +z. */
export function compass(east: number, south: number): number {
  const deg = (Math.atan2(east, -south) * 180) / Math.PI
  return (deg + 360) % 360
}
