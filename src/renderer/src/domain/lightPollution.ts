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

/**
 * Type de ciel en langage courant pour chaque niveau de l'atlas (0 à 14), du plus noir au plus clair.
 * Repères approximatifs, à la manière de l'échelle de Bortle.
 */
export const SKY_CLASS_NAMES = [
  'Ciel noir parfait',
  'Ciel noir',
  'Ciel noir',
  'Campagne',
  'Campagne',
  'Campagne éclairée',
  'Campagne éclairée',
  'Périurbain',
  'Périurbain',
  'Banlieue',
  'Banlieue',
  'Ville',
  'Ville',
  'Centre-ville',
  'Centre-ville'
]

/** « Ville (6b) » : type de ciel et zone de l'atlas. */
export function skyClassLabel(level: number): string {
  const k = Math.max(0, Math.min(LP_LEVELS - 1, Math.round(level)))
  return `${SKY_CLASS_NAMES[k]} (${LP_LEVEL_NAMES[k]})`
}

export interface SkyQuality {
  level: number
  name: string
  lpi: number
  sqm: number
  limit: number
  glow: number
}

/** Ciel naturel, sans pollution lumineuse : 22 mag/arcsec², aucune lueur. */
export function naturalSky(): SkyQuality {
  return { level: -1, name: 'aucune', lpi: 0, sqm: NATURAL_SKY_MAG, limit: nakedEyeLimit(NATURAL_SKY_MAG), glow: 0 }
}

export function skyQuality(level: number): SkyQuality {
  const lpi = levelToLpi(level)
  const sqm = skyBrightness(lpi)
  return { level, name: LP_LEVEL_NAMES[level] ?? '?', lpi, sqm, limit: nakedEyeLimit(sqm), glow: glowStrength(lpi) }
}

// --- Filés photographiés ---
//
// Un filé ne s'accumule pas sur le capteur : l'étoile ne reste qu'un instant sur chaque pixel, alors que
// le fond de ciel, lui, s'accumule pendant toute la pose. Ce qui décide si un filé se voit, c'est le
// contraste entre sa brillance de surface (l'éclat de l'étoile étalé sur la largeur du trait et sur
// la vitesse apparente) et celle du ciel. L'ouverture éclaire autant les deux : elle ne compte pas.

/** Traitement de l'image finale : seuil de contraste à partir duquel un filé ressort du fond. */
export type Processing = 'raw' | 'standard' | 'pushed'
export const PROCESSINGS: readonly Processing[] = ['raw', 'standard', 'pushed']
export const PROCESSING_LABELS: Record<Processing, string> = { raw: 'aucun', standard: 'léger', pushed: 'avancé' }

/** Ce que recouvre chaque niveau de post-traitement, en langage courant (aide sous les boutons). */
export const PROCESSING_HELP: Record<Processing, string> = {
  raw: 'Photo telle qu’elle sort de l’appareil, sans retouche.',
  standard: 'Empilement des images et réglage des courbes, comme dans un logiciel de retouche courant.',
  pushed: 'Soustraction du fond de ciel et étirement fort : les filés les plus faibles ressortent.'
}

/**
 * Marge de contraste (magnitudes) selon le traitement : brut (image telle quelle), standard
 * (empilement et courbes usuelles), poussé (soustraction du fond, étirement fort). Calée pour qu'à
 * Strasbourg (18,7 mag/arcsec²), au 24 mm plein format, un filé à mi-hauteur de déclinaison
 * ressorte jusqu'à la magnitude ≈ 4,5 / 5,5 / 6,5.
 */
export const PROCESSING_MARGIN: Record<Processing, number> = { raw: -6.4, standard: -5.4, pushed: -4.4 }

/** Vitesse apparente d'une étoile sur l'équateur céleste (secondes d'arc par seconde). */
export const SIDEREAL_ARCSEC_PER_S = 15.041

/**
 * Largeur d'un filé sur l'image (secondes d'arc) : environ 2,5 pixels d'un capteur de 6 000 pixels de
 * large (≈ 24 Mpx), au moins 20″ (turbulence de l'air, mise au point).
 */
export function trailWidthArcsec(focalMm: number, sensorWidthMm: number): number {
  const pitchMm = sensorWidthMm / 6000
  return Math.max(20, ((2.5 * pitchMm) / focalMm) * 206_265)
}

/**
 * Magnitude la plus faible dont le filé ressort du fond de ciel, pour une étoile de déclinaison donnée :
 * m < SQM − 2,5 log10(largeur × vitesse) + marge. Près du pôle, l'étoile avance lentement : son filé
 * est plus concentré et ressort mieux.
 */
export function trailLimit(sqm: number, decDeg: number, widthArcsec: number, processing: Processing): number {
  const speed = SIDEREAL_ARCSEC_PER_S * Math.max(0.01, Math.cos((decDeg * Math.PI) / 180))
  return sqm - 2.5 * Math.log10(widthArcsec * speed) + PROCESSING_MARGIN[processing]
}
