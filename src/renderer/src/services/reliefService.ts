import { toLambert93 } from '../domain/geo/lambert93'
import { cleanNoData } from '../domain/terrain'
import type { ReliefGrid } from '../domain/horizon'
import { fetchCached } from './cache'

const WMS = 'https://data.geopf.fr/wms-r'
/** MNT RGE ALTI de l'IGN, complété hors de France (Italie, Suisse…) par la Géoplateforme. */
const MAIN_LAYER = 'ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES'
/** Secours mondial si des pixels manquent. */
const FALLBACK_LAYER = 'ELEVATION.ELEVATIONGRIDCOVERAGE.SRTM3'

/** Anneaux de relief : plus on s'éloigne, plus le pas est grossier (une crête à 15 km n'a pas besoin de 5 m). */
const RINGS = [
  { half: 2500, res: 10 },
  { half: 8000, res: 25 },
  { half: 20500, res: 50 },
  { half: 60000, res: 150 },
  { half: 201000, res: 500 }
] as const

/** MNS LiDAR HD : la surface vue d'avion, bâtiments et arbres compris. */
const SURFACE_LAYER = 'IGNF_LIDAR-HD_MNS_ELEVATION.ELEVATIONGRIDCOVERAGE.LAMB93'

/**
 * Ceinture urbaine : au-delà des volumes 3D et jusqu'à 3 km, la silhouette des toits, clochers
 * et arbres. Pas de 2 m puis 5 m : assez fin pour garder les flèches.
 */
export const URBAN_BELT = [
  { half: 1500, res: 2 },
  { half: 3000, res: 5 }
] as const
export const URBAN_BELT_M = URBAN_BELT[URBAN_BELT.length - 1].half

async function fetchSurfaceRing(cx: number, cy: number, half: number, res: number): Promise<ReliefGrid | null> {
  const snap = res * 10
  const x0 = Math.round(cx / snap) * snap
  const y0 = Math.round(cy / snap) * snap
  const cols = Math.round((2 * half) / res)
  try {
    const values = await fetchRaw(SURFACE_LAYER, x0 - half, y0 - half, x0 + half, y0 + half, cols, cols)
    // Hors couverture LiDAR HD (étranger, zones pas encore relevées) : le MNT prend le relais.
    if (values.every(Number.isNaN)) return null
    return { minX: x0 - half, maxY: y0 + half, res, cols, rows: cols, values, surface: true }
  } catch {
    // La silhouette de la ville est un plus : son absence ne doit pas priver du relief.
    return null
  }
}

async function fetchRaw(
  layer: string,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  cols: number,
  rows: number,
  onBytes?: (loaded: number, total: number) => void
) {
  const url =
    `${WMS}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=${layer}&STYLES=` +
    `&CRS=EPSG:2154&BBOX=${minX},${minY},${maxX},${maxY}&WIDTH=${cols}&HEIGHT=${rows}` +
    `&FORMAT=image/x-bil;bits=32`
  const buf = await fetchCached(url, 60_000, onBytes, cols * rows * 4)
  if (buf.byteLength !== cols * rows * 4) throw new Error(`Relief : réponse inattendue (${buf.byteLength} octets)`)
  const view = new DataView(buf)
  const values = new Float32Array(cols * rows)
  for (let i = 0; i < values.length; i++) values[i] = view.getFloat32(i * 4, true)
  return cleanNoData(values)
}

async function fetchRing(cx: number, cy: number, half: number, res: number): Promise<ReliefGrid> {
  // Centre calé sur un multiple de 10 pas : un petit déplacement réutilise le cache.
  const snap = res * 10
  const x0 = Math.round(cx / snap) * snap
  const y0 = Math.round(cy / snap) * snap
  const minX = x0 - half
  const maxX = x0 + half
  const minY = y0 - half
  const maxY = y0 + half
  const cols = Math.round((maxX - minX) / res)
  const rows = cols
  const values = await fetchRaw(MAIN_LAYER, minX, minY, maxX, maxY, cols, rows)
  if (values.some(Number.isNaN)) {
    const fallback = await fetchRaw(FALLBACK_LAYER, minX, minY, maxX, maxY, cols, rows)
    for (let i = 0; i < values.length; i++) if (Number.isNaN(values[i])) values[i] = fallback[i]
  }
  return { minX, maxY, res, cols, rows, values }
}

/**
 * Grilles de relief nécessaires pour voir jusqu'à `distance` mètres, de la plus fine à la plus grossière :
 * d'abord la ceinture urbaine (MNS), puis les anneaux de sol nu (MNT).
 */
export async function loadReliefGrids(
  lat: number,
  lon: number,
  distance: number,
  /** Grilles reçues sur le total (pour la barre de progression). */
  onProgress?: (done: number, total: number) => void
): Promise<ReliefGrid[]> {
  const p = toLambert93(lat, lon)
  const needed = RINGS.filter((_ring, i) => i === 0 || distance > RINGS[i - 1].half)
  const belt = URBAN_BELT.filter((_ring, i) => i === 0 || distance > URBAN_BELT[i - 1].half)
  const total = needed.length + belt.length
  let done = 0
  onProgress?.(0, total)
  const count = <T>(promise: Promise<T>) =>
    promise.then((v) => {
      onProgress?.(++done, total)
      return v
    })
  const [surface, bare] = await Promise.all([
    Promise.all(belt.map((r) => count(fetchSurfaceRing(p.x, p.y, r.half, r.res)))),
    Promise.all(needed.map((r) => count(fetchRing(p.x, p.y, r.half, r.res))))
  ])
  return [...surface.filter((g): g is ReliefGrid => g !== null), ...bare]
}
