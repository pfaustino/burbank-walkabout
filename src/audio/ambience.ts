type Mover = { x: number; z: number; speed: number }

export type AmbienceWorld = {
  hour: number
  x: number
  z: number
  yaw: number
  speed: number
  onFoot: boolean
  altitude: number
  muted: boolean
  cars: readonly Mover[]
  buses: readonly Mover[]
}

/** Procedural street bed: steps, traffic, horns, buses, wind, and daytime birds. */
export class Ambience {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private windGain: GainNode | null = null
  private trafficGain: GainNode | null = null
  private trafficPan: StereoPannerNode | null = null
  private busGain: GainNode | null = null
  private busPan: StereoPannerNode | null = null
  private stepAt = 0
  private chirpAt = 1.4
  private honkAt = 3
  private hissAt = 2
  private noise: AudioBuffer | null = null

  resume(): void {
    const ctx = this.ensure()
    if (ctx && ctx.state === 'suspended') void ctx.resume()
  }

  update(dt: number, world: AmbienceWorld): void {
    const ctx = this.ensure()
    if (!ctx || !this.master || !this.windGain || !this.trafficGain || !this.trafficPan || !this.busGain || !this.busPan) return
    const now = ctx.currentTime
    const mute = world.muted || ctx.state !== 'running' ? 0 : 1
    this.master.gain.setTargetAtTime(mute * 0.42, now, 0.08)

    const wind = Math.min(0.16, 0.035 + world.altitude * 0.0014 + world.speed * 0.004)
    this.windGain.gain.setTargetAtTime(wind, now, 0.2)

    const traffic = nearest(world.cars, world.x, world.z, 38)
    if (traffic) {
      const closeness = 1 - traffic.dist / 38
      const roll = Math.max(0.2, Math.min(1, traffic.mover.speed / 11))
      this.trafficGain.gain.setTargetAtTime(closeness * roll * 0.22, now, 0.12)
      this.trafficPan.pan.setTargetAtTime(panOf(traffic.mover, world), now, 0.08)
    } else this.trafficGain.gain.setTargetAtTime(0, now, 0.2)

    const bus = nearest(world.buses, world.x, world.z, 30)
    if (bus) {
      const closeness = 1 - bus.dist / 30
      this.busGain.gain.setTargetAtTime(closeness * Math.max(0.35, Math.min(1, bus.mover.speed / 8)) * 0.28, now, 0.15)
      this.busPan.pan.setTargetAtTime(panOf(bus.mover, world), now, 0.08)
      if (bus.dist < 16 && bus.mover.speed < 0.5 && now > this.hissAt) {
        this.hiss(now, panOf(bus.mover, world))
        this.hissAt = now + 7
      }
    } else this.busGain.gain.setTargetAtTime(0, now, 0.2)

    if (world.onFoot && world.speed > 0.4 && world.speed < 14) {
      const gap = world.speed > 3.2 ? 0.32 : Math.min(0.62, 0.78 / world.speed)
      this.stepAt -= dt
      if (this.stepAt <= 0) {
        this.step(now, world.speed)
        this.stepAt = gap
      }
    } else this.stepAt = 0.05

    const day = world.hour >= 5.5 && world.hour <= 19
    this.chirpAt -= dt
    if (day && this.chirpAt <= 0) {
      this.chirp(now)
      this.chirpAt = 1.6 + Math.random() * 4.5
    }
    if (!day) this.chirpAt = 2

    if (now > this.honkAt) {
      let pick: Mover | null = null
      let count = 0
      for (const car of world.cars) {
        if (car.speed >= 1.2) continue
        if (Math.hypot(car.x - world.x, car.z - world.z) >= 32) continue
        count++
        if (Math.random() < 1 / count) pick = car
      }
      if (pick && Math.random() < dt * 0.35) {
        this.honk(now, panOf(pick, world))
        this.honkAt = now + 6 + Math.random() * 8
      }
    }
  }

  dispose(): void {
    void this.ctx?.close()
    this.ctx = null
  }

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx
    const Ctx = window.AudioContext
    if (!Ctx) return null
    const ctx = new Ctx()
    this.ctx = ctx
    this.noise = noiseBuffer(ctx)
    this.master = ctx.createGain()
    this.master.gain.value = 0
    this.master.connect(ctx.destination)

