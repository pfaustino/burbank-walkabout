import { recognitionAvailable } from '../voice/speech.ts'

export class Hud {
  private readonly handlers: {
    onSay: (text: string) => void
    onMic: () => void
    onHear: (enabled: boolean) => void
    onPay?: (which: 'fare' | 'tip') => void
    coinInto?: () => { x: number; y: number }
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
    onPay?: (which: 'fare' | 'tip') => void
    coinInto?: () => { x: number; y: number }
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
    this.mountCoach()
  }

  private mountCoach(): void {
    const coach = must('#coach')
    const ok = must('#coach-ok') as HTMLButtonElement
    try {
      if (localStorage.getItem('burbank-coach') === '1') {
        coach.hidden = true
        return
      }
    } catch {
      /* Private browsing still shows the card. */
    }
    ok.addEventListener('click', () => {
      coach.hidden = true
      try {
        localStorage.setItem('burbank-coach', '1')
      } catch {
        /* The card stays dismissed for this visit. */
      }
    })
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

  addPay(fare: number, tip: number): void {
    this.cash += fare + tip
    this.score.textContent = `$${this.cash}`
    const pop = document.createElement('div')
    pop.className = 'cash-float'
    const base = document.createElement('strong')
    base.textContent = `+$${fare}`
    pop.append(base)
    let extra: HTMLElement | null = null
    if (tip > 0) {
      extra = document.createElement('span')
      extra.textContent = `+$${tip} tip`
      pop.append(extra)
    }
    pop.addEventListener('animationend', () => pop.remove())
    this.cashPop.append(pop)
    this.tossCoins(base, 5, 0)
    this.handlers.onPay?.('fare')
    if (extra) {
      this.tossCoins(extra, 4, 180)
      window.setTimeout(() => this.handlers.onPay?.('tip'), 180)
    }
  }

  private tossCoins(from: HTMLElement, count: number, delay: number): void {
    const into = this.handlers.coinInto?.()
    if (!into) return
    const box = from.getBoundingClientRect()
    const sx = box.left + box.width / 2
    const sy = box.top + box.height / 2
    for (let i = 0; i < count; i++) {
      const coin = document.createElement('div')
      coin.className = 'pay-coin'
      coin.append(document.createElement('i'))
      const spread = (i - (count - 1) / 2) * 16
      coin.style.left = `${sx + spread}px`
      coin.style.top = `${sy}px`
      document.body.append(coin)
      const ms = 760 + i * 30
      const wait = delay + i * 45
      window.setTimeout(() => {
        coin.style.transition = `left ${ms}ms cubic-bezier(0.2, 0.65, 0.2, 1), top ${ms}ms cubic-bezier(0.15, 0.55, 0.2, 1)`
        coin.style.left = `${into.x + spread * 0.25}px`
        coin.style.top = `${into.y}px`
      }, wait)
      window.setTimeout(() => coin.remove(), wait + ms + 60)
    }
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
