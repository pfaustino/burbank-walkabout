import type { ClientMsg, NetPerson, NetPlayer, ServerMsg, SpeechMsg } from './protocol.ts'

export class CityClient {
  id = ''
  connected = false
  replies: 'local' | 'openrouter' = 'local'
  private readonly url: string
  private readonly name: string
  private readonly handlers: {
    onPeople: (people: NetPerson[]) => void
    onPlayers: (players: NetPlayer[]) => void
    onSpeech: (msg: SpeechMsg) => void
    onStatus: (text: string) => void
    onError: (message: string) => void
  }
  private socket: WebSocket | null = null
  private queue: ClientMsg[] = []
  private disposed = false
  private moveTimer = 0
  private pendingMove: ClientMsg | null = null

  constructor(
    url: string,
    name: string,
    handlers: {
      onPeople: (people: NetPerson[]) => void
      onPlayers: (players: NetPlayer[]) => void
      onSpeech: (msg: SpeechMsg) => void
      onStatus: (text: string) => void
      onError: (message: string) => void
    },
  ) {
    this.url = url
    this.name = name
    this.handlers = handlers
  }

  connect(): void {
    if (this.disposed) return
    this.handlers.onStatus('connecting')
    const socket = new WebSocket(this.url)
    this.socket = socket
    socket.addEventListener('open', () => {
      this.connected = true
      this.send({ type: 'hello', name: this.name })
      const rest = this.queue.splice(0)
      for (const msg of rest) this.send(msg)
    })
    socket.addEventListener('message', (ev) => {
      this.onMessage(String(ev.data))
    })
    socket.addEventListener('close', () => {
      this.connected = false
      if (this.socket === socket) this.socket = null
      if (this.disposed) return
      this.handlers.onStatus('offline')
      window.setTimeout(() => this.connect(), 1200)
    })
    socket.addEventListener('error', () => {
      socket.close()
    })
  }

  send(msg: ClientMsg): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(msg))
      return
    }
    if (this.queue.length < 20) this.queue.push(msg)
  }

  sendMove(x: number, z: number, yaw: number): void {
    this.pendingMove = { type: 'move', x, z, yaw }
    const now = performance.now()
    if (now - this.moveTimer < 50) return
    this.flushMove()
  }

  flushMove(): void {
    if (!this.pendingMove) return
    this.moveTimer = performance.now()
    const msg = this.pendingMove
    this.pendingMove = null
    this.send(msg)
  }

  dispose(): void {
    this.disposed = true
    this.socket?.close()
  }

  private onMessage(raw: string): void {
    let msg: ServerMsg
    try {
      msg = JSON.parse(raw) as ServerMsg
    } catch {
      return
    }
    if (msg.type === 'welcome') {
      this.id = msg.id
      this.replies = msg.replies
      return
    }
    if (msg.type === 'snapshot') {
      this.handlers.onPeople(msg.people)
      this.handlers.onPlayers(msg.players.filter((player) => player.id !== this.id))
      const mode = this.replies === 'openrouter' ? 'live replies' : 'local replies'
      this.handlers.onStatus(`connected · ${mode} · ${msg.players.length} on the street`)
      return
    }
    if (msg.type === 'speech') {
      this.handlers.onSpeech(msg)
      return
    }
    if (msg.type === 'error') this.handlers.onError(msg.message)
  }
}

export function clientUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${location.host}/ws`
}
