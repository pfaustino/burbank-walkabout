import './style.css'
import { preloadFigures } from './actors/figure.ts'
import { preloadCars } from './traffic/CarSet.ts'
import { Game } from './game/Game.ts'
import { cleanName } from './net/protocol.ts'

const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas')
const gate = document.querySelector<HTMLElement>('#gate')
const form = document.querySelector<HTMLFormElement>('#gate-form')
const nameInput = document.querySelector<HTMLInputElement>('#name-input')
if (!canvas || !gate || !form || !nameInput) throw new Error('Missing page shell')

const params = new URLSearchParams(window.location.search)
const preset = params.get('name') || sessionStorage.getItem('burbank-name')

async function boot(name: string): Promise<void> {
  const clean = cleanName(name)
  sessionStorage.setItem('burbank-name', clean)
  await Promise.all([preloadFigures(), preloadCars()])
  gate!.hidden = true
  const dev = params.has('dev') || import.meta.env.DEV
  const previous = (window as unknown as { __game?: Game }).__game
  previous?.dispose()
  const game = new Game(canvas!, clean, dev)
  game.start()
  ;(window as unknown as { __game: Game }).__game = game
  if (import.meta.hot) import.meta.hot.dispose(() => game.dispose())
}

if (preset) boot(preset)
else {
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    boot(nameInput.value)
  })
}
