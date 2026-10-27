import * as THREE from 'three'
import { slideClear, type Disc } from '../traffic/bodies.ts'
import { createFigure, type Figure } from './figure.ts'
import type { PersonVoice } from './peopleSim.ts'

const BODY = 0.45

export type PuppetDesc = {
  id: string
  name: string
  voice: PersonVoice
  shirt: string
  pants: string
  skin: string
  hair: string
  x: number
  z: number
  yaw: number
}

type Puppet = {
  figure: Figure
  tx: number
  tz: number
  tyaw: number
  bubble: number
}

export class PuppetSet {
  private readonly puppets = new Map<string, Puppet>()
  private readonly scene: THREE.Scene

  constructor(scene: THREE.Scene) {
    this.scene = scene
  }

  sync(list: PuppetDesc[], dt: number, blocks: readonly Disc[] = []): void {
    const seen = new Set<string>()
    for (const desc of list) {
      seen.add(desc.id)
      let puppet = this.puppets.get(desc.id)
      if (!puppet) {
        const figure = createFigure({ ...desc, showName: true })
        figure.root.position.set(desc.x, 0, desc.z)
        figure.root.rotation.y = desc.yaw
        this.scene.add(figure.root)
        puppet = { figure, tx: desc.x, tz: desc.z, tyaw: desc.yaw, bubble: 0 }
        this.puppets.set(desc.id, puppet)
      }
      puppet.tx = desc.x
      puppet.tz = desc.z
      puppet.tyaw = desc.yaw
      const root = puppet.figure.root
      const k = 1 - Math.exp(-dt * 8)
      const prevX = root.position.x
      const prevZ = root.position.z
      const nx = prevX + (puppet.tx - prevX) * k
      const nz = prevZ + (puppet.tz - prevZ) * k
      const next = slideClear(blocks, prevX, prevZ, nx, nz, BODY, desc.id)
      root.position.x = next.x
      root.position.z = next.z
      root.rotation.y = dampAngle(root.rotation.y, puppet.tyaw, k)
      const speed = dt > 0 ? Math.hypot(root.position.x - prevX, root.position.z - prevZ) / dt : 0
      puppet.figure.update(dt, speed)
      if (puppet.bubble > 0) {
        puppet.bubble -= dt
        if (puppet.bubble <= 0) puppet.figure.setBubble(null)
      }
    }
    for (const [id, puppet] of this.puppets) {
      if (seen.has(id)) continue
      this.scene.remove(puppet.figure.root)
      puppet.figure.dispose()
      this.puppets.delete(id)
    }
  }

  say(id: string, text: string): void {
    const puppet = this.puppets.get(id)
    if (!puppet) return
    puppet.figure.setBubble(text)
    puppet.bubble = 7
  }

  clear(): void {
    for (const puppet of this.puppets.values()) {
      this.scene.remove(puppet.figure.root)
      puppet.figure.dispose()
    }
    this.puppets.clear()
  }

  dispose(): void {
    this.clear()
  }
}

function dampAngle(current: number, target: number, t: number): number {
  let delta = target - current
  while (delta > Math.PI) delta -= Math.PI * 2
  while (delta < -Math.PI) delta += Math.PI * 2
  return current + delta * t
}
