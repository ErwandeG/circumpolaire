/** Capteurs disponibles. Seul le plein format est proposé pour l'instant. */
export interface Sensor {
  id: string
  label: string
  widthMm: number
  heightMm: number
}

export const SENSORS: readonly Sensor[] = [
  { id: 'full-frame', label: 'Plein format 36×24', widthMm: 36, heightMm: 24 }
]

export type FrameOrientation = 'landscape' | 'portrait'

export const FOCAL_MIN_MM = 10
export const FOCAL_MAX_MM = 600

/** Champ de vision (degrés) d'un objectif rectilinéaire sur un côté de capteur donné. */
export function fieldOfView(sideMm: number, focalMm: number): number {
  return (2 * Math.atan(sideMm / (2 * focalMm)) * 180) / Math.PI
}

export function frameSize(sensor: Sensor, orientation: FrameOrientation): { width: number; height: number } {
  return orientation === 'landscape'
    ? { width: sensor.widthMm, height: sensor.heightMm }
    : { width: sensor.heightMm, height: sensor.widthMm }
}

/**
 * Slider logarithmique : position 0…1 ↔ focale 10…600 mm.
 * Donne autant de place à 14→50 mm qu'à 170→600 mm.
 */
export function focalFromSlider(position: number): number {
  const p = Math.max(0, Math.min(1, position))
  return FOCAL_MIN_MM * Math.pow(FOCAL_MAX_MM / FOCAL_MIN_MM, p)
}

export function sliderFromFocal(focalMm: number): number {
  const f = Math.max(FOCAL_MIN_MM, Math.min(FOCAL_MAX_MM, focalMm))
  return Math.log(f / FOCAL_MIN_MM) / Math.log(FOCAL_MAX_MM / FOCAL_MIN_MM)
}

/** Hauteur d'œil sur un curseur logarithmique : autant de place pour 0,2 → 3 m que pour 3 → 50 m. */
const EYE_MIN = 0.2
const EYE_MAX = 50
export function eyeFromSlider(position: number): number {
  const p = Math.max(0, Math.min(1, position))
  return EYE_MIN * Math.pow(EYE_MAX / EYE_MIN, p)
}

export function sliderFromEye(heightM: number): number {
  const h = Math.max(EYE_MIN, Math.min(EYE_MAX, heightM))
  return Math.log(h / EYE_MIN) / Math.log(EYE_MAX / EYE_MIN)
}

/** Distance du relief sur un curseur logarithmique : 200 m → 20 km. */
export function reliefFromSlider(position: number): number {
  const p = Math.max(0, Math.min(1, position))
  return 200 * Math.pow(100, p)
}

export function sliderFromRelief(distanceM: number): number {
  const d = Math.max(200, Math.min(20000, distanceM))
  return Math.log(d / 200) / Math.log(100)
}

/** Arrondi lisible : 10, 14, 24, 35, 50, 85, 135, 200, 300… sur le slider. */
export function roundFocal(focalMm: number): number {
  if (focalMm < 30) return Math.round(focalMm)
  if (focalMm < 100) return Math.round(focalMm / 5) * 5
  return Math.round(focalMm / 10) * 10
}

export const DURATION_MIN = 5
export const DURATION_MAX = 120
/** Rotation apparente du ciel : 360° par jour sidéral. */
export const SIDEREAL_DEG_PER_MIN = 360 / (23.9344696 * 60)
