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
  /** Faux quand la vue du ciel est cachée : les flèches du clavier ne font rien. */
  isActive: () => boolean
  /** Pas élémentaire : mètres vers l'avant et vers la droite depuis la dernière image. */
  onStep: (forwardM: number, rightM: number) => void
  /** Plus aucune flèche enfoncée. */
  onStop: () => void
}

/**
 * Déplacement continu à 1 m/s tant qu'une flèche du clavier est enfoncée.
 * ↑ / ↓ suivent la direction visée ; ← / → font un pas de côté.
 */
export function setupWalker(opts: WalkerOptions): void {
  const held = new Map<string, Direction>()
  let last = 0
  let running = false

  function frame(now: number): void {
    if (held.size === 0) {
      running = false
      opts.onStop()
      return
    }
    const dt = Math.min(0.1, (now - last) / 1000)
    last = now
    let forward = 0
    let right = 0
    for (const d of held.values()) {
      if (d === 'forward') forward += 1
      if (d === 'back') forward -= 1
      if (d === 'right') right += 1
      if (d === 'left') right -= 1
    }
    const norm = Math.hypot(forward, right)
    if (norm > 0) opts.onStep((forward / norm) * WALK_SPEED_M_PER_S * dt, (right / norm) * WALK_SPEED_M_PER_S * dt)
    requestAnimationFrame(frame)
  }

  // Un curseur ou un champ a le focus : les flèches lui reviennent.
  const typing = () => {
    const a = document.activeElement
    return a instanceof HTMLInputElement || a instanceof HTMLSelectElement || a instanceof HTMLTextAreaElement
  }

  window.addEventListener('keydown', (e) => {
    const dir = KEYS[e.key]
    if (!dir || !opts.isActive() || typing()) return
    e.preventDefault()
    held.set(e.key, dir)
    if (!running) {
      running = true
      last = performance.now()
      requestAnimationFrame(frame)
    }
  })
  window.addEventListener('keyup', (e) => {
    held.delete(e.key)
  })
  // Fenêtre qui perd le focus : on lâche tout, sinon la marche continuerait seule.
  window.addEventListener('blur', () => held.clear())
}
