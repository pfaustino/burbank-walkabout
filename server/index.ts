import { existsSync, readFileSync } from 'node:fs'
import { WebSocket, WebSocketServer } from 'ws'
import crowdJson from '../data/crowd.json' with { type: 'json' }
import mapJson from '../data/map.json' with { type: 'json' }
import peopleJson from '../data/people.json' with { type: 'json' }
import { CROWD_SEED, createCrowd, crowdIndex, crowdPose, type CrowdFile } from '../src/actors/crowdSim.ts'
import { createPeople, stepPeople, type PeopleFile, type PersonSim, type PersonVoice } from '../src/actors/peopleSim.ts'
import { talkManner } from '../src/dialog/fallback.ts'
import { npcReply, remember, type DialogTurn } from './dialog.ts'
import { fishEnabled, fishSpeech } from './fish.ts'
import {
  parseClientMessage,
  shirtForName,
  type ClientMsg,
  type NetPerson,
  type NetPlayer,
  type ServerMsg,
} from '../src/net/protocol.ts'
import { createSeededRng } from '../src/util/seededRng.ts'
import { buildLayout, describePlace, hitsBuilding, mapBrief, type MapFile } from '../src/world/layout.ts'

loadDotEnv()

const PORT = Number(process.env.CITY_PORT || 8787)
const layout = buildLayout(mapJson as MapFile)
const peopleFile = peopleJson as PeopleFile
const brief = mapBrief(layout)
const rng = createSeededRng(0xb0b81a4)
const people: PersonSim[] = createPeople(layout, peopleFile, rng)
const crowd = createCrowd(layout, crowdJson as CrowdFile, createSeededRng(CROWD_SEED))
const talkSlack = 1.6
/** npc id -> player id. They stand still until that player walks out of earshot. */
const conversations = new Map<string, string>()

type Walker = {
  id: string
  name: string
  color: string
  x: number
  z: number
  yaw: number
  socket: WebSocket
  lastTalk: number
  history: Map<string, DialogTurn[]>
}

const walkers = new Map<string, Walker>()
let nextId = 1

const replies = process.env.DIALOG === 'local' || !process.env.OPENROUTER_API_KEY ? 'local' : 'openrouter'

const wss = new WebSocketServer({ port: PORT })

wss.on('connection', (socket) => {
  let walker: Walker | null = null

  socket.on('message', (data) => {
    const raw = String(data)
    if (raw.length > 2000) return
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return
    }
    const msg = parseClientMessage(parsed)
    if (!msg) return
    if (!walker) {
      if (msg.type !== 'hello') return
      const spot = openSpawn()
      walker = {
        id: `p${nextId++}`,
        name: msg.name,
        color: shirtForName(msg.name),
        x: spot.x,
        z: spot.z,
        yaw: 0,
        socket,
        lastTalk: 0,
        history: new Map(),
      }
      walkers.set(walker.id, walker)
      send(socket, { type: 'welcome', id: walker.id, replies })
      console.log(`joined ${walker.name} (${walker.id}) · ${walkers.size} on the street`)
      return
    }
    handle(walker, msg)
  })

  socket.on('close', () => {
    if (!walker) return
    walkers.delete(walker.id)
    console.log(`left ${walker.name} · ${walkers.size} on the street`)
  })
})

setInterval(() => {
  const reach = peopleFile.talkRange + talkSlack
  for (const [npcId, playerId] of conversations) {
    const walker = walkers.get(playerId)
    const person = people.find((entry) => entry.id === npcId)
    if (!walker || !person || Math.hypot(walker.x - person.x, walker.z - person.z) > reach) {
      conversations.delete(npcId)
    }
  }
  stepPeople(people, layout, peopleFile.speed, 0.05, rng, new Set(conversations.keys()))
}, 50)

setInterval(() => {
  const snapshot = {
    type: 'snapshot' as const,
    people: visiblePeople(),
    players: visiblePlayers(),
  }
  for (const walker of walkers.values()) send(walker.socket, snapshot)
}, 100)

function handle(walker: Walker, msg: ClientMsg): void {
  if (msg.type === 'move') {
    walker.x = msg.x
    walker.z = msg.z
    walker.yaw = msg.yaw
    return
  }
  if (msg.type === 'hello') return
  walker.x = msg.x
  walker.z = msg.z
  const now = Date.now()
  if (now - walker.lastTalk < 800) return
  walker.lastTalk = now

  if (msg.type === 'say') {
    void deliver(walker, {
      type: 'speech',
      kind: 'player',
      id: walker.id,
      name: walker.name,
      text: msg.text,
      voice: 'default',
      aloud: true,
    }, false)
    return
  }

  const passerby = crowdSpeaker(msg.npcId, msg.t, walker.x, walker.z)
  if (passerby) {
    if (passerby.dist > peopleFile.talkRange + talkSlack) {
      send(walker.socket, { type: 'error', message: `${passerby.speaker.name} is too far to hear you.` })
      return
    }
    void answer(walker, passerby.speaker, passerby.x, passerby.z, msg.text)
    return
  }

  const person = people.find((entry) => entry.id === msg.npcId)
  const def = peopleFile.people.find((entry) => entry.id === msg.npcId)
  if (!person || !def) {
    send(walker.socket, { type: 'error', message: 'They already turned the corner.' })
    return
  }
  const dist = Math.hypot(person.x - walker.x, person.z - walker.z)
  if (dist > peopleFile.talkRange + talkSlack) {
    send(walker.socket, { type: 'error', message: `${def.name} is too far to hear you.` })
    return
  }
  conversations.set(person.id, walker.id)
  void answer(walker, def, person.x, person.z, msg.text)
}

