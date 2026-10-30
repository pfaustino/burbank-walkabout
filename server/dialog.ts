import { localReply, type LocalSpeaker } from '../src/dialog/fallback.ts'

export type DialogTurn = { role: 'user' | 'assistant'; content: string }

const MAX_TURNS = 8

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
  if (process.env.DIALOG === 'local' || !process.env.OPENROUTER_API_KEY) return canned()

  const model = process.env.OPENROUTER_MODEL || 'cognitivecomputations/dolphin-mistral-24b-venice-edition'
  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal: AbortSignal.timeout(25_000),
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://127.0.0.1:5174',
        'X-Title': 'Burbank Walkabout',
      },
      body: JSON.stringify({
        model,
        temperature: 0.85,
        max_tokens: 450,
        messages: [
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
              input.mapBrief,
              `You are standing at ${input.place}.`,
              'Ordinary conversation is fine. Do not give instructions for hurting someone.',
            ].join(' '),
          },
          ...input.history,
          { role: 'user', content: input.text },
        ],
      }),
    })
    if (!response.ok) throw new Error(`openrouter ${response.status}`)
    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[]
    }
    const text = data.choices?.[0]?.message?.content?.trim()
    if (!text) throw new Error('empty completion')
    return text.replace(/\s+/g, ' ').slice(0, 1600)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'request failed'
    console.error('openrouter failed:', message)
    return canned()
  }
}