    const wind = this.loop(ctx, this.noise, 420, 'lowpass', 0.04)
    this.windGain = wind.gain
    const traffic = this.loop(ctx, this.noise, 180, 'lowpass', 0)
    this.trafficGain = traffic.gain
    this.trafficPan = traffic.pan
    const bus = this.loop(ctx, this.noise, 90, 'lowpass', 0)
    this.busGain = bus.gain
    this.busPan = bus.pan
    return ctx
  }

  private loop(
    ctx: AudioContext,
    buffer: AudioBuffer,
    frequency: number,
    type: BiquadFilterType,
    gain: number,
  ): { gain: GainNode; pan: StereoPannerNode } {
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.loop = true
    const filter = ctx.createBiquadFilter()
    filter.type = type
    filter.frequency.value = frequency
    const amp = ctx.createGain()
    amp.gain.value = gain
    const pan = ctx.createStereoPanner()
    source.connect(filter)
    filter.connect(amp)
    amp.connect(pan)
    pan.connect(this.master!)
    source.start()
    return { gain: amp, pan }
  }

  private step(when: number, speed: number): void {
    const ctx = this.ctx
    const buffer = this.noise
    if (!ctx || !buffer || !this.master) return
    const source = ctx.createBufferSource()
    source.buffer = buffer
    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.value = 140 + Math.random() * 180 + speed * 18
    filter.Q.value = 0.8
    const amp = ctx.createGain()
    amp.gain.setValueAtTime(0.0001, when)
    amp.gain.exponentialRampToValueAtTime(0.16, when + 0.012)
    amp.gain.exponentialRampToValueAtTime(0.0001, when + 0.09)
    source.connect(filter)
    filter.connect(amp)
    amp.connect(this.master)
    source.start(when)
    source.stop(when + 0.1)
  }

  private chirp(when: number): void {
    const ctx = this.ctx
    if (!ctx || !this.master) return
    const base = 1700 + Math.random() * 1400
    const notes = 2 + Math.floor(Math.random() * 2)
    for (let i = 0; i < notes; i++) {
      const start = when + i * 0.09
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(base + i * 180, start)
      osc.frequency.exponentialRampToValueAtTime(base * 0.82, start + 0.08)
      const amp = ctx.createGain()
      amp.gain.setValueAtTime(0.0001, start)
      amp.gain.exponentialRampToValueAtTime(0.045, start + 0.012)
      amp.gain.exponentialRampToValueAtTime(0.0001, start + 0.1)
      const pan = ctx.createStereoPanner()
      pan.pan.value = Math.random() * 1.4 - 0.7
      osc.connect(amp)
      amp.connect(pan)
      pan.connect(this.master)
      osc.start(start)
      osc.stop(start + 0.11)
    }
  }

  private honk(when: number, panValue: number): void {
    const ctx = this.ctx
    if (!ctx || !this.master) return
    for (const [freq, delay] of [
      [392, 0],
      [466, 0.16],
    ] as const) {
      const start = when + delay
      const osc = ctx.createOscillator()
      osc.type = 'square'
      osc.frequency.value = freq
      const filter = ctx.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.value = 1800
      const amp = ctx.createGain()
      amp.gain.setValueAtTime(0.0001, start)
      amp.gain.exponentialRampToValueAtTime(0.05, start + 0.02)
      amp.gain.exponentialRampToValueAtTime(0.0001, start + 0.2)
      const pan = ctx.createStereoPanner()
      pan.pan.value = panValue
      osc.connect(filter)
      filter.connect(amp)
      amp.connect(pan)
      pan.connect(this.master)
      osc.start(start)
      osc.stop(start + 0.22)
    }
  }

  private hiss(when: number, panValue: number): void {
    const ctx = this.ctx
    const buffer = this.noise
    if (!ctx || !buffer || !this.master) return
    const source = ctx.createBufferSource()
    source.buffer = buffer
    const filter = ctx.createBiquadFilter()
    filter.type = 'highpass'
    filter.frequency.value = 1200
    const amp = ctx.createGain()
    amp.gain.setValueAtTime(0.0001, when)
    amp.gain.exponentialRampToValueAtTime(0.06, when + 0.05)
    amp.gain.exponentialRampToValueAtTime(0.0001, when + 0.45)
    const pan = ctx.createStereoPanner()
    pan.pan.value = panValue
    source.connect(filter)
    filter.connect(amp)
    amp.connect(pan)
    pan.connect(this.master)
    source.start(when)
    source.stop(when + 0.5)
  }
}

function nearest(movers: readonly Mover[], x: number, z: number, reach: number): { mover: Mover; dist: number } | null {
  let best: Mover | null = null
  let bestDist = reach
  for (const mover of movers) {
    const dist = Math.hypot(mover.x - x, mover.z - z)
    if (dist < bestDist) {
      best = mover
      bestDist = dist
    }
  }
  return best ? { mover: best, dist: bestDist } : null
}

function panOf(mover: Mover, world: AmbienceWorld): number {
  const dx = mover.x - world.x
  const dz = mover.z - world.z
  const dist = Math.hypot(dx, dz) || 1
  const fx = -Math.sin(world.yaw)
  const fz = -Math.cos(world.yaw)
  const right = (dx * fz + dz * -fx) / dist
  return Math.max(-1, Math.min(1, right))
}

function noiseBuffer(ctx: AudioContext): AudioBuffer {
  const length = ctx.sampleRate * 2
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1
  return buffer
}
