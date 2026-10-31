/**
 * Named shops and venues inside the city of Burbank, projected into map meters.
 * Source: OpenStreetMap via Overpass. © OpenStreetMap contributors, ODbL.
 * Relation 3529574 is the city. The old downtown box stopped west of Giamela's.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const LAT0 = 34.183
const LON0 = -118.308
const MX = 111_320 * Math.cos((LAT0 * Math.PI) / 180)
const MZ = 110_540
const BBOX = '34.1426633,-118.3702096,34.2216629,-118.2799902'
const SERVERS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
]

const SKIP_AMENITY = new Set([
  'parking',
  'parking_space',
  'parking_entrance',
  'toilets',
  'bench',
  'waste_basket',
  'fountain',
  'bicycle_parking',
  'shelter',
  'telephone',
  'vending_machine',
  'atm',
  'drinking_water',
  'recycling',
  'post_box',
  'charging_station',
  'bicycle_rental',
  'waste_disposal',
  'clock',
  'bbq',
  'public_bookcase',
  'grit_bin',
])

const SKIP_LEISURE = new Set(['park', 'garden', 'pitch', 'playground', 'track', 'nature_reserve', 'dog_park'])

const query = `
[out:json][timeout:180];
(
  nwr["name"]["shop"](${BBOX});
  nwr["name"]["amenity"](${BBOX});
  nwr["name"]["office"](${BBOX});
  nwr["name"]["tourism"](${BBOX});
  nwr["name"]["leisure"](${BBOX});
);
out center tags;
`

let raw = null
let lastError = 'no server'
for (const server of SERVERS) {
  try {
    const response = await fetch(server, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'burbank-walkabout/0.1' },
      body: `data=${encodeURIComponent(query)}`,
    })
    if (!response.ok) {
      lastError = `${server} ${response.status}`
      continue
    }
    const text = await response.text()
    if (text.startsWith('<')) {
      lastError = `${server} returned HTML`
      continue
    }
    raw = JSON.parse(text)
    console.log('server', server, 'elements', raw.elements?.length ?? 0)
    break
  } catch (error) {
    lastError = `${server} ${error instanceof Error ? error.message : error}`
  }
}
if (!raw) throw new Error(lastError)

const city = cityRing()

function project(lat, lon) {
  return {
    x: Math.round((lon - LON0) * MX * 100) / 100,
    z: Math.round((LAT0 - lat) * MZ * 100) / 100,
  }
}

function kindOf(tags) {
  return tags.shop || tags.amenity || tags.tourism || tags.leisure || tags.office || 'place'
}

function keep(tags) {
  const name = (tags.name || '').trim()
  if (name.length < 2 || name.length > 42) return false
  if (SKIP_AMENITY.has(tags.amenity)) return false
  if (SKIP_LEISURE.has(tags.leisure)) return false
  if (tags.tourism === 'information') return false
  return true
}

function cityRing() {
  const boundary = JSON.parse(readFileSync('tmp-burbank-boundary.json', 'utf8'))
  const relation = boundary.elements.find((element) => element.type === 'relation')
  const lines = []
  for (const member of relation?.members ?? []) {
    if (member.role !== 'outer' || !member.geometry || member.geometry.length < 2) continue
    lines.push(member.geometry.map((node) => project(node.lat, node.lon)))
  }
  if (lines.length === 0) throw new Error('Burbank boundary did not project')
  const ring = lines.shift()
  while (lines.length > 0) {
    const end = ring[ring.length - 1]
    let found = -1
    let reverse = false
    let best = Infinity
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const fromStart = Math.hypot(line[0].x - end.x, line[0].z - end.z)
      const fromTail = Math.hypot(line[line.length - 1].x - end.x, line[line.length - 1].z - end.z)
      if (fromStart < best) {
        best = fromStart
        found = i
        reverse = false
      }
      if (fromTail < best) {
        best = fromTail
        found = i
        reverse = true
      }
    }
    if (found < 0 || best > 40) break
    const next = lines.splice(found, 1)[0]
    if (reverse) next.reverse()
    ring.push(...next.slice(1))
  }
  if (ring.length < 3) throw new Error('Burbank boundary did not project')
  return ring
}

function insideCity(x, z, ring) {
  if (pointInRing(x, z, ring)) return true
  return distToRing(x, z, ring) <= 12
}

function pointInRing(x, z, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]
    const b = ring[j]
    const hit = a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z || 1e-9) + a.x
    if (hit) inside = !inside
  }
  return inside
}

function distToRing(x, z, ring) {
  let best = Infinity
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    const dx = b.x - a.x
    const dz = b.z - a.z
    const len2 = dx * dx + dz * dz || 1
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / len2))
    best = Math.min(best, Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t)))
  }
  return best
}

const seen = new Set()
const businesses = []
for (const element of raw.elements ?? []) {
  const tags = element.tags ?? {}
  if (!keep(tags)) continue
  const lat = element.lat ?? element.center?.lat
  const lon = element.lon ?? element.center?.lon
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
  const key = `${element.type}:${element.id}`
  if (seen.has(key)) continue
  seen.add(key)
  const spot = project(lat, lon)
  if (!insideCity(spot.x, spot.z, city)) continue
  businesses.push({ name: tags.name.trim(), x: spot.x, z: spot.z, kind: kindOf(tags) })
}
businesses.sort((a, b) => a.name.localeCompare(b.name))
writeFileSync('data/businesses.json', `${JSON.stringify(businesses, null, 2)}\n`)
console.log('businesses', businesses.length)
