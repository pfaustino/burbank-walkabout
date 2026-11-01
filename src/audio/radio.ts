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
  { id: 'bbc', name: 'BBC World Service', url: 'https://stream.live.vc.bbcmedia.co.uk/bbc_world_service' },
  { id: 'cbc', name: 'CBC Radio One', url: 'https://playerservices.streamtheworld.com/api/livestream-redirect/CBLAFM_CBC.mp3' },
  { id: 'nhk', name: 'NHK World Radio', url: 'https://nhkworld-radio.nhkworld.jp/hls/live/nhkworld-radio-media13/index.m3u8', hls: true },
  { id: 'dw', name: 'DW English', url: 'https://dw.audiostream.io/dw/1027/mp3/64/dw08' },
  { id: 'abcnews', name: 'ABC NewsRadio', url: 'https://abc.streamguys1.com/live/newsradio/icecast.audio' },
  { id: 'abcrn', name: 'ABC Radio National', url: 'https://abc.streamguys1.com/live/rnnsw/icecast.audio' },
  { id: 'triplej', name: 'triple j', url: 'https://abc.streamguys1.com/live/triplejnsw/icecast.audio' },
  { id: 'bbc6', name: 'BBC Radio 6 Music', url: 'https://as-hls-ww-live.akamaized.net/pool_81827798/live/ww/bbc_6music/bbc_6music.isml/bbc_6music-audio=128000.norewind.m3u8', hls: true },
  { id: 'fip', name: 'FIP', url: 'https://icecast.radiofrance.fr/fip-hifi.aac' },
  { id: 'nts', name: 'NTS Radio', url: 'https://stream-relay-geo.ntslive.net/stream' },
  { id: 'inter', name: 'France Inter', url: 'https://icecast.radiofrance.fr/franceinter-midfi.mp3' },
  { id: 'rne', name: 'Radio Nacional', url: 'https://dispatcher.rndfnk.com/crtve/rne1/main/mp3/high' },
  { id: 'caroline', name: 'Radio Caroline', url: 'https://stream.radiocaroline.net/rc128/;' },
] as const

const IDS = STATIONS.map((station) => station.id)

export function knownStation(id: unknown): id is (typeof STATIONS)[number]['id'] {
  return typeof id === 'string' && IDS.includes(id as (typeof IDS)[number])
}

/** Step through Off and the stations. `dir` is 1 or -1. */
export function stepStation(current: string, dir: number): string {
  const ids = ['', ...IDS]
  const at = Math.max(0, ids.indexOf(current))
  const next = (at + (dir < 0 ? -1 : 1) + ids.length) % ids.length
  return ids[next] ?? ''
}

/** Fill the list above the chat from the stations the radio can play. */
export function fillRadio(select: HTMLSelectElement): void {
  if (select.options.length > 1) return
  for (const station of STATIONS) {
    const option = document.createElement('option')
    option.value = station.id
    option.textContent = station.name
    select.append(option)
  }
}

export function paintRadio(id: string): void {
  const select = document.querySelector<HTMLSelectElement>('#radio-pick')
  if (select) select.value = knownStation(id) ? id : ''
}

/** Play one station through the music volume. A click or key resumes it if the browser blocked the first try. */
export class Radio {
  private audio: HTMLAudioElement | null = null
  private hls: { destroy: () => void } | null = null
  private id = ''
  private volume = 1
  private hushed = false
  private generation = 0

  tune(id: string, volume: number): void {
    this.volume = Math.min(1, Math.max(0, volume))
    const next = knownStation(id) ? id : ''
    if (!this.audio) this.audio = new Audio()
    this.audio.volume = this.hushed ? 0 : this.volume
    if (next === this.id) return
    this.id = next
    this.generation += 1
    const generation = this.generation
    this.release()
    if (!next) return
    const station = STATIONS.find((entry) => entry.id === next)
    if (!station) return
    if ('hls' in station) {
      void this.openHls(station.url, generation)
      return
    }
    this.audio.src = station.url
    void this.audio.play().catch(() => {})
  }

  /** NHK and BBC 6 Music publish a playlist, not a single audio file. */
  private async openHls(url: string, generation: number): Promise<void> {
    const { default: Hls } = await import('hls.js')
    if (generation !== this.generation || !this.audio) return
    if (this.audio.canPlayType('application/vnd.apple.mpegurl')) {
      this.audio.src = url
      void this.audio.play().catch(() => {})
      return
    }
    if (!Hls.isSupported()) return
    const player = new Hls()
    this.hls = player
    player.loadSource(url)
    player.attachMedia(this.audio)
    player.on(Hls.Events.MANIFEST_PARSED, () => {
      if (generation !== this.generation) return
      void this.audio?.play().catch(() => {})
    })
  }

  private release(): void {
    this.hls?.destroy()
    this.hls = null
    if (!this.audio) return
    this.audio.pause()
    this.audio.removeAttribute('src')
    this.audio.load()
  }

  /** Drop the station to silence without stopping the stream. */
  hush(on: boolean): void {
    this.hushed = on
    if (this.audio) this.audio.volume = on ? 0 : this.volume
  }

  /** Try again after a click or key, once the browser will allow sound. */
  resume(): void {
    if (!this.id || !this.audio || !this.audio.paused) return
    void this.audio.play().catch(() => {})
  }
}
