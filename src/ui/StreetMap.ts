import type { CityLayout, MapRoad } from '../world/layout.ts'
import { bakedCity, type CityBake } from './cityChart.ts'

export type MapView = {
  centerX: number
  centerZ: number
  ppm: number
  width: number
  height: number
}

export type MapLabel = {
  name: string
  x: number
  z: number
  angle: number
  rank: number
  font: number
}

const MIN_PPM = 0.04
const MAX_PPM = 16
const NAME_GAP = 168

/** North Maple Street reads as N Maple St. */
export function mapLabel(name: string): string {
  return name
    .replace(/^North /, 'N ')
    .replace(/^South /, 'S ')
    .replace(/^East /, 'E ')
    .replace(/^West /, 'W ')
    .replace(/ Boulevard$/, ' Blvd')
    .replace(/ Avenue$/, ' Ave')
    .replace(/ Street$/, ' St')
    .replace(/ Drive$/, ' Dr')
    .replace(/ Road$/, ' Rd')
    .replace(/ Place$/, ' Pl')
    .replace(/ Lane$/, ' Ln')
    .replace(/ Court$/, ' Ct')
}

/** Keep lettering upright. East and west both read left to right. */
export function readableAngle(dx: number, dz: number): number {
  let angle = Math.atan2(dz, dx)
  if (angle > Math.PI / 2) angle -= Math.PI
  if (angle < -Math.PI / 2) angle += Math.PI
  return angle
}

/** Street names that fit the current view, spaced so they do not pile up. */
export function labelsInView(roads: readonly MapRoad[], view: MapView): MapLabel[] {
  const halfW = view.width / view.ppm / 2
  const halfH = view.height / view.ppm / 2
  const minX = view.centerX - halfW
  const maxX = view.centerX + halfW
  const minZ = view.centerZ - halfH
  const maxZ = view.centerZ + halfH
  const candidates: { label: MapLabel; screen: number }[] = []
  for (const road of roads) {
    if (!namedStreet(road)) continue
    const clipped = longestInView(road.pts, minX, maxX, minZ, maxZ)
    if (!clipped) continue
    const screen = clipped.length * view.ppm
    const rank = rankOf(road.kind)
    const minScreen = rank >= 3 ? 46 : rank >= 2 ? 62 : 84
    if (screen < minScreen) continue
    const font = rank >= 3 ? 15 : rank >= 2 ? 14 : 12
    candidates.push({
      screen,
      label: {
        name: mapLabel(road.name),
        x: (clipped.x0 + clipped.x1) / 2,
        z: (clipped.z0 + clipped.z1) / 2,
        angle: readableAngle(clipped.x1 - clipped.x0, clipped.z1 - clipped.z0),
        rank,
        font,
      },
    })
  }
  candidates.sort((a, b) => b.label.rank - a.label.rank || b.screen - a.screen)
  const placed: MapLabel[] = []
  const boxes: { x: number; y: number; w: number; h: number; name: string }[] = []
  for (const candidate of candidates) {
    if (placed.length >= 120) break
    const label = candidate.label
    const sx = (label.x - view.centerX) * view.ppm + view.width / 2
    const sy = (label.z - view.centerZ) * view.ppm + view.height / 2
    const textW = label.name.length * label.font * 0.54
    const vertical = Math.abs(Math.sin(label.angle)) > Math.abs(Math.cos(label.angle))
    const w = vertical ? label.font + 8 : textW
    const h = vertical ? textW : label.font + 8
    const box = { x: sx - w / 2, y: sy - h / 2, w, h, name: label.name }
    if (sx < -w || sy < -h || sx > view.width + w || sy > view.height + h) continue
    const crowded = boxes.some((other) => {
      const same = other.name === box.name
      const near = Math.hypot(other.x + other.w / 2 - sx, other.y + other.h / 2 - sy) < NAME_GAP
      return (same && near) || overlaps(other, box)
    })
    if (crowded) continue
    boxes.push(box)
    placed.push(label)
  }
  return placed
}

export class StreetMap {
  private readonly root: HTMLElement
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private readonly names: HTMLElement
  private readonly bake: CityBake
  private readonly roads: readonly MapRoad[]
  private readonly bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
  private centerX = 0
  private centerZ = 0
  private ppm = 1
  private playerX = 0
  private playerZ = 0
  private playerYaw = 0
  private shown = false
  private fitted = false
  private panning = false
  private lastX = 0
  private lastY = 0
  private readonly onClose: () => void

