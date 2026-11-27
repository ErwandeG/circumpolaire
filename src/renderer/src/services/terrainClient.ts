import type { Building } from '../domain/geo/buildings'
import type { HdTileFrame } from '../domain/hdModel'
import { hdCovers } from '../domain/hdModel'
import { buildTerrain, type ElevationGrid, type TerrainMesh } from '../domain/terrain'

/** Tout ce qu'il faut pour construire la surface 3D : données simples, transmissibles à une tâche de fond. */
export interface TerrainJob {
  observer: { x: number; y: number; lat: number; lon: number }
  mns: ElevationGrid
  mnt: ElevationGrid
  buildings: Building[]
  radius: number
  trees: boolean
  hd?: { anchorX: number; anchorY: number; triangles: Float32Array; tiles: HdTileFrame[] }
}

function buildInline(job: TerrainJob): TerrainMesh {
  const hd = job.hd ? { ...job.hd, covers: (x: number, y: number) => hdCovers(job.hd!.tiles, x, y) } : undefined
  return buildTerrain(job.observer, job.mns, job.mnt, job.buildings, job.radius, { trees: job.trees, hd })
}

let worker: Worker | null = null
/** Tâche de fond indisponible (fichier local refusé…) : calcul sur le fil principal. */
let workerBroken = false
let nextId = 0
const pending = new Map<number, { resolve: (m: TerrainMesh) => void; job: TerrainJob }>()

function getWorker(): Worker | null {
  if (workerBroken) return null
  if (!worker) {
    try {
      worker = new Worker(new URL('./terrainWorker.ts', import.meta.url), { type: 'module' })
    } catch {
      workerBroken = true
      return null
    }
    worker.onmessage = (e) => {
      const job = pending.get(e.data.id)
      pending.delete(e.data.id)
      job?.resolve(e.data.mesh)
    }
    worker.onerror = () => {
      // On termine les constructions en attente sur le fil principal.
      workerBroken = true
      for (const [id, job] of pending) {
        pending.delete(id)
        job.resolve(buildInline(job.job))
      }
    }
  }
  return worker
}

/**
 * Construit la surface 3D dans une tâche de fond. Les grilles sont copiées (pas transférées) :
 * elles restent utilisables ici pour la marche (altitude du sol, collisions).
 */
export function buildTerrainAsync(job: TerrainJob): Promise<TerrainMesh> {
  const w = getWorker()
  if (!w) return Promise.resolve(buildInline(job))
  const id = ++nextId
  return new Promise((resolve) => {
    pending.set(id, { resolve, job })
    w.postMessage({ id, job })
  })
}
