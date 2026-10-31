import type { CityLayout } from '../world/layout.ts'

const BAKE_PPM = 0.8

export type CityBake = {
  canvas: HTMLCanvasElement
  ppm: number
  minX: number
  minZ: number
}

const bakes = new WeakMap<CityLayout, CityBake>()

/** One painted city, shared by the corner map and the street map. */
export function bakedCity(layout: CityLayout): CityBake {
  const existing = bakes.get(layout)
  if (existing) return existing
  const { bounds } = layout.file
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil((bounds.maxX - bounds.minX) * BAKE_PPM))
  canvas.height = Math.max(1, Math.ceil((bounds.maxZ - bounds.minZ) * BAKE_PPM))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Missing city chart')
  paintCity(ctx, layout, BAKE_PPM, bounds.minX, bounds.minZ)
  const bake: CityBake = { canvas, ppm: BAKE_PPM, minX: bounds.minX, minZ: bounds.minZ }
  bakes.set(layout, bake)
  return bake
}

function paintCity(ctx: CanvasRenderingContext2D, layout: CityLayout, ppm: number, minX: number, minZ: number): void {
  ctx.fillStyle = '#243646'
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  ctx.fillStyle = '#3d6b45'
  for (const park of layout.file.parks) fillRing(ctx, park.ring, ppm, minX, minZ)
  ctx.fillStyle = '#314556'
  for (const building of layout.buildings) fillRing(ctx, building.ring, ppm, minX, minZ)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const road of layout.file.roads) {
    if (road.kind === 'service' || road.kind === 'pedestrian') continue
    ctx.strokeStyle = road.kind === 'primary' || road.kind === 'secondary' ? '#d5dde6' : '#8b97a3'
    ctx.lineWidth = road.kind === 'primary' ? 2.4 : road.kind === 'secondary' ? 1.8 : 1.1
    strokeRoad(ctx, road.pts, ppm, minX, minZ)
  }
}

function fillRing(ctx: CanvasRenderingContext2D, ring: number[], ppm: number, minX: number, minZ: number): void {
  if (ring.length < 6) return
  ctx.beginPath()
  ctx.moveTo(((ring[0] ?? 0) - minX) * ppm, ((ring[1] ?? 0) - minZ) * ppm)
  for (let i = 2; i < ring.length; i += 2) {
    ctx.lineTo(((ring[i] ?? 0) - minX) * ppm, ((ring[i + 1] ?? 0) - minZ) * ppm)
  }
  ctx.closePath()
  ctx.fill()
}

function strokeRoad(ctx: CanvasRenderingContext2D, pts: number[], ppm: number, minX: number, minZ: number): void {
  if (pts.length < 4) return
  ctx.beginPath()
  ctx.moveTo(((pts[0] ?? 0) - minX) * ppm, ((pts[1] ?? 0) - minZ) * ppm)
  for (let i = 2; i < pts.length; i += 2) {
    ctx.lineTo(((pts[i] ?? 0) - minX) * ppm, ((pts[i + 1] ?? 0) - minZ) * ppm)
  }
  ctx.stroke()
}
