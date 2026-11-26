import { bbox, contains, distanceToBuilding, fallbackHeight, type Building } from './geo/buildings'
import { fromLambert93 } from './geo/lambert93'

/** Rayon de la scène autour de l'observateur (cahier des charges : 60 m, modifiable). */
export const SCENE_RADIUS_M = 60
/** Pas des modèles LiDAR HD. */
export const GRID_RES_M = 0.5
/** Côté maximal de la zone chargée, même si un bâtiment touché par le cercle est très grand. */
export const MAX_EXTENT_M = 240
export const EYE_HEIGHT_M = 1.7

/** Grille d'altitudes, ligne 0 = bord nord, colonne 0 = bord ouest (convention WMS). */
export interface ElevationGrid {
  minX: number
  maxY: number
  res: number
  cols: number
  rows: number
  /** Altitudes en mètres, NaN = pas de donnée. */
  values: Float32Array
}

export function cleanNoData(values: Float32Array): Float32Array {
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (!Number.isFinite(v) || v < -1000 || v > 9000) values[i] = Number.NaN
  }
  return values
}

/** Zone à charger : carré de 2 × rayon, élargi aux bâtiments touchés par le cercle, aligné sur la grille. */
export function sceneExtent(
  cx: number,
  cy: number,
  buildings: readonly Building[],
  radius = SCENE_RADIUS_M
): { minX: number; minY: number; maxX: number; maxY: number; touched: Building[] } {
  const touched = buildings.filter((b) => distanceToBuilding(b, cx, cy) <= radius)
  let minX = cx - radius
  let minY = cy - radius
  let maxX = cx + radius
  let maxY = cy + radius
  for (const b of touched) {
    const bb = bbox(b)
    minX = Math.min(minX, bb.minX)
    minY = Math.min(minY, bb.minY)
    maxX = Math.max(maxX, bb.maxX)
    maxY = Math.max(maxY, bb.maxY)
  }
  const half = MAX_EXTENT_M / 2
  minX = Math.max(minX, cx - half)
  minY = Math.max(minY, cy - half)
  maxX = Math.min(maxX, cx + half)
  maxY = Math.min(maxY, cy + half)
  const snap = (v: number, f: (n: number) => number) => f(v / GRID_RES_M) * GRID_RES_M
  return {
    minX: snap(minX, Math.floor),
    minY: snap(minY, Math.floor),
    maxX: snap(maxX, Math.ceil),
    maxY: snap(maxY, Math.ceil),
    touched
  }
}

function sample(g: ElevationGrid, x: number, y: number): number {
  // Bilinéaire sur les centres de pixels.
  const fx = (x - g.minX) / g.res - 0.5
  const fy = (g.maxY - y) / g.res - 0.5
  const c0 = Math.max(0, Math.min(g.cols - 1, Math.floor(fx)))
  const r0 = Math.max(0, Math.min(g.rows - 1, Math.floor(fy)))
  const c1 = Math.min(g.cols - 1, c0 + 1)
  const r1 = Math.min(g.rows - 1, r0 + 1)
  const tx = Math.max(0, Math.min(1, fx - c0))
  const ty = Math.max(0, Math.min(1, fy - r0))
  const v = (r: number, c: number) => g.values[r * g.cols + c]
  const vals = [v(r0, c0), v(r0, c1), v(r1, c0), v(r1, c1)]
  if (vals.some(Number.isNaN)) {
    const ok = vals.filter((x) => !Number.isNaN(x))
    return ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : Number.NaN
  }
  return (vals[0] * (1 - tx) + vals[1] * tx) * (1 - ty) + (vals[2] * (1 - tx) + vals[3] * tx) * ty
}

export function groundAltitude(mnt: ElevationGrid, x: number, y: number): number {
  return sample(mnt, x, y)
}

/** Nature d'un point de la surface, pour la couleur. */
export const SurfaceKind = {
  Ground: 0,
  Building: 1,
  Vegetation: 2,
  /** Volume BD TOPO de repli (pas de LiDAR à cet endroit). */
  Fallback: 3
} as const

export interface TerrainMesh {
  /** x = Est, y = haut (par rapport à l'œil), z = Sud, en mètres. */
  positions: Float32Array
  kinds: Uint8Array
  indices: Uint32Array
  /** Part de la zone sans LiDAR, couverte par BD TOPO (0 à 1). */
  fallbackShare: number
  eyeAltitude: number
}

/**
 * Construit la surface : MNS dans le cercle et dans les bâtiments qu'il touche, MNT ailleurs.
 * Les sommets passent de Lambert 93 au repère local par la projection inverse,
 * ce qui corrige la convergence des méridiens (le nord vrai, pas le nord du quadrillage).
 */
