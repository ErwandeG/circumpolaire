/**
 * Panneau de gauche : largeur réglable à la poignée (mémorisée dans ce navigateur),
 * et, en vue 3D, deux onglets « Lieu et calendrier » / « Réglages ».
 */
const WIDTH_KEY = 'star-trail-planner.panelWidth'
const MIN_W = 300
const MAX_W = 680

export interface Sidebar {
  /** Vue 3D ouverte : onglets visibles, réglages affichés. Carte : lieu et calendrier seulement. */
  setSkyMode(sky: boolean): void
}

export function setupSidebar(el: {
  app: HTMLElement
  resizer: HTMLElement
  toggle: HTMLElement
  tabs: HTMLElement
  tabPlace: HTMLButtonElement
  tabSettings: HTMLButtonElement
  panePlace: HTMLElement
  paneSettings: HTMLElement
}): Sidebar {
  const setWidth = (w: number) => el.app.style.setProperty('--panel-w', `${Math.round(Math.min(MAX_W, Math.max(MIN_W, w)))}px`)
  try {
    const saved = Number(localStorage.getItem(WIDTH_KEY))
    if (saved) setWidth(saved)
  } catch {
    // Stockage indisponible : largeur par défaut.
  }

  // Glisser la poignée : le panneau suit la souris.
  el.resizer.addEventListener('pointerdown', (e) => {
    if (e.target === el.toggle || el.app.classList.contains('is-collapsed')) return
    e.preventDefault()
    el.resizer.classList.add('is-dragging')
    const left = el.app.getBoundingClientRect().left
    const move = (ev: PointerEvent) => {
      setWidth(ev.clientX - left)
      window.dispatchEvent(new Event('resize'))
    }
    const up = () => {
      el.resizer.classList.remove('is-dragging')
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      try {
        localStorage.setItem(WIDTH_KEY, String(parseInt(el.app.style.getPropertyValue('--panel-w'), 10)))
      } catch {
        // Tant pis : la largeur ne sera pas retrouvée au prochain lancement.
      }
    }
    // Suivi sur toute la fenêtre : la souris peut quitter la poignée pendant le glissement.
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  })

  const select = (settings: boolean) => {
    el.tabPlace.setAttribute('aria-selected', String(!settings))
    el.tabSettings.setAttribute('aria-selected', String(settings))
    el.panePlace.hidden = settings
    el.paneSettings.hidden = !settings
  }
  el.tabPlace.addEventListener('click', () => select(false))
  el.tabSettings.addEventListener('click', () => select(true))

  return {
    setSkyMode(sky) {
      el.tabs.hidden = !sky
      select(sky)
    }
  }
}
