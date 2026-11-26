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

async function fetchRaw(layer: string, minX: number, minY: number, maxX: number, maxY: number, cols: number, rows: number) {
  const url =
    `${WMS}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=${layer}&STYLES=` +
    `&CRS=EPSG:2154&BBOX=${minX},${minY},${maxX},${maxY}&WIDTH=${cols}&HEIGHT=${rows}` +
    `&FORMAT=image/x-bil;bits=32`
  const buf = await fetchCached(url, 60_000)
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

/** Grilles de relief nécessaires pour voir jusqu'à `distance` mètres, de la plus fine à la plus grossière. */
export async function loadReliefGrids(lat: number, lon: number, distance: number): Promise<ReliefGrid[]> {
  const p = toLambert93(lat, lon)
  const needed = RINGS.filter((_ring, i) => i === 0 || distance > RINGS[i - 1].half)
  return Promise.all(needed.map((r) => fetchRing(p.x, p.y, r.half, r.res)))
}