export function buildTerrain(
  observer: { x: number; y: number; lat: number; lon: number },
  mns: ElevationGrid,
  mnt: ElevationGrid,
  buildings: readonly Building[],
  radius = SCENE_RADIUS_M
): TerrainMesh {
  const cols = mns.cols
  const rows = mns.rows
  const ground0 = sample(mnt, observer.x, observer.y)
  const eyeAltitude = (Number.isNaN(ground0) ? sample(mns, observer.x, observer.y) : ground0) + EYE_HEIGHT_M
  const touched = buildings.filter((b) => distanceToBuilding(b, observer.x, observer.y) <= radius)

  const positions = new Float32Array(cols * rows * 3)
  const kinds = new Uint8Array(cols * rows)
  const groundRel = new Float32Array(cols * rows)
  const lat0 = (observer.lat * Math.PI) / 180
  const mPerDegLat = 111_132.954 - 559.822 * Math.cos(2 * lat0) + 1.175 * Math.cos(4 * lat0)
  const mPerDegLon = (Math.PI / 180) * 6_378_137 * Math.cos(lat0) / Math.sqrt(1 - 0.00669438 * Math.sin(lat0) ** 2)
  let fallbackCells = 0
  let maskedCells = 0

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      const x = mns.minX + (c + 0.5) * mns.res
      const y = mns.maxY - (r + 0.5) * mns.res
      const inCircle = Math.hypot(x - observer.x, y - observer.y) <= radius
      const building = touched.find((b) => contains(b, x, y))
      const masked = inCircle || building !== undefined
      let ground = mnt.values[i]
      if (Number.isNaN(ground)) ground = eyeAltitude - EYE_HEIGHT_M
      let h = ground
      let kind: number = SurfaceKind.Ground
      if (masked) {
        maskedCells++
        const s = mns.values[i]
        if (!Number.isNaN(s)) {
          h = s
          if (s - ground > 1.0) kind = building ? SurfaceKind.Building : SurfaceKind.Vegetation
        } else if (building) {
          h = ground + fallbackHeight(building).height
          kind = SurfaceKind.Fallback
          fallbackCells++
        } else {
          fallbackCells++
        }
      }
      const g = fromLambert93(x, y)
      positions[i * 3] = (g.lon - observer.lon) * mPerDegLon
      positions[i * 3 + 1] = h - eyeAltitude
      groundRel[i] = ground - eyeAltitude
      positions[i * 3 + 2] = -(g.lat - observer.lat) * mPerDegLat
      kinds[i] = kind
    }
  }

  return assembleMesh(positions, kinds, groundRel, cols, rows, fallbackCells, maskedCells, eyeAltitude)
}

/** Bas des cimes : 40 % de la hauteur de l'arbre, au plus 5 m au-dessus du sol. */
export function crownBottom(groundY: number, topY: number): number {
  const h = topY - groundY
  return groundY + Math.min(5, Math.max(0, 0.4 * h))
}

/**
 * Triangule la grille. Bâtiments et sol : surface pleine (murs compris).
 * Arbres : cimes flottantes (dessus, dessous, côtés) avec le sol en dessous,
 * pour qu'un observateur sous un arbre voie l'horizon et la cime au-dessus de lui.
 */
function assembleMesh(
  top: Float32Array,
  kinds: Uint8Array,
  groundRel: Float32Array,
  cols: number,
  rows: number,
  fallbackCells: number,
  maskedCells: number,
  eyeAltitude: number
): TerrainMesh {
  const n = cols * rows
  const isVeg = (i: number) => kinds[i] === SurfaceKind.Vegetation
  // Sommets supplémentaires des arbres : bas de cime et sol sous l'arbre.
  const extra = new Int32Array(n).fill(-1)
  let count = n
  for (let i = 0; i < n; i++) if (isVeg(i)) {
    extra[i] = count
    count += 2
  }
  const positions = new Float32Array(count * 3)
  positions.set(top)
  const outKinds = new Uint8Array(count)
  outKinds.set(kinds)
  for (let i = 0; i < n; i++) {
    const j = extra[i]
    if (j < 0) continue
    const x = top[i * 3]
    const z = top[i * 3 + 2]
    positions.set([x, crownBottom(groundRel[i], top[i * 3 + 1]), z], j * 3)
    outKinds[j] = SurfaceKind.Vegetation
    positions.set([x, groundRel[i], z], (j + 1) * 3)
    outKinds[j + 1] = SurfaceKind.Ground
  }
  const bottomOf = (i: number) => extra[i]
  const groundOf = (i: number) => (extra[i] >= 0 ? extra[i] + 1 : i)

  const idx: number[] = []
  const tri = (a: number, b: number, c: number) => {
    const va = isVeg(a)
    const vb = isVeg(b)
    const vc = isVeg(c)
    if (!va && !vb && !vc) {
      idx.push(a, b, c)
      return
    }
    // Sol sous les arbres.
    idx.push(groundOf(a), groundOf(b), groundOf(c))
    if (va && vb && vc) {
      idx.push(a, b, c) // dessus de la cime
      idx.push(bottomOf(a), bottomOf(c), bottomOf(b)) // dessous
      return
    }
    // Bord de cime : côtés entre dessus et dessous sur les arêtes arbre-arbre.
    for (const [p, q] of [[a, b], [b, c], [c, a]] as const) {
      if (isVeg(p) && isVeg(q)) idx.push(p, q, bottomOf(q), p, bottomOf(q), bottomOf(p))
    }
  }
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c
      const b = a + 1
      const d = a + cols
      const e = d + 1
      tri(a, d, b)
      tri(b, d, e)
    }
  }

  return {
    positions,
    kinds: outKinds,
    indices: Uint32Array.from(idx),
    fallbackShare: maskedCells ? fallbackCells / maskedCells : 0,
    eyeAltitude
  }
}
