/** Live streams published by the stations. The game does not host the audio. */
export const STATIONS = [
  { id: 'kfi', name: 'KFI 640', url: 'https://stream.revma.ihrhls.com/zc177' },
  { id: 'kiis', name: 'KIIS 102.7', url: 'https://stream.revma.ihrhls.com/zc185' },
  { id: 'kost', name: 'KOST 103.5', url: 'https://stream.revma.ihrhls.com/zc193' },
  { id: 'myfm', name: 'MyFM 104.3', url: 'https://stream.revma.ihrhls.com/zc173' },
  { id: 'alt', name: 'ALT 98.7', url: 'https://stream.revma.ihrhls.com/zc201' },
  { id: 'real', name: 'Real 92.3', url: 'https://stream.revma.ihrhls.com/zc181' },
  { id: 'klac', name: 'AM 570 LA Sports', url: 'https://stream.revma.ihrhls.com/zc189' },
  { id: 'patriot', name: 'The Patriot 1150', url: 'https://stream.revma.ihrhls.com/zc197' },
  { id: 'klos', name: '95.5 KLOS', url: 'https://playerservices.streamtheworld.com/api/livestream-redirect/KLOSFMAAC.aac' },
  { id: 'cali', name: 'Cali 93.9', url: 'https://playerservices.streamtheworld.com/api/livestream-redirect/KLLI_FMAAC.aac' },
  { id: 'kpfk', name: 'KPFK 90.7', url: 'https://streams.pacifica.org:9000/kpfk_128' },
  { id: 'laist', name: 'LAist 89.3', url: 'https://laist.streamguys1.com/kpcc-mp3' },
  { id: 'kcrw', name: 'KCRW 89.9', url: 'https://streams.kcrw.com/kcrw_mp3' },
] as const

const IDS = STATIONS.map((station) => station.id)

export function knownStation(id: unknown): id is (typeof STATIONS)[number]['id'] {
  return typeof id === 'string' && IDS.includes(id as (typeof IDS)[number])
}

export function stationName(id: string): string {
  return STATIONS.find((station) => station.id === id)?.name ?? 'Radio off'
}

/** Step through Off and the stations. `dir` is 1 or -1. */
export function stepStation(current: string, dir: number): string {
  const ids = ['', ...IDS]
  const at = Math.max(0, ids.indexOf(current))
  const next = (at + (dir < 0 ? -1 : 1) + ids.length) % ids.length
  return ids[next] ?? ''
}

export function paintRadio(id: string): void {
  const button = document.querySelector('#radio-name')
  if (button) button.textContent = stationName(id)
}

/** Play one station through the music volume. A click or key resumes it if the browser blocked the first try. */
export class Radio {
  private audio: HTMLAudioElement | null = null
  private id = ''
  private volume = 1

  tune(id: string, volume: number): void {
    this.volume = Math.min(1, Math.max(0, volume))
    const next = knownStation(id) ? id : ''
    if (!this.audio) this.audio = new Audio()
    this.audio.volume = this.volume
    if (next === this.id) return
    this.id = next
    if (!next) {
      this.audio.pause()
      this.audio.removeAttribute('src')
      return
    }
    const station = STATIONS.find((entry) => entry.id === next)
    if (!station) return
    this.audio.src = station.url
    void this.audio.play().catch(() => {})
  }

  /** Try again after a click or key, once the browser will allow sound. */
  resume(): void {
    if (!this.id || !this.audio || !this.audio.paused) return
    void this.audio.play().catch(() => {})
  }
}
