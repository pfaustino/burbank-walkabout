import * as THREE from 'three'
import playerJson from '../../data/player.json'
import trafficJson from '../../data/traffic.json'
import { createFigure, type Figure } from '../actors/figure.ts'
import { shirtForName } from '../net/protocol.ts'
import { BodyGrid, hitsBody, overlapsCapsule, pushOutOf, type Disc } from '../traffic/bodies.ts'
import { BODY_RADIUS, hitsBuilding, slide, type CityLayout } from '../world/layout.ts'

const DIST_MIN = 3.2
const DIST_MAX = 16
const PITCH_MIN = -1.35
const PITCH_MAX = 1.15
const CAMERA_FLOOR = 0.45
const CAR_RADIUS = 1.15

export class Walker {
  readonly mesh: THREE.Group
  paused = false
  blockers: Disc[] = []
  ignoreBlocker: string | null = null
  private readonly layout: CityLayout
  private readonly camera: THREE.PerspectiveCamera
  private readonly keys = new Set<string>()
  private readonly figure: Figure
  private yaw = 0.4
  private pitch = 0.42
  private cameraDist = 8.5
  private velocityY = 0
  private grounded = true
  private driveMode = false
  private rideMode = false
  private flyMode = false
  private carYaw = 0.4
  private carSpeed = 0
  private wallCool = 0
  private wallHit = 0
  private pedal = 0
  private slideYaw = 0.4
  private skid = 0
  private readonly driveClear: Disc[] = []
  private readonly posts = new BodyGrid()
  private flyYaw = 0.4
  private flySpeed = 0
  private lift = 0
  private bank = 0
  private dragging = false

  constructor(
    layout: CityLayout,
    camera: THREE.PerspectiveCamera,
    spawn: { x: number; z: number },
    name: string,
  ) {
    this.layout = layout
    this.camera = camera
    this.figure = createFigure({
      name,
      voice: 'male',
      shirt: shirtForName(name),
      pants: '#243044',
      skin: '#e0b090',
      hair: '#2a2118',
      showName: false,
    })
    this.mesh = this.figure.root
    this.mesh.position.set(spawn.x, 0, spawn.z)
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('mousemove', this.onMouseMove)
    window.addEventListener('wheel', this.onWheel, { passive: false })
    window.addEventListener('mouseup', this.onMouseUp)
    window.addEventListener('blur', this.onBlur)
  }

  get driving(): boolean {
    return this.driveMode
  }

  get riding(): boolean {
    return this.rideMode
  }

  get flying(): boolean {
    return this.flyMode
  }

  /** Signed speed while driving. Negative is reverse. */
  get driveSpeed(): number {
    return this.carSpeed
  }

  /** Gas and brake keys while driving: 1, 0, or -1. */
  get throttle(): number {
    return this.driveMode ? this.pedal : 0
  }

  /** 0 is planted, 1 is the tires sliding in a hard turn. */
  get skidding(): number {
    return this.driveMode ? this.skid : 0
  }

  get braking(): boolean {
    return this.driveMode && this.pedal < 0 && Math.abs(this.carSpeed) > 3.5
  }

  get facing(): number {
    if (this.flyMode) return this.flyYaw
    return this.driveMode ? this.carYaw : this.mesh.rotation.y
  }

  get flight(): { x: number; y: number; z: number; yaw: number; roll: number } {
    return {
      x: this.mesh.position.x,
      y: this.mesh.position.y,
      z: this.mesh.position.z,
      yaw: this.flyYaw,
      roll: this.bank,
    }
  }

  /** Tree trunks and lamp poles. They block like buildings. */
  setPosts(posts: readonly Disc[]): void {
    this.posts.clear()
    for (const post of posts) this.posts.add({ x: post.x, z: post.z, r: post.r })
  }

  beginDrive(x: number, z: number, yaw: number): void {
    this.driveMode = true
    this.rideMode = false
    this.flyMode = false
    this.carYaw = yaw
    this.slideYaw = yaw
    this.skid = 0
    this.carSpeed = 0
    this.wallCool = 0
    this.wallHit = 0
    this.yaw = yaw + Math.PI
    this.mesh.visible = false
    this.mesh.position.set(x, 0, z)
    this.velocityY = 0
    this.grounded = true
  }

