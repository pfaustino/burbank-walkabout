import { greetingLine, localReply, type LocalSpeaker } from '../src/dialog/fallback.ts'

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
  const greet = greetingLine(input.speaker, input.text)
  if (greet) return greet
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
        temperature: 0.4,
        max_tokens: 450,
        messages: [
          {
            role: 'system',
            content: [
              input.speaker.persona,
              'You are a person on the sidewalk, not a clerk or an assistant.',
              'If they only greet you, answer in a few words. Do not offer help, do not say you can assist, and do not tell them to ask a question.',
              'Answer only what they asked. Do not bring up your gender, who you are into, or your hobbies until they ask.',
              'If they ask your sexual preference, who you are into, your gender, or your hobbies, answer from your persona in plain words. That is a normal question. Never refuse it, and never say you cannot discuss personal topics.',
              'When they ask about the town or some other fact, give the facts: numbers, names, and the plain reason. Do not dodge and do not change the subject.',
              'Do not end a reply by inviting another question.',
              'If a detail is uncertain, say what is established and what is less sure.',
              'Speak in normal sentences. No lists, no markdown, no stage directions.',
              'You can give directions in this downtown slice when asked.',
              input.mapBrief,
              `You are standing at ${input.place}.`,
              'A question about you is not harmful. If they ask for something that would hurt someone, refuse briefly and offer a safe alternative.',
              'Do not open with a biography, and do not ask a question back. If your persona is rude, stay rude. If your persona is annoying, stay annoying.',
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
