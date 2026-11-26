import { fromLocal, localFrame } from '../../domain/geo/local'
import { toLambert93 } from '../../domain/geo/lambert93'
import {
  computeHorizon,
  reliefAt,
  ridgeSegments,
  type HorizonParams,
  type HorizonProfile,
  type ReliefGrid
} from '../../domain/horizon'

export interface HorizonResult {
  profile: HorizonProfile
  /** Crêtes intermédiaires reliées : [direction1, angle1, direction2, angle2, distance] à la suite. */
  segments: Float32Array
  maxDistance: number
  /** Portée de la silhouette de la ville (MNS) ; 0 si elle n'a pas pu être chargée. */
  urbanDistance: number
}

let worker: Worker | null = null
/** Tâche de fond indisponible (fichier local refusé…) : calcul sur le fil principal. */
let workerBroken = false
let nextId = 0
const pending = new Map<
  number,
  { resolve: (r: { profile: HorizonProfile; segments: Float32Array }) => void; params: HorizonParams }
>()

function computeInline(params: HorizonParams) {
  const profile = computeHorizon(params)
  return { profile, segments: ridgeSegments(profile) }
}

function getWorker(): Worker | null {
  if (workerBroken) return null
  if (!worker) {
    try {
      worker = new Worker(new URL('./horizonWorker.ts', import.meta.url), { type: 'module' })
    } catch {
      workerBroken = true
      return null
    }
    worker.onmessage = (e) => {
      const job = pending.get(e.data.id)
      pending.delete(e.data.id)
      job?.resolve(e.data)
    }
    worker.onerror = () => {
      // On termine les calculs en attente sur le fil principal.
      workerBroken = true
      for (const [id, job] of pending) {
        pending.delete(id)
        job.resolve(computeInline(job.params))
      }
    }
  }
  return worker
}

/**
 * Lance le calcul du profil d'horizon dans le Web Worker.
 * L'altitude de l'œil est celle du relief sous l'observateur plus la hauteur choisie.
 */
export function computeHorizonAsync(
  grids: ReliefGrid[],
  lat: number,
  lon: number,
  eyeHeight: number,
  minDistance: number,
  maxDistance: number
): Promise<HorizonResult> {
  const p = toLambert93(lat, lon)
  // Direction du nord vrai dans le quadrillage Lambert (convergence des méridiens).
  const n = fromLocal(localFrame(lat, lon), 0, 1000)
  const pn = toLambert93(n.lat, n.lon)
  const gridNorth = Math.atan2(pn.x - p.x, pn.y - p.y)
  // Altitude du sol nu : sur le MNS, l'œil serait posé sur un toit ou un arbre voisin.
  const ground = reliefAt(grids, p.x, p.y, false).h
  const eyeAltitude = (Number.isNaN(ground) ? 0 : ground) + eyeHeight
  const params: HorizonParams = { grids, x: p.x, y: p.y, eyeAltitude, gridNorth, minDistance, maxDistance, azimuths: 3600 }
  const urbanDistance = Math.max(0, ...grids.filter((g) => g.surface).map((g) => (g.cols * g.res) / 2))
  const w = getWorker()
  if (!w) return Promise.resolve({ ...computeInline(params), maxDistance, urbanDistance })
  const id = ++nextId
  return new Promise((resolve) => {
    pending.set(id, { resolve: (r) => resolve({ ...r, maxDistance, urbanDistance }), params })
    w.postMessage({ id, params })
  })
}