  beginRide(x: number, z: number, yaw: number): void {
    this.rideMode = true
    this.driveMode = false
    this.flyMode = false
    this.mesh.visible = false
    this.mesh.position.set(x, 1.3, z)
    this.mesh.rotation.y = yaw
    this.yaw = yaw + Math.PI
    this.pitch = 0.38
    this.cameraDist = 18
    this.velocityY = 0
    this.grounded = true
  }

  followRide(x: number, z: number, yaw: number): void {
    this.mesh.position.set(x, 1.3, z)
    this.mesh.rotation.y = yaw
    if (!this.dragging) this.yaw = yaw + Math.PI
  }

  endRide(): void {
    const yaw = this.mesh.rotation.y
    const x = this.mesh.position.x + Math.cos(yaw) * 4.2
    const z = this.mesh.position.z - Math.sin(yaw) * 4.2
    const next = this.place(this.mesh.position.x, this.mesh.position.z, x, z, BODY_RADIUS)
    this.rideMode = false
    this.mesh.visible = true
    this.mesh.position.set(next.x, 0, next.z)
    this.pitch = 0.42
    this.cameraDist = 8.5
    this.velocityY = 0
    this.grounded = true
  }

  beginFly(x: number, y: number, z: number, yaw: number): void {
    this.flyMode = true
    this.driveMode = false
    this.rideMode = false
    this.flyYaw = yaw
    this.flySpeed = 0
    this.lift = 0
    this.bank = 0
    this.yaw = yaw + Math.PI
    this.pitch = 0.28
    this.cameraDist = 16
    this.mesh.visible = false
    this.mesh.position.set(x, y, z)
    this.velocityY = 0
    this.grounded = false
  }

  endFly(): void {
    const x = this.mesh.position.x
    const z = this.mesh.position.z
    const spot = landingSpot(this.layout, x, z)
    this.flyMode = false
    this.flySpeed = 0
    this.lift = 0
    this.bank = 0
    this.mesh.visible = true
    this.mesh.position.set(spot.x, 0, spot.z)
    this.mesh.rotation.y = this.flyYaw
    this.velocityY = 0
    this.grounded = true
  }

  endDrive(): void {
    const x = this.mesh.position.x + Math.cos(this.carYaw) * 2.4
    const z = this.mesh.position.z - Math.sin(this.carYaw) * 2.4
    const next = this.place(this.mesh.position.x, this.mesh.position.z, x, z, BODY_RADIUS)
    this.driveMode = false
    this.carSpeed = 0
    this.wallHit = 0
    this.mesh.visible = true
    this.mesh.position.set(next.x, 0, next.z)
    this.mesh.rotation.y = this.carYaw
  }

  teleport(x: number, z: number): void {
    if (this.flyMode) {
      this.mesh.position.x = x
      this.mesh.position.z = z
      return
    }
    const radius = this.driveMode ? CAR_RADIUS : BODY_RADIUS
    const next = slide(this.layout, x, z, x, z, radius)
    this.mesh.position.set(next.x, 0, next.z)
    this.velocityY = 0
    this.grounded = true
    this.carSpeed = 0
  }

  update(dt: number): void {
    const speed = this.paused ? 0 : this.move(dt)
    this.figure.update(dt, speed)
    this.updateCamera()
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('mousemove', this.onMouseMove)
    window.removeEventListener('wheel', this.onWheel)
    window.removeEventListener('mouseup', this.onMouseUp)
    window.removeEventListener('blur', this.onBlur)
    this.figure.dispose()
  }