  constructor(layout: CityLayout, onClose: () => void) {
    this.onClose = onClose
    this.root = must('#street-map')
    this.canvas = must('#street-map-canvas') as HTMLCanvasElement
    const ctx = this.canvas.getContext('2d')
    if (!ctx) throw new Error('Missing street map context')
    this.ctx = ctx
    this.names = must('#street-map-names')
    this.bake = bakedCity(layout)
    this.roads = layout.file.roads
    this.bounds = layout.file.bounds
    must('#street-map-close').addEventListener('click', () => this.onClose())
    must('#street-map-in').addEventListener('click', () => this.zoomBy(1.25, this.canvas.clientWidth / 2, this.canvas.clientHeight / 2))
    must('#street-map-out').addEventListener('click', () => this.zoomBy(1 / 1.25, this.canvas.clientWidth / 2, this.canvas.clientHeight / 2))
    this.root.addEventListener('wheel', this.onWheel, { passive: false })
    this.root.addEventListener('pointerdown', this.onPointerDown)
    this.root.addEventListener('pointermove', this.onPointerMove)
    this.root.addEventListener('pointerup', this.onPointerUp)
    this.root.addEventListener('pointercancel', this.onPointerUp)
    this.root.addEventListener('mousemove', this.stopLook)
    this.root.addEventListener('contextmenu', this.onContext)
    this.root.addEventListener('dblclick', this.onDoubleClick)
    window.addEventListener('keydown', this.onKey)
    window.addEventListener('resize', this.onResize)
  }

  show(x: number, z: number, yaw: number): void {
    this.playerX = x
    this.playerZ = z
    this.playerYaw = yaw
    this.centerX = x
    this.centerZ = z
    this.shown = true
    this.root.hidden = false
    if (!this.fitted) {
      this.ppm = this.neighborhood()
      this.fitted = true
    }
    this.clamp()
    this.resize()
  }

