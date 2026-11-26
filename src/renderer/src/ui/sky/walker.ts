/** Vitesse de marche du cahier des charges. */
export const WALK_SPEED_M_PER_S = 1

type Direction = 'forward' | 'back' | 'left' | 'right'

const KEYS: Record<string, Direction> = {
  ArrowUp: 'forward',
  ArrowDown: 'back',
  ArrowLeft: 'left',
  ArrowRight: 'right'
}

interface WalkerOptions {
  /** Boutons à l'écran, avec leur direction dans data-dir. */
  buttons: HTMLButtonElement[]
  /** Faux quand la vue du ciel est cachée : les flèches du clavier ne font rien. */
  isActive: () => boolean
  /** Pas élémentaire : mètres vers l'avant et vers la droite depuis la dernière image. */
  onStep: (forwardM: number, rightM: number) => void
  /** Plus aucune direction active. */
  onStop: () => void
}

/**
 * Déplacement continu à 1 m/s tant qu'une flèche (écran ou clavier) est maintenue.
 * Avant / arrière suivent la direction visée ; gauche / droite font un pas de côté.
 */
export function setupWalker(opts: WalkerOptions): void {
  const active = new Set<string>()
  const dirs = new Map<string, Direction>()
  let last = 0
  let running = false

  function frame(now: number): void {
    if (dirs.size === 0) {
      running = false
      opts.onStop()
      return
    }
    const dt = Math.min(0.1, (now - last) / 1000)
    last = now
    let forward = 0
    let right = 0
    for (const d of dirs.values()) {
      if (d === 'forward') forward += 1
      if (d === 'back') forward -= 1
      if (d === 'right') right += 1
      if (d === 'left') right -= 1
    }
    const norm = Math.hypot(forward, right)
    if (norm > 0) opts.onStep((forward / norm) * WALK_SPEED_M_PER_S * dt, (right / norm) * WALK_SPEED_M_PER_S * dt)
    requestAnimationFrame(frame)
  }

  function press(id: string, dir: Direction): void {
    if (active.has(id)) return
    active.add(id)
    dirs.set(id, dir)
    for (const b of opts.buttons) if (b.dataset.dir === dir) b.classList.add('is-pressed')
    if (!running) {
      running = true
      last = performance.now()
      requestAnimationFrame(frame)
    }
  }

  function release(id: string): void {
    const dir = dirs.get(id)
    active.delete(id)
    dirs.delete(id)
    if (dir && ![...dirs.values()].includes(dir)) {
      for (const b of opts.buttons) if (b.dataset.dir === dir) b.classList.remove('is-pressed')
    }
  }

  for (const b of opts.buttons) {
    const dir = b.dataset.dir as Direction
    const id = `btn-${dir}`
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      try {
        // Le bouton garde la main même si le pointeur glisse en dehors pendant l'appui.
        b.setPointerCapture(e.pointerId)
      } catch {
        // Pointeur inconnu (événement synthétique) : on continue sans capture.
      }
      press(id, dir)
    })
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
      b.addEventListener(ev, () => release(id))
    }
  }

  const typing = () => {
    const a = document.activeElement
    return a instanceof HTMLInputElement || a instanceof HTMLSelectElement || a instanceof HTMLTextAreaElement
  }
  window.addEventListener('keydown', (e) => {
    const dir = KEYS[e.key]
    if (!dir || !opts.isActive() || typing()) return
    e.preventDefault()
    press(`key-${e.key}`, dir)
  })
  window.addEventListener('keyup', (e) => {
    if (KEYS[e.key]) release(`key-${e.key}`)
  })
  // Fenêtre qui perd le focus : on lâche tout, sinon la marche continuerait seule.
  window.addEventListener('blur', () => {
    for (const id of [...active]) release(id)
  })
}
