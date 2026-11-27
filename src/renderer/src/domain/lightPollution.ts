/**
 * Pollution lumineuse : de l'atlas de David Lorenz (2025, données satellite VIIRS) à ce que voit l'œil.
 *
 * L'atlas classe chaque point en 15 niveaux (zones 0, 1a, 1b … 7b). D'un niveau au suivant, la lumière
 * artificielle est multipliée par √3 ; la limite entre 3b et 4a correspond à une lumière artificielle
 * égale à la lumière naturelle du ciel (indice de pollution lumineuse LPI = 1).
 */

/** Brillance du ciel naturel au zénith, sans Lune (mag/arcsec²), valeur de référence de l'atlas. */
export const NATURAL_SKY_MAG = 22.0
export const LP_LEVELS = 15
export const LP_LEVEL_NAMES = ['0', '1a', '1b', '2a', '2b', '3a', '3b', '4a', '4b', '5a', '5b', '6a', '6b', '7a', '7b']

/** Indice de pollution lumineuse (artificielle / naturelle) au milieu du niveau k. */
export function levelToLpi(level: number): number {
  const k = Math.max(0, Math.min(LP_LEVELS - 1, Math.round(level)))
  return Math.pow(3, (k - 6.5) / 2)
}

/** Brillance du fond de ciel au zénith (mag/arcsec²) : plus le nombre est petit, plus le ciel est clair. */
export function skyBrightness(lpi: number): number {
  return NATURAL_SKY_MAG - 2.5 * Math.log10(1 + Math.max(0, lpi))
}

/**
 * Magnitude limite à l'œil nu au zénith, d'après la brillance du ciel (mag/arcsec²) :
 * relation usuelle NELM = 7,93 − 5 log10(10^(4,316 − SQM/5) + 1), qui donne environ 6,6 sous
 * un ciel naturel et 4 sous un ciel de banlieue (SQM 18).
 */
export function nakedEyeLimit(sqm: number): number {
  return 7.93 - 5 * Math.log10(Math.pow(10, 4.316 - sqm / 5) + 1)
}

/**
 * Force de la lueur à l'horizon (0 à 1) : nulle sous un ciel naturel, pleine en centre-ville.
 * Échelle logarithmique, comme la perception de la lumière.
 */
export function glowStrength(lpi: number): number {
  return Math.max(0, Math.min(1, Math.log10(1 + Math.max(0, lpi)) / 1.8))
}

export interface SkyQuality {
  level: number
  name: string
  lpi: number
  sqm: number
  limit: number
  glow: number
}

export function skyQuality(level: number): SkyQuality {
  const lpi = levelToLpi(level)
  const sqm = skyBrightness(lpi)
  return { level, name: LP_LEVEL_NAMES[level] ?? '?', lpi, sqm, limit: nakedEyeLimit(sqm), glow: glowStrength(lpi) }
}
