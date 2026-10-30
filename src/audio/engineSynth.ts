/**
 * Procedural four-cylinder engine, after the pulse-train and exhaust-resonator models of
 * Baldan et al. (SIVE 2015) and Doerfler et al. (PTR, 2026): each cylinder fires a pressure
 * pulse once per cycle (RPM / 120 Hz), throttle sets the pulse energy, and the summed train
 * rings through Karplus-Strong delay lines standing in for the straight pipe and muffler.
 */
export const ENGINE_WORKLET = `
class CityEngine extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'rpm', defaultValue: 850, minValue: 300, maxValue: 8000, automationRate: 'k-rate' },
      { name: 'load', defaultValue: 0.2, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ]
  }

  constructor() {
    super()
    const k = sampleRate / 44100
    this.phase = 0
    this.offsets = [0, 0.2515, 0.4985, 0.7505]
    this.gains = [1, 0.95, 1.03, 0.97]
    this.seed = 22222
    this.pipe = this.line(Math.round(118 * k))
    this.mufflers = [37, 53, 71, 97].map((n) => this.line(Math.round(n * k)))
    this.lowBody = 0
    this.lowIntake = 0
    this.lowOut = 0
    this.dcIn = 0
    this.dcOut = 0
  }

  line(length) {
    return { buf: new Float32Array(length + 2), at: 0, length, last: 0 }
  }

  ring(line, input, gain) {
    const read = line.buf[line.at]
    const filtered = 0.5 * (read + line.last)
    line.last = read
    const out = input + gain * filtered
    line.buf[line.at] = out
    line.at = (line.at + 1) % line.length
    return out
  }

  noise() {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0
    return this.seed / 2147483648 - 1
  }

  process(_inputs, outputs, params) {
    const out = outputs[0][0]
    if (!out) return true
    const rpm = params.rpm[0]
    const load = params.load[0]
    const step = rpm / 120 / sampleRate
    const width = 0.075 + 0.03 * (1 - load)
    const energy = 0.35 + 0.65 * load
    const bodyCut = 1 - Math.exp((-2 * Math.PI * 180) / sampleRate)
    const intakeCut = 1 - Math.exp((-2 * Math.PI * 1400) / sampleRate)
    const outCut = 1 - Math.exp((-2 * Math.PI * (900 + load * 2600 + rpm * 0.25)) / sampleRate)
    const dc = 1 - (2 * Math.PI * 25) / sampleRate
    for (let i = 0; i < out.length; i++) {
      this.phase += step
      if (this.phase >= 1) this.phase -= 1
      let pulse = 0
      for (let c = 0; c < 4; c++) {
        let p = this.phase - this.offsets[c]
        if (p < 0) p += 1
        if (p < width) {
          const s = Math.sin((Math.PI * p) / width)
          pulse += s * s * this.gains[c]
        }
      }
      const hiss = this.noise()
      const fire = pulse * energy * (1 + 0.25 * hiss)
      const pipe = this.ring(this.pipe, fire, 0.55)
      let muffled = 0
      for (const m of this.mufflers) muffled += this.ring(m, pipe * 0.25, 0.32)
      this.lowBody += bodyCut * (fire - this.lowBody)
      this.lowIntake += intakeCut * (hiss * pulse * (0.2 + 0.8 * load) - this.lowIntake)
      const mix = muffled * 0.7 + this.lowBody * 0.9 + this.lowIntake * 0.18
      this.lowOut += outCut * (mix - this.lowOut)
      const y = this.lowOut - this.dcIn + dc * this.dcOut
      this.dcIn = this.lowOut
      this.dcOut = y
      out[i] = Math.tanh(y * 1.6)
    }
    return true
  }
}
registerProcessor('city-engine', CityEngine)
`

export const IDLE_RPM = 850
const REDLINE = 6200
/** Engine rpm per meter per second in each gear. */
const RATIOS = [520, 330, 235, 180, 145]

export type Gearbox = { gear: number; rpm: number; shiftWait: number }

export function newGearbox(): Gearbox {
  return { gear: 0, rpm: IDLE_RPM, shiftWait: 0 }
}

/** Advance a simple five-speed box. Throttle is 0..1. Returns the smoothed rpm. */
export function stepGearbox(box: Gearbox, speed: number, throttle: number, dt: number): number {
  const ground = Math.abs(speed)
  box.shiftWait = Math.max(0, box.shiftWait - dt)
  const shiftUp = throttle > 0.3 ? 4600 : 2500
  if (box.shiftWait <= 0) {
    const turning = ground * RATIOS[box.gear]!
    if (turning > shiftUp && box.gear < RATIOS.length - 1) {
      box.gear++
      box.shiftWait = 0.4
    } else if (turning < 1300 && box.gear > 0) {
      box.gear--
      box.shiftWait = 0.4
    }
  }
  if (speed < 0) box.gear = 0
  let target = Math.max(IDLE_RPM, ground * RATIOS[box.gear]!)
  if (ground < 2.5) target = Math.max(target, IDLE_RPM + throttle * 1600)
  target = Math.min(REDLINE, target + throttle * 300)
  box.rpm += (target - box.rpm) * Math.min(1, dt * 7)
  return box.rpm
}
