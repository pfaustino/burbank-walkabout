import type { PersonVoice } from '../src/actors/peopleSim.ts'

// Public Fish library ids, checked against each model's tags.
// Fallback only. Each person below has their own voice.
const FEMALE_VOICE = 'ca3007f96ae7499ab87d27ea3599956a' // E-girl, female
const MALE_VOICE = '802e3bc2b27e49c2995d23ef70e6ac89' // Energetic Male

const PERSON_VOICES: Record<string, string> = {
  june: 'e3cd384158934cc9a01029cd7d278634', // Laura, warm
  priya: 'c2623f0c075b4492ac367989aee1576f', // Paula, clear
  aisha: 'b545c585f631496c914815291da4e893', // Friendly Women, bright
  rosa: '933563129e564b19a115bedd57b7406a', // Sarah, gentle
  marcus: '802e3bc2b27e49c2995d23ef70e6ac89', // Energetic Male
  luis: '536d3a5e000945adb7038665781a4aca', // Ethan, calm
  kenji: 'bf322df2096a46f18c579d0baa36f41d', // Adrian, low
  sam: 'c5f56a6cc2ec4fa8920cb4c5889a3fb7', // Slax, even
}

/** MP3 from Fish Audio, or null when the key is missing or the request fails. */
export async function fishSpeech(
  text: string,
  voice: PersonVoice | 'default',
  speakerId?: string,
): Promise<string | null> {
  const key = process.env.FISH_AUDIO_API_KEY
  if (!key) return null
  const spoken = text.trim().slice(0, 1600)
  if (!spoken) return null

  const model = process.env.FISH_AUDIO_MODEL || 's2.1-pro-free'
  const referenceId = referenceFor(speakerId, voice)
  const first = await requestSpeech(key, model, spoken, referenceId)
  if (first || model === 's2.1-pro-free') return first
  console.error(`fish.audio model ${model} failed, retrying s2.1-pro-free`)
  return requestSpeech(key, 's2.1-pro-free', spoken, referenceId)
}

/** Fish reference for this person, or the gender fallback. */
export function referenceFor(speakerId: string | undefined, voice: PersonVoice | 'default'): string | undefined {
  if (speakerId && PERSON_VOICES[speakerId]) return PERSON_VOICES[speakerId]
  if (voice === 'female') return process.env.FISH_VOICE_FEMALE || FEMALE_VOICE
  if (voice === 'male') return process.env.FISH_VOICE_MALE || MALE_VOICE
  return undefined
}

async function requestSpeech(
  key: string,
  model: string,
  text: string,
  referenceId: string | undefined,
): Promise<string | null> {
  try {
    const response = await fetch('https://api.fish.audio/v1/tts', {
      method: 'POST',
      signal: AbortSignal.timeout(20_000),
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        model,
      },
      body: JSON.stringify({
        text,
        format: 'mp3',
        ...(referenceId ? { reference_id: referenceId } : {}),
      }),
    })
    const bytes = Buffer.from(await response.arrayBuffer())
    if (!response.ok || bytes.length < 200 || bytes[0] === 0x7b) {
      console.error(`fish.audio ${model} ${response.status} ${bytes.toString('utf8').slice(0, 180)}`)
      return null
    }
    return bytes.toString('base64')
  } catch (err) {
    const message = err instanceof Error ? err.message : 'request failed'
    console.error('fish.audio failed:', message)
    return null
  }
}

export function fishEnabled(): boolean {
  return Boolean(process.env.FISH_AUDIO_API_KEY)
}

