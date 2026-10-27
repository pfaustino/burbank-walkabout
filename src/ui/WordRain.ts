const SEED = [
  'Olive', 'Magnolia', 'Hall', 'Library', 'Street', 'Walk', 'Sidewalk', 'Downtown',
  'Burbank', 'Block', 'Corner', 'Bus', 'Shade', 'People', 'Hello', 'Avenue',
]

const STOP = new Set([
  'a', 'an', 'the', 'and', 'or', 'to', 'of', 'in', 'on', 'for', 'with', 'is', 'it', 'be',
  'are', 'was', 'were', 'you', 'i', 'me', 'my', 'we', 'they', 'them', 'that', 'this',
  'just', 'so', 'at', 'from', 'as', 'if', 'but', 'not', 'do', 'dont', "don't", 'its',
  'your', 'im', "i'm", 'am', 'our', 'us', 'he', 'she', 'his', 'her', 'have', 'has',
  'had', 'will', 'can', 'cant', "can't", 'about', 'into', 'out', 'up', 'what', 'when',
  'where', 'who', 'how', 'there', 'here', 'then', 'than', 'too', 'very', 'really',
])

/** Halfwidth kana and digits, the glyph soup from the movie. */
const NOISE = 'ｦｧｨｩｪｫｬｭｮｯｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789'

const FONT = '"MS Gothic", "Yu Gothic", Consolas, monospace'

type Glyph = {
  text: string
  x: number
  width: number
  word: boolean
  head: boolean
  fresh: number
  dim: number
}

type Row = {
  size: number
  y: number
  speed: number
  phase: number
  every: number
  glyphs: Glyph[]
}