type Speaker = { id: string; name: string; voice: PersonVoice; persona: string }

function answer(walker: Walker, speaker: Speaker, x: number, z: number, text: string): void {
  const place = describePlace(layout, x, z)
  const history = walker.history.get(speaker.id) ?? []
  void npcReply({
    speaker,
    place,
    mapBrief: brief,
    history,
    text,
  }).then((reply) => {
    if (!walkers.has(walker.id)) return
    walker.history.set(speaker.id, remember(history, text, reply))
    void deliver(walker, {
      type: 'speech',
      kind: 'player',
      id: walker.id,
      name: walker.name,
      text,
      voice: 'default',
      aloud: true,
    }, false)
    void deliver(walker, {
      type: 'speech',
      kind: 'npc',
      id: speaker.id,
      name: speaker.name,
      text: reply,
      voice: speaker.voice,
      aloud: true,
    }, true)
  })
}

function crowdPersona(name: string, id: string): string {
  const manner = talkManner(id)
  if (manner === 'brief') {
    return `You are ${name}. You speak very little. A greeting is two or three words. A real question gets one short sentence.`
  }
  if (manner === 'warm') {
    return `You are ${name}. Friendly, not a clerk. A greeting is one short sentence. You answer a real question in plain sentences.`
  }
  return `You are ${name}, out for a walk. A greeting gets a short hello. A real question gets a sentence or two.`
}

function crowdSpeaker(
  id: string,
  time: number | undefined,
  x: number,
  z: number,
): { dist: number; x: number; z: number; speaker: Speaker } | null {
  const index = crowdIndex(id)
  if (index === null) return null
  const person = crowd.people[index]
  if (!person) return null
  const pose = crowdPose(crowd, index, time ?? 0)
  return {
    dist: Math.hypot(pose.x - x, pose.z - z),
    x: pose.x,
    z: pose.z,
    speaker: {
      id,
      name: person.name,
      voice: person.voice,
      persona: crowdPersona(person.name, id),
    },
  }
}

async function deliver(
  walker: Walker,
  msg: Extract<ServerMsg, { type: 'speech' }>,
  includeOrigin: boolean,
): Promise<void> {
  const speakerId = msg.kind === 'npc' ? msg.id : undefined
  const audio = await fishSpeech(msg.text, msg.voice, speakerId)
  broadcastNear(walker, peopleFile.hearRange, audio ? { ...msg, audio } : msg, includeOrigin)
}

function broadcastNear(origin: Walker, range: number, msg: ServerMsg, includeOrigin: boolean): void {
  for (const other of walkers.values()) {
    if (other.id === origin.id && !includeOrigin) continue
    const dist = Math.hypot(other.x - origin.x, other.z - origin.z)
    if (dist <= range) send(other.socket, msg)
  }
}

function openSpawn(): { x: number; z: number } {
  const base = layout.file.spawn
  for (let n = 0; n < 12; n++) {
    const ang = n * 2.399
    const dist = n === 0 ? 0 : 1.5
    const x = base.x + Math.cos(ang) * dist
    const z = base.z + Math.sin(ang) * dist
    if (hitsBuilding(layout, x, z, 0.5)) continue
    let busy = false
    for (const other of walkers.values()) {
      if (Math.hypot(other.x - x, other.z - z) < 1.2) busy = true
    }
    if (!busy) return { x, z }
  }
  return { x: base.x + 1.5, z: base.z }
}

function visiblePeople(): NetPerson[] {
  return people.flatMap((person) => {
    const def = peopleFile.people.find((entry) => entry.id === person.id)
    if (!def) return []
    return [
      {
        id: def.id,
        name: def.name,
        voice: def.voice,
        shirt: def.shirt,
        pants: def.pants,
        skin: def.skin,
        hair: def.hair,
        x: round(person.x),
        z: round(person.z),
        yaw: round(person.yaw),
      },
    ]
  })
}

function visiblePlayers(): NetPlayer[] {
  return [...walkers.values()].map((walker) => ({
    id: walker.id,
    name: walker.name,
    color: walker.color,
    x: round(walker.x),
    z: round(walker.z),
    yaw: round(walker.yaw),
  }))
}

function send(socket: WebSocket, msg: ServerMsg): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg))
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

function loadDotEnv(): void {
  if (!existsSync('.env')) return
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 1) continue
    const key = trimmed.slice(0, eq).trim()
    if (process.env[key] !== undefined) continue
    process.env[key] = trimmed.slice(eq + 1).trim()
  }
}

console.log(
  `Burbank street listening on ${PORT} · replies: ${replies}${replies === 'openrouter' ? ` · ${process.env.OPENROUTER_MODEL || 'cognitivecomputations/dolphin-mistral-24b-venice-edition'}` : ''} · voices: ${fishEnabled() ? process.env.FISH_AUDIO_MODEL || 's2.1-pro-free' : 'browser'}`,
)
