/**
 * Atlas de pollution lumineuse de David Lorenz (2025, d'après les données satellite VIIRS), réduit à la
 * France métropolitaine : grille de niveaux 0 à 14 au pas de 1/120° (≈ 1 km), et image colorée pour la carte.
 * Les images sont intégrées au code (données « data: ») : lisibles aussi depuis l'appli empaquetée.
 */
import gridUrl from '../data/lightpollution-fr.png?inline'
import mapUrl from '../data/lightpollution-fr-map.png?inline'

/** Emprise de la grille et de l'image (degrés). */
export const LP_BOUNDS = { west: -5.5, north: 51.5, east: 10, south: 41 }
const PX_PER_DEG = 120
export const LP_MAP_IMAGE = mapUrl
export const LP_CREDIT = 'Pollution lumineuse : atlas de David Lorenz (2025, données VIIRS)'

let grid: Promise<{ width: number; height: number; levels: Uint8Array } | null> | null = null

function loadGrid() {
  if (!grid) {
    grid = (async () => {
      try {
        const img = new Image()
        img.src = gridUrl
        await img.decode()
        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth
        canvas.height = img.naturalHeight
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!
        ctx.drawImage(img, 0, 0)
        const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data
        const levels = new Uint8Array(canvas.width * canvas.height)
        for (let i = 0; i < levels.length; i++) levels[i] = rgba[i * 4]
        return { width: canvas.width, height: canvas.height, levels }
      } catch {
        return null
      }
    })()
  }
  return grid
}

/** Niveau de pollution lumineuse (0 à 14) au point, null hors de l'emprise ou si l'atlas est illisible. */
export async function lightPollutionLevel(lat: number, lon: number): Promise<number | null> {
  const g = await loadGrid()
  if (!g) return null
  const c = Math.floor((lon - LP_BOUNDS.west) * PX_PER_DEG)
  const r = Math.floor((LP_BOUNDS.north - lat) * PX_PER_DEG)
  if (c < 0 || r < 0 || c >= g.width || r >= g.height) return null
  return g.levels[r * g.width + c]
}

// --- Interrupteur « Pollution lumineuse » : carte principale et effets dans la vue 3D ---
const KEY = 'star-trail-planner.lightPollution'
const listeners = new Set<(on: boolean) => void>()

export function isLightPollutionOn(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function setLightPollutionOn(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? '1' : '0')
  } catch {
    // Stockage indisponible : l'état vaut pour cette session seulement.
  }
  for (const l of listeners) l(on)
}

export function onLightPollutionChange(listener: (on: boolean) => void): void {
  listeners.add(listener)
}
