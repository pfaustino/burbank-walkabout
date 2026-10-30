import { recognitionAvailable } from '../voice/speech.ts'

export class Hud {
  private readonly handlers: {
    onSay: (text: string) => void
    onMic: () => void
    onHear: (enabled: boolean) => void
  }
  private readonly place: HTMLElement
  private readonly nearby: HTMLElement
  private readonly net: HTMLElement
  private readonly transcript: HTMLElement
  private readonly subtitle: HTMLElement
  private readonly input: HTMLInputElement
  private readonly mic: HTMLButtonElement
  private readonly pause: HTMLElement
  private readonly order: HTMLElement
  private readonly score: HTMLElement
  private readonly cashPop: HTMLElement
  private cash = 0
  private subTimer = 0

  constructor(handlers: {
    onSay: (text: string) => void
    onMic: () => void
    onHear: (enabled: boolean) => void
  }) {
    this.handlers = handlers
    this.place = must('#place')
    this.nearby = must('#nearby')
    this.net = must('#net-status')
    this.transcript = must('#transcript')
    this.subtitle = must('#subtitle')
    this.input = must('#say-input') as HTMLInputElement
    this.mic = must('#mic') as HTMLButtonElement
    this.pause = must('#pause-banner')
    this.order = must('#order')
    this.score = must('#score')
    this.cashPop = must('#cash-pop')

    const form = must('#talk-bar') as HTMLFormElement
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      const text = this.input.value
      this.input.value = ''
      this.handlers.onSay(text)
    })
    this.mic.addEventListener('click', () => this.handlers.onMic())
    if (!recognitionAvailable()) this.mic.title = 'This browser has no speech recognition. Type instead.'
    const hear = must('#hear') as HTMLInputElement
    hear.addEventListener('change', () => this.handlers.onHear(hear.checked))

    this.setStatus('WASD walk · Shift run · right-drag look · Space hop · E talk · V mic · F drive or ride · H helicopter')
  }

  setPlace(text: string): void {
    if (this.place.textContent !== text) this.place.textContent = text
  }

  setNearby(text: string): void {
    if (this.nearby.textContent !== text) this.nearby.textContent = text
  }

  setNet(text: string): void {
    if (this.net.textContent !== text) this.net.textContent = text
  }

  setStatus(text: string): void {
    const status = must('#status')
    status.textContent = text
  }

  setPaused(paused: boolean): void {
    this.pause.hidden = !paused
  }

  setOrder(text: string | null, dropoff = false): void {
    if (!text) {
      this.order.hidden = true
      this.order.textContent = ''
      this.order.classList.remove('dropoff')
      return
    }
    this.order.hidden = false
    if (this.order.textContent !== text) this.order.textContent = text
    this.order.classList.toggle('dropoff', dropoff)
  }

  addPay(total: number, tip: number): void {
    this.cash += total
    this.score.textContent = `$${this.cash}`
    const pop = document.createElement('div')
    pop.className = 'cash-float'
    const fare = document.createElement('strong')
    fare.textContent = `+$${total}`
    const extra = document.createElement('span')
    extra.textContent = `tip $${tip}`
    pop.append(fare, extra)
    pop.addEventListener('animationend', () => pop.remove())
    this.cashPop.append(pop)
  }

  setDraft(text: string): void {
    this.input.value = text
  }

  setPlaceholder(text: string): void {
    if (this.input.placeholder !== text) this.input.placeholder = text
  }

  setMic(active: boolean): void {
    this.mic.textContent = active ? 'Stop' : 'Mic'
    this.mic.setAttribute('aria-pressed', active ? 'true' : 'false')
  }

  focusTalk(): void {
    this.input.focus()
  }

  pushLine(speaker: string, text: string): void {
    const row = document.createElement('p')
    const who = document.createElement('strong')
    who.textContent = speaker
    row.append(who, document.createTextNode(` ${text}`))
    this.transcript.append(row)
    while (this.transcript.childElementCount > 12) this.transcript.firstElementChild?.remove()
    this.transcript.scrollTop = this.transcript.scrollHeight
  }

  setSubtitle(speaker: string, text: string): void {
    this.subtitle.textContent = `${speaker}: ${text}`
    window.clearTimeout(this.subTimer)
    this.subTimer = window.setTimeout(() => {
      this.subtitle.textContent = ''
    }, 7000)
  }
}

function must(selector: string): HTMLElement {
  const node = document.querySelector(selector)
  if (!(node instanceof HTMLElement)) throw new Error(`Missing ${selector}`)
  return node
}
