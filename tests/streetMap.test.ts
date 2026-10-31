import { describe, expect, it } from 'vitest'
import mapJson from '../data/map.json'
import { labelsInView, mapLabel, readableAngle } from '../src/ui/StreetMap.ts'
import { buildLayout, type MapFile, type MapRoad } from '../src/world/layout.ts'

const layout = buildLayout(mapJson as MapFile)

describe('street map', () => {
  it('abbreviates a street and keeps the lettering upright', () => {
    expect(mapLabel('North Maple Street')).toBe('N Maple St')
    expect(mapLabel('East Olive Avenue')).toBe('E Olive Ave')
    expect(readableAngle(1, 0)).toBeCloseTo(0)
    expect(readableAngle(-1, 0)).toBeCloseTo(0)
    expect(readableAngle(0, -1)).toBeCloseTo(-Math.PI / 2)
  })

  it('names the block you are looking at and skips alleys', () => {
    const view = { centerX: -3755, centerZ: 2071, ppm: 1.2, width: 900, height: 700 }
    const names = labelsInView(layout.file.roads, view).map((label) => label.name)
    expect(names).toContain('N Maple St')
    expect(names.some((name) => /alley/i.test(name))).toBe(false)
  })

  it('keeps a short residential street off the wide view', () => {
    const roads: MapRoad[] = [
      { name: 'North Maple Street', kind: 'residential', w: 8, pts: [0, 0, 50, 0] },
      { name: 'West Magnolia Boulevard', kind: 'primary', w: 14, pts: [0, 40, 200, 40] },
    ]
    const wide = { centerX: 100, centerZ: 20, ppm: 1, width: 400, height: 300 }
    const names = labelsInView(roads, wide).map((label) => label.name)
    expect(names).toContain('W Magnolia Blvd')
    expect(names).not.toContain('N Maple St')
  })
})
