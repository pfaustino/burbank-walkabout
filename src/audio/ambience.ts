type Mover = { x: number; z: number; speed: number }

export type AmbienceWorld = {
  hour: number
  x: number
  z: number
  yaw: number
  speed: number
  driving: boolean
  driveSpeed: number
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
  private crunchAt = 0
  private noise: AudioBuffer | null = null
  private crashBuf: AudioBuffer | null = null
  private coinBuf: AudioBuffer | null = null
  private engineGain: GainNode | null = null
  private engineFilter: BiquadFilterNode | null = null
  private engineOsc: OscillatorNode | null = null
  private engineSrc: AudioBufferSourceNode | null = null
  private driveHeard = 0

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

    const traffic = nearest(world.cars, world.x, world.z, 38, world.driving ? 3 : 0)
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

    this.hearEngine(now, dt, world)

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

  /** A crash at a collision, louder when the hit is close and fast. */
  crunch(
    hits: readonly { x: number; z: number; impact: number }[],
    hearX: number,
    hearZ: number,
    hearYaw: number,
    minImpact: number,
  ): void {
    const ctx = this.ensure()
    if (!ctx || !this.master || ctx.state !== 'running') return
    const now = ctx.currentTime
    if (now < this.crunchAt) return
    let bestX = 0
    let bestZ = 0
    let best = 0
    let loud = 0
    for (const hit of hits) {
      if (hit.impact < minImpact) continue
      const dist = Math.hypot(hit.x - hearX, hit.z - hearZ)
      if (dist > 46) continue
      const score = hit.impact * (1 - dist / 46)
      if (score <= best) continue
      best = score
      bestX = hit.x
      bestZ = hit.z
      loud = Math.min(1, hit.impact / 10)
    }
    if (best <= 0) return
    this.playCrash(now, crunchPan(bestX - hearX, bestZ - hearZ, hearYaw), loud)
    this.crunchAt = now + 0.4
  }

  /** A coin ding. A higher rate is the tip. */
  coin(rate = 1): void {
    const ctx = this.ensure()
    if (!ctx || !this.master || ctx.state !== 'running') return
    const now = ctx.currentTime
    if (this.coinBuf) {
      const source = ctx.createBufferSource()
      source.buffer = this.coinBuf
      source.playbackRate.value = rate
      const amp = ctx.createGain()
      amp.gain.value = 0.62
      source.connect(amp)
      amp.connect(this.master)
      source.start(now)
      return
    }
    this.playDing(now, rate)
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
    this.startEngine(ctx)
    const base = import.meta.env.BASE_URL
    // Pixabay Content License: "Sound Effect - Car Crash" by u_mgq59j5ayf,
    // "coin recieved" by RibhavAgrawal, "muscle car engine idling" by flutie8211.
    this.loadClip('crash', `${base}sounds/crash.mp3`)
    this.loadClip('coin', `${base}sounds/coin.mp3`)
    this.loadClip('engine', `${base}sounds/engine.mp3`)
    return ctx
  }

  private loadClip(kind: 'crash' | 'coin' | 'engine', url: string): void {
    const ctx = this.ctx
    if (!ctx) return
    void fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status))
        return res.arrayBuffer()
      })
      .then((data) => ctx.decodeAudioData(data))
      .then((audio) => {
        if (kind === 'crash') this.crashBuf = audio
        else if (kind === 'coin') this.coinBuf = audio
        else this.attachEngine(audio)
      })
      .catch(() => undefined)
  }

  private startEngine(ctx: AudioContext): void {
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 220
    filter.Q.value = 0.4
    const amp = ctx.createGain()
    amp.gain.value = 0.0001
    filter.connect(amp)
    amp.connect(this.master!)
    const osc = ctx.createOscillator()
    osc.type = 'triangle'
    osc.frequency.value = 20
    osc.connect(filter)
    osc.start()
    this.engineFilter = filter
    this.engineGain = amp
    this.engineOsc = osc
  }

  /** Swap the quiet fallback for a looped low idle, played under its recorded pitch. */
  private attachEngine(buffer: AudioBuffer): void {
    const ctx = this.ctx
    if (!ctx || !this.engineFilter || this.engineSrc) return
    const osc = this.engineOsc
    this.engineOsc = null
    if (osc) {
      try {
        osc.stop()
      } catch {
        /* already stopped */
      }
    }
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.loop = true
    source.playbackRate.value = 0.68
    source.connect(this.engineFilter)
    source.start()
    this.engineSrc = source
  }

  private hearEngine(now: number, dt: number, world: AmbienceWorld): void {
    if (!this.engineGain || !this.engineFilter) return
    if (!world.driving) {
      this.engineGain.gain.setTargetAtTime(0.0001, now, 0.12)
      this.driveHeard = 0
      return
    }
    const speed = Math.abs(world.driveSpeed)
    const accel = dt > 0 ? (speed - this.driveHeard) / dt : 0
    this.driveHeard = speed
    const climb = Math.max(0, Math.min(6, accel))
    // Idle stays under the recording. Speed and throttle each lift the pitch so a pull away is a rev.
    const rate = Math.min(1.75, 0.72 + speed * 0.042 + climb * 0.08)
    if (this.engineSrc) {
      this.engineSrc.playbackRate.setTargetAtTime(rate, now, 0.05)
      this.engineFilter.frequency.setTargetAtTime(Math.min(980, 260 + speed * 24 + climb * 40), now, 0.05)
    } else if (this.engineOsc) {
      this.engineOsc.frequency.setTargetAtTime(22 + speed * 2.2 + climb * 3, now, 0.05)
      this.engineFilter.frequency.setTargetAtTime(120 + speed * 14, now, 0.05)
    }
    const loud = 0.055 + Math.min(0.09, speed * 0.005) + climb * 0.012
    this.engineGain.gain.setTargetAtTime(loud, now, 0.05)
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

  private playCrash(when: number, panValue: number, amount: number): void {
    const ctx = this.ctx
    const buffer = this.crashBuf
    if (!ctx || !buffer || !this.master) {
      this.playCrunch(when, panValue, amount)
      return
    }
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.playbackRate.value = 0.96 + amount * 0.12
    const amp = ctx.createGain()
    amp.gain.setValueAtTime(0.0001, when)
    amp.gain.exponentialRampToValueAtTime(0.28 + amount * 0.4, when + 0.012)
    const pan = ctx.createStereoPanner()
    pan.pan.value = panValue
    source.connect(amp)
    amp.connect(pan)
    pan.connect(this.master)
    source.start(when)
  }

  private playDing(when: number, rate: number): void {
    const ctx = this.ctx
    if (!ctx || !this.master) return
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(880 * rate, when)
    osc.frequency.exponentialRampToValueAtTime(1320 * rate, when + 0.08)
    const amp = ctx.createGain()
    amp.gain.setValueAtTime(0.0001, when)
    amp.gain.exponentialRampToValueAtTime(0.16, when + 0.012)
    amp.gain.exponentialRampToValueAtTime(0.0001, when + 0.18)
    osc.connect(amp)
    amp.connect(this.master)
    osc.start(when)
    osc.stop(when + 0.2)
  }

  private playCrunch(when: number, panValue: number, amount: number): void {
    const ctx = this.ctx
    const buffer = this.noise
    if (!ctx || !buffer || !this.master) return
    const pan = ctx.createStereoPanner()
    pan.pan.value = panValue
    pan.connect(this.master)

    const noise = ctx.createBufferSource()
    noise.buffer = buffer
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(900, when)
    filter.frequency.exponentialRampToValueAtTime(180, when + 0.16)
    const noiseAmp = ctx.createGain()
    const peak = 0.08 + amount * 0.22
    noiseAmp.gain.setValueAtTime(0.0001, when)
    noiseAmp.gain.exponentialRampToValueAtTime(peak, when + 0.012)
    noiseAmp.gain.exponentialRampToValueAtTime(0.0001, when + 0.2)
    noise.connect(filter)
    filter.connect(noiseAmp)
    noiseAmp.connect(pan)
    noise.start(when)
    noise.stop(when + 0.22)

    const thud = ctx.createOscillator()
    thud.type = 'sine'
    thud.frequency.setValueAtTime(110, when)
    thud.frequency.exponentialRampToValueAtTime(42, when + 0.14)
    const thudAmp = ctx.createGain()
    thudAmp.gain.setValueAtTime(0.0001, when)
    thudAmp.gain.exponentialRampToValueAtTime(0.12 + amount * 0.16, when + 0.01)
    thudAmp.gain.exponentialRampToValueAtTime(0.0001, when + 0.18)
    thud.connect(thudAmp)
    thudAmp.connect(pan)
    thud.start(when)
    thud.stop(when + 0.2)
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

function nearest(
  movers: readonly Mover[],
  x: number,
  z: number,
  reach: number,
  skip = 0,
): { mover: Mover; dist: number } | null {
  let best: Mover | null = null
  let bestDist = reach
  for (const mover of movers) {
    const dist = Math.hypot(mover.x - x, mover.z - z)
    if (dist < skip) continue
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

function crunchPan(dx: number, dz: number, yaw: number): number {
  const dist = Math.hypot(dx, dz) || 1
  const fx = -Math.sin(yaw)
  const fz = -Math.cos(yaw)
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
