const KEY = import.meta.env.VITE_GOOGLE_MAPS_EMBED_KEY ?? ''

/** Google's Street View for the building ahead. Stays up once a photo is in it. */
export class StreetView {
  private readonly root = must('#streetview')
  private readonly label = must<HTMLButtonElement>('#streetview-name')
  private readonly zoom = must<HTMLButtonElement>('#streetview-zoom')
  private readonly frame = document.querySelector<HTMLIFrameElement>('#streetview-frame')
  private lat = 0
  private lng = 0
  private heading = 0
  private placed = false
  private zoomed = false

  constructor() {
    this.zoom.addEventListener('click', () => this.setZoom(true))
    this.label.addEventListener('click', () => this.setZoom(!this.zoomed))
  }

  show(name: string, lat: number, lng: number, heading: number): void {
    if (!KEY || !this.frame) return
    this.root.hidden = false
    if (this.zoomed) return
    if (this.placed && this.samePhoto(lat, lng, heading)) return
    this.lat = lat
    this.lng = lng
    this.heading = heading
    this.placed = true
    this.label.textContent = name
    const query = new URLSearchParams({
      key: KEY,
      location: `${lat.toFixed(5)},${lng.toFixed(5)}`,
      heading: String(Math.round(heading)),
      pitch: '8',
      fov: '80',
    })
    this.frame.src = `https://www.google.com/maps/embed/v1/streetview?${query}`
  }

  private samePhoto(lat: number, lng: number, heading: number): boolean {
    const north = (lat - this.lat) * 111_320
    const east = (lng - this.lng) * 111_320 * Math.cos((lat * Math.PI) / 180)
    let turn = Math.abs(heading - this.heading) % 360
    if (turn > 180) turn = 360 - turn
    return Math.hypot(north, east) < 20 && turn < 30
  }

  private setZoom(on: boolean): void {
    this.zoomed = on
    this.root.classList.toggle('is-zoomed', on)
    this.zoom.hidden = on
  }
}

function must<T extends HTMLElement>(id: string): T {
  const el = document.querySelector(id)
  if (!el) throw new Error(`Missing ${id}`)
  return el as T
}
