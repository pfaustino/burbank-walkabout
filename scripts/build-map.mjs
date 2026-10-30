/**
 * Turn an Overpass extract into data/map.json.
 * Query downtown Burbank (south,west,north,east) = (34.177,-118.316,34.189,-118.300)
 * and save the response as tmp-downtown.json before running this.
 * The extract is © OpenStreetMap contributors, ODbL.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const LAT0 = 34.183
const LON0 = -118.308
const MX = 111_320 * Math.cos((LAT0 * Math.PI) / 180)
const MZ = 110_540
const BBOX = { minLat: 34.177, maxLat: 34.189, minLon: -118.316, maxLon: -118.3 }

const raw = JSON.parse(readFileSync('tmp-downtown.json', 'utf8'))

function project(lat, lon) {
  return {
    x: round((lon - LON0) * MX),
    z: round((LAT0 - lat) * MZ),
  }
}

function round(value) {
  return Math.round(value * 100) / 100
}

function boundsOf(points) {
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const point of points) {
    minX = Math.min(minX, point.x)
    maxX = Math.max(maxX, point.x)
    minZ = Math.min(minZ, point.z)
    maxZ = Math.max(maxZ, point.z)
  }
  return { minX, maxX, minZ, maxZ }
}

function ringArea(points) {
  let area = 0
  for (let i = 0; i < points.length; i++) {
    const next = points[(i + 1) % points.length]
    area += points[i].x * next.z - next.x * points[i].z
  }
  return area / 2
}

function simplify(points) {
  const out = []
  for (const point of points) {
    const prev = out[out.length - 1]
    if (prev && Math.hypot(point.x - prev.x, point.z - prev.z) < 0.4) continue
    out.push(point)
  }
  if (out.length > 2 && Math.hypot(out[0].x - out[out.length - 1].x, out[0].z - out[out.length - 1].z) < 0.4) out.pop()
  return out
}

function toPoints(geometry) {
  return simplify(geometry.map((node) => project(node.lat, node.lon)))
}

function pointInRing(x, z, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]
    const b = ring[j]
    const hit = a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z + 0) + a.x
    if (hit) inside = !inside
  }
  return inside
}

function distToRing(x, z, ring) {
  if (pointInRing(x, z, ring)) return 0
  let best = Infinity
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    const dx = b.x - a.x
    const dz = b.z - a.z
    const len2 = dx * dx + dz * dz || 1
    const t = Math.min(1, Math.max(0, ((x - a.x) * dx + (z - a.z) * dz) / len2))
    best = Math.min(best, Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t)))
  }
  return best
}

function clearOfBuildings(x, z, buildings) {
  for (const building of buildings) {
    if (x < building.minX - 1 || x > building.maxX + 1 || z < building.minZ - 1 || z > building.maxZ + 1) continue
    if (distToRing(x, z, building.points) < 0.9) return false
  }
  return true
}

function heightOf(tags) {
  const rawHeight = parseFloat(tags.height || tags['building:height'] || '')
  if (Number.isFinite(rawHeight)) return Math.min(60, Math.max(2.4, rawHeight))
  const levels = parseFloat(tags['building:levels'] || '')
  if (Number.isFinite(levels)) return Math.min(60, Math.max(2.4, levels * 3.2))
  return 6.5
}

function kindOf(tags) {
  const building = tags.building || ''
  if (/house|detached|semi|terrace|residential|apartments|dorm/.test(building)) return 'residential'
  if (/retail|commercial|office|hotel|supermarket|kiosk/.test(building)) return 'commercial'
  if (/civic|public|government|church|chapel|school|university|hospital/.test(building)) return 'civic'
  if (/industrial|warehouse|factory|garage/.test(building)) return 'industrial'
  if (building === 'parking' || tags.amenity === 'parking') return 'parking'
  return 'general'
}

const COLORS = {
  residential: [
    '#f4efe4',
    '#e7d7b8',
    '#f7f3ea',
    '#d8c09a',
    '#c48b62',
    '#c46a4a',
    '#e4c2a4',
    '#d7b8b0',
    '#c9d3c3',
    '#b7c4bc',
    '#c5d0d8',
    '#d5d8dc',
    '#e6d48a',
    '#f0e2c8',
  ],
  commercial: ['#d5dde3', '#c8d0d6', '#e3ddd2'],
  civic: ['#efe6d0', '#e6d8bc', '#f4efe2'],
  industrial: ['#c4c0b6', '#b5b1a8'],
  parking: ['#9aa3ab'],
  general: ['#e4d3bc', '#d7c4a4', '#cfc6ba', '#d9c7ae'],
}

function colorFor(kind, id) {
  const palette = COLORS[kind] || COLORS.general
  return palette[Math.abs(id) % palette.length]
}

function clipSegment(a, b, box) {
  let t0 = 0
  let t1 = 1
  const dx = b.x - a.x
  const dz = b.z - a.z
  const p = [-dx, dx, -dz, dz]
  const q = [a.x - box.minX, box.maxX - a.x, a.z - box.minZ, box.maxZ - a.z]
  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]) < 1e-8) {
      if (q[i] < 0) return null
    } else {
      const t = q[i] / p[i]
      if (p[i] < 0) {
        if (t > t1) return null
        if (t > t0) t0 = t
      } else {
        if (t < t0) return null
        if (t < t1) t1 = t
      }
    }
  }
  return [
    { x: round(a.x + t0 * dx), z: round(a.z + t0 * dz) },
    { x: round(a.x + t1 * dx), z: round(a.z + t1 * dz) },
  ]
}

function clipPolyline(points, box) {
  const runs = []
  let run = []
  for (let i = 1; i < points.length; i++) {
    const piece = clipSegment(points[i - 1], points[i], box)
    if (!piece) {
      if (run.length > 1) runs.push(run)
      run = []
      continue
    }
    if (run.length === 0) run.push(piece[0])
    else if (Math.hypot(run[run.length - 1].x - piece[0].x, run[run.length - 1].z - piece[0].z) > 0.2) {
      runs.push(run)
      run = [piece[0]]
    }
    run.push(piece[1])
  }
  if (run.length > 1) runs.push(run)
  return runs
}

function lengthOf(points) {
  let length = 0
  for (let i = 1; i < points.length; i++) length += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z)
  return length
}

function chainSegments(segments) {
  const unused = segments.map((segment) => segment.slice())
  const chains = []
  while (unused.length > 0) {
    const current = unused.pop()
    let grew = true
    while (grew) {
      grew = false
      for (let i = 0; i < unused.length; i++) {
        const other = unused[i]
        const head = current[0]
        const tail = current[current.length - 1]
        const oHead = other[0]
        const oTail = other[other.length - 1]
        if (Math.hypot(tail.x - oHead.x, tail.z - oHead.z) < 1.6) {
          current.push(...other.slice(1))
        } else if (Math.hypot(tail.x - oTail.x, tail.z - oTail.z) < 1.6) {
          current.push(...other.slice(0, -1).reverse())
        } else if (Math.hypot(head.x - oTail.x, head.z - oTail.z) < 1.6) {
          current.unshift(...other.slice(0, -1))
        } else if (Math.hypot(head.x - oHead.x, head.z - oHead.z) < 1.6) {
          current.unshift(...other.slice(1).reverse())
        } else {
          continue
        }
        unused.splice(i, 1)
        grew = true
        break
      }
    }
    chains.push(current)
  }
  return chains
}

function offsetPolyline(points, dist) {
  const out = []
  for (let i = 0; i < points.length; i++) {
    const a = points[Math.max(0, i - 1)]
    const b = points[Math.min(points.length - 1, i + 1)]
    let dx = b.x - a.x
    let dz = b.z - a.z
    const len = Math.hypot(dx, dz) || 1
    dx /= len
    dz /= len
    out.push({ x: round(points[i].x - dz * dist), z: round(points[i].z + dx * dist) })
  }
  return out
}

function resample(points, step) {
  if (points.length < 2) return points.slice()
  const out = [points[0]]
  let carry = 0
  for (let i = 1; i < points.length; i++) {
    let from = points[i - 1]
    let span = Math.hypot(points[i].x - from.x, points[i].z - from.z)
    if (span < 0.01) continue
    let walked = carry
    while (walked + span >= step) {
      const remain = step - walked
      const t = remain / span
      const next = {
        x: round(from.x + (points[i].x - from.x) * t),
        z: round(from.z + (points[i].z - from.z) * t),
      }
      out.push(next)
      from = next
      span = Math.hypot(points[i].x - from.x, points[i].z - from.z)
      walked = 0
    }
    carry = walked + span
  }
  const last = points[points.length - 1]
  const prev = out[out.length - 1]
  if (Math.hypot(last.x - prev.x, last.z - prev.z) > 1) out.push(last)
  return out
}

function roadHalf(kind) {
  if (kind === 'primary' || kind === 'trunk') return 8
  if (kind === 'secondary') return 6.5
  if (kind === 'tertiary') return 5.5
  if (kind === 'service') return 2.2
  if (kind === 'pedestrian' || kind === 'living_street') return 3
  return 4.2
}

const buildingWays = new Set()
const buildings = []

function addBuilding(id, tags, geometry) {
  const points = toPoints(geometry)
  if (points.length < 3) return
  const area = Math.abs(ringArea(points))
  if (area < 18 || area > 80_000) return
  const box = boundsOf(points)
  if (box.maxX - box.minX > 350 || box.maxZ - box.minZ > 350) return
  const cx = (box.minX + box.maxX) / 2
  const cz = (box.minZ + box.maxZ) / 2
  const center = project((BBOX.minLat + BBOX.maxLat) / 2, (BBOX.minLon + BBOX.maxLon) / 2)
  if (Math.hypot(cx - center.x, cz - center.z) > 1100) return
  const kind = kindOf(tags)
  const record = {
    id,
    h: round(heightOf(tags)),
    c: colorFor(kind, id),
    k: kind,
    points,
    minX: box.minX,
    maxX: box.maxX,
    minZ: box.minZ,
    maxZ: box.maxZ,
  }
  const label = landmarkOf(tags)
  if (label) Object.assign(record, label)
  buildings.push(record)
}

function landmarkOf(tags) {
  const wiki = tags.wikipedia || ''
  const street = tags['addr:street'] || ''
  const number = tags['addr:housenumber'] || ''
  if (wiki === 'en:Burbank City Hall' || (number === '275' && /Olive/.test(street) && tags.building === 'civic')) {
    return {
      name: 'Burbank City Hall',
      blurb: 'the civic building at 275 East Olive Avenue',
    }
  }
  if (number === '201' && /Magnolia/.test(street) && tags.building === 'retail') {
    return {
      name: 'Burbank Town Center',
      blurb: 'the mall at 201 East Magnolia Boulevard',
    }
  }
  if (tags.amenity === 'library' || tags.name === 'Burbank Central Library') {
    return {
      name: 'Burbank Central Library',
      blurb: 'the central library at 110 North Glenoaks Boulevard',
    }
  }
  return null
}

for (const element of raw.elements) {
  if (element.type === 'way' && element.tags?.building && element.geometry) {
    buildingWays.add(element.id)
    addBuilding(element.id, element.tags, element.geometry)
  }
}

for (const element of raw.elements) {
  if (element.type !== 'relation' || !element.tags?.building) continue
  const outers = (element.members || []).filter((member) => member.role === 'outer' && member.geometry)
  if (outers.some((member) => buildingWays.has(member.ref))) continue
  outers.forEach((member, index) => addBuilding(element.id * 10 + index, element.tags, member.geometry))
}

const world = boundsOf(buildings.flatMap((building) => building.points))
const margin = 18
const box = {
  minX: world.minX - margin,
  maxX: world.maxX + margin,
  minZ: world.minZ - margin,
  maxZ: world.maxZ + margin,
}

const grouped = new Map()
for (const element of raw.elements) {
  const tags = element.tags
  if (element.type !== 'way' || !tags?.highway || !element.geometry) continue
  if (!/primary|secondary|tertiary|unclassified|residential|living_street|pedestrian|service/.test(tags.highway)) continue
  const points = toPoints(element.geometry)
  if (points.length < 2) continue
  const key = `${tags.name || ''}||${tags.highway}`
  const list = grouped.get(key) || []
  list.push(points)
  grouped.set(key, list)
}

const roads = []
for (const [key, segments] of grouped) {
  const [name, kind] = key.split('||')
  const half = roadHalf(kind)
  for (const chain of chainSegments(segments)) {
    for (const run of clipPolyline(chain, box)) {
      if (lengthOf(run) < 8) continue
      roads.push({ name, kind, w: half * 2, pts: run.flatMap((point) => [point.x, point.z]) })
    }
  }
}

function walkable(name, kind, points) {
  if (!name || kind === 'service') return false
  if (/^Alley|Frontage|Lot|Way$/.test(name)) return false
  if (/Frontage|Lot/.test(name)) return false
  return lengthOf(points) > 70 && /Avenue|Street|Boulevard|Road|Drive|Place|Way/.test(name)
}

const paths = []
for (const road of roads) {
  const points = pairs(road.pts)
  if (!walkable(road.name, road.kind, points)) continue
  const dist = road.w / 2 + 2.6
  const sides = [offsetPolyline(points, dist), offsetPolyline(points, -dist)]
  let best = []
  for (const side of sides) {
    const samples = resample(side, 7)
    const kept = []
    for (const sample of samples) {
      if (sample.x < box.minX || sample.x > box.maxX || sample.z < box.minZ || sample.z > box.maxZ) continue
      if (!clearOfBuildings(sample.x, sample.z, buildings)) continue
      const prev = kept[kept.length - 1]
      if (prev && Math.hypot(sample.x - prev.x, sample.z - prev.z) > 16) {
        if (kept.length > best.length) best = kept.slice()
        kept.length = 0
      }
      kept.push(sample)
    }
    if (kept.length > best.length) best = kept
  }
  if (best.length < 4 || lengthOf(best) < 40) continue
  paths.push({ name: road.name, pts: best.flatMap((point) => [point.x, point.z]) })
}

function pairs(flat) {
  const points = []
  for (let i = 0; i < flat.length; i += 2) points.push({ x: flat[i], z: flat[i + 1] })
  return points
}

function nearestOnPaths(x, z, pattern) {
  let best = null
  let bestD = Infinity
  for (const path of paths) {
    if (pattern && !pattern.test(path.name)) continue
    const points = pairs(path.pts)
    for (const point of points) {
      const dist = Math.hypot(point.x - x, point.z - z)
      if (dist < bestD) {
        bestD = dist
        best = point
      }
    }
  }
  return best
}

function centroid(points) {
  let x = 0
  let z = 0
  for (const point of points) {
    x += point.x
    z += point.z
  }
  return { x: x / points.length, z: z / points.length }
}

const landmarks = []
for (const building of buildings) {
  if (!building.name) continue
  const center = centroid(building.points)
  const pattern = /Hall/.test(building.name) ? /Olive/i : /Town Center/.test(building.name) ? /Magnolia/i : /Glenoaks/i
  const door = nearestOnPaths(center.x, center.z, pattern) || nearestOnPaths(center.x, center.z, null)
  building.door = door ? [door.x, door.z] : [round(center.x), round(center.z)]
  landmarks.push(building.name)
}

const hall = buildings.find((building) => building.name === 'Burbank City Hall')
const hallCenter = hall ? centroid(hall.points) : { x: 0, z: 0 }
const spawn = nearestOnPaths(hallCenter.x, hallCenter.z, /Olive/i) || { x: 0, z: 0 }

const parks = []
for (const element of raw.elements) {
  if (element.type !== 'way' || element.tags?.leisure !== 'park' || !element.geometry) continue
  const points = toPoints(element.geometry)
  if (points.length < 3 || Math.abs(ringArea(points)) < 200) continue
  parks.push({
    name: element.tags.name || 'Park',
    ring: points.flatMap((point) => [point.x, point.z]),
  })
}

const map = {
  name: 'Downtown Burbank',
  credit: '© OpenStreetMap contributors',
  spawn: { x: spawn.x, z: spawn.z },
  bounds: {
    minX: round(box.minX),
    maxX: round(box.maxX),
    minZ: round(box.minZ),
    maxZ: round(box.maxZ),
  },
  buildings: buildings.map((building) => ({
    h: building.h,
    c: building.c,
    ...(building.name ? { name: building.name, blurb: building.blurb, door: building.door } : {}),
    ring: building.points.flatMap((point) => [point.x, point.z]),
  })),
  roads: roads.map((road) => ({
    name: road.name,
    kind: road.kind,
    w: road.w,
    pts: road.pts,
  })),
  paths: paths.map((path) => ({ name: path.name, pts: path.pts })),
  parks,
}

writeFileSync('data/map.json', JSON.stringify(map))
const named = [...new Set(paths.map((path) => path.name))].sort()
console.log('buildings', map.buildings.length, 'roads', map.roads.length, 'paths', map.paths.length, 'parks', parks.length)
console.log('landmarks', landmarks.join(', '))
console.log('spawn', map.spawn.x, map.spawn.z, 'hall door', hall?.door)
console.log('paths:\n' + named.join('\n'))
console.log('bytes', Buffer.byteLength(JSON.stringify(map)))
