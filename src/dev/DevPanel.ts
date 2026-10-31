import { hitsBuilding, type CityLayout, type MapRoad } from '../world/layout.ts'
import addresses from '../../data/addresses.json'
import { findAddress, type AddressPin } from './address.ts'

export function mountDevPanel(input: {
  layout: CityLayout
  landmarks: { name: string; x: number; z: number }[]
  people: { id: string; name: string }[]
  teleport: (x: number, z: number) => void
  meet: (id: string) => void
}): void {
  const root = document.querySelector('#dev-panel')
  if (!(root instanceof HTMLElement)) return
  root.hidden = false
  root.replaceChildren()

  const title = document.createElement('p')
  title.textContent = 'dev'
  root.append(title)
  root.append(addressForm(input.layout, input.teleport))

  root.append(
    pullDown(
      'Locations',
      input.landmarks.map((place, index) => ({ value: String(index), text: place.name })),
      (value) => {
        const place = input.landmarks[Number(value)]
        if (place) input.teleport(place.x, place.z)
      },
    ),
  )
  root.append(
    pullDown(
      'NPCs',
      input.people.map((person) => ({ value: person.id, text: person.name })),
      (value) => input.meet(value),
    ),
  )
}

/** Parks and stores that are not named buildings on the map. */
export function shortcutPlaces(
  layout: CityLayout,
  businesses: { name: string; x: number; z: number }[],
): { name: string; x: number; z: number }[] {
  const places: { name: string; x: number; z: number }[] = []
  const verdugo = parkCenter(layout, 'Verdugo Park')
  if (verdugo) places.push({ name: 'Verdugo Park', ...openSpot(layout, verdugo.x, verdugo.z) })
  const magnolia = boulevardCrossing(layout, /magnolia boulevard/i, /hollywood way/i)
  if (magnolia) places.push({ name: 'Magnolia Park', ...openSpot(layout, magnolia.x, magnolia.z) })
  const named: [string, string][] = [
    ['Providence Saint Joseph Medical Center', "St. Joseph's Hospital"],
    ['IKEA', 'IKEA'],
    ['Walmart Supercenter', 'Walmart'],
  ]
  for (const [match, label] of named) {
    const shop = businesses.find((business) => business.name === match)
    if (!shop) continue
    places.push({ name: label, ...openSpot(layout, shop.x, shop.z) })
  }
  return places
}

function addressForm(layout: CityLayout, teleport: (x: number, z: number) => void): HTMLFormElement {
  const form = document.createElement('form')
  const field = document.createElement('input')
  field.type = 'search'
  field.placeholder = 'Address'
  field.ariaLabel = 'Address'
  field.autocomplete = 'off'
  field.spellcheck = false
  const note = document.createElement('p')
  note.className = 'dev-note'
  form.append(field, note)
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    const spot = findAddress(field.value, addresses as AddressPin[], layout.file.roads)
    if (!spot) {
      note.textContent = 'No address like that'
      return
    }
    note.textContent = ''
    const clear = openSpot(layout, spot.x, spot.z)
    teleport(clear.x, clear.z)
    field.blur()
  })
  field.addEventListener('input', () => {
    note.textContent = ''
  })
  return form
}

function pullDown(label: string, options: { value: string; text: string }[], onPick: (value: string) => void): HTMLSelectElement {
  const select = document.createElement('select')
  select.ariaLabel = label
  const blank = document.createElement('option')
  blank.value = ''
  blank.textContent = label
  select.append(blank)
  for (const option of options) {
    const item = document.createElement('option')
    item.value = option.value
    item.textContent = option.text
    select.append(item)
  }
  select.addEventListener('change', () => {
    const value = select.value
    select.value = ''
    select.blur()
    if (value) onPick(value)
  })
  return select
}

function parkCenter(layout: CityLayout, name: string): { x: number; z: number } | null {
  const park = layout.file.parks.find((entry) => entry.name === name)
  if (!park || park.ring.length < 2) return null
  let x = 0
  let z = 0
  let count = 0
  for (let i = 0; i < park.ring.length; i += 2) {
    x += park.ring[i] ?? 0
    z += park.ring[i + 1] ?? 0
    count += 1
  }
  return count > 0 ? { x: x / count, z: z / count } : null
}

function boulevardCrossing(layout: CityLayout, left: RegExp, right: RegExp): { x: number; z: number } | null {
  const roads = layout.file.roads.filter((road) => road.kind !== 'service')
  const from = roads.filter((road) => left.test(road.name))
  const onto = roads.filter((road) => right.test(road.name))
  let best = 40
  let point: { x: number; z: number } | null = null
  for (const road of from) {
    for (let i = 0; i < road.pts.length; i += 2) {
      const x = road.pts[i] ?? 0
      const z = road.pts[i + 1] ?? 0
      const hit = project(onto, x, z)
      if (hit.d < best) {
        best = hit.d
        point = { x: (x + hit.x) / 2, z: (z + hit.z) / 2 }
      }
    }
  }
  return point
}

function project(roads: MapRoad[], x: number, z: number): { x: number; z: number; d: number } {
  let bestD = Infinity
  let px = x
  let pz = z
  for (const road of roads) {
    for (let i = 0; i < road.pts.length - 2; i += 2) {
      const ax = road.pts[i] ?? 0
      const az = road.pts[i + 1] ?? 0
      const bx = road.pts[i + 2] ?? ax
      const bz = road.pts[i + 3] ?? az
      const dx = bx - ax
      const dz = bz - az
      const len2 = dx * dx + dz * dz || 1
      const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / len2))
      const qx = ax + dx * t
      const qz = az + dz * t
      const dist = Math.hypot(x - qx, z - qz)
      if (dist < bestD) {
        bestD = dist
        px = qx
        pz = qz
      }
    }
  }
  return { x: px, z: pz, d: bestD }
}

/** Step out of a building so the shortcut does not leave you inside a wall. */
function openSpot(layout: CityLayout, x: number, z: number): { x: number; z: number } {
  if (!hitsBuilding(layout, x, z, 0.8)) return { x, z }
  for (let radius = 6; radius <= 140; radius += 6) {
    for (let step = 0; step < 12; step++) {
      const angle = (step / 12) * Math.PI * 2
      const nx = x + Math.cos(angle) * radius
      const nz = z + Math.sin(angle) * radius
      if (!hitsBuilding(layout, nx, nz, 0.8)) return { x: nx, z: nz }
    }
  }
  return { x, z }
}
