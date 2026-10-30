import mapJson from '../data/map.json'
import { rejoinWalk, resumeWalk, createCrowd, crowdPose, type CrowdFile } from '../src/actors/crowdSim.ts'
import { offeredPlace, stepErrand, type Errand } from '../src/actors/errand.ts'
import { buildSidewalks, routeSidewalk } from '../src/actors/sidewalk.ts'
import { createSeededRng } from '../src/util/seededRng.ts'
import { buildLayout, type MapFile } from '../src/world/layout.ts'
import crowdJson from '../data/crowd.json'
import { describe, expect, it } from 'vitest'

const shops = [
  { name: 'The Coffee Bean', x: -316, z: -2, kind: 'cafe' },
  { name: 'Cafe Grano', x: 40, z: 40, kind: 'cafe' },
  { name: 'City Hall', x: 10, z: 10, kind: 'civic' },
]

describe('an offer to walk somewhere', () => {
  it('follows an invitation and ignores a bare mention', () => {
    expect(offeredPlace("Let's get some coffee, we'll turn left.", shops, { x: 0, z: 0 })?.name).toBe('Cafe Grano')
    expect(offeredPlace("Let's go to The Coffee Bean.", shops, { x: 0, z: 0 })?.name).toBe('The Coffee Bean')
    expect(offeredPlace('The Coffee Bean is on Magnolia.', shops, { x: 0, z: 0 })).toBeNull()
    expect(offeredPlace('I already had coffee.', shops, { x: 0, z: 0 })).toBeNull()
  })

  it('stays on the sidewalk after a conversation instead of jumping ahead', () => {
    const layout = buildLayout(mapJson as MapFile)
    const world = createCrowd(layout, crowdJson as CrowdFile, createSeededRng(11))
    const held = crowdPose(world, 0, 5)
    resumeWalk(world.people[0]!, 5, 40)
    const resumed = crowdPose(world, 0, 40)
    expect(resumed.x).toBeCloseTo(held.x, 3)
    expect(resumed.z).toBeCloseTo(held.z, 3)
    const later = crowdPose(world, 0, 48)
    expect(Math.hypot(later.x - resumed.x, later.z - resumed.z)).toBeGreaterThan(2)
  })

  it('routes a coffee walk along the sidewalk and waits when you fall behind', () => {
    const layout = buildLayout(mapJson as MapFile)
    const graph = buildSidewalks(layout.file.paths)
    const route = routeSidewalk(graph, 28, 140, -316, -2)
    expect(route.length).toBeGreaterThan(4)
    const end = route[route.length - 1]!
    expect(Math.hypot(end.x + 316, end.z + 2)).toBeLessThan(25)
    const errand: Errand = {
      x: route[0]!.x,
      z: route[0]!.z,
      yaw: 0,
      route,
      at: 1,
      goalX: -316,
      goalZ: -2,
      place: 'The Coffee Bean',
      moving: true,
    }
    const origin = { x: errand.x, z: errand.z }
    for (let i = 0; i < 40; i++) stepErrand(errand, 0.05, errand.x, errand.z)
    expect(Math.hypot(errand.x - origin.x, errand.z - origin.z)).toBeGreaterThan(4)
    const left = { x: errand.x, z: errand.z }
    expect(stepErrand(errand, 0.05, errand.x + 10, errand.z)).toBe('wait')
    expect(errand.x).toBeCloseTo(left.x)
    expect(errand.z).toBeCloseTo(left.z)
    const awayX = errand.x + Math.sign(errand.x - errand.goalX || 1) * 40
    const awayZ = errand.z + Math.sign(errand.z - errand.goalZ || 1) * 40
    expect(stepErrand(errand, 0.05, awayX, awayZ)).toBe('drop')
    const world = createCrowd(layout, crowdJson as CrowdFile, createSeededRng(3))
    const pose = crowdPose(world, 4, 2)
    rejoinWalk(world, 4, pose.x + 3, pose.z - 2, 80)
    const back = crowdPose(world, 4, 80)
    expect(Math.hypot(back.x - (pose.x + 3), back.z - (pose.z - 2))).toBeLessThan(8)
  })
})
