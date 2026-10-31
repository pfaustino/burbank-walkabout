import * as THREE from 'three'
import { asideStep, type RoadThreat } from './peopleSim.ts'
import { separatePeople, pushClear, type Disc } from '../traffic/bodies.ts'
import { crowdId, crowdIndex, crowdPose, type CrowdWorld } from './crowdSim.ts'
import type { Errand } from './errand.ts'
import { staysDrawn, type DrawSpot } from '../world/drawRange.ts'
import { createFigure, type Figure } from './figure.ts'

/** Sidewalk crowd on the shared character mesh, tinted per person. */
export class CrowdSet {
  readonly xy: Float32Array
  private readonly home: Float32Array
  private readonly homeYaw: Float32Array
  private readonly world: CrowdWorld
  private readonly scene: THREE.Scene
  private readonly figures: (Figure | null)[]
  private readonly shown: boolean[]
  private readonly bubbleUntil: number[]
  private lastTime = 0

  constructor(scene: THREE.Scene, world: CrowdWorld) {
    this.scene = scene
    this.world = world
    this.xy = new Float32Array(world.people.length * 2)
    this.home = new Float32Array(world.people.length * 2)
    this.homeYaw = new Float32Array(world.people.length)
    this.bubbleUntil = world.people.map(() => 0)
    this.shown = world.people.map(() => false)
    this.figures = world.people.map(() => null)
  }

  update(
    time: number,
    frozen?: ReadonlyMap<number, number>,
    blocks: readonly Disc[] = [],
    threat?: RoadThreat | null,
    guides?: ReadonlyMap<number, Errand>,
    view?: DrawSpot,
  ): void {
    const dt = Math.min(0.05, Math.max(0, time - this.lastTime))
    this.lastTime = time
    const people = this.world.people
    for (let i = 0; i < people.length; i++) {
      const held = frozen?.has(i) ? frozen.get(i)! : null
      const pose = crowdPose(this.world, i, held === null ? time : held)
      this.home[i * 2] = pose.x
      this.home[i * 2 + 1] = pose.z
      this.homeYaw[i] = pose.yaw
      this.xy[i * 2] = pose.x
      this.xy[i * 2 + 1] = pose.z
    }
    separatePeople(this.xy, blocks)
    if (threat) {
      for (let i = 0; i < people.length; i++) {
        const next = asideStep(this.xy[i * 2]!, this.xy[i * 2 + 1]!, threat)
        this.xy[i * 2] = next.x
        this.xy[i * 2 + 1] = next.z
      }
    }
    for (let i = 0; i < people.length; i++) {
      const person = people[i]!
      const guide = guides?.get(i)
      if (guide) {
        this.xy[i * 2] = guide.x
        this.xy[i * 2 + 1] = guide.z
        this.homeYaw[i] = guide.yaw
      }
      const x = this.xy[i * 2]!
      const z = this.xy[i * 2 + 1]!
      const keep = guide !== undefined || frozen?.has(i) === true
      const show = !view || keep || staysDrawn(x, z, view.x, view.z, view.reach, this.shown[i]!)
      this.shown[i] = show
      let figure = this.figures[i]
      if (!show) {
        if (figure?.root.parent) this.scene.remove(figure.root)
        continue
      }
      if (!figure) {
        this.evictHidden()
        figure = this.makeFigure(i)
        this.figures[i] = figure
      }
      const root = figure.root
      const until = this.bubbleUntil[i] ?? 0
      if (until > 0 && time >= until) {
        figure.setBubble(null)
        this.bubbleUntil[i] = 0
      }
      if (!root.parent) this.scene.add(root)
      const dx = x - this.home[i * 2]!
      const dz = z - this.home[i * 2 + 1]!
      root.position.set(x, 0, z)
      root.rotation.y = this.homeYaw[i]!
      const shoved = dx * dx + dz * dz > 0.09
      const pace = guide ? (guide.moving ? 3 : 0) : frozen?.has(i) || shoved ? 0 : person.speed
      figure.update(dt, pace)
    }
  }

  private makeFigure(index: number): Figure {
    const person = this.world.people[index]!
    const figure = createFigure({
      name: person.name,
      voice: person.voice,
      shirt: css(person.shirt),
      pants: css(person.pants),
      skin: css(person.skin),
      hair: css(person.hair),
      shoes: css(person.shoes),
      showName: true,
      castShadow: false,
    })
    figure.root.name = crowdId(index)
    return figure
  }

  /** Drop one off-screen figure so the pool stays small as the city gets bigger. */
  private evictHidden(): void {
    let kept = 0
    for (const figure of this.figures) if (figure) kept++
    if (kept < 64) return
    for (let i = 0; i < this.figures.length; i++) {
      if (this.shown[i]) continue
      const figure = this.figures[i]
      if (!figure) continue
      this.scene.remove(figure.root)
      figure.dispose()
      this.figures[i] = null
      return
    }
  }

  /** Cars move after the crowd step; ease anyone they rolled into. */
  nudge(blocks: readonly Disc[]): void {
    pushClear(this.xy, blocks)
    for (let i = 0; i < this.figures.length; i++) {
      const root = this.figures[i]?.root
      if (!root?.parent) continue
      root.position.x = this.xy[i * 2]!
      root.position.z = this.xy[i * 2 + 1]!
    }
  }

  say(id: string, text: string): void {
    const index = crowdIndex(id)
    const figure = index === null ? undefined : this.figures[index]
    if (!figure) return
    figure.setBubble(text)
    this.bubbleUntil[index!] = this.lastTime + 7
  }

  dispose(): void {
    for (const figure of this.figures) {
      if (!figure) continue
      this.scene.remove(figure.root)
      figure.dispose()
    }
  }
}

function css(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`
}
