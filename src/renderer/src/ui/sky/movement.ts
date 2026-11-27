/**
 * Déplacement dans la vue du ciel : marche au clavier (avec rechargement de la zone en route),
 * hauteur du point de vue au clavier, saut vers un point cliqué sur la mini-carte.
 */
import { distanceM, fromLocal, localFrame, stepToward } from '../../domain/geo/local'
import { clampEyeHeight } from '../../domain/preferences'
import { EYE_HEIGHT_MAX_M, EYE_HEIGHT_MIN_M, isBlocked } from '../../domain/terrain'
import { checkPointInFrance } from '../../services/geocoding'
import type { SceneLoader } from './sceneLoader'
import type { SkyState } from './skyState'
import { setupWalker } from './walker'

/**
 * À l'arrêt de la marche, ou après un clic sur la mini-carte, les volumes 3D ne sont rechargés que si
 * l'on s'est éloigné d'au moins cette distance (horizontale) du point d'où ils ont été chargés.
 */
export const RELOAD_MIN_DISTANCE_M = 10

export interface MovementContext {
  state: SkyState
  loader: SceneLoader
  /** Vue du ciel affichée : sinon le clavier ne fait rien. */
  isActive(): boolean
  draw(): void
  showCoords(): void
  recomputeSky(): void
  /** Hauteur de l'œil changée : réglages, curseur, œil et relief à mettre à jour. */
  onEyeHeight(): void
  /** Nouveau lieu choisi sur la mini-carte : nom à afficher, ou erreur. */
  showPlace(label: string): void
  showError(message: string): void
}

export function setupMovement(ctx: MovementContext) {
  const { state, loader } = ctx
  /** Au-delà de la moitié du rayon depuis le point de chargement, on recharge la zone en marchant. */
  const reloadDistance = () => state.radius / 2
  const origin = () => (loader.walk ? { lat: loader.walk.frame.lat0, lon: loader.walk.frame.lon0 } : null)

  function step(forward: number, right: number): void {
    const d = stepToward(state.azimuth, forward, right)
    const f = localFrame(state.observer.lat, state.observer.lon)
    const walk = loader.walk
    const tryMove = (e: number, n: number): boolean => {
      const p = fromLocal(f, e, n)
      if (walk && isBlocked(walk, p.lat, p.lon, state.eyeHeight)) return false
      state.observer = { ...state.observer, lat: p.lat, lon: p.lon }
      return true
    }
    // Contre une façade, on glisse le long du mur sur l'axe resté libre.
    if (!tryMove(d.e, d.n) && !tryMove(d.e, 0)) tryMove(0, d.n)
    loader.placeEye()
    ctx.showCoords()
    ctx.draw()
    const o = origin()
    if (o && !loader.loading && distanceM(o, state.observer) > reloadDistance()) void loader.loadBuildings(true)
  }

  let stopTimer: ReturnType<typeof setTimeout> | undefined
  function stopWalking(): void {
    clearTimeout(stopTimer)
    // À l'arrêt, on recharge la zone autour du nouveau point et on recalcule le ciel,
    // sauf si l'on est resté à moins de 10 m du point de chargement.
    stopTimer = setTimeout(() => {
      const o = origin()
      if (!o || distanceM(o, state.observer) < RELOAD_MIN_DISTANCE_M) return
      ctx.recomputeSky()
      ctx.draw()
      void loader.loadBuildings(true)
    }, 700)
  }

  // Hauteur au clavier : valeur exacte cumulée (le réglage est arrondi au centimètre),
  // bornée comme le curseur.
  let eyeExact = state.eyeHeight
  function rise(upM: number): void {
    if (Math.abs(eyeExact - state.eyeHeight) > 0.01) eyeExact = state.eyeHeight
    eyeExact = Math.min(EYE_HEIGHT_MAX_M, Math.max(EYE_HEIGHT_MIN_M, eyeExact + upM))
    const h = clampEyeHeight(eyeExact)
    if (h === state.eyeHeight) return
    state.eyeHeight = h
    ctx.onEyeHeight()
  }

  setupWalker({ isActive: ctx.isActive, onStep: step, onRise: rise, onStop: stopWalking })

  /** Point cliqué sur la mini-carte : on s'y place (s'il est en France métropolitaine). */
  async function moveTo(lat: number, lon: number): Promise<void> {
    const check = await checkPointInFrance(lat, lon)
    if (check.status === 'outside') {
      ctx.showError('Ce point est hors de France métropolitaine.')
      return
    }
    state.observer = {
      lat,
      lon,
      label: check.status === 'inside' && check.label ? `Près de ${check.label}` : 'Point choisi sur la carte'
    }
    ctx.showPlace(state.observer.label)
    ctx.showCoords()
    ctx.recomputeSky()
    // Clic à moins de 10 m du point de chargement : on se place dans la scène actuelle, sans recharger.
    const o = origin()
    if (o && distanceM(o, state.observer) < RELOAD_MIN_DISTANCE_M) {
      loader.placeEye()
      ctx.draw()
      return
    }
    ctx.draw()
    void loader.loadBuildings(false)
  }

  return { moveTo }
}
