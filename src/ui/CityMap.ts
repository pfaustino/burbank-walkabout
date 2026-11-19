import { toLatLon } from '../world/geo.ts'

const KEY = import.meta.env.VITE_GOOGLE_MAPS_EMBED_KEY ?? ''

export interface MapDestination {
  x: number
  z: number
  mode?: 'driving' | 'walking'
}

/** Google's map, centered on the player (with destination trail when active), with a Map / Satellite switch. */
export class CityMap {
  private readonly root = must('#street-map')
  private readonly frame = must<HTMLIFrameElement>('#street-map-frame')
  private readonly road = must<HTMLButtonElement>('#street-map-roadmap')
  private readonly sat = must<HTMLButtonElement>('#street-map-satellite')
  private readonly close = must<HTMLButtonElement>('#street-map-close')
  private readonly onClose: () => void
  private lat = 0
  private lng = 0
  private dest: { lat: number; lng: number; mode: 'driving' | 'walking' } | null = null
  private kind: 'roadmap' | 'satellite' = 'roadmap'

  constructor(onClose: () => void) {
    this.onClose = onClose
    this.road.addEventListener('click', this.onRoad)
    this.sat.addEventListener('click', this.onSat)
    this.close.addEventListener('click', this.onClose)
  }

  show(x: number, z: number, destination?: MapDestination | null): void {
    const spot = toLatLon(x, z)
    this.lat = spot.lat
    this.lng = spot.lng
    if (destination) {
      const end = toLatLon(destination.x, destination.z)
      this.dest = { lat: end.lat, lng: end.lng, mode: destination.mode ?? 'driving' }
    } else {
      this.dest = null
    }
    this.root.hidden = false
    this.paint()
  }

  hide(): void {
    this.root.hidden = true
  }

  dispose(): void {
    this.road.removeEventListener('click', this.onRoad)
    this.sat.removeEventListener('click', this.onSat)
    this.close.removeEventListener('click', this.onClose)
    this.hide()
  }

  private readonly onRoad = (): void => {
    this.setKind('roadmap')
  }

  private readonly onSat = (): void => {
    this.setKind('satellite')
  }

  private setKind(kind: 'roadmap' | 'satellite'): void {
    if (kind === this.kind) return
    this.kind = kind
    this.paint()
  }

  private paint(): void {
    this.road.setAttribute('aria-pressed', this.kind === 'roadmap' ? 'true' : 'false')
    this.sat.setAttribute('aria-pressed', this.kind === 'satellite' ? 'true' : 'false')
    if (!KEY) return
    const here = `${this.lat.toFixed(5)},${this.lng.toFixed(5)}`
    const src = this.dest
      ? `https://www.google.com/maps/embed/v1/directions?${new URLSearchParams({
          key: KEY,
          origin: here,
          destination: `${this.dest.lat.toFixed(5)},${this.dest.lng.toFixed(5)}`,
          mode: this.dest.mode,
          maptype: this.kind,
        })}`
      : `https://www.google.com/maps/embed/v1/place?${new URLSearchParams({
          key: KEY,
          q: here,
          center: here,
          zoom: '17',
          maptype: this.kind,
        })}`
    if (this.frame.src !== src) this.frame.src = src
  }
}

function must<T extends HTMLElement>(id: string): T {
  const el = document.querySelector(id)
  if (!el) throw new Error(`Missing ${id}`)
  return el as T
}
