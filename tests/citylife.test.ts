import mapJson from '../data/map.json'
import businessesJson from '../data/businesses.json'
import { formatHour, skyAt } from '../src/world/daylight.ts'
import { buildLayout, hitsBuilding, type MapFile } from '../src/world/layout.ts'
import { planStoreSigns, type Business } from '../src/world/storefronts.ts'
import { planLamps } from '../src/world/streetlamps.ts'
import { floorsForHeight } from '../src/world/CityMesh.ts'
import { shortcutPlaces } from '../src/dev/DevPanel.ts'
import { describe, expect, it } from 'vitest'

const layout = buildLayout(mapJson as MapFile)
const businesses = businessesJson as Business[]

describe('daylight', () => {
  it('puts the sun overhead at noon and the moon up at midnight', () => {
    const noon = skyAt(12)
    const night = skyAt(0)
    expect(noon.sunUp).toBe(true)
    expect(noon.key.y).toBeGreaterThan(0.8)
    expect(noon.keyIntensity).toBeGreaterThan(night.keyIntensity)
    expect(night.sunUp).toBe(false)
    expect(night.key.y).toBeGreaterThan(0.8)
    expect(night.background).toBeLessThan(noon.background)
    expect(noon.shadow).toBeGreaterThan(0.9)
    expect(night.shadow).toBe(0)
    expect(noon.night).toBeLessThan(0.05)
    expect(night.night).toBeGreaterThan(0.95)
  })

  it('reads the clock in local time', () => {
    expect(formatHour(9.5)).toBe('9:30 AM')
    expect(formatHour(15.25)).toBe('3:15 PM')
    expect(formatHour(0)).toBe('12:00 AM')
  })
})

describe('storefront signs', () => {
  it('signs real businesses and leaves a building with none blank', () => {
    const file = {
      name: 't',
      credit: '',
      spawn: { x: 0, z: 0 },
      bounds: { minX: -50, maxX: 120, minZ: -50, maxZ: 80 },
      buildings: [
        { h: 5, c: '#ccc', ring: [0, 0, 8, 0, 8, 8, 0, 8] },
        { h: 8, c: '#ccc', ring: [20, 0, 70, 0, 70, 24, 20, 24] },
        { h: 18, c: '#ccc', name: 'Big Hall', ring: [20, 40, 60, 40, 60, 70, 20, 70] },
        { h: 6, c: '#ccc', ring: [0, 20, 16, 20, 16, 30, 0, 30] },
      ],
      roads: [],
      paths: [],
      parks: [],
    } satisfies MapFile
    const signs = planStoreSigns(buildLayout(file), [
      { name: 'Cafe', x: 4, z: 4, kind: 'cafe' },
      { name: '148', x: 40, z: 12, kind: 'shop' },
      { name: 'Market', x: 40, z: 12, kind: 'supermarket' },
      { name: 'Deli', x: 55, z: 12, kind: 'deli' },
      { name: 'Annex', x: 40, z: 50, kind: 'office' },
    ])
    expect(signs.some((sign) => sign.name === 'Cafe')).toBe(true)
    expect(signs.some((sign) => sign.name === '148')).toBe(false)
    expect(signs.some((sign) => sign.name === 'Market')).toBe(true)
    expect(signs.some((sign) => sign.name === 'Deli')).toBe(true)
    expect(signs.some((sign) => sign.name === 'Big Hall')).toBe(true)
    expect(signs.some((sign) => sign.name === 'Annex')).toBe(true)
    const bare = signs.filter((sign) => sign.x > -2 && sign.x < 18 && sign.z > 18 && sign.z < 32)
    expect(bare).toHaveLength(0)
  })

  it('hangs downtown names on the real blocks', () => {
    const signs = planStoreSigns(layout, businesses)
    const names = new Set(signs.map((sign) => sign.name))
    const allowed = new Set(businesses.map((business) => business.name))
    for (const building of layout.buildings) if (building.name) allowed.add(building.name)
    for (const sign of signs) expect(allowed.has(sign.name)).toBe(true)
    expect(names.has('Burbank City Hall')).toBe(true)
    expect(names.has('Burbank Central Library')).toBe(true)
    expect(names.has('Burbank Town Center')).toBe(true)
    expect([...names].some((name) => name.startsWith('AMC'))).toBe(true)
    const ross = signs.filter((sign) => sign.name === 'Ross')
    expect(ross.length).toBeGreaterThanOrEqual(2)
    let apart = 0
    for (let i = 0; i < ross.length; i++) {
      for (let j = i + 1; j < ross.length; j++) {
        apart = Math.max(apart, Math.hypot(ross[i]!.x - ross[j]!.x, ross[i]!.z - ross[j]!.z))
      }
    }
    expect(apart).toBeGreaterThan(20)
  })

  it('repeats a corner shop on each street it faces', () => {
    const file = {
      name: 't',
      credit: '',
      spawn: { x: 0, z: 0 },
      bounds: { minX: -20, maxX: 80, minZ: -30, maxZ: 50 },
      buildings: [{ h: 10, c: '#ccc', ring: [0, 0, 40, 0, 40, 24, 0, 24] }],
      roads: [
        { name: 'Magnolia Boulevard', kind: 'primary', w: 16, pts: [-10, -12, 50, -12] },
        { name: 'North San Fernando Boulevard', kind: 'primary', w: 16, pts: [52, -10, 52, 40] },
      ],
      paths: [],
      parks: [],
    } satisfies MapFile
    const signs = planStoreSigns(buildLayout(file), [{ name: 'Ross', x: 20, z: 12, kind: 'department_store' }])
    const ross = signs.filter((sign) => sign.name === 'Ross')
    expect(ross).toHaveLength(2)
    expect(ross.some((sign) => sign.z < 2)).toBe(true)
    expect(ross.some((sign) => sign.x > 38)).toBe(true)
  })
})

