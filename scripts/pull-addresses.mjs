/**
 * House numbers from the local OpenStreetMap extract, in the same meters as the map.
 * The extract is © OpenStreetMap contributors, ODbL.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'

const LAT0 = 34.183
const LON0 = -118.308
const MX = 111_320 * Math.cos((LAT0 * Math.PI) / 180)
const MZ = 110_540

function project(lat, lon) {
  return {
    x: Math.round((lon - LON0) * MX * 100) / 100,
    z: Math.round((LAT0 - lat) * MZ * 100) / 100,
  }
}

function center(element) {
  if (Number.isFinite(element.lat) && Number.isFinite(element.lon)) return project(element.lat, element.lon)
  const geometry = element.geometry ?? element.center
  if (element.center) return project(element.center.lat, element.center.lon)
  if (!geometry || geometry.length === 0) return null
  let lat = 0
  let lon = 0
  for (const point of geometry) {
    lat += point.lat
    lon += point.lon
  }
  return project(lat / geometry.length, lon / geometry.length)
}

const seen = new Set()
const addresses = []
const parts = readdirSync('.').filter((name) => /^tmp-burbank-part-\d+\.json$/.test(name)).sort()
for (const name of parts) {
  const text = readFileSync(name, 'utf8')
  if (!text.startsWith('{')) continue
  const file = JSON.parse(text)
  for (const element of file.elements ?? []) {
    const tags = element.tags
    const number = tags?.['addr:housenumber']?.trim()
    const street = tags?.['addr:street']?.trim()
    if (!number || !street || number.length > 12 || street.length > 48) continue
    const point = center(element)
    if (!point) continue
    if (point.x < -5900 || point.x > 2700 || point.z < -4300 || point.z > 4400) continue
    const key = `${number.toLowerCase()}|${street.toLowerCase()}|${Math.round(point.x)}|${Math.round(point.z)}`
    if (seen.has(key)) continue
    seen.add(key)
    addresses.push({ n: number, s: street, x: point.x, z: point.z })
  }
}
addresses.sort((a, b) => a.s.localeCompare(b.s) || a.n.localeCompare(b.n, undefined, { numeric: true }))
writeFileSync('data/addresses.json', JSON.stringify(addresses))
console.log('addresses', addresses.length, 'bytes', Buffer.byteLength(JSON.stringify(addresses)))