  hide(): void {
    this.shown = false
    this.panning = false
    this.root.hidden = true
    this.canvas.classList.remove('is-panning')
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKey)
    window.removeEventListener('resize', this.onResize)
    this.hide()
  }

  private neighborhood(): number {
    const short = Math.min(this.canvas.clientWidth || window.innerWidth, this.canvas.clientHeight || window.innerHeight)
    return clamp(short / 900, this.fitPpm(), MAX_PPM)
  }

  private fitPpm(): number {
    const width = this.canvas.clientWidth || window.innerWidth
    const height = this.canvas.clientHeight || window.innerHeight
    const spanX = this.bounds.maxX - this.bounds.minX
    const spanZ = this.bounds.maxZ - this.bounds.minZ
    return Math.max(MIN_PPM, Math.min(width / spanX, height / spanZ) * 0.92)
  }

  private zoomBy(factor: number, cssX: number, cssY: number): void {
    const width = this.canvas.clientWidth
    const height = this.canvas.clientHeight
    const worldX = this.centerX + (cssX - width / 2) / this.ppm
    const worldZ = this.centerZ + (cssY - height / 2) / this.ppm
    this.ppm = clamp(this.ppm * factor, this.fitPpm(), MAX_PPM)
    this.centerX = worldX - (cssX - width / 2) / this.ppm
    this.centerZ = worldZ - (cssY - height / 2) / this.ppm
    this.clamp()
    this.draw()
  }

  private panPixels(dx: number, dy: number): void {
    this.centerX -= dx / this.ppm
    this.centerZ -= dy / this.ppm
    this.clamp()
    this.draw()
  }

  private clamp(): void {
    const width = (this.canvas.clientWidth || window.innerWidth) / this.ppm
    const height = (this.canvas.clientHeight || window.innerHeight) / this.ppm
    this.centerX = clampCenter(this.centerX, width, this.bounds.minX, this.bounds.maxX)
    this.centerZ = clampCenter(this.centerZ, height, this.bounds.minZ, this.bounds.maxZ)
  }

  private resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const width = Math.max(1, Math.round(this.canvas.clientWidth * dpr))
    const height = Math.max(1, Math.round(this.canvas.clientHeight * dpr))
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width
      this.canvas.height = height
    }
    this.draw()
  }

  private draw(): void {
    if (!this.shown) return
    const cssW = this.canvas.clientWidth
    const cssH = this.canvas.clientHeight
    if (cssW < 2 || cssH < 2) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const ctx = this.ctx
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = '#243646'
    ctx.fillRect(0, 0, cssW, cssH)
    blitBake(ctx, this.bake, this.centerX, this.centerZ, this.ppm, cssW, cssH)
    if (this.ppm >= 0.45) this.strokeRoads(ctx, cssW, cssH)
    const labels = labelsInView(this.roads, {
      centerX: this.centerX,
      centerZ: this.centerZ,
      ppm: this.ppm,
      width: cssW,
      height: cssH,
    })
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineJoin = 'round'
    for (const label of labels) {
      const sx = (label.x - this.centerX) * this.ppm + cssW / 2
      const sy = (label.z - this.centerZ) * this.ppm + cssH / 2
      ctx.save()
      ctx.translate(sx, sy)
      ctx.rotate(label.angle)
      ctx.font = `600 ${label.font}px Segoe UI, sans-serif`
      ctx.lineWidth = 3
      ctx.strokeStyle = 'rgba(16, 32, 48, 0.92)'
      ctx.strokeText(label.name, 0, 0)
      ctx.fillStyle = label.rank >= 3 ? '#f0c14d' : label.rank >= 2 ? '#f6f1e6' : '#e7dcc8'
      ctx.fillText(label.name, 0, 0)
      ctx.restore()
    }
    this.drawPlayer(ctx, cssW, cssH)
    ctx.fillStyle = '#f0c14d'
    ctx.font = '700 14px Segoe UI, sans-serif'
    ctx.fillText('N', cssW / 2, 18)
    this.names.textContent = uniqueNames(labels)
  }

  private strokeRoads(ctx: CanvasRenderingContext2D, cssW: number, cssH: number): void {
    const pad = 40 / this.ppm
    const minX = this.centerX - cssW / this.ppm / 2 - pad
    const maxX = this.centerX + cssW / this.ppm / 2 + pad
    const minZ = this.centerZ - cssH / this.ppm / 2 - pad
    const maxZ = this.centerZ + cssH / this.ppm / 2 + pad
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (const road of this.roads) {
      if (road.kind === 'service' || road.kind === 'pedestrian' || road.pts.length < 4) continue
      if (!hitsBox(road.pts, minX, maxX, minZ, maxZ)) continue
      ctx.strokeStyle = road.kind === 'primary' || road.kind === 'secondary' ? '#d5dde6' : '#9aa6b2'
      ctx.lineWidth = Math.max(1.4, road.w * this.ppm * 0.42)
      ctx.beginPath()
      ctx.moveTo((road.pts[0]! - this.centerX) * this.ppm + cssW / 2, (road.pts[1]! - this.centerZ) * this.ppm + cssH / 2)
      for (let i = 2; i < road.pts.length; i += 2) {
        ctx.lineTo(((road.pts[i] ?? 0) - this.centerX) * this.ppm + cssW / 2, ((road.pts[i + 1] ?? 0) - this.centerZ) * this.ppm + cssH / 2)
      }
      ctx.stroke()
    }
  }

  private drawPlayer(ctx: CanvasRenderingContext2D, cssW: number, cssH: number): void {
    const rawX = (this.playerX - this.centerX) * this.ppm + cssW / 2
    const rawY = (this.playerZ - this.centerZ) * this.ppm + cssH / 2
    const inset = 28
    const sx = clamp(rawX, inset, cssW - inset)
    const sy = clamp(rawY, inset, cssH - inset)
    const off = sx !== rawX || sy !== rawY
    ctx.save()
    ctx.translate(sx, sy)
    ctx.rotate(off ? Math.atan2(rawX - sx, -(rawY - sy)) : Math.PI - this.playerYaw)
    ctx.fillStyle = '#f6f1e6'
    ctx.beginPath()
    ctx.moveTo(0, -9)
    ctx.lineTo(6, 7)
    ctx.lineTo(0, 3)
    ctx.lineTo(-6, 7)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    const dy = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY
    const factor = clamp(Math.exp(-dy * 0.0016), 0.8, 1.25)
    const rect = this.canvas.getBoundingClientRect()
    this.zoomBy(factor, event.clientX - rect.left, event.clientY - rect.top)
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.target instanceof HTMLButtonElement) return
    event.preventDefault()
    event.stopPropagation()
    this.panning = true
    this.lastX = event.clientX
    this.lastY = event.clientY
    this.root.setPointerCapture(event.pointerId)
    this.canvas.classList.add('is-panning')
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    event.stopPropagation()
    if (!this.panning) return
    this.panPixels(event.clientX - this.lastX, event.clientY - this.lastY)
    this.lastX = event.clientX
    this.lastY = event.clientY
  }

  private readonly onPointerUp = (event: PointerEvent): void => {
    this.panning = false
    this.canvas.classList.remove('is-panning')
    if (this.root.hasPointerCapture(event.pointerId)) this.root.releasePointerCapture(event.pointerId)
  }

  private readonly stopLook = (event: MouseEvent): void => {
    event.stopPropagation()
  }

  private readonly onContext = (event: Event): void => {
    event.preventDefault()
  }

  private readonly onDoubleClick = (event: MouseEvent): void => {
    if (event.target instanceof HTMLButtonElement) return
    const rect = this.canvas.getBoundingClientRect()
    this.zoomBy(1.6, event.clientX - rect.left, event.clientY - rect.top)
  }

  private readonly onKey = (event: KeyboardEvent): void => {
    if (!this.shown || event.repeat) return
    const tag = (event.target as HTMLElement | null)?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
    if (event.code === 'Equal' || event.code === 'NumpadAdd') {
      event.preventDefault()
      this.zoomBy(1.25, this.canvas.clientWidth / 2, this.canvas.clientHeight / 2)
    } else if (event.code === 'Minus' || event.code === 'NumpadSubtract') {
      event.preventDefault()
      this.zoomBy(1 / 1.25, this.canvas.clientWidth / 2, this.canvas.clientHeight / 2)
    } else if (event.code === 'ArrowUp') {
      event.preventDefault()
      this.panPixels(0, 90)
    } else if (event.code === 'ArrowDown') {
      event.preventDefault()
      this.panPixels(0, -90)
    } else if (event.code === 'ArrowLeft') {
      event.preventDefault()
      this.panPixels(90, 0)
    } else if (event.code === 'ArrowRight') {
      event.preventDefault()
      this.panPixels(-90, 0)
    }
  }

  private readonly onResize = (): void => {
    if (!this.shown) return
    this.clamp()
    this.resize()
  }
}