describe('house stories', () => {
  it('keeps a house at one story until the roof clears seven meters', () => {
    expect(floorsForHeight(5.2, 160)).toBe(1)
    expect(floorsForHeight(6.5, 160)).toBe(1)
    expect(floorsForHeight(6.9, 40)).toBe(1)
    expect(floorsForHeight(7, 160)).toBe(2)
    expect(floorsForHeight(9, 160)).toBe(2)
    expect(floorsForHeight(10.2, 160)).toBe(3)
    expect(floorsForHeight(6.4, 600)).toBe(2)
    expect(floorsForHeight(5, 600)).toBe(2)
    expect(floorsForHeight(4.2, 600)).toBe(1)
  })
})

describe('dev shortcuts', () => {
  it('lands the added places on open ground', () => {
    const places = shortcutPlaces(layout, businesses)
    expect(places.map((place) => place.name)).toEqual([
      'Verdugo Park',
      'Magnolia Park',
      "St. Joseph's Hospital",
      'IKEA',
      'Walmart',
    ])
    for (const place of places) {
      expect(hitsBuilding(layout, place.x, place.z, 0.4)).toBe(false)
    }
    const magnolia = places.find((place) => place.name === 'Magnolia Park')
    expect(Math.hypot((magnolia?.x ?? 0) + 3591, (magnolia?.z ?? 0) - 1672)).toBeLessThan(80)
  })
})

describe('street lamps', () => {
  it('stands posts on the sidewalk, clear of buildings and each other', () => {
    const posts = planLamps(layout)
    expect(posts.length).toBeGreaterThan(40)
    let nearest = Infinity
    for (let i = 0; i < posts.length; i++) {
      const post = posts[i]!
      expect(hitsBuilding(layout, post.x, post.z, 0.3)).toBe(false)
      for (let j = i + 1; j < posts.length; j++) {
        const other = posts[j]!
        const dist = Math.hypot(post.x - other.x, post.z - other.z)
        if (dist < nearest) nearest = dist
      }
    }
    expect(nearest).toBeGreaterThan(11)
    const crossing = { x: -2464.8, z: 1220.2 }
    for (const post of posts) {
      expect(Math.hypot(post.x - crossing.x, post.z - crossing.z)).toBeGreaterThan(12)
    }
  })
})
