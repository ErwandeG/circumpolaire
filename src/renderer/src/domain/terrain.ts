import { buildBuildingGeometry } from './buildings3d'
import { bbox, contains, distanceToBuilding, type Building } from './geo/buildings'
import { fromLambert93, toLambert93 } from './geo/lambert93'
import { localFrame, toLocal, type LocalFrame } from './geo/local'

/** Rayons proposés pour les volumes 3D autour de l'observateur. */
export const SCENE_RADII_M = [50, 150, 500] as const
export type SceneRadius = (typeof SCENE_RADII_M)[number]
export const SCENE_RADIUS_M: SceneRadius = 50
/** Pas des modèles LiDAR HD. */
export const GRID_RES_M = 0.5

/**
 * Pas de grille selon le rayon : 0,5 m (pas natif du LiDAR HD) jusqu'à 150 m,
 * 1 m à 500 m pour garder un maillage affichable (~1,2 million de pixels au lieu de 5).
 */
export function gridResFor(radius: number): number {
  return radius > 200 ? 1 : GRID_RES_M
}
export const EYE_HEIGHT_M = 1.7
/** Hauteur d'œil réglable, du ras du sol à un point haut (toit, colline). */
export const EYE_HEIGHT_MIN_M = 0.2
export const EYE_HEIGHT_MAX_M = 100
/** Au-delà de cette hauteur au-dessus du sol, hors emprise de bâtiment : végétation. */
const VEGETATION_MIN_M = 1

export interface TerrainOptions {
  /** Arbres affichés (par défaut) ou ramenés au niveau du sol. */
  trees?: boolean
  /**
   * Bâtiments HD (maquette 3D LoD2) : là où ils existent, ils remplacent les bâtiments
   * reconstruits (murs BD TOPO et toits LiDAR).
   */
  hd?: HdBuildings
}

/** Bâtiments HD en Lambert 93, relatifs à un point d'ancrage (voir services/hdService). */
export interface HdBuildings {
  anchorX: number
  anchorY: number
  /** Triangles [x − anchorX, y − anchorY, altitude] à la suite. */
  triangles: Float32Array
  covers(x: number, y: number): boolean
}

