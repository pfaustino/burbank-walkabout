import mapJson from '../data/map.json'
import { describe, expect, it } from 'vitest'
import { buildSidewalks, nearestNode } from '../src/actors/sidewalk.ts'
import { createSeededRng } from '../src/util/seededRng.ts'
import { buildLayout, describePlace, hitsBuilding, hitsBuildingScan, type MapFile } from '../src/world/layout.ts'

const layout = buildLayout(mapJson as MapFile)
const { bounds } = layout.file

function randomPoints(seed: number, count: number, pad: number): [number, number][] {
  const rng = createSeededRng(seed)
  const points: [number, number][] = []
  for (let i = 0; i < count; i++) {
    points.push([
      bounds.minX - pad + rng() * (bounds.maxX - bounds.minX + pad * 2),
      bounds.minZ - pad + rng() * (bounds.maxZ - bounds.minZ + pad * 2),
    ])
  }
  return points
}

describe('spatial grids', () => {
  it('hitsBuilding matches the full scan', () => {
    let hits = 0
    for (const radius of [0, 0.16, 0.45, 1.2, 3, 12, 40]) {
      for (const [x, z] of randomPoints(7 + radius * 100, 4000, 60)) {
        const expected = hitsBuildingScan(layout, x, z, radius)
        expect(hitsBuilding(layout, x, z, radius)).toBe(expected)
        if (expected) hits++
      }
    }
    expect(hits).toBeGreaterThan(1000)
  })

  it('hitsBuilding matches the full scan right at building edges', () => {
    for (const building of layout.buildings.slice(0, 400)) {
      for (const [x, z] of [
        [building.minX - 0.45, building.minZ],
        [building.maxX + 0.45, building.maxZ],
        [building.minX, building.maxZ + 0.45],
        [(building.minX + building.maxX) / 2, building.minZ - 0.45],
      ] as [number, number][]) {
        expect(hitsBuilding(layout, x, z, 0.45)).toBe(hitsBuildingScan(layout, x, z, 0.45))
      }
    }
  })

  it('describePlace matches the full scan', () => {
    for (const [x, z] of randomPoints(11, 3000, 120)) {
      expect(describePlace(layout, x, z)).toBe(describePlace(layout, x, z, true))
    }
  })

  it('the nearest sidewalk node matches the full scan', () => {
    const graph = buildSidewalks(layout.file.paths)
    expect(graph.nodes.length).toBeGreaterThan(100)
    for (const [x, z] of randomPoints(13, 3000, 400)) {
      expect(nearestNode(graph, x, z)).toBe(nearestNode(graph, x, z, true))
    }
    for (const node of graph.nodes.slice(0, 300)) {
      expect(nearestNode(graph, node.x, node.z)).toBe(nearestNode(graph, node.x, node.z, true))
    }
  })
})
