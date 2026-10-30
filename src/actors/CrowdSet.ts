import * as THREE from 'three'
import { asideStep, type RoadThreat } from './peopleSim.ts'
import { separatePeople, pushClear, type Disc } from '../traffic/bodies.ts'
import { crowdId, crowdIndex, crowdPose, type CrowdWorld } from './crowdSim.ts'
import { createFigure, type Figure } from './figure.ts'

/** Sidewalk crowd on the shared character mesh, tinted per person. */
export class CrowdSet {
  readonly xy: Float32Array
  private readonly home: Float32Array
  private readonly homeYaw: Float32Array
  private readonly world: CrowdWorld
  private readonly scene: THREE.Scene
  private readonly figures: Figure[]
  private readonly bubbleUntil: number[]
  private lastTime = 0

  constructor(scene: THREE.Scene, world: CrowdWorld) {
    this.scene = scene
    this.world = world
    this.xy = new Float32Array(world.people.length * 2)
    this.home = new Float32Array(world.people.length * 2)
    this.homeYaw = new Float32Array(world.people.length)
    this.bubbleUntil = world.people.map(() => 0)
    this.figures = world.people.map((person, index) => {
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
      scene.add(figure.root)
      return figure
    })
    this.update(0)
  }

  update(time: number, frozen?: ReadonlyMap<number, number>, blocks: readonly Disc[] = [], threat?: RoadThreat | null): void {
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
      const root = this.figures[i]!.root
      const x = this.xy[i * 2]!
      const z = this.xy[i * 2 + 1]!
      const dx = x - this.home[i * 2]!
      const dz = z - this.home[i * 2 + 1]!
      root.position.set(x, 0, z)
      root.rotation.y = this.homeYaw[i]!
      const shoved = dx * dx + dz * dz > 0.09
      this.figures[i]!.update(dt, frozen?.has(i) || shoved ? 0 : person.speed)
      const until = this.bubbleUntil[i] ?? 0
      if (until > 0 && time >= until) {
        this.figures[i]!.setBubble(null)
        this.bubbleUntil[i] = 0
      }
    }
  }

  /** Cars move after the crowd step; ease anyone they rolled into. */
  nudge(blocks: readonly Disc[]): void {
    pushClear(this.xy, blocks)
    for (let i = 0; i < this.figures.length; i++) {
      const root = this.figures[i]!.root
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
      this.scene.remove(figure.root)
      figure.dispose()
    }
  }
}

function css(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`
}
