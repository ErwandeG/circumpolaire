/**
 * Chargements de la vue du ciel : volumes 3D (LiDAR, BD TOPO, bâtiments HD) autour du point,
 * puis relief lointain. Les réponses arrivées trop tard (autre point, autre réglage) sont ignorées.
 */
import { EYE_HEIGHT_M, eyePosition, type WalkContext } from '../../domain/terrain'
import { describeFetchError } from '../../services/cache'
import { loadReliefGrids } from '../../services/reliefService'
import { loadTerrain } from '../../services/terrainService'
import { computeHorizonAsync } from './horizonClient'
import type { SkyScene } from './scene'
import type { SkyState } from './skyState'
import { fmt1 } from './skyText'

export interface LoaderContext {
  state: SkyState
  scene: SkyScene
  /** Ligne d'état sous le nom du lieu (bilan, erreurs). */
  status: HTMLElement
  setBusy(key: string, label: string | null): void
  draw(): void
  /** Le point a été déplacé (sortie d'un bâtiment) : coordonnées et ciel à recalculer. */
  onObserverMoved(): void
  /** Cercle des volumes 3D sur la mini-carte. */
  showZone(lat: number, lon: number, radius: number): void
}

const RELIEF_ERROR = 'Relief lointain indisponible'

export function createSceneLoader(ctx: LoaderContext) {
  const { state, scene, status } = ctx
  let walk: WalkContext | null = null
  let lastGround = Number.NaN
  let loading = false
  let terrainRequest = 0
  /** Dernier bilan du chargement des bâtiments, réaffiché quand une erreur de relief se résout. */
  let terrainStatus = ''
  let reliefRequest = 0
  let reliefTimer: ReturnType<typeof setTimeout> | undefined

  /** Place l'œil au point courant, à la hauteur choisie au-dessus du sol de la scène chargée. */
  function placeEye(): void {
    if (!walk) {
      // Sans relief chargé, le sol est à 1,70 m sous l'origine de la scène.
      scene.setEye(0, state.eyeHeight - EYE_HEIGHT_M, 0, state.eyeHeight)
      return
    }
    const fallback = Number.isNaN(lastGround) ? walk.eyeAltitude - EYE_HEIGHT_M : lastGround
    const eye = eyePosition(walk, state.observer.lat, state.observer.lon, fallback, state.eyeHeight)
    lastGround = eye.ground
    scene.setEye(eye.x, eye.y, eye.z, state.eyeHeight)
  }

  /**
   * Charge les bâtiments autour du point courant.
   * keepCurrent : on garde la scène affichée pendant le chargement (déplacement à pied).
   */
  async function loadBuildings(keepCurrent: boolean): Promise<void> {
    const id = ++terrainRequest
    loading = true
    if (!keepCurrent) {
      walk = null
      lastGround = Number.NaN
      scene.setTerrain(null)
      placeEye()
    }
    status.textContent = 'Chargement des bâtiments et du relief (LiDAR HD)…'
    delete status.dataset.tone
    ctx.setBusy('terrain', 'Bâtiments et relief proche')
    const res = await loadTerrain(state.observer.lat, state.observer.lon, state.radius, {
      trees: state.showTrees,
      hdBuildings: state.hdBuildings
    })
    if (id !== terrainRequest) return // une autre vue a été ouverte entre-temps
    loading = false
    ctx.setBusy('terrain', null)
    if (res.status === 'error') {
      status.textContent = keepCurrent && walk ? `${res.message} Zone précédente conservée.` : `${res.message} Horizon plat.`
      status.dataset.tone = 'error'
      ctx.draw()
      void loadRelief()
      return
    }
    const parts = [`${res.buildingCount} bâtiment${res.buildingCount > 1 ? 's' : ''} dans les ${state.radius} m`]
    if (res.hdTiles > 0) parts.push(`bâtiments HD (${res.hdTiles} dalle${res.hdTiles > 1 ? 's' : ''})`)
    if (res.mesh.fallbackShare > 0.01) {
      parts.push(`${Math.round(res.mesh.fallbackShare * 100)} % sans LiDAR (volumes BD TOPO en orange)`)
    }
    if (res.movedM > 0 && !keepCurrent) {
      parts.push(`point déplacé de ${fmt1(res.movedM)} m pour sortir du bâtiment`)
      state.observer = { ...state.observer, lat: res.lat, lon: res.lon }
      ctx.onObserverMoved()
    }
    terrainStatus = parts.join(' · ')
    status.textContent = terrainStatus
    walk = res.walk
    scene.setTerrain(res.mesh, state.radius)
    ctx.showZone(res.walk.frame.lat0, res.walk.frame.lon0, state.radius)
    placeEye()
    ctx.draw()
    // Relief lointain ensuite, depuis la position finale (éventuellement sortie d'un bâtiment).
    void loadRelief()
  }

  /** Relief lointain : crêtes jusqu'à la distance choisie, au-delà de la scène détaillée. */
  async function loadRelief(): Promise<void> {
    const id = ++reliefRequest
    if (!state.reliefOn || state.reliefDistance <= state.radius) {
      scene.setHorizon(null)
      ctx.setBusy('relief', null)
      ctx.draw()
      return
    }
    ctx.setBusy('relief', 'Relief lointain')
    const { lat, lon } = state.observer
    try {
      const grids = await loadReliefGrids(lat, lon, state.reliefDistance)
      if (id !== reliefRequest) return
      const result = await computeHorizonAsync(grids, lat, lon, state.eyeHeight, state.radius, state.reliefDistance)
      if (id !== reliefRequest) return
      scene.setHorizon(result)
      // Une erreur de relief précédente n'a plus lieu d'être affichée.
      if (status.textContent?.startsWith(RELIEF_ERROR)) {
        status.textContent = terrainStatus
        delete status.dataset.tone
      }
    } catch (e) {
      if (id !== reliefRequest) return
      status.textContent = describeFetchError(e, RELIEF_ERROR)
      status.dataset.tone = 'error'
    } finally {
      if (id === reliefRequest) ctx.setBusy('relief', null)
      ctx.draw()
    }
  }

  /** Recalcul différé : on attend la fin du glissement du curseur. */
  function scheduleRelief(): void {
    clearTimeout(reliefTimer)
    reliefTimer = setTimeout(() => void loadRelief(), 350)
  }

  return {
    placeEye,
    loadBuildings,
    loadRelief,
    scheduleRelief,
    /** Sol et bâtiments de la zone chargée (null avant le premier chargement). */
    get walk() {
      return walk
    },
    /** Un chargement de bâtiments est en cours. */
    get loading() {
      return loading
    }
  }
}

export type SceneLoader = ReturnType<typeof createSceneLoader>
