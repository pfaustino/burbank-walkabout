import type { CityLayout } from '../world/layout.ts'

export type MinimapMarker = {
  x: number
  z: number
  yaw?: number
}

const VIEW_METERS = 280
const SIZE = 200
const PAD = 18

/** North (+z) is up and east (+x) is right, in pixels from the player. */
export function minimapDelta(dx: number, dz: number, pixelsPerMeter: number): { x: number; y: number } {
  return { x: dx * pixelsPerMeter, y: -dz * pixelsPerMeter }
}

export class Minimap {
  private readonly ctx: CanvasRenderingContext2D
  private readonly bake: HTMLCanvasElement
  private readonly ppm: number
  private readonly minX: number
  private readonly maxZ: number

  constructor(layout: CityLayout) {
    const canvas = document.querySelector('#minimap')
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Missing #minimap')
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Missing minimap context')
    this.ctx = ctx
    const { bounds } = layout.file
    this.minX = bounds.minX
    this.maxZ = bounds.maxZ
    this.ppm = 0.8
    this.bake = document.createElement('canvas')
    this.bake.width = Math.max(1, Math.ceil((bounds.maxX - bounds.minX) * this.ppm))
    this.bake.height = Math.max(1, Math.ceil((bounds.maxZ - bounds.minZ) * this.ppm))
    const bakeCtx = this.bake.getContext('2d')
    if (!bakeCtx) throw new Error('Missing minimap bake')
    paintCity(bakeCtx, layout, this.ppm, this.minX, this.maxZ)
  }

  draw(input: {
    x: number
    z: number
    yaw: number
    buses: MinimapMarker[]
    crowdXY: Float32Array
    people: MinimapMarker[]
    heli: MinimapMarker
    job?: { x: number; z: number; dropoff: boolean } | null
  }): void {
    const ctx = this.ctx
    const inner = SIZE - PAD * 2
    const scale = inner / VIEW_METERS
    ctx.clearRect(0, 0, SIZE, SIZE)
    ctx.fillStyle = '#102030'
    roundPath(ctx, 1, 1, SIZE - 2, SIZE - 2, 16)
    ctx.fill()

    ctx.save()
    roundPath(ctx, PAD, PAD, inner, inner, 10)
    ctx.clip()
    ctx.fillStyle = '#1b2c3c'
    ctx.fillRect(PAD, PAD, inner, inner)
    blit(ctx, this.bake, this.ppm, this.minX, this.maxZ, input.x, input.z, inner)

    const project = (x: number, z: number): { sx: number; sy: number } => {
      const delta = minimapDelta(x - input.x, z - input.z, scale)
      return { sx: PAD + inner / 2 + delta.x, sy: PAD + inner / 2 + delta.y }
    }
    const inside = (sx: number, sy: number): boolean => sx >= PAD && sy >= PAD && sx <= PAD + inner && sy <= PAD + inner

    ctx.fillStyle = 'rgba(246, 241, 230, 0.72)'
    for (let i = 0; i < input.crowdXY.length; i += 2) {
      const spot = project(input.crowdXY[i] ?? 0, input.crowdXY[i + 1] ?? 0)
      if (!inside(spot.sx, spot.sy)) continue
      ctx.fillRect(spot.sx - 1, spot.sy - 1, 2, 2)
    }

    ctx.fillStyle = '#f0c14d'
    for (const bus of input.buses) {
      const spot = project(bus.x, bus.z)
      if (!inside(spot.sx, spot.sy)) continue
      ctx.save()
      ctx.translate(spot.sx, spot.sy)
      ctx.rotate(bus.yaw ?? 0)
      ctx.fillRect(-2, -6, 4, 12)
      ctx.restore()
    }

    const heli = project(input.heli.x, input.heli.z)
    if (inside(heli.sx, heli.sy)) {
      ctx.strokeStyle = '#7ec8e3'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.arc(heli.sx, heli.sy, 4, 0, Math.PI * 2)
      ctx.moveTo(heli.sx - 7, heli.sy)
      ctx.lineTo(heli.sx + 7, heli.sy)
      ctx.moveTo(heli.sx, heli.sy - 7)
      ctx.lineTo(heli.sx, heli.sy + 7)
      ctx.stroke()
    }

    ctx.fillStyle = '#e07a3d'
    for (const person of input.people) {
      const spot = project(person.x, person.z)
      if (!inside(spot.sx, spot.sy)) continue
      ctx.beginPath()
      ctx.arc(spot.sx, spot.sy, 3, 0, Math.PI * 2)
      ctx.fill()
    }

    if (input.job) paintJob(ctx, project(input.job.x, input.job.z), input.job.dropoff, PAD, inner)

    const player = project(input.x, input.z)
    ctx.save()
    ctx.translate(player.sx, player.sy)
    ctx.rotate(input.yaw)
    ctx.fillStyle = '#f6f1e6'
    ctx.beginPath()
    ctx.moveTo(0, -8)
    ctx.lineTo(5, 6)
    ctx.lineTo(0, 3)
    ctx.lineTo(-5, 6)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
    ctx.restore()

    ctx.fillStyle = '#f0c14d'
    ctx.font = '700 13px Segoe UI, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('N', SIZE / 2, 10)
    ctx.fillStyle = '#f6f1e6'
    ctx.fillText('E', SIZE - 10, SIZE / 2)
    ctx.fillText('S', SIZE / 2, SIZE - 8)
    ctx.fillText('W', 10, SIZE / 2)
  }

