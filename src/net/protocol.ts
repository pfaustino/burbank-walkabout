import type { PersonVoice } from '../actors/peopleSim.ts'

export type ClientMsg =
  | { type: 'hello'; name: string }
  | { type: 'move'; x: number; z: number; yaw: number }
  | { type: 'talk'; npcId: string; text: string; x: number; z: number; t?: number }
  | { type: 'say'; text: string; x: number; z: number }

export type NetPerson = {
  id: string
  name: string
  voice: PersonVoice
  shirt: string
  pants: string
  skin: string
  hair: string
  x: number
  z: number
  yaw: number
}

export type NetPlayer = {
  id: string
  name: string
  color: string
  x: number
  z: number
  yaw: number
}

export type SpeechMsg = {
  type: 'speech'
  kind: 'npc' | 'player'
  id: string
  name: string
  text: string
  voice: PersonVoice | 'default'
  aloud: boolean
  /** Base64 MP3 from Fish Audio. Absent when the browser should speak the text. */
  audio?: string
}

export type WelcomeMsg = {
  type: 'welcome'
  id: string
  replies: 'local' | 'openrouter'
}

export type SnapshotMsg = {
  type: 'snapshot'
  people: NetPerson[]
  players: NetPlayer[]
}

export type ServerMsg = WelcomeMsg | SnapshotMsg | SpeechMsg | { type: 'error'; message: string }

const SHIRTS = ['#2457c5', '#1f7a4d', '#8c2f39', '#c47b2b', '#3d3a7a', '#0f6e6a', '#6b3f69']

export function shirtForName(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (Math.imul(hash, 33) + name.charCodeAt(i)) >>> 0
  return SHIRTS[hash % SHIRTS.length]!
}

export function cleanName(input: string): string {
  const cleaned = input.replace(/[^\p{L}\p{N} '\-]/gu, '').trim().slice(0, 24)
  return cleaned.length > 0 ? cleaned : 'Walker'
}

export function parseClientMessage(value: unknown): ClientMsg | null {
  if (!value || typeof value !== 'object') return null
  const rec = value as Record<string, unknown>
  if (rec.type === 'hello') {
    if (typeof rec.name !== 'string') return null
    return { type: 'hello', name: cleanName(rec.name) }
  }
  if (rec.type === 'move') {
    const x = finite(rec.x)
    const z = finite(rec.z)
    const yaw = finite(rec.yaw)
    if (x === null || z === null || yaw === null) return null
    return { type: 'move', x, z, yaw }
  }
  if (rec.type === 'talk') {
    const x = finite(rec.x)
    const z = finite(rec.z)
    if (typeof rec.npcId !== 'string' || typeof rec.text !== 'string' || x === null || z === null) return null
    const npcId = rec.npcId.trim().slice(0, 40)
    const text = rec.text.trim().slice(0, 240)
    if (!npcId || !text) return null
    if (rec.t === undefined) return { type: 'talk', npcId, text, x, z }
    const t = finite(rec.t)
    if (t === null) return null
    return { type: 'talk', npcId, text, x, z, t }
  }
  if (rec.type === 'say') {
    const x = finite(rec.x)
    const z = finite(rec.z)
    if (typeof rec.text !== 'string' || x === null || z === null) return null
    const text = rec.text.trim().slice(0, 240)
    if (!text) return null
    return { type: 'say', text, x, z }
  }
  return null
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
