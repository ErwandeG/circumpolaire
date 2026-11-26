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
