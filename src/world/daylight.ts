/** One real-world day, compressed so a walk can reach dusk. */
export const DAY_SECONDS = 12 * 60
export const START_HOUR = 9.5

export type SkySample = {
  /** Direction from the player toward the key light. y is up. */
  key: { x: number; y: number; z: number }
  keyColor: number
  keyIntensity: number
  hemiSky: number
  hemiGround: number
  hemiIntensity: number
  background: number
  fog: number
  fogNear: number
  fogFar: number
  sunUp: boolean
  /** 1 in daylight, 0 after the sun has set. */
  shadow: number
  /** 1 at night, 0 at noon. Street lamps use this. */
  night: number
}

export function advanceHour(hour: number, dt: number): number {
  const next = hour + (dt / DAY_SECONDS) * 24
  return ((next % 24) + 24) % 24
}

export function formatHour(hour: number): string {
  const wrapped = ((hour % 24) + 24) % 24
  const minutes = Math.floor(wrapped * 60 + 1e-6)
  const h24 = Math.floor(minutes / 60) % 24
  const mm = minutes % 60
  const am = h24 < 12
  const h12 = h24 % 12 || 12
  return `${h12}:${mm.toString().padStart(2, '0')} ${am ? 'AM' : 'PM'}`
}

export function skyAt(hour: number): SkySample {
  const sun = directionAt(hour)
  const moon = directionAt(hour + 12)
  const sunW = smooth(-0.05, 0.16, sun.y)
  const key = normalize(sun.x * sunW + moon.x * (1 - sunW), sun.y * sunW + moon.y * (1 - sunW), sun.z * sunW + moon.z * (1 - sunW))
  const warm = sun.y > 0 && sun.y < 0.38 ? 1 - sun.y / 0.38 : 0
  const daySky = mix(0xf2a15a, 0x8ec6ea, 1 - warm * 0.8)
  const background = mix(0x101a2c, daySky, sunW)
  const sunColor = mix(0xffb36b, 0xfff3d4, smooth(0.02, 0.4, sun.y))
  return {
    key,
    keyColor: mix(0xb9c9e4, sunColor, sunW),
    keyIntensity: sunW * (0.32 + 0.98 * smooth(0, 0.5, sun.y)) + (1 - sunW) * 0.26,
    hemiSky: mix(0x1a2744, mix(0xf0c49a, 0xcfe8ff, 1 - warm), sunW),
    hemiGround: mix(0x16130f, 0x8a7a62, sunW),
    hemiIntensity: 0.26 + 0.64 * sunW,
    background,
    fog: mix(background, 0x2a3548, (1 - sunW) * 0.45),
    fogNear: 36 + 48 * sunW,
    fogFar: 340 + 560 * sunW,
    sunUp: sun.y > 0.02,
    shadow: sunW,
    night: 1 - sunW,
  }
}

function directionAt(hour: number): { x: number; y: number; z: number } {
  const wrapped = ((hour % 24) + 24) % 24
  const elevation = Math.sin(((wrapped - 6) / 12) * Math.PI)
  const azimuth = ((wrapped - 6) / 24) * Math.PI * 2
  const y = Math.max(-0.35, elevation)
  const hyp = Math.cos(Math.asin(clamp(y, -1, 1)))
  return { x: Math.sin(azimuth) * hyp, y, z: Math.cos(azimuth) * hyp }
}

function normalize(x: number, y: number, z: number): { x: number; y: number; z: number } {
  const len = Math.hypot(x, y, z) || 1
  return { x: x / len, y: y / len, z: z / len }
}

function mix(a: number, b: number, t: number): number {
  const k = clamp(t, 0, 1)
  const ar = (a >> 16) & 255
  const ag = (a >> 8) & 255
  const ab = a & 255
  const br = (b >> 16) & 255
  const bg = (b >> 8) & 255
  const bb = b & 255
  const r = Math.round(ar + (br - ar) * k)
  const g = Math.round(ag + (bg - ag) * k)
  const bl = Math.round(ab + (bb - ab) * k)
  return (r << 16) | (g << 8) | bl
}

function smooth(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