/** Content words from a line the model, or the player, just said. */
export function collectWords(text: string): string[] {
  const out: string[] = []
  for (const part of text.split(/[^A-Za-z']+/)) {
    const word = part.replace(/^'+|'+$/g, '')
    if (word.length < 3 || word.length > 18) continue
    const key = word.toLowerCase().replace(/'/g, '')
    if (STOP.has(key) || STOP.has(word.toLowerCase())) continue
    out.push(word[0]!.toUpperCase() + word.slice(1).toLowerCase())
  }
  return out
}

/** Horizontal Matrix rain: noise in mixed sizes, with readable words in the stream. */
export class WordRain {
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private readonly heard: string[] = []
  private readonly rows: Row[] = []
  private readonly charWidth = new Map<number, number>()
  private zoomed = false
  private view = 0

  constructor() {
    const canvas = document.querySelector('#wordnet')
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Missing #wordnet')
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Missing wordnet context')
    this.canvas = canvas
    this.ctx = ctx
    canvas.addEventListener('click', this.onClick)
  }

  hear(text: string): void {
    const words = collectWords(text)
    for (let i = words.length - 1; i >= 0; i--) this.heard.unshift(words[i]!)
    if (this.heard.length > 48) this.heard.length = 48
  }

  draw(dt: number): void {
    const view = this.canvas.clientWidth
    if (view < 8) return
    const ctx = this.ctx
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const size = Math.max(1, Math.round(view * dpr))
    if (this.canvas.width !== size) {
      this.canvas.width = size
      this.canvas.height = size
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    this.ensure(view)
    ctx.clearRect(0, 0, view, view)
    ctx.fillStyle = '#010a05'
    roundPath(ctx, 1, 1, view - 2, view - 2, 16)
    ctx.fill()
    ctx.save()
    roundPath(ctx, 4, 4, view - 8, view - 8, 12)
    ctx.clip()
    ctx.textBaseline = 'middle'
    const step = dt > 0 ? Math.min(dt, 0.05) : 0
    for (const row of this.rows) {
      ctx.font = `600 ${row.size}px ${FONT}`
      for (const glyph of row.glyphs) glyph.x -= row.speed * step
      while (row.glyphs.length > 1 && row.glyphs[0]!.x + row.glyphs[0]!.width < -8) {
        row.glyphs.shift()
        const last = row.glyphs[row.glyphs.length - 1]!
        row.glyphs.push(this.spawn(row, last.x + last.width))
      }
      for (const glyph of row.glyphs) {
        if (glyph.x > view + 4 || glyph.x + glyph.width < -4) continue
        if (!glyph.word && Math.random() < 0.08) glyph.text = noiseChar()
        glyph.fresh = Math.max(0, glyph.fresh - step * 0.4)
        let alpha = 1
        if (glyph.word) {
          if (glyph.x < 1 || glyph.x + glyph.width > view - 1) continue
          alpha = Math.min(1, Math.min(glyph.x, view - glyph.x - glyph.width) / 12)
          if (alpha < 0.05) continue
        }
        ctx.globalAlpha = alpha
        ctx.fillStyle = ink(glyph)
        if (glyph.word || glyph.head) {
          ctx.shadowColor = glyph.head ? 'rgba(210, 255, 230, 0.9)' : 'rgba(80, 255, 140, 0.7)'
          ctx.shadowBlur = glyph.head ? 4 : 2
        }
        ctx.fillText(glyph.text, glyph.x, row.y)
        ctx.globalAlpha = 1
        if (glyph.word || glyph.head) ctx.shadowBlur = 0
      }
    }
    ctx.restore()
  }

  dispose(): void {
    this.canvas.removeEventListener('click', this.onClick)
  }

  private readonly onClick = (): void => {
    this.zoomed = !this.zoomed
    this.canvas.classList.toggle('is-zoomed', this.zoomed)
    this.canvas.setAttribute('aria-pressed', this.zoomed ? 'true' : 'false')
  }

  private ensure(view: number): void {
    if (this.rows.length > 0 && Math.abs(this.view - view) <= 1) return
    this.view = view
    this.rows.length = 0
    this.charWidth.clear()
    const small = Math.max(8, Math.round(view * 0.042))
    const large = Math.max(small + 6, Math.round(view * 0.09))
    const palette = [0.0, 0.35, 0.7, 1, 0.15, 0.55, 0.85, 0.25]
    let y = 3
    let i = 0
    while (y < view - 4) {
      const size = Math.round(small + (large - small) * palette[i % palette.length]!)
      const lead = Math.round(size * 1.22)
      if (y + lead > view - 1) break
      const row: Row = {
        size,
        y: y + size * 0.46,
        speed: (34 + (1 - (size - small) / (large - small)) * 58) * (view / 200),
        phase: (i * 5 + 2) % 17,
        every: size >= (small + large) / 2 ? 12 : 20,
        glyphs: [],
      }
      let x = -((i * 23) % Math.max(size, 1))
      while (x < view + size * 2) {
        const glyph = this.spawn(row, x)
        row.glyphs.push(glyph)
        x += glyph.width
      }
      this.rows.push(row)
      y += lead
      i++
    }
  }

  private spawn(row: Row, x: number): Glyph {
    const at = row.phase++ % row.every
    if (at === 3) {
      const text = this.pick()
      const width = this.measure(row.size, text) + 7
      const fresh = this.heard.length > 0 && this.heard.slice(0, 6).includes(text) ? 1 : 0
      return { text, x, width, word: true, head: false, fresh, dim: 1 }
    }
    const head = at === 0
    const text = noiseChar()
    const dim = head ? 1 : at < 4 ? 0.75 : at < 8 ? 0.45 : 0.18 + (at % 3) * 0.06
    return { text, x, width: this.cellWidth(row.size), word: false, head, fresh: 0, dim }
  }

  private measure(size: number, text: string): number {
    this.ctx.font = `600 ${size}px ${FONT}`
    return this.ctx.measureText(text).width
  }

  private cellWidth(size: number): number {
    const cached = this.charWidth.get(size)
    if (cached) return cached
    const width = this.measure(size, 'ｱ')
    this.charWidth.set(size, width)
    return width
  }

  private pick(): string {
    if (this.heard.length > 0 && Math.random() < 0.75) {
      const span = Math.min(10, this.heard.length)
      return this.heard[Math.floor(Math.random() * span)]!
    }
    return SEED[Math.floor(Math.random() * SEED.length)]!
  }
}

function noiseChar(): string {
  return NOISE[Math.floor(Math.random() * NOISE.length)]!
}

function ink(glyph: Glyph): string {
  if (glyph.word) return glyph.fresh > 0.08 ? 'rgba(236, 255, 244, 0.97)' : 'rgba(170, 255, 196, 0.94)'
  if (glyph.head) return 'rgba(232, 255, 242, 0.98)'
  const g = Math.round(80 + glyph.dim * 160)
  const alpha = 0.28 + glyph.dim * 0.62
  return `rgba(${Math.round(12 + glyph.dim * 70)}, ${g}, ${Math.round(36 + glyph.dim * 40)}, ${alpha.toFixed(2)})`
}

function roundPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}