/** Côté maximal de la zone chargée : le cercle plus 60 m de marge pour les bâtiments qu'il touche. */
export function maxExtent(radius: number): number {
  return 2 * radius + 120
}

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
  radius: number = SCENE_RADIUS_M
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
  const half = maxExtent(radius) / 2
  minX = Math.max(minX, cx - half)
  minY = Math.max(minY, cy - half)
  maxX = Math.min(maxX, cx + half)
  maxY = Math.min(maxY, cy + half)
  const res = gridResFor(radius)
  const snap = (v: number, f: (n: number) => number) => f(v / res) * res
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
  /** Hauteur de chaque sommet au-dessus du sol (m) : lueur de l'éclairage public, ombres de contact. */
  elevation: Float32Array
  /** Assombrissement par sommet (1 = aucun) : sol au pied des bâtiments. */
  contact: Float32Array
  /** Arêtes des bâtiments à souligner : paires de points (x, y, z). */
  outline: Float32Array
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
  radius: number = SCENE_RADIUS_M,
  options: TerrainOptions = {}
): TerrainMesh {
  const showTrees = options.trees !== false
  const cols = mns.cols
  const rows = mns.rows
  const ground0 = sample(mnt, observer.x, observer.y)
  const eyeAltitude = (Number.isNaN(ground0) ? sample(mns, observer.x, observer.y) : ground0) + EYE_HEIGHT_M
  const touched = buildings.filter((b) => distanceToBuilding(b, observer.x, observer.y) <= radius)
  // Bâtiments couverts par la maquette HD : leur emprise reste au sol (MNT), sans murs ni toit LiDAR.
  const hd = options.hd
  const replaced = touched.map((b) => {
    if (!hd) return false
    const bb = bbox(b)
    return hd.covers((bb.minX + bb.maxX) / 2, (bb.minY + bb.maxY) / 2)
  })

  const positions = new Float32Array(cols * rows * 3)
  const kinds = new Uint8Array(cols * rows)
  const groundRel = new Float32Array(cols * rows)
  const frame = localFrame(observer.lat, observer.lon)
  let fallbackCells = 0
  let maskedCells = 0

  // Index des bâtiments par cellule, calculé une fois sur l'emprise de chacun :
  // indispensable à 150 m (jusqu'à ~700 000 cellules).
  const buildingAt = new Int32Array(cols * rows).fill(-1)
  touched.forEach((b, k) => {
    const bb = bbox(b)
    const c0 = Math.max(0, Math.floor((bb.minX - mns.minX) / mns.res))
    const c1 = Math.min(cols - 1, Math.ceil((bb.maxX - mns.minX) / mns.res))
    const r0 = Math.max(0, Math.floor((mns.maxY - bb.maxY) / mns.res))
    const r1 = Math.min(rows - 1, Math.ceil((mns.maxY - bb.minY) / mns.res))
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        const x = mns.minX + (c + 0.5) * mns.res
        const y = mns.maxY - (r + 0.5) * mns.res
        if (buildingAt[r * cols + c] < 0 && contains(b, x, y)) buildingAt[r * cols + c] = k
      }
  })

  // Abords des bâtiments (1 m) : débords de toit et décalages entre LiDAR et emprise.
  // Le sol y reste au niveau du MNT, sinon ces pixels deviendraient de faux arbres collés aux façades.
  const NEAR_CELLS = Math.max(1, Math.round(1 / mns.res))
  const nearBuilding = new Uint8Array(cols * rows)
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      if (buildingAt[r * cols + c] < 0) continue
      for (let dr = -NEAR_CELLS; dr <= NEAR_CELLS; dr++)
        for (let dc = -NEAR_CELLS; dc <= NEAR_CELLS; dc++) {
          const rr = r + dr
          const cc = c + dc
          if (rr >= 0 && cc >= 0 && rr < rows && cc < cols) nearBuilding[rr * cols + cc] = 1
        }
    }

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      const x = mns.minX + (c + 0.5) * mns.res
      const y = mns.maxY - (r + 0.5) * mns.res
      const inCircle = Math.hypot(x - observer.x, y - observer.y) <= radius
      const inBuilding = buildingAt[i] >= 0
      let ground = mnt.values[i]
      if (Number.isNaN(ground)) ground = eyeAltitude - EYE_HEIGHT_M
      let h = ground
      let kind: number = SurfaceKind.Ground
      // Dans les emprises, le sol passe sous le bâtiment reconstruit à part.
      if (inCircle && !inBuilding) {
        maskedCells++
        const s = mns.values[i]
        if (Number.isNaN(s)) {
          fallbackCells++
        } else if (!nearBuilding[i]) {
          if (s - ground <= VEGETATION_MIN_M) h = s
          // Ce qui dépasse du sol hors des emprises : surtout des arbres (aussi kiosques, abribus…).
          else if (showTrees) {
            h = s
            kind = SurfaceKind.Vegetation
          }
        }
      }
      const g = fromLambert93(x, y)
      const local = toLocal(frame, g.lat, g.lon)
      positions[i * 3] = local.e
      positions[i * 3 + 1] = h - eyeAltitude
      groundRel[i] = ground - eyeAltitude
      positions[i * 3 + 2] = -local.n
      kinds[i] = kind
    }
  }

  const ground = assembleMesh(positions, kinds, groundRel, cols, rows, 0, 0, eyeAltitude)

  // Bâtiments reconstruits : murs verticaux des emprises BD TOPO, toits LiDAR.
  const toScene = (x: number, y: number, h: number): [number, number, number] => {
    const g = fromLambert93(x, y)
    const local = toLocal(frame, g.lat, g.lon)
    return [local.e, h - eyeAltitude, -local.n]
  }
  const groundAltitude = (x: number, y: number) => sample(mnt, x, y)
  const kept: Building[] = []
  const keptIndex = touched.map((b, k) => (replaced[k] ? -1 : kept.push(b) - 1))
  const buildingAtKept = buildingAt.map((k) => (k >= 0 ? keptIndex[k] : -1))
  const bld = buildBuildingGeometry(kept, buildingAtKept, mns, groundAltitude, toScene)
  const hdMesh = hd ? hdGeometry(hd, observer, radius, toScene, groundAltitude) : null
  if (hdMesh) {
    // Les triangles HD s'ajoutent aux bâtiments reconstruits restants (hors maquette).
    const n0 = bld.kinds.length
    for (let i = 0; i < hdMesh.count; i++) {
      bld.positions.push(hdMesh.positions[i * 3], hdMesh.positions[i * 3 + 1], hdMesh.positions[i * 3 + 2])
      bld.kinds.push(SurfaceKind.Building)
      bld.elevations.push(hdMesh.elevations[i])
      bld.indices.push(n0 + i)
    }
  }

  // Assemblage sol + bâtiments dans un seul maillage.
  const nGround = ground.kinds.length
  const allPositions = new Float32Array(ground.positions.length + bld.positions.length)
  allPositions.set(ground.positions)
  allPositions.set(bld.positions, ground.positions.length)
  const allKinds = new Uint8Array(nGround + bld.kinds.length)
  allKinds.set(ground.kinds)
  allKinds.set(bld.kinds, nGround)
  const allIndices = new Uint32Array(ground.indices.length + bld.indices.length)
  allIndices.set(ground.indices)
  for (let i = 0; i < bld.indices.length; i++) allIndices[ground.indices.length + i] = bld.indices[i] + nGround

  const elevation = new Float32Array(nGround + bld.kinds.length)
  elevation.set(ground.elevation)
  elevation.set(bld.elevations, nGround)
  // Ombre de contact : le sol s'assombrit au pied des bâtiments.
  const contact = new Float32Array(nGround + bld.kinds.length).fill(1)
  for (let i = 0; i < cols * rows; i++) if (nearBuilding[i]) contact[i] = 0.72

  const total = maskedCells + bld.footprintCells
  return {
    positions: allPositions,
    kinds: allKinds,
    indices: allIndices,
    elevation,
    contact,
    outline: Float32Array.from(bld.lines),
    fallbackShare: total ? (fallbackCells + bld.fallbackCells) / total : 0,
    eyeAltitude
  }
}

