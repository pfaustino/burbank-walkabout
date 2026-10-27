export type LocalSpeaker = {
  id: string
  name: string
}

export type TalkManner = 'brief' | 'plain' | 'warm'

const BRIEF = ['Hey.', 'Hi.', 'Hello.', 'Yeah?', 'Morning.']
const PLAIN = ['Hey.', 'Hi.', 'Hello.', 'All right.']
const WARM = ['Hey.', 'Hi. Nice out.', 'Hello.', 'Good to see you.']

/** Stable across restarts. About two in five people barely talk. */
export function talkManner(id: string): TalkManner {
  const n = talkHash(id) % 5
  if (n <= 1) return 'brief'
  if (n <= 3) return 'plain'
  return 'warm'
}

/** A bare hello. Real questions return null so they still get an answer. */
export function greetingLine(speaker: LocalSpeaker, text: string): string | null {
  const q = text.trim().toLowerCase().replace(/[!?.]+$/g, '').replace(/\s+/g, ' ')
  if (!/^(hi|hey|hello|yo|howdy|hiya|sup|good morning|good afternoon|good evening)$/.test(q)) {
    return null
  }
  const manner = talkManner(speaker.id)
  const lines = manner === 'brief' ? BRIEF : manner === 'plain' ? PLAIN : WARM
  return lines[talkHash(`${speaker.id}:${q}`) % lines.length]!
}

export function talkHash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return h >>> 0
}

/** Spoken line when OpenRouter is off or the request fails. Facts match the downtown map. */
export function localReply(speaker: LocalSpeaker, text: string, place: string): string {
  const greet = greetingLine(speaker, text)
  if (greet) return greet
  const q = text.toLowerCase()

  if (/how are you|how'?s it going|hows it going|what'?s up|whats up|what is up/.test(q)) {
    const manner = talkManner(speaker.id)
    if (speaker.id === 'sam') return 'Worse. Keep walking.'
    if (speaker.id === 'kenji') return 'I am fine, which is already too many words, but my feet hurt and I am still out here.'
    if (manner === 'brief') return 'Tired. Still walking.'
    if (manner === 'warm') return 'Pretty good. This walk is the decent part of the day.'
    return 'All right. My feet are sore.'
  }
  if (/who are you|your name|what'?s your name/.test(q)) {
    return `I'm ${speaker.name}. Just walking ${place}.`
  }
  if (/city hall/.test(q)) {
    return 'City Hall is the civic building at 275 East Olive Avenue.'
  }
  if (/town center|mall/.test(q)) {
    return 'Town Center is the mall at 201 East Magnolia Boulevard.'
  }
  if (/library|book/.test(q)) {
    return 'Burbank Central Library is at 110 North Glenoaks Boulevard.'
  }
  if (/plaza|park|lawn/.test(q)) {
    return 'The open parks downtown are Robert R. Ovrom Park and Burbank Centennial Park.'
  }
  if (/magnolia/.test(q)) {
    return 'Magnolia Boulevard is the wide street along the north side of downtown. Town Center faces it.'
  }
  if (/olive/.test(q)) {
    return 'Olive Avenue runs east-west through downtown. City Hall is at 275 East Olive.'
  }
  if (/bus|metro|ride/.test(q)) {
    return 'The buses people actually wait for run Olive and Magnolia.'
  }
  if (/studio|warner|lot|media/.test(q)) {
    if (speaker.id === 'marcus' || speaker.id === 'sam') {
      return 'The lots are west of downtown. I keep going until Magnolia opens up.'
    }
    return 'The studio lots are west of this downtown slice. Magnolia is the straight walk.'
  }
  if (/coffee|hungry|eat|food/.test(q)) {
    return 'If you want shade and food, sit outside Town Center. Otherwise Olive is the nicer walk.'
  }

  return `I'm heading along ${place}.`
}
