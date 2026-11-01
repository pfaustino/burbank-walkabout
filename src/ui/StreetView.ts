const KEY = import.meta.env.VITE_GOOGLE_MAPS_EMBED_KEY ?? ''

/** Google's Street View for the building in the middle of the view. */
export class StreetView {
  private readonly root = must('#streetview')
  private readonly label = must('#streetview-name')
  private readonly frame = document.querySelector<HTMLIFrameElement>('#streetview-frame')
  private sig = ''
  private misses = 0

  show(name: string, lat: number, lng: number, heading: number): void {
    if (!KEY || !this.frame) return
    this.misses = 0
    this.root.hidden = false
    this.label.textContent = name
    const sig = `${lat.toFixed(5)},${lng.toFixed(5)},${Math.round(heading)}`
    if (sig === this.sig) return
    this.sig = sig
    const query = new URLSearchParams({
      key: KEY,
      location: `${lat.toFixed(5)},${lng.toFixed(5)}`,
      heading: String(Math.round(heading)),
      pitch: '8',
      fov: '80',
    })
    this.frame.src = `https://www.google.com/maps/embed/v1/streetview?${query}`
  }

  /** Hide after the look has missed for a couple of checks, so a glance at the sky does not flash it off. */
  clear(): void {
    this.misses += 1
    if (this.misses < 3) return
    this.root.hidden = true
  }
}

function must(id: string): HTMLElement {
  const el = document.querySelector(id)
  if (!el) throw new Error(`Missing ${id}`)
  return el as HTMLElement
}
