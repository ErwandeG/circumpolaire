import { DURATION_MAX, DURATION_MIN, FOCAL_MAX_MM, FOCAL_MIN_MM, type FrameOrientation } from './optics'
import {
  EYE_HEIGHT_M,
  EYE_HEIGHT_MAX_M,
  EYE_HEIGHT_MIN_M,
  SCENE_RADII_M,
  SCENE_RADIUS_M,
  type SceneRadius
} from './terrain'

/** Réglages de la vue du ciel retrouvés au lancement suivant. */
export interface ViewPreferences {
  focalMm: number
  durationMin: number
  orientation: FrameOrientation
  starCount: number
  radius: SceneRadius
  miniMapCollapsed: boolean
  /** Hauteur de l'œil au-dessus du sol, en mètres. */
  eyeHeight: number
  showTrees: boolean
}

export const STAR_COUNT_MIN = 1000
export const STAR_COUNT_MAX = 15000
export const STAR_COUNT_STEP = 1000

export const DEFAULT_PREFERENCES: ViewPreferences = {
  focalMm: 24,
  durationMin: 30,
  orientation: 'landscape',
  starCount: 2000,
  radius: SCENE_RADIUS_M,
  miniMapCollapsed: false,
  eyeHeight: EYE_HEIGHT_M,
  showTrees: true
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))

/** Hauteur d'œil bornée et arrondie au centimètre. */
export function clampEyeHeight(h: number): number {
  return Math.round(clamp(h, EYE_HEIGHT_MIN_M, EYE_HEIGHT_MAX_M) * 100) / 100
}

/**
 * Relit des préférences enregistrées en refusant tout ce qui est hors limites :
 * une valeur absente ou abîmée reprend sa valeur par défaut, les autres sont gardées.
 */
export function sanitizePreferences(raw: unknown): ViewPreferences {
  const p = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
  const d = DEFAULT_PREFERENCES

  const focal = num(p.focalMm)
  const duration = num(p.durationMin)
  const stars = num(p.starCount)
  const eye = num(p.eyeHeight)
  return {
    focalMm: focal === undefined ? d.focalMm : clamp(focal, FOCAL_MIN_MM, FOCAL_MAX_MM),
    durationMin: duration === undefined ? d.durationMin : Math.round(clamp(duration, DURATION_MIN, DURATION_MAX)),
    orientation: p.orientation === 'portrait' || p.orientation === 'landscape' ? p.orientation : d.orientation,
    starCount:
      stars === undefined
        ? d.starCount
        : clamp(Math.round(stars / STAR_COUNT_STEP) * STAR_COUNT_STEP, STAR_COUNT_MIN, STAR_COUNT_MAX),
    radius: (SCENE_RADII_M as readonly number[]).includes(p.radius as number) ? (p.radius as SceneRadius) : d.radius,
    miniMapCollapsed: typeof p.miniMapCollapsed === 'boolean' ? p.miniMapCollapsed : d.miniMapCollapsed,
    eyeHeight: eye === undefined ? d.eyeHeight : clampEyeHeight(eye),
    showTrees: typeof p.showTrees === 'boolean' ? p.showTrees : d.showTrees
  }
}