/**
 * Ce qu'il faut pour marcher dans une scène chargée : sol (MNT) et emprises de bâtiments.
 * Origine du repère = point d'où la scène a été chargée.
 */
export interface WalkContext {
  frame: LocalFrame
  eyeAltitude: number
  mnt: ElevationGrid
  /** Surface (toits) : au-dessus d'un toit, on peut passer au-dessus du bâtiment. */
  mns: ElevationGrid
  buildings: readonly Building[]
}

/** Altitude du sol (m) en un point, NaN hors de la zone chargée ou sans donnée. */
export function groundAt(ctx: WalkContext, lat: number, lon: number): number {
  const p = toLambert93(lat, lon)
  const g = ctx.mnt
  const inside =
    p.x >= g.minX && p.x <= g.minX + g.cols * g.res && p.y <= g.maxY && p.y >= g.maxY - g.rows * g.res
  return inside ? sample(g, p.x, p.y) : Number.NaN
}

/**
 * Vrai si l'œil entrerait dans un bâtiment : on ne traverse pas les façades.
 * Un œil placé plus haut que le toit (au moins 0,5 m au-dessus) passe au-dessus du bâtiment.
 */
export function isBlocked(ctx: WalkContext, lat: number, lon: number, eyeHeight: number = EYE_HEIGHT_M): boolean {
  const p = toLambert93(lat, lon)
  if (!ctx.buildings.some((b) => contains(b, p.x, p.y))) return false
  const ground = groundAt(ctx, lat, lon)
  const roof = sample(ctx.mns, p.x, p.y)
  if (Number.isNaN(ground) || Number.isNaN(roof)) return true
  return ground + eyeHeight < roof + 0.5
}

