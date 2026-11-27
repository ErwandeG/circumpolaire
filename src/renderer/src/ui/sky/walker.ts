/** Vitesse de marche du cahier des charges. */
export const WALK_SPEED_M_PER_S = 1
/** Montée ou descente du point de vue (Espace / Ctrl gauche). */
export const RISE_SPEED_M_PER_S = 0.2
/** Maj enfoncée : tout va trois fois plus vite. */
export const FAST_FACTOR = 3

type Direction = 'forward' | 'back' | 'left' | 'right' | 'up' | 'down'

const KEYS: Record<string, Direction> = {
  ArrowUp: 'forward',
  ArrowDown: 'back',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  // Clavier AZERTY : Z Q S D comme les flèches (non indiqué dans l'aide).
  z: 'forward',
  s: 'back',
  q: 'left',
  d: 'right',
  // Codes physiques des touches (indépendants de la disposition du clavier).
  Space: 'up',
  ControlLeft: 'down'
}

interface WalkerOptions {
  /** Faux quand la vue du ciel est cachée : les flèches du clavier ne font rien. */
  isActive: () => boolean
  /** Pas élémentaire : mètres vers l'avant et vers la droite depuis la dernière image. */
  onStep: (forwardM: number, rightM: number) => void
  /** Montée (positif) ou descente du point de vue, en mètres depuis la dernière image. */
  onRise: (upM: number) => void
  /** Plus aucune touche de déplacement enfoncée. */
  onStop: () => void
}

/**
 * Déplacement continu tant qu'une touche est enfoncée :
 * ↑ / ↓ suivent la direction visée, ← / → font un pas de côté (1 m/s) ;
 * Espace monte, Ctrl gauche descend (20 cm/s) ; Maj multiplie les vitesses par 3.
 */
export function setupWalker(opts: WalkerOptions): void {
  const held = new Map<string, Direction>()
  let last = 0
  let running = false
  let fast = false

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
    let up = 0
    for (const d of held.values()) {
      if (d === 'forward') forward += 1
      if (d === 'back') forward -= 1
      if (d === 'right') right += 1
      if (d === 'left') right -= 1
      if (d === 'up') up += 1
      if (d === 'down') up -= 1
    }
    const k = fast ? FAST_FACTOR : 1
    const norm = Math.hypot(forward, right)
    if (norm > 0) opts.onStep((forward / norm) * WALK_SPEED_M_PER_S * k * dt, (right / norm) * WALK_SPEED_M_PER_S * k * dt)
    if (up !== 0) opts.onRise(up * RISE_SPEED_M_PER_S * k * dt)
    requestAnimationFrame(frame)
  }

  // Un champ de saisie ou une liste a le focus : les touches lui reviennent.
  // Les curseurs et les boutons, eux, ne gardent pas les flèches ni l'espace : on se déplace
  // même juste après avoir touché un réglage.
  const typing = () => {
    const a = document.activeElement
    if (a instanceof HTMLInputElement) return a.type !== 'range' && a.type !== 'checkbox'
    return a instanceof HTMLSelectElement || a instanceof HTMLTextAreaElement
  }
  const keyOf = (e: KeyboardEvent) =>
    e.key.startsWith('Arrow') ? e.key : e.key.length === 1 && /[zqsd]/i.test(e.key) ? e.key.toLowerCase() : e.code

  window.addEventListener('keydown', (e) => {
    fast = e.shiftKey
    const key = keyOf(e)
    const dir = KEYS[key]
    if (!dir || !opts.isActive() || typing()) return
    e.preventDefault()
    held.set(key, dir)
    if (!running) {
      running = true
      last = performance.now()
      requestAnimationFrame(frame)
    }
  })
  window.addEventListener('keyup', (e) => {
    fast = e.shiftKey
    held.delete(keyOf(e))
  })
  // Fenêtre qui perd le focus : on lâche tout, sinon la marche continuerait seule.
  window.addEventListener('blur', () => held.clear())
}