  private move(dt: number): number {
    if (this.rideMode) return 0
    if (this.flyMode) return this.fly(dt)
    if (this.driveMode) return this.drive(dt)
    let wishX = 0
    let wishZ = 0
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) wishZ -= 1
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) wishZ += 1
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) wishX -= 1
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) wishX += 1

    const length = Math.hypot(wishX, wishZ)
    let speed = 0
    if (length > 0) {
      wishX /= length
      wishZ /= length
      const sin = Math.sin(this.yaw)
      const cos = Math.cos(this.yaw)
      const worldX = wishX * cos + wishZ * sin
      const worldZ = -wishX * sin + wishZ * cos
      speed = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? playerJson.sprintSpeed : playerJson.walkSpeed
      const next = this.place(
        this.mesh.position.x,
        this.mesh.position.z,
        this.mesh.position.x + worldX * speed * dt,
        this.mesh.position.z + worldZ * speed * dt,
        BODY_RADIUS,
      )
      this.mesh.position.x = next.x
      this.mesh.position.z = next.z
      this.mesh.rotation.y = Math.atan2(worldX, worldZ)
    }

    if (this.grounded) {
      this.mesh.position.y = 0
      this.velocityY = 0
    } else {
      this.velocityY -= playerJson.gravity * dt
      this.mesh.position.y += this.velocityY * dt
      if (this.mesh.position.y <= 0) {
        this.mesh.position.y = 0
        this.velocityY = 0
        this.grounded = true
      }
    }
    return speed
  }

  private fly(dt: number): number {
    let throttle = 0
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) throttle += 1
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) throttle -= 1
    const steer = (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0) - (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0)
    const climb = (this.keys.has('Space') ? 1 : 0) - (this.keys.has('ControlLeft') || this.keys.has('ControlRight') || this.keys.has('KeyC') ? 1 : 0)
    const boost = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')
    const maxFwd = boost ? 46 : 26
    if (throttle > 0) this.flySpeed = Math.min(maxFwd, this.flySpeed + 16 * dt)
    else if (throttle < 0) this.flySpeed = Math.max(-12, this.flySpeed - 20 * dt)
    else this.flySpeed *= Math.max(0, 1 - 0.7 * dt)
    const yawRate = Math.abs(this.flySpeed) > 0.4 ? 1.15 : 1.3
    this.flyYaw += steer * yawRate * dt
    const climbRate = climb * (boost ? 18 : 11)
    this.lift += THREE.MathUtils.clamp(climbRate - this.lift, -22 * dt, 22 * dt)
    if (climb === 0) this.lift *= Math.max(0, 1 - 1.6 * dt)
    this.bank = THREE.MathUtils.damp(this.bank, -steer * 0.35, 4, dt)
    const bounds = this.layout.file.bounds
    const nextX = this.mesh.position.x + Math.sin(this.flyYaw) * this.flySpeed * dt
    const nextZ = this.mesh.position.z + Math.cos(this.flyYaw) * this.flySpeed * dt
    const nextY = this.mesh.position.y + this.lift * dt
    this.mesh.position.x = THREE.MathUtils.clamp(nextX, bounds.minX + 12, bounds.maxX - 12)
    this.mesh.position.z = THREE.MathUtils.clamp(nextZ, bounds.minZ + 12, bounds.maxZ - 12)
    this.mesh.position.y = THREE.MathUtils.clamp(nextY, 8, 110)
    this.mesh.rotation.y = this.flyYaw
    if (!this.dragging) this.yaw = dampAngle(this.yaw, this.flyYaw + Math.PI, 1 - Math.exp(-dt * 4))
    return Math.abs(this.flySpeed)
  }

  private drive(dt: number): number {
    this.wallCool = Math.max(0, this.wallCool - dt)
    let throttle = 0
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) throttle += 1
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) throttle -= 1
    const boost = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')
    const maxFwd = boost ? trafficJson.driveBoost : trafficJson.driveMax
    this.pedal = this.paused ? 0 : throttle
    if (throttle > 0) this.carSpeed = Math.min(maxFwd, this.carSpeed + 8 * dt)
    else if (throttle < 0) this.carSpeed = Math.max(-4.5, this.carSpeed - 16 * dt)
    else this.carSpeed *= Math.max(0, 1 - 1.4 * dt)
    const steer = (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0) - (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0)
    const fast = Math.abs(this.carSpeed)
    const wantSkid = Math.abs(steer) > 0 && fast > 7 ? Math.min(1, (fast - 7) / 8) : 0
    this.skid += (wantSkid - this.skid) * Math.min(1, dt * 5)
    const rate = 1.8 * THREE.MathUtils.clamp(fast / 6, 0.3, 1)
    this.carYaw += steer * rate * dt * Math.sign(this.carSpeed || 1) * (1 - this.skid * 0.55)
    const catchup = 1 - Math.exp(-dt * (this.skid > 0.2 ? 1.6 : 9))
    this.slideYaw = dampAngle(this.slideYaw, this.carYaw, catchup)
    const speed = this.carSpeed
    const dx = Math.sin(this.slideYaw) * speed * dt
    const dz = Math.cos(this.slideYaw) * speed * dt
    const pos = this.mesh.position
    const wanted = Math.hypot(dx, dz)
    const intoWall = wanted > 0 && this.solid(pos.x + dx, pos.z + dz, CAR_RADIUS)
    const next = this.place(pos.x, pos.z, pos.x + dx, pos.z + dz, CAR_RADIUS)
    const moved = Math.hypot(next.x - pos.x, next.z - pos.z)
    pos.x = next.x
    pos.z = next.z
    if (intoWall && this.wallCool <= 0 && moved < wanted * 0.45) {
      const bounce = wallBounce(speed)
      if (bounce) {
        const sign = Math.sign(speed) || 1
        this.carSpeed = bounce.speed
        this.shoveFree(-Math.sin(this.carYaw) * sign * bounce.kick, -Math.cos(this.carYaw) * sign * bounce.kick)
        this.wallHit = Math.abs(speed)
        this.wallCool = 0.4
      }
    } else if (moved < wanted * 0.45) {
      this.carSpeed *= 0.35
    }
    this.mesh.rotation.y = this.carYaw
    if (!this.dragging) this.yaw = dampAngle(this.yaw, this.carYaw + Math.PI, 1 - Math.exp(-dt * 4))
    return Math.abs(this.carSpeed)
  }

  /** Impact of a building bounce this frame, then clear it. */
  takeWallHit(): number {
    const hit = this.wallHit
    this.wallHit = 0
    return hit
  }

  private shoveFree(dx: number, dz: number): void {
    const pos = this.mesh.position
    if (this.open(pos.x + dx, pos.z + dz, CAR_RADIUS)) {
      pos.x += dx
      pos.z += dz
      return
    }
    if (this.open(pos.x + dx, pos.z, CAR_RADIUS)) pos.x += dx
    else if (this.open(pos.x, pos.z + dz, CAR_RADIUS)) pos.z += dz
  }

  /** Move the driven car off a hit and take the new forward speed. */
  nudge(dx: number, dz: number, speed: number): void {
    if (!this.driveMode) return
    this.mesh.position.x += dx
    this.mesh.position.z += dz
    this.carSpeed = THREE.MathUtils.clamp(speed, -6, trafficJson.driveBoost)
  }

  /** Push the player out of a vehicle that moved into them after they stepped. */
  shoveOut(discs: readonly Disc[]): void {
    if (this.flyMode || this.rideMode) return
    const blocks = this.driveClear
    blocks.length = 0
    for (const disc of discs) {
      if (this.driveMode && disc.id?.startsWith('car:')) continue
      blocks.push(disc)
    }
    const radius = this.driveMode ? CAR_RADIUS : BODY_RADIUS
    const pos = this.mesh.position
    const next = pushOutOf(blocks, pos.x, pos.z, radius, this.ignoreBlocker)
    if (!next.hit || hitsBuilding(this.layout, next.x, next.z, radius)) return
    pos.x = next.x
    pos.z = next.z
    this.carSpeed = 0
  }

  private place(x: number, z: number, nx: number, nz: number, radius: number): { x: number; z: number } {
    if (this.open(nx, nz, radius)) return { x: nx, z: nz }
    if (this.open(nx, z, radius)) return { x: nx, z }
    if (this.open(x, nz, radius)) return { x, z: nz }
    if (!hitsBuilding(this.layout, x, z, radius)) {
      const out = pushOutOf(this.blockers, x, z, radius, this.ignoreBlocker)
      if (out.hit && !hitsBuilding(this.layout, out.x, out.z, radius)) return { x: out.x, z: out.z }
    }
    return { x, z }
  }

  private open(x: number, z: number, radius: number): boolean {
    return !this.solid(x, z, radius) && !hitsBody(this.blockers, x, z, radius, this.ignoreBlocker)
  }

  private solid(x: number, z: number, radius: number): boolean {
    if (hitsBuilding(this.layout, x, z, radius)) return true
    let hit = false
    this.posts.near(x, z, radius + 1, (post) => {
      if (!hit && overlapsCapsule(x, z, 0, 0, radius, post)) hit = true
    })
    return hit
  }

  private updateCamera(): void {
    const dist = this.flyMode ? THREE.MathUtils.clamp(this.cameraDist, 10, 28) : this.fitCamera(this.cameraDist)
    const cosPitch = Math.cos(this.pitch)
    const ox = Math.sin(this.yaw) * dist * cosPitch
    const oz = Math.cos(this.yaw) * dist * cosPitch
    const oy = 4.2 * (dist / 9) + Math.sin(this.pitch) * dist
    const pos = this.mesh.position
    const camY = Math.max(pos.y + CAMERA_FLOOR, pos.y + oy)
    const sky = Math.max(0, 0.15 - this.pitch)
    const lookY = this.flyMode ? pos.y + 0.4 : pos.y + (this.driveMode ? 1.15 : 1.45) + sky * dist * 0.85
    this.camera.position.set(pos.x + ox, camY, pos.z + oz)
    this.camera.lookAt(pos.x, lookY, pos.z)
  }

  private fitCamera(desired: number): number {
    const headX = this.mesh.position.x
    const headZ = this.mesh.position.z
    for (let dist = desired; dist >= DIST_MIN; dist -= 0.45) {
      const ox = Math.sin(this.yaw) * dist * Math.cos(this.pitch)
      const oz = Math.cos(this.yaw) * dist * Math.cos(this.pitch)
      if (!hitsBuilding(this.layout, headX + ox, headZ + oz, 0.3)) return dist
    }
    return DIST_MIN
  }

  private tryJump(): void {
    if (this.paused || !this.grounded || this.driveMode || this.flyMode || this.rideMode) return
    this.velocityY = playerJson.jumpSpeed
    this.grounded = false
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (typingTarget(event.target)) return
    this.keys.add(event.code)
    if (event.code === 'Space') {
      event.preventDefault()
      if (!event.repeat) this.tryJump()
    }
  }

  private onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code)
  }

  private onMouseUp = (): void => {
    this.dragging = false
  }

  private onMouseMove = (event: MouseEvent): void => {
    this.dragging = (event.buttons & 2) !== 0
    if (this.paused || !this.dragging) return
    this.yaw -= event.movementX * 0.0022
    this.pitch += event.movementY * 0.0018
    this.pitch = THREE.MathUtils.clamp(this.pitch, PITCH_MIN, PITCH_MAX)
  }

  private onWheel = (event: WheelEvent): void => {
    if (typingTarget(event.target)) return
    event.preventDefault()
    if (this.paused) return
    const maxDist = this.flyMode ? 28 : DIST_MAX
    const minDist = this.flyMode ? 10 : DIST_MIN
    this.cameraDist = THREE.MathUtils.clamp(this.cameraDist + Math.sign(event.deltaY) * 0.8, minDist, maxDist)
  }

  private onBlur = (): void => {
    this.keys.clear()
  }
}