/**
 * Position de l'œil dans le repère de la scène (x = Est, y = haut, z = Sud),
 * à la hauteur d'œil choisie au-dessus du sol du point où l'on se trouve.
 */
export function eyePosition(
  ctx: WalkContext,
  lat: number,
  lon: number,
  lastGround: number,
  eyeHeight: number = EYE_HEIGHT_M
): { x: number; y: number; z: number; ground: number } {
  const local = toLocal(ctx.frame, lat, lon)
  const g = groundAt(ctx, lat, lon)
  const ground = Number.isNaN(g) ? lastGround : g
  return { x: local.e, y: ground + eyeHeight - ctx.eyeAltitude, z: -local.n, ground }
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
  const elevation = new Float32Array(count)
  for (let i = 0; i < n; i++) elevation[i] = Math.max(0, top[i * 3 + 1] - groundRel[i])
  for (let i = 0; i < n; i++) {
    const j = extra[i]
    if (j < 0) continue
    const x = top[i * 3]
    const z = top[i * 3 + 2]
    const bottom = crownBottom(groundRel[i], top[i * 3 + 1])
    positions.set([x, bottom, z], j * 3)
    outKinds[j] = SurfaceKind.Vegetation
    elevation[j] = bottom - groundRel[i]
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
    elevation,
    contact: new Float32Array(count).fill(1),
    outline: new Float32Array(0),
    fallbackShare: maskedCells ? fallbackCells / maskedCells : 0,
    eyeAltitude
  }
}

/**
 * Triangles HD dans le repère de la scène, limités au cercle (plus 60 m pour les bâtiments qu'il touche).
 * Passage Lambert 93 → scène par une transformation affine autour de l'observateur (écart de quelques mm à 500 m).
 */
function hdGeometry(
  hd: HdBuildings,
  observer: { x: number; y: number },
  radius: number,
  toScene: (x: number, y: number, h: number) => [number, number, number],
  groundAltitude: (x: number, y: number) => number
): { positions: Float32Array; kinds: Uint8Array; elevations: Float32Array; count: number } {
  const o = toScene(observer.x, observer.y, 0)
  const ex = toScene(observer.x + 100, observer.y, 0)
  const ey = toScene(observer.x, observer.y + 100, 0)
  const reach = radius + 60
  const t = hd.triangles
  const positions: number[] = []
  const elevations: number[] = []
  for (let i = 0; i < t.length; i += 9) {
    const cx = hd.anchorX + (t[i] + t[i + 3] + t[i + 6]) / 3
    const cy = hd.anchorY + (t[i + 1] + t[i + 4] + t[i + 7]) / 3
    if (Math.hypot(cx - observer.x, cy - observer.y) > reach) continue
    const ground = groundAltitude(cx, cy)
    for (let k = i; k < i + 9; k += 3) {
      const dx = (hd.anchorX + t[k] - observer.x) / 100
      const dy = (hd.anchorY + t[k + 1] - observer.y) / 100
      const [, y0] = toScene(observer.x, observer.y, t[k + 2])
      positions.push(o[0] + dx * (ex[0] - o[0]) + dy * (ey[0] - o[0]), y0, o[2] + dx * (ex[2] - o[2]) + dy * (ey[2] - o[2]))
      elevations.push(Number.isNaN(ground) ? 10 : Math.max(0, t[k + 2] - ground))
    }
  }
  const count = positions.length / 3
  return {
    positions: Float32Array.from(positions),
    kinds: new Uint8Array(count).fill(SurfaceKind.Building),
    elevations: Float32Array.from(elevations),
    count
  }
}
