import './style.css'
import { preloadFigures } from './actors/figure.ts'
import { preloadCars } from './traffic/CarSet.ts'
import { Game } from './game/Game.ts'
import { cleanName } from './net/protocol.ts'

const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas')
const gate = document.querySelector<HTMLElement>('#gate')
const loading = document.querySelector<HTMLElement>('#loading')
const form = document.querySelector<HTMLFormElement>('#gate-form')
const nameInput = document.querySelector<HTMLInputElement>('#name-input')
if (!canvas || !gate || !loading || !form || !nameInput) throw new Error('Missing page shell')

const params = new URLSearchParams(window.location.search)
const preset = params.get('name') || sessionStorage.getItem('burbank-name')

function showLoading(): void {
  loading!.hidden = false
  loading!.textContent = 'Loading the map…'
}

/** Let the status paint before the map build blocks the page. */
function paint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

async function boot(name: string): Promise<void> {
  const clean = cleanName(name)
  sessionStorage.setItem('burbank-name', clean)
  showLoading()
  gate!.hidden = true
  await paint()
  await Promise.all([preloadFigures(), preloadCars()])
  const dev = params.has('dev') || import.meta.env.DEV
  const previous = (window as unknown as { __game?: Game }).__game
  previous?.dispose()
  const game = new Game(canvas!, clean, dev)
  game.start()
  ;(window as unknown as { __game: Game }).__game = game
  loading!.hidden = true
  if (import.meta.hot) import.meta.hot.dispose(() => game.dispose())
}

if (preset) boot(preset)
else {
  loading!.hidden = true
  form!.addEventListener('submit', (event) => {
    event.preventDefault()
    boot(nameInput.value)
  })
}
