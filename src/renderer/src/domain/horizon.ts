/**
 * Relief lointain : profil d'horizon et lignes de crête vus depuis l'observateur.
 *
 * On lance un rayon par direction (0,1° par défaut) et on lit l'altitude du terrain à distance
 * croissante. L'angle sous lequel on voit chaque point tient compte de la rotondité de la Terre
 * et de la réfraction terrestre. La crête principale est l'angle maximal ; les crêtes
 * intermédiaires sont les sommets visibles suivis d'un creux (une vallée derrière).
 */
export interface ReliefGrid {
  minX: number
  maxY: number
  res: number
  cols: number
  rows: number
  /** Altitudes (m), NaN = pas de donnée. */
  values: Float32Array
}

export interface HorizonParams {
  /** Grilles de la plus fine à la plus grossière ; la première qui couvre le point est utilisée. */
  grids: ReliefGrid[]
  /** Position de l'observateur en Lambert 93. */
  x: number
  y: number
  /** Altitude de l'œil (m). */
  eyeAltitude: number
  /** Angle (rad) du nord vrai dans le quadrillage Lambert : correction de la convergence des méridiens. */
  gridNorth: number
  minDistance: number
  maxDistance: number
  /** Nombre de directions sur 360°. */
  azimuths?: number
}

export interface HorizonProfile {
  azimuths: number
  /** Hauteur angulaire de la crête principale (degrés), par direction. NaN = pas de relief. */
  skyline: Float32Array
  /** Distance de la crête principale (m). */
  skylineDistance: Float32Array
  /** Crêtes intermédiaires : [direction, hauteur angulaire (°), distance (m)] à la suite. */
  ridges: Float32Array
}

const EARTH_RADIUS_M = 6_371_000
/** Coefficient de réfraction terrestre usuel : la lumière suit une courbe qui « relève » l'horizon. */
const REFRACTION_K = 0.13
/** Une crête intermédiaire n'est retenue que si le terrain replonge d'au moins cet angle derrière elle. */
const RIDGE_DIP_DEG = 0.25
const MAX_RIDGES_PER_RAY = 8
const DEG = Math.PI / 180

/** Abaissement apparent d'un point à distance d (rotondité moins réfraction), en mètres. */
export function curvatureDrop(d: number): number {
  return ((d * d) / (2 * EARTH_RADIUS_M)) * (1 - REFRACTION_K)
}

function sampleGrid(g: ReliefGrid, x: number, y: number): number {
  const fx = (x - g.minX) / g.res - 0.5
  const fy = (g.maxY - y) / g.res - 0.5
  if (fx < 0 || fy < 0 || fx > g.cols - 1 || fy > g.rows - 1) return Number.NaN
  const c0 = Math.floor(fx)
  const r0 = Math.floor(fy)
  const c1 = Math.min(g.cols - 1, c0 + 1)
  const r1 = Math.min(g.rows - 1, r0 + 1)
  const tx = fx - c0
  const ty = fy - r0
  const v = g.values
  const a = v[r0 * g.cols + c0]
  const b = v[r0 * g.cols + c1]
  const c = v[r1 * g.cols + c0]
  const d = v[r1 * g.cols + c1]
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty
}

/** Altitude en un point : la grille la plus fine qui a une valeur. */
export function reliefAt(grids: readonly ReliefGrid[], x: number, y: number): { h: number; res: number } {
  for (const g of grids) {
    const h = sampleGrid(g, x, y)
    if (!Number.isNaN(h)) return { h, res: g.res }
  }
  return { h: Number.NaN, res: grids.at(-1)?.res ?? 50 }
}

export function computeHorizon(p: HorizonParams): HorizonProfile {
  const n = p.azimuths ?? 3600
  const skyline = new Float32Array(n).fill(Number.NaN)
  const skylineDistance = new Float32Array(n).fill(Number.NaN)
  const ridges: number[] = []

  for (let i = 0; i < n; i++) {
    const az = (i / n) * 2 * Math.PI + p.gridNorth
    const dx = Math.sin(az)
    const dy = Math.cos(az)
    let best = -Infinity
    let bestD = Number.NaN
    let prev = -Infinity
    let prevD = 0
    let rising = false
    // Crête candidate : sommet visible, en attente de savoir si le terrain replonge derrière.
    let cand: { ang: number; d: number } | null = null
    let dipMin = Infinity
    const rayRidges: { ang: number; d: number }[] = []

    let d = p.minDistance
    while (d <= p.maxDistance) {
      const { h, res } = reliefAt(p.grids, p.x + dx * d, p.y + dy * d)
      // Pas qui grandit avec la distance : ~1 700 échantillons par direction jusqu'à 200 km.
      const step = Math.max(res * 0.8, d * 0.004)
      if (!Number.isNaN(h)) {
        const ang = Math.atan2(h - curvatureDrop(d) - p.eyeAltitude, d) / DEG
        if (cand) dipMin = Math.min(dipMin, ang)
        if (ang < prev && rising && prev >= best - 1e-9) {
          // On vient de passer un sommet visible : il devient candidat.
          if (cand && cand.ang - dipMin >= RIDGE_DIP_DEG) rayRidges.push(cand)
          cand = { ang: prev, d: prevD }
          dipMin = ang
        }
        if (cand && ang > cand.ang) {
          // Le terrain remonte plus haut que le candidat : on décide pour ce dernier.
          if (cand.ang - dipMin >= RIDGE_DIP_DEG) rayRidges.push(cand)
          cand = null
          dipMin = Infinity
        }
        rising = ang >= prev
        if (ang > best) {
          best = ang
          bestD = d
        }
        prev = ang
        prevD = d
      }
      d += step
    }
    if (best > -Infinity) {
      skyline[i] = best
      skylineDistance[i] = bestD
    }
    // Les crêtes intermédiaires ne doublent pas la crête principale.
    const kept = rayRidges.filter((r) => Math.abs(r.d - bestD) > Math.max(50, bestD * 0.02))
    for (const r of kept.slice(-MAX_RIDGES_PER_RAY)) ridges.push(i, r.ang, r.d)
  }
  return { azimuths: n, skyline, skylineDistance, ridges: Float32Array.from(ridges) }
}

/**
 * Relie les crêtes de directions voisines quand elles sont à une distance proche :
 * segments [direction1, angle1, direction2, angle2, distance] prêts à dessiner.
 */
export function ridgeSegments(profile: HorizonProfile): Float32Array {
  const byAz = new Map<number, { ang: number; d: number }[]>()
  const r = profile.ridges
  for (let k = 0; k < r.length; k += 3) {
    const list = byAz.get(r[k]) ?? []
    list.push({ ang: r[k + 1], d: r[k + 2] })
    byAz.set(r[k], list)
  }
  const out: number[] = []
  const n = profile.azimuths
  for (const [az, list] of byAz) {
    const next = byAz.get((az + 1) % n)
    if (!next) continue
    for (const a of list) {
      let best: { ang: number; d: number } | null = null
      for (const b of next) {
        const close = Math.abs(a.d - b.d) < Math.max(80, a.d * 0.08) && Math.abs(a.ang - b.ang) < 0.6
        if (close && (!best || Math.abs(a.d - b.d) < Math.abs(a.d - best.d))) best = b
      }
      if (best) out.push(az, a.ang, az + 1, best.ang, (a.d + best.d) / 2)
    }
  }
  return Float32Array.from(out)
}
