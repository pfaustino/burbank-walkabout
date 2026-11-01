import { loadSettings, saveSettings, type Settings } from './settings'

type Handlers = {
  onResume: () => void
  onChange: (settings: Settings) => void
  onTutorial: () => void
}

type Page = 'home' | 'sound' | 'graphics' | 'about'

export class PauseMenu {
  settings: Settings
  private page: Page = 'home'
  private readonly handlers: Handlers
  private readonly root = must<HTMLElement>('#menu')
  private readonly note = must<HTMLElement>('#menu-note')

  constructor(handlers: Handlers) {
    this.handlers = handlers
    this.settings = loadSettings()
    this.paint()
    must<HTMLButtonElement>('#menu-resume').addEventListener('click', () => this.handlers.onResume())
    must<HTMLButtonElement>('#menu-sound').addEventListener('click', () => this.showPage('sound'))
    must<HTMLButtonElement>('#menu-graphics').addEventListener('click', () => this.showPage('graphics'))
    must<HTMLButtonElement>('#menu-about').addEventListener('click', () => this.showPage('about'))
    must<HTMLButtonElement>('#menu-tutorial').addEventListener('click', () => {
      this.handlers.onTutorial()
      this.note.textContent = 'The getting-around card will show when you resume.'
    })
    for (const back of this.root.querySelectorAll('.menu-back')) {
      back.addEventListener('click', () => this.showPage('home'))
    }
    for (const input of this.root.querySelectorAll('input, select')) {
      input.addEventListener('input', () => this.read())
      input.addEventListener('change', () => this.read())
    }
  }

  setOpen(open: boolean): void {
    this.root.hidden = !open
    if (open) {
      this.note.textContent = ''
      this.showPage('home')
      must<HTMLButtonElement>('#menu-resume').focus()
    }
  }

  /** Leave a subpage for the main list. Returns false when already there. */
  back(): boolean {
    if (this.page === 'home') return false
    this.showPage('home')
    return true
  }

  private showPage(page: Page): void {
    this.page = page
    for (const name of ['home', 'sound', 'graphics', 'about'] as const) {
      must<HTMLElement>(`#menu-page-${name}`).hidden = name !== page
    }
  }

  private paint(): void {
    const s = this.settings
    must<HTMLInputElement>('#vol-ambient').value = String(Math.round(s.ambient * 100))
    must<HTMLInputElement>('#vol-music').value = String(Math.round(s.music * 100))
    must<HTMLInputElement>('#vol-sfx').value = String(Math.round(s.sfx * 100))
    must<HTMLSelectElement>('#gfx-shadows').value = s.shadows
    must<HTMLInputElement>('#gfx-distance').value = String(Math.round(s.distance * 100))
    must<HTMLSelectElement>('#gfx-quality').value = s.quality
    this.label()
  }

  private read(): void {
    this.settings = {
      ambient: numberOf('#vol-ambient') / 100,
      music: numberOf('#vol-music') / 100,
      sfx: numberOf('#vol-sfx') / 100,
      shadows: must<HTMLSelectElement>('#gfx-shadows').value as Settings['shadows'],
      distance: numberOf('#gfx-distance') / 100,
      quality: must<HTMLSelectElement>('#gfx-quality').value as Settings['quality'],
    }
    this.label()
    saveSettings(this.settings)
    this.handlers.onChange(this.settings)
  }

  private label(): void {
    must<HTMLElement>('#gfx-distance-value').textContent = `${Math.round(this.settings.distance * 100)}%`
  }
}

function numberOf(id: string): number {
  return Number(must<HTMLInputElement>(id).value)
}

function must<T extends HTMLElement>(id: string): T {
  const el = document.querySelector(id)
  if (!el) throw new Error(`Missing ${id}`)
  return el as T
}
