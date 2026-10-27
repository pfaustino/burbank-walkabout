export type ListenHandle = { stop(): void }

type RecEvent = {
  resultIndex: number
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>
}

type BrowserRec = {
  lang: string
  interimResults: boolean
  continuous: boolean
  onresult: ((ev: RecEvent) => void) | null
  onerror: (() => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
}

export function recognitionAvailable(): boolean {
  return recCtor() !== null
}

export function listen(
  onFinal: (text: string) => void,
  onInterim: (text: string) => void,
  onEnd: () => void,
): ListenHandle | null {
  const Ctor = recCtor()
  if (!Ctor) return null
  const rec = new Ctor()
  rec.lang = 'en-US'
  rec.interimResults = true
  rec.continuous = false
  rec.onresult = (ev) => {
    let text = ''
    let final = false
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const row = ev.results[i]
      if (!row) continue
      text += row[0].transcript
      final = row.isFinal
    }
    const clean = text.trim()
    if (!clean) return
    if (final) onFinal(clean)
    else onInterim(clean)
  }
  rec.onerror = () => onEnd()
  rec.onend = () => onEnd()
  try {
    rec.start()
  } catch {
    return null
  }
  return {
    stop() {
      rec.onend = null
      try {
        rec.stop()
      } catch {
        /* already stopped */
      }
    },
  }
}

let currentClip: HTMLAudioElement | null = null

/** Play a Fish Audio MP3. Returns false when the browser blocks playback. */
export async function playMp3(base64: string): Promise<boolean> {
  window.speechSynthesis?.cancel()
  currentClip?.pause()
  const clip = new Audio(`data:audio/mpeg;base64,${base64}`)
  currentClip = clip
  try {
    await clip.play()
    return true
  } catch {
    return false
  }
}

export function speak(text: string, voice: 'female' | 'male' | 'default'): void {
  if (!window.speechSynthesis) return
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.rate = 1.02
  const picked = pickVoice(voice)
  if (picked) utterance.voice = picked
  window.speechSynthesis.cancel()
  window.speechSynthesis.speak(utterance)
}

function pickVoice(kind: 'female' | 'male' | 'default'): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis?.getVoices() ?? []
  if (kind === 'default' || voices.length === 0) return null
  const pattern = kind === 'female' ? /female|zira|samantha|victoria|moira|susan/i : /male|david|mark|daniel|alex/i
  return voices.find((voice) => pattern.test(`${voice.name} ${voice.voiceURI}`)) ?? null
}

function recCtor(): (new () => BrowserRec) | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => BrowserRec
    webkitSpeechRecognition?: new () => BrowserRec
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}