function dampAngle(current: number, target: number, t: number): number {
  let delta = target - current
  while (delta > Math.PI) delta -= Math.PI * 2
  while (delta < -Math.PI) delta += Math.PI * 2
  return current + delta * t
}

function landingSpot(layout: CityLayout, x: number, z: number): { x: number; z: number } {
  if (!hitsBuilding(layout, x, z, BODY_RADIUS)) return { x, z }
  for (let radius = 2; radius <= 24; radius += 2) {
    for (let step = 0; step < 8; step++) {
      const angle = (step / 8) * Math.PI * 2
      const sx = x + Math.cos(angle) * radius
      const sz = z + Math.sin(angle) * radius
      if (!hitsBuilding(layout, sx, sz, BODY_RADIUS)) return { x: sx, z: sz }
    }
  }
  return { x, z }
}

/** Reverse part of the impact and kick the car back off a building. */
export function wallBounce(speed: number): { speed: number; kick: number } | null {
  const impact = Math.abs(speed)
  if (impact < trafficJson.crunch) return null
  const sign = Math.sign(speed)
  return { speed: -sign * impact * 0.45, kick: Math.min(2.2, impact * 0.14) }
}

function typingTarget(target: EventTarget | null): boolean {
  const tag = (target as HTMLElement | null)?.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}
