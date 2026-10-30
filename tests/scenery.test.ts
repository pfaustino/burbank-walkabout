import { describe, expect, it } from 'vitest'
import busesJson from '../data/buses.json'
import crowdJson from '../data/crowd.json'
import foliageJson from '../data/foliage.json'
import mapJson from '../data/map.json'
import { createCrowd, crowdId, crowdIndex, crowdPose, type CrowdFile } from '../src/actors/crowdSim.ts'
import { createBuses, stepBuses, type BusFile } from '../src/traffic/busSim.ts'
import { buildNetwork } from '../src/traffic/network.ts'
import { createSeededRng } from '../src/util/seededRng.ts'
import { minimapDelta } from '../src/ui/Minimap.ts'
import { helicopterPose, tourOver } from '../src/world/helicopterSim.ts'
import { placeFoliage, type FoliageFile } from '../src/world/foliage.ts'
import { buildLayout, hitsBuilding, type MapFile } from '../src/world/layout.ts'

const layout = buildLayout(mapJson as MapFile)
const network = buildNetwork(layout)

describe('downtown scenery', () => {
  it('puts trees and bushes outside buildings', () => {
    const plants = placeFoliage(layout, foliageJson as FoliageFile, createSeededRng(4))
    const trees = plants.filter((plant) => plant.kind === 'tree')
    const bushes = plants.filter((plant) => plant.kind === 'bush')
    expect(trees.length).toBeGreaterThan(200)
    expect(bushes.length).toBeGreaterThan(40)
    let onRoad = 0
    for (const tree of trees) {
      if (treeOnAsphalt(layout.file.roads, tree.x, tree.z)) onRoad++
    }
    expect(onRoad).toBe(0)
    for (const plant of plants) {
      expect(hitsBuilding(layout, plant.x, plant.z, 0.3)).toBe(false)
      expect(plant.x).toBeGreaterThan(layout.file.bounds.minX)
      expect(plant.z).toBeLessThan(layout.file.bounds.maxZ)
    }
    const park = layout.file.parks[0]
    expect(park).toBeTruthy()
    expect(plants.some((plant) => pointInRing(plant.x, plant.z, park!.ring))).toBe(true)
  })

  it('runs buses along the street grid', () => {
    const file = busesJson as BusFile
    const buses = createBuses(network, file, createSeededRng(5))
    expect(buses.length).toBe(file.count)
    const start = buses.map((bus) => ({ x: bus.x, z: bus.z }))
    const rng = createSeededRng(9)
    for (let t = 0; t < 12; t += 0.05) stepBuses(buses, network, file, t, 0.05, rng, [])
    const moved = buses.filter((bus, index) => Math.hypot(bus.x - start[index]!.x, bus.z - start[index]!.z) > 6)
    expect(moved.length).toBeGreaterThan(2)
    for (const bus of buses) expect(hitsBuilding(layout, bus.x, bus.z, 0.6)).toBe(false)
  })

  it('walks five hundred people without filling buildings', () => {
    const file = crowdJson as CrowdFile
    const world = createCrowd(layout, file, createSeededRng(11))
    expect(world.people).toHaveLength(500)
    const names = world.people.map((person) => person.name)
    expect(new Set(names).size).toBe(names.length)
    expect(names.every((name) => name.includes(' '))).toBe(true)
    expect(crowdId(12)).toBe('c12')
    expect(crowdIndex('c12')).toBe(12)
    expect(crowdIndex('june')).toBeNull()
    const started = performance.now()
    let indoors = 0
    for (const time of [0, 45, 120]) {
      for (let i = 0; i < world.people.length; i++) {
        const pose = crowdPose(world, i, time)
        if (hitsBuilding(layout, pose.x, pose.z, 0.25)) indoors++
        expect(pose.x).toBeGreaterThan(layout.file.bounds.minX)
        expect(pose.x).toBeLessThan(layout.file.bounds.maxX)
        expect(Number.isFinite(pose.yaw)).toBe(true)
      }
    }
    expect(indoors).toBeLessThan(40)
    expect(performance.now() - started).toBeLessThan(500)
    const a = crowdPose(world, 0, 0)
    const b = crowdPose(world, 0, 12)
    expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeGreaterThan(4)
  })

  it('keeps the helicopter over downtown', () => {
    const tour = tourOver(layout.landmarks, layout.file.spawn)
    expect(tour.rx).toBeGreaterThan(100)
    for (const time of [0, 10, 40]) {
      const pose = helicopterPose(tour, time)
      expect(pose.y).toBeGreaterThan(30)
      expect(pose.y).toBeLessThan(75)
      const along = (pose.x - tour.x) / tour.rx
      const across = (pose.z - tour.z) / tour.rz
      expect(Math.hypot(along, across)).toBeLessThan(1.05)
    }
  })

  it('maps north up and east to the right', () => {
    const north = minimapDelta(0, -12, 1)
    const east = minimapDelta(12, 0, 1)
    expect(north.y).toBeLessThan(0)
    expect(north.x).toBeCloseTo(0)
    expect(east.x).toBeGreaterThan(0)
    expect(east.y).toBeCloseTo(0)
  })
})

function treeOnAsphalt(roads: { kind: string; w: number; pts: number[] }[], x: number, z: number): boolean {
  for (const road of roads) {
    if (road.kind === 'pedestrian' || road.w < 2) continue
    const limit = road.w / 2 - 0.15
    const pts = road.pts
    for (let i = 0; i < pts.length - 2; i += 2) {
      const ax = pts[i] ?? 0
      const az = pts[i + 1] ?? 0
      const bx = pts[i + 2] ?? 0
      const bz = pts[i + 3] ?? 0
      const dx = bx - ax
      const dz = bz - az
      const len2 = dx * dx + dz * dz
      const t = len2 < 1e-6 ? 0 : Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / len2))
      if (Math.hypot(x - (ax + dx * t), z - (az + dz * t)) < limit) return true
    }
  }
  return false
}

function pointInRing(x: number, z: number, ring: number[]): boolean {
  let inside = false
  const count = ring.length / 2
  for (let i = 0, j = count - 1; i < count; j = i++) {
    const ax = ring[i * 2] ?? 0
    const az = ring[i * 2 + 1] ?? 0
    const bx = ring[j * 2] ?? 0
    const bz = ring[j * 2 + 1] ?? 0
    const crosses = az > z !== bz > z
    if (crosses && x < ((bx - ax) * (z - az)) / (bz - az || 1) + ax) inside = !inside
  }
  return inside
}
