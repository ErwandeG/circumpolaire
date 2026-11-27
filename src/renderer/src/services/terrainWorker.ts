/// <reference lib="webworker" />
// Construction de la surface 3D hors du fil principal : l'interface reste fluide pendant le calcul.
import { hdCovers } from '../domain/hdModel'
import { buildTerrain } from '../domain/terrain'
import type { TerrainJob } from './terrainClient'

self.onmessage = (e: MessageEvent<{ id: number; job: TerrainJob }>) => {
  const { id, job } = e.data
  const hd = job.hd ? { ...job.hd, covers: (x: number, y: number) => hdCovers(job.hd!.tiles, x, y) } : undefined
  const mesh = buildTerrain(job.observer, job.mns, job.mnt, job.buildings, job.radius, { trees: job.trees, hd })
  ;(self as unknown as Worker).postMessage({ id, mesh }, [
    mesh.positions.buffer,
    mesh.kinds.buffer,
    mesh.indices.buffer,
    mesh.elevation.buffer,
    mesh.contact.buffer,
    mesh.outline.buffer
  ])
}