function namedStreet(road: MapRoad): boolean {
  if (!road.name || road.kind === 'service' || road.kind === 'pedestrian') return false
  return !/alley|frontage|\blot\b/i.test(road.name)
}

function rankOf(kind: string): number {
  if (kind === 'primary' || kind === 'trunk') return 3
  if (kind === 'secondary') return 2
  if (kind === 'tertiary') return 1
  return 0
}

function longestInView(
  pts: number[],
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
): { x0: number; z0: number; x1: number; z1: number; length: number } | null {
  let best: { x0: number; z0: number; x1: number; z1: number; length: number } | null = null
  for (let i = 0; i < pts.length - 2; i += 2) {
    const clipped = clipSegment(pts[i] ?? 0, pts[i + 1] ?? 0, pts[i + 2] ?? 0, pts[i + 3] ?? 0, minX, maxX, minZ, maxZ)
    if (!clipped) continue
    const length = Math.hypot(clipped.x1 - clipped.x0, clipped.z1 - clipped.z0)
    if (!best || length > best.length) best = { ...clipped, length }
  }
  return best
}

function clipSegment(
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
): { x0: number; z0: number; x1: number; z1: number } | null {
  const code = (x: number, z: number): number =>
    (x < minX - 1e-4 ? 1 : 0) | (x > maxX + 1e-4 ? 2 : 0) | (z < minZ - 1e-4 ? 4 : 0) | (z > maxZ + 1e-4 ? 8 : 0)
  let c0 = code(x0, z0)
  let c1 = code(x1, z1)
  for (let guard = 0; guard < 8; guard++) {
    if ((c0 | c1) === 0) return { x0, z0, x1, z1 }
    if ((c0 & c1) !== 0) return null
    const side = c0 !== 0 ? c0 : c1
    const dx = x1 - x0
    const dz = z1 - z0
    let x = x0
    let z = z0
    if ((side & 8) !== 0 && dz !== 0) {
      z = maxZ
      x = x0 + dx * ((z - z0) / dz)
    } else if ((side & 4) !== 0 && dz !== 0) {
      z = minZ
      x = x0 + dx * ((z - z0) / dz)
    } else if ((side & 2) !== 0 && dx !== 0) {
      x = maxX
      z = z0 + dz * ((x - x0) / dx)
    } else if ((side & 1) !== 0 && dx !== 0) {
      x = minX
      z = z0 + dz * ((x - x0) / dx)
    } else {
      return null
    }
    if (c0 !== 0) {
      x0 = x
      z0 = z
      c0 = code(x0, z0)
    } else {
      x1 = x
      z1 = z
      c1 = code(x1, z1)
    }
  }
  return null
}

