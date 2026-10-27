/**
 * Named shops and venues in the downtown extract, projected into map meters.
 * Source: OpenStreetMap via Overpass. © OpenStreetMap contributors, ODbL.
 */
import { writeFileSync } from 'node:fs'

const LAT0 = 34.183
const LON0 = -118.308
const MX = 111_320 * Math.cos((LAT0 * Math.PI) / 180)
const MZ = 110_540
const BBOX = '34.177,-118.316,34.189,-118.300'

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
[out:json][timeout:90];
(
  nwr["name"]["shop"](${BBOX});
  nwr["name"]["amenity"](${BBOX});
  nwr["name"]["office"](${BBOX});
  nwr["name"]["tourism"](${BBOX});
  nwr["name"]["leisure"](${BBOX});
);
out center tags;
`

const response = await fetch('https://overpass-api.de/api/interpreter', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'burbank-walkabout/0.1' },
  body: `data=${encodeURIComponent(query)}`,
})
if (!response.ok) throw new Error(`Overpass ${response.status}`)
const raw = await response.json()

function project(lat, lon) {
  return {
    x: Math.round((lon - LON0) * MX * 100) / 100,
    z: Math.round((lat - LAT0) * MZ * 100) / 100,
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

const seen = new Set()
const businesses = []
for (const element of raw.elements ?? []) {
  const tags = element.tags ?? {}
  if (!keep(tags)) continue
  const lat = element.lat ?? element.center?.lat
  const lon = element.lon ?? element.center?.lon
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
  const name = tags.name.trim()
  const key = name.toLowerCase()
  if (seen.has(key)) continue
  seen.add(key)
  const spot = project(lat, lon)
  businesses.push({ name, x: spot.x, z: spot.z, kind: kindOf(tags) })
}
businesses.sort((a, b) => a.name.localeCompare(b.name))
writeFileSync('data/businesses.json', `${JSON.stringify(businesses, null, 2)}\n`)
console.log('businesses', businesses.length)
