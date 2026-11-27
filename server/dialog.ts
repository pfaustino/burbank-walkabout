import { localReply, type LocalSpeaker } from '../src/dialog/fallback.ts'
import type { ReplyMode } from '../src/net/protocol.ts'

export type DialogTurn = { role: 'user' | 'assistant'; content: string }

const MAX_TURNS = 8
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
const NVIDIA_URL = 'https://integrate.api.nvidia.com/v1/chat/completions'
const DEFAULT_OPENROUTER_MODEL = 'cognitivecomputations/dolphin-mistral-24b-venice-edition'
const DEFAULT_NVIDIA_MODEL = 'meta/llama-3.3-70b-instruct'

type Env = Record<string, string | undefined>

/** Local script, unless a key is set. A NVIDIA key wins over OpenRouter. `DIALOG=local` skips both. */
export function replyMode(env: Env = process.env): ReplyMode {
  if (env.DIALOG === 'local') return 'local'
  if (clean(env.NVIDIA_API_KEY)) return 'nvidia'
  if (clean(env.OPENROUTER_API_KEY)) return 'openrouter'
  return 'local'
}

/** Model id for the active provider. Empty while replies stay on the local script. */
export function replyModel(env: Env = process.env): string {
  const mode = replyMode(env)
  if (mode === 'nvidia') return clean(env.NVIDIA_MODEL) || DEFAULT_NVIDIA_MODEL
  if (mode === 'openrouter') return clean(env.OPENROUTER_MODEL) || DEFAULT_OPENROUTER_MODEL
  return ''
}

export function remember(history: DialogTurn[], userText: string, answer: string): DialogTurn[] {
  const next = [...history, { role: 'user' as const, content: userText }, { role: 'assistant' as const, content: answer }]
  return next.slice(-MAX_TURNS)
}

export async function npcReply(input: {
  speaker: LocalSpeaker & { persona: string }
  place: string
  mapBrief: string
  history: DialogTurn[]
  text: string
}): Promise<string> {
  const canned = () => localReply(input.speaker, input.text, input.place)
  const mode = replyMode()
  if (mode === 'local') return canned()

  try {
    const text = await complete(mode, [
      {
        role: 'system',
        content: [
          input.speaker.persona,
          'You have your own mind. You are not an assistant, a clerk, or a script.',
          'When someone speaks to you, answer them freely, in your own voice. Say what you actually think and feel.',
          'A hello gets a real reply. A question gets the answer, not a dodge and not a change of subject.',
          'If they ask about you, your life, how you feel, your gender, or who you are into, answer honestly. That is ordinary talk. Do not refuse it.',
          'If they ask a fact, give the real answer, including numbers and names. If a detail is uncertain, say what is known and what is less sure.',
          'Do not recite your life story unless they asked. Do not offer help or invite another question.',
          'Speak in normal sentences. No lists, no markdown, no stage directions.',
          'You can give directions in this downtown slice.',
          'If you invite them to come with you, name a real place from this map, such as a cafe. You will walk there with them. Do not invent a turn, and do not say you are going if you are staying put.',
          input.mapBrief,
          `You are standing at ${input.place}.`,
          'Ordinary conversation is fine. Do not give instructions for hurting someone.',
        ].join(' '),
      },
      ...input.history,
      { role: 'user', content: input.text },
    ])
    return text.replace(/\s+/g, ' ').slice(0, 1600)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'request failed'
    console.error(`${mode} failed:`, message)
    return canned()
  }
}

async function complete(
  mode: Exclude<ReplyMode, 'local'>,
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
): Promise<string> {
  const nvidia = mode === 'nvidia'
  const key = clean(nvidia ? process.env.NVIDIA_API_KEY : process.env.OPENROUTER_API_KEY)
  const response = await fetch(nvidia ? NVIDIA_URL : OPENROUTER_URL, {
    method: 'POST',
    signal: AbortSignal.timeout(25_000),
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(nvidia
        ? {}
        : {
            'HTTP-Referer': 'http://127.0.0.1:5174',
            'X-Title': 'Burbank Walkabout',
          }),
    },
    body: JSON.stringify({
      model: replyModel(),
      temperature: 0.85,
      max_tokens: 450,
      stream: false,
      messages,
    }),
  })
  if (!response.ok) throw new Error(`${mode} ${response.status}`)
  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[]
  }
  const text = data.choices?.[0]?.message?.content?.trim()
  if (!text) throw new Error('empty completion')
  return text
}

function clean(value: string | undefined): string {
  return value?.trim() ?? ''
}