function overlaps(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean {
  return a.x < b.x + b.w + 6 && a.x + a.w + 6 > b.x && a.y < b.y + b.h + 6 && a.y + a.h + 6 > b.y
}

function hitsBox(pts: number[], minX: number, maxX: number, minZ: number, maxZ: number): boolean {
  let loX = Infinity
  let hiX = -Infinity
  let loZ = Infinity
  let hiZ = -Infinity
  for (let i = 0; i < pts.length; i += 2) {
    const x = pts[i] ?? 0
    const z = pts[i + 1] ?? 0
    if (x < loX) loX = x
    if (x > hiX) hiX = x
    if (z < loZ) loZ = z
    if (z > hiZ) hiZ = z
  }
  return loX <= maxX && hiX >= minX && loZ <= maxZ && hiZ >= minZ
}

function blitBake(
  ctx: CanvasRenderingContext2D,
  bake: CityBake,
  centerX: number,
  centerZ: number,
  ppm: number,
  cssW: number,
  cssH: number,
): void {
  const viewW = cssW / ppm
  const viewH = cssH / ppm
  let srcX = (centerX - viewW / 2 - bake.minX) * bake.ppm
  let srcY = (centerZ - viewH / 2 - bake.minZ) * bake.ppm
  let srcW = viewW * bake.ppm
  let srcH = viewH * bake.ppm
  let dstX = 0
  let dstY = 0
  let dstW = cssW
  let dstH = cssH
  if (srcX < 0) {
    const cut = -srcX
    dstX += (cut / srcW) * cssW
    dstW -= (cut / srcW) * cssW
    srcW -= cut
    srcX = 0
  }
  if (srcY < 0) {
    const cut = -srcY
    dstY += (cut / srcH) * cssH
    dstH -= (cut / srcH) * cssH
    srcH -= cut
    srcY = 0
  }
  if (srcX + srcW > bake.canvas.width) {
    const cut = srcX + srcW - bake.canvas.width
    dstW -= (cut / (viewW * bake.ppm)) * cssW
    srcW -= cut
  }
  if (srcY + srcH > bake.canvas.height) {
    const cut = srcY + srcH - bake.canvas.height
    dstH -= (cut / (viewH * bake.ppm)) * cssH
    srcH -= cut
  }
  if (srcW > 1 && srcH > 1 && dstW > 1 && dstH > 1) {
    ctx.imageSmoothingEnabled = ppm < 3
    ctx.drawImage(bake.canvas, srcX, srcY, srcW, srcH, dstX, dstY, dstW, dstH)
  }
}

function uniqueNames(labels: readonly MapLabel[]): string {
  const names: string[] = []
  for (const label of labels) {
    if (names.includes(label.name)) continue
    names.push(label.name)
    if (names.length === 24) break
  }
  return names.join(', ')
}

function clampCenter(center: number, view: number, min: number, max: number): number {
  const span = max - min
  if (view >= span) return (min + max) / 2
  const pad = view * 0.15
  return clamp(center, min + pad, max - pad)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function must(selector: string): HTMLElement {
  const node = document.querySelector(selector)
  if (!(node instanceof HTMLElement)) throw new Error(`Missing ${selector}`)
  return node
}