  dispose(): void {
    this.ctx.clearRect(0, 0, SIZE, SIZE)
  }
}

function paintJob(
  ctx: CanvasRenderingContext2D,
  spot: { sx: number; sy: number },
  dropoff: boolean,
  pad: number,
  inner: number,
): void {
  const cx = pad + inner / 2
  const cy = pad + inner / 2
  const dx = spot.sx - cx
  const dy = spot.sy - cy
  const limit = inner / 2 - 10
  const dist = Math.hypot(dx, dy) || 1
  const clamped = dist > limit
  const sx = clamped ? cx + (dx / dist) * limit : spot.sx
  const sy = clamped ? cy + (dy / dist) * limit : spot.sy
  ctx.save()
  ctx.translate(sx, sy)
  ctx.fillStyle = dropoff ? '#3ddc84' : '#ffc107'
  if (!clamped) {
    ctx.strokeStyle = ctx.fillStyle
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(0, 0, 8, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.rotate(Math.atan2(dx, -dy))
  ctx.beginPath()
  ctx.moveTo(0, -8)
  ctx.lineTo(5, 5)
  ctx.lineTo(0, 2)
  ctx.lineTo(-5, 5)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

function paintCity(ctx: CanvasRenderingContext2D, layout: CityLayout, ppm: number, minX: number, maxZ: number): void {
  const width = ctx.canvas.width
  const height = ctx.canvas.height
  ctx.fillStyle = '#243646'
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = '#3d6b45'
  for (const park of layout.file.parks) fillRing(ctx, park.ring, ppm, minX, maxZ)
  ctx.fillStyle = '#314556'
  for (const building of layout.buildings) fillRing(ctx, building.ring, ppm, minX, maxZ)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const road of layout.file.roads) {
    if (road.kind === 'service' || road.kind === 'pedestrian') continue
    ctx.strokeStyle = road.kind === 'primary' || road.kind === 'secondary' ? '#d5dde6' : '#8b97a3'
    ctx.lineWidth = road.kind === 'primary' ? 2.4 : road.kind === 'secondary' ? 1.8 : 1.1
    strokeRoad(ctx, road.pts, ppm, minX, maxZ)
  }
}

function fillRing(ctx: CanvasRenderingContext2D, ring: number[], ppm: number, minX: number, maxZ: number): void {
  if (ring.length < 6) return
  ctx.beginPath()
  ctx.moveTo(((ring[0] ?? 0) - minX) * ppm, (maxZ - (ring[1] ?? 0)) * ppm)
  for (let i = 2; i < ring.length; i += 2) {
    ctx.lineTo(((ring[i] ?? 0) - minX) * ppm, (maxZ - (ring[i + 1] ?? 0)) * ppm)
  }
  ctx.closePath()
  ctx.fill()
}

function strokeRoad(ctx: CanvasRenderingContext2D, pts: number[], ppm: number, minX: number, maxZ: number): void {
  if (pts.length < 4) return
  ctx.beginPath()
  ctx.moveTo(((pts[0] ?? 0) - minX) * ppm, (maxZ - (pts[1] ?? 0)) * ppm)
  for (let i = 2; i < pts.length; i += 2) {
    ctx.lineTo(((pts[i] ?? 0) - minX) * ppm, (maxZ - (pts[i + 1] ?? 0)) * ppm)
  }
  ctx.stroke()
}

function blit(
  ctx: CanvasRenderingContext2D,
  bake: HTMLCanvasElement,
  ppm: number,
  minX: number,
  maxZ: number,
  playerX: number,
  playerZ: number,
  inner: number,
): void {
  const srcSize = VIEW_METERS * ppm
  let sx = (playerX - minX) * ppm - srcSize / 2
  let sy = (maxZ - playerZ) * ppm - srcSize / 2
  let sw = srcSize
  let sh = srcSize
  let dx = PAD
  let dy = PAD
  let dw = inner
  let dh = inner
  if (sx < 0) {
    const cut = -sx
    dx += (cut / srcSize) * inner
    dw -= (cut / srcSize) * inner
    sw -= cut
    sx = 0
  }
  if (sy < 0) {
    const cut = -sy
    dy += (cut / srcSize) * inner
    dh -= (cut / srcSize) * inner
    sh -= cut
    sy = 0
  }
  if (sx + sw > bake.width) {
    const cut = sx + sw - bake.width
    dw -= (cut / srcSize) * inner
    sw -= cut
  }
  if (sy + sh > bake.height) {
    const cut = sy + sh - bake.height
    dh -= (cut / srcSize) * inner
    sh -= cut
  }
  if (sw > 1 && sh > 1 && dw > 1 && dh > 1) ctx.drawImage(bake, sx, sy, sw, sh, dx, dy, dw, dh)
}

function roundPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}
