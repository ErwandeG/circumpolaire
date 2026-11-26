import { fallbackHeight, type Building, type Ring } from './geo/buildings'

/**
 * Bâtiments reconstruits « niveau 2 » : murs verticaux extrudés des emprises BD TOPO,
 * toits issus du LiDAR (MNS) découpés exactement au contour de l'emprise.
 *
 * Grille : sommets aux centres des pixels LiDAR (x = minX + (c + 0,5) × res, y = maxY − (r + 0,5) × res).
 * Les toits et les murs sont coupés aux mêmes lignes de grille, donc se raccordent sans fente.
 */
export interface Grid {
  minX: number
  maxY: number
  res: number
  cols: number
  rows: number
  values: Float32Array
}

export const BuildingPartKind = { Building: 1, Fallback: 3 } as const

/**
 * Largeur (en pixels de 0,5 m) de la bande de bord dont la valeur LiDAR est remplacée.
 * Emprise BD TOPO et LiDAR peuvent être décalés de 1 à 1,5 m : ces pixels voient la rue ou les arbres.
 * On essaie 1,5 m, puis 0,5 m pour les petits bâtiments.
 */
const EDGE_ERODE_TRIES_M = [1.5, 0.5] as const
/** Même bande exprimée en pixels selon le pas de la grille (0,5 m ou 1 m). */
const erodeTries = (res: number) => EDGE_ERODE_TRIES_M.map((m) => Math.max(1, Math.round(m / res)))
/** Un pixel d'emprise à moins de cette hauteur au-dessus du sol voit la rue, pas un toit. */
const MIN_ROOF_ABOVE_GROUND_M = 2.5
/** Passes de propagation des hauteurs de toit vers l'extérieur (pour l'interpolation au contour). */
const FILL_PASSES = 6
/** Les murs descendent un peu sous le sol pour ne laisser aucun jour. */
const WALL_FOOTING_M = 0.5
/** Au-delà de cette part de pixels sans LiDAR, le bâtiment est un volume BD TOPO de repli. */
const MAX_MISSING_SHARE = 0.5

export interface BuildingGeometry {
  positions: number[]
  kinds: number[]
  indices: number[]
  /** Hauteur de chaque sommet au-dessus du sol (m), pour l'éclairage. */
  elevations: number[]
  /** Arêtes à souligner (haut des murs, angles) : paires de points dans le repère de la scène. */
  lines: number[]
  /** Pixels couverts par des volumes de repli (sans LiDAR). */
  fallbackCells: number
  /** Pixels couverts par les emprises. */
  footprintCells: number
}

type ToScene = (x: number, y: number, h: number) => [number, number, number]

function median(values: number[]): number {
  if (values.length === 0) return Number.NaN
  const s = [...values].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

/** Segment du contour : [ax, ay, bx, by]. */
export type Edge = [number, number, number, number]

export function edgesOf(building: Building): Edge[] {
  const edges: Edge[] = []
  for (const poly of building.polygons)
    for (const ring of poly as Ring[])
      for (let i = 0; i + 1 < ring.length; i++) edges.push([ring[i][0], ring[i][1], ring[i + 1][0], ring[i + 1][1]])
  return edges
}

const EPS = 1e-9

/**
 * Partie d'une case [x0, x1] × [y0, y1] couverte par l'emprise, en triangles, de façon exacte.
 * Découpe en bandes verticales (aux sommets du contour et aux croisements des bords de la case),
 * puis règle pair-impair dans chaque bande : formes concaves et cours intérieures comprises.
 * Les sommets produits tombent sur les lignes de grille et les sommets du contour,
 * exactement là où les murs sont découpés.
 */
export function fillCell(edges: readonly Edge[], x0: number, y0: number, x1: number, y1: number): [number, number][][] {
  const xs = new Set<number>([x0, x1])
  const local: Edge[] = []
  for (const e of edges) {
    const [ax, ay, bx, by] = e
    if (Math.max(ax, bx) < x0 - EPS || Math.min(ax, bx) > x1 + EPS) continue
    local.push(e)
    for (const x of [ax, bx]) if (x > x0 + EPS && x < x1 - EPS) xs.add(x)
    // Croisements avec les bords haut et bas de la case.
    for (const yy of [y0, y1]) {
      if ((ay - yy) * (by - yy) < 0) {
        const x = ax + ((yy - ay) / (by - ay)) * (bx - ax)
        if (x > x0 + EPS && x < x1 - EPS) xs.add(x)
      }
    }
  }
  const cuts = [...xs].sort((a, b) => a - b)
  const triangles: [number, number][][] = []
  const yAt = (e: Edge, x: number) => e[1] + ((x - e[0]) / (e[2] - e[0])) * (e[3] - e[1])
  const clampY = (y: number) => Math.min(y1, Math.max(y0, y))

  for (let s = 0; s + 1 < cuts.length; s++) {
    const xa = cuts[s]
    const xb = cuts[s + 1]
    if (xb - xa < EPS) continue
    const xm = (xa + xb) / 2
    // Arêtes qui traversent toute la bande (les verticales la bordent sans la traverser).
    const spans = local
      .filter((e) => Math.abs(e[2] - e[0]) > EPS && Math.min(e[0], e[2]) <= xa + EPS && Math.max(e[0], e[2]) >= xb - EPS)
      .map((e) => ({ a: yAt(e, xa), b: yAt(e, xb), m: yAt(e, xm) }))
      .sort((p, q) => p.m - q.m)
    for (let k = 0; k + 1 < spans.length; k += 2) {
      const lo = spans[k]
      const hi = spans[k + 1]
      // Intervalle intérieur [lo, hi] ramené à la hauteur de la case.
      const la = clampY(lo.a)
      const lb = clampY(lo.b)
      const ha = clampY(hi.a)
      const hb = clampY(hi.b)
      if (ha - la < EPS && hb - lb < EPS) continue
      triangles.push([[xa, la], [xb, lb], [xb, hb]], [[xa, la], [xb, hb], [xa, ha]])
    }
  }
  return triangles.filter(([p, q, r]) => Math.abs((q[0] - p[0]) * (r[1] - p[1]) - (r[0] - p[0]) * (q[1] - p[1])) > EPS)
}

/**
 * Construit murs et toits des bâtiments touchés.
 * buildingAt : pour chaque pixel, l'indice du bâtiment qui le contient (−1 sinon).
 */
export function buildBuildingGeometry(
  touched: readonly Building[],
  buildingAt: Int32Array,
  mns: Grid,
  groundAltitude: (x: number, y: number) => number,
  toScene: ToScene
): BuildingGeometry {
  const out: BuildingGeometry = {
    positions: [],
    kinds: [],
    indices: [],
    elevations: [],
    lines: [],
    fallbackCells: 0,
    footprintCells: 0
  }
  const { cols, rows, res } = mns
  const vx = (c: number) => mns.minX + (c + 0.5) * res
  const vy = (r: number) => mns.maxY - (r + 0.5) * res

  const push = (x: number, y: number, h: number, kind: number, ground = groundAltitude(x, y)): number => {
    const [sx, sy, sz] = toScene(x, y, h)
    out.positions.push(sx, sy, sz)
    out.kinds.push(kind)
    out.elevations.push(Number.isNaN(ground) ? 0 : Math.max(0, h - ground))
    return out.kinds.length - 1
  }
  const line = (x0: number, y0: number, h0: number, x1: number, y1: number, h1: number) => {
    out.lines.push(...toScene(x0, y0, h0), ...toScene(x1, y1, h1))
  }

  touched.forEach((building, k) => {
    // Zone de travail : emprise du bâtiment + marge, bornée à la grille.
    let c0 = cols
    let c1 = -1
    let r0 = rows
    let r1 = -1
    for (const poly of building.polygons)
      for (const [x, y] of poly[0]) {
        c0 = Math.min(c0, Math.floor((x - mns.minX) / res - 0.5))
        c1 = Math.max(c1, Math.ceil((x - mns.minX) / res - 0.5))
        r0 = Math.min(r0, Math.floor((mns.maxY - y) / res - 0.5))
        r1 = Math.max(r1, Math.ceil((mns.maxY - y) / res - 0.5))
      }
    const tries = erodeTries(res)
    const m = FILL_PASSES + tries[0] + 1
    c0 = Math.max(0, c0 - m)
    r0 = Math.max(0, r0 - m)
    c1 = Math.min(cols - 1, c1 + m)
    r1 = Math.min(rows - 1, r1 + m)
    if (c1 < c0 || r1 < r0) return
    const w = c1 - c0 + 1
    const h = r1 - r0 + 1
    const at = (r: number, c: number) => (r - r0) * w + (c - c0)
    const isInside = (r: number, c: number) => buildingAt[r * cols + c] === k

    // 1. Hauteurs de toit : MNS dans l'emprise, bords mélangés écartés.
    const roof = new Float32Array(w * h).fill(Number.NaN)
    const trusted = new Uint8Array(w * h)
    const insideValues: number[] = []
    let insideCount = 0
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        if (!isInside(r, c)) continue
        insideCount++
        const v = mns.values[r * cols + c]
        if (!Number.isNaN(v)) {
          roof[at(r, c)] = v
          insideValues.push(v)
        }
      }
    out.footprintCells += insideCount
    const missingShare = insideCount ? 1 - insideValues.length / insideCount : 1
    const fallback = insideCount === 0 || missingShare > MAX_MISSING_SHARE
    let kind: number = BuildingPartKind.Building

    if (fallback) {
      // Pas de LiDAR : toit plat à la hauteur BD TOPO (ou étages × 3 m, ou 10 m).
      kind = BuildingPartKind.Fallback
      out.fallbackCells += insideCount
      const grounds: number[] = []
      for (const poly of building.polygons) for (const [x, y] of poly[0]) grounds.push(groundAltitude(x, y))
      const base = Math.min(...grounds.filter((g) => !Number.isNaN(g)))
      const top = (Number.isFinite(base) ? base : 0) + fallbackHeight(building).height
      roof.fill(top)
    } else {
      // Un pixel d'emprise presque au niveau du sol voit la rue (décalage, passage) : on l'écarte.
      for (let r = r0; r <= r1; r++)
        for (let c = c0; c <= c1; c++) {
          const i = at(r, c)
          if (Number.isNaN(roof[i])) continue
          const g = groundAltitude(vx(c), vy(r))
          if (!Number.isNaN(g) && roof[i] - g < MIN_ROOF_ABOVE_GROUND_M) roof[i] = Number.NaN
        }
      // Pixels de confiance : dans l'emprise, loin du bord (voisins tous dans l'emprise).
      const markDeep = (radius: number): boolean => {
        let any = false
        for (let r = r0; r <= r1; r++)
          for (let c = c0; c <= c1; c++) {
            const i = at(r, c)
            if (Number.isNaN(roof[i])) continue
            let deep = true
            for (let dr = -radius; dr <= radius && deep; dr++)
              for (let dc = -radius; dc <= radius && deep; dc++) {
                const rr = r + dr
                const cc = c + dc
                if (rr < 0 || cc < 0 || rr >= rows || cc >= cols || !isInside(rr, cc)) deep = false
              }
            if (deep) {
              trusted[i] = 1
              any = true
            }
          }
        return any
      }
      let erode = 0
      for (const radius of tries) {
        if (markDeep(radius)) {
          erode = radius
          break
        }
      }
      // Petit bâtiment sans pixel « profond » : on se fie à tous ses pixels.
      if (!trusted.some((t) => t === 1)) {
        for (let i = 0; i < roof.length; i++) if (!Number.isNaN(roof[i])) trusted[i] = 1
      }
      for (let i = 0; i < roof.length; i++) if (!trusted[i]) roof[i] = Number.NaN
      // Propagation : chaque pixel non fiable prend la moyenne de ses voisins fiables.
      for (let pass = 0; pass < FILL_PASSES + erode + 2; pass++) {
        const next = roof.slice()
        const nextTrusted = trusted.slice()
        let changed = false
        for (let r = r0; r <= r1; r++)
          for (let c = c0; c <= c1; c++) {
            const i = at(r, c)
            if (trusted[i]) continue
            let s = 0
            let n = 0
            for (let dr = -1; dr <= 1; dr++)
              for (let dc = -1; dc <= 1; dc++) {
                const rr = r + dr
                const cc = c + dc
                if (rr < r0 || cc < c0 || rr > r1 || cc > c1) continue
                const j = at(rr, cc)
                if (trusted[j]) {
                  s += roof[j]
                  n++
                }
              }
            if (n) {
              next[i] = s / n
              nextTrusted[i] = 1
              changed = true
            }
          }
        roof.set(next)
        trusted.set(nextTrusted)
        if (!changed) break
      }
      const med = median(insideValues)
      for (let i = 0; i < roof.length; i++) if (Number.isNaN(roof[i])) roof[i] = med
    }

    // Hauteur de toit en un point quelconque : bilinéaire sur les sommets de la zone.
    const roofAt = (x: number, y: number): number => {
      const fc = Math.max(c0, Math.min(c1, (x - mns.minX) / res - 0.5))
      const fr = Math.max(r0, Math.min(r1, (mns.maxY - y) / res - 0.5))
      const ca = Math.min(c1 - 1, Math.floor(fc))
      const ra = Math.min(r1 - 1, Math.floor(fr))
      if (ca < c0 || ra < r0) return roof[at(Math.round(fr), Math.round(fc))]
      const tx = fc - ca
      const ty = fr - ra
      const v00 = roof[at(ra, ca)]
      const v01 = roof[at(ra, ca + 1)]
      const v10 = roof[at(ra + 1, ca)]
      const v11 = roof[at(ra + 1, ca + 1)]
      return (v00 * (1 - tx) + v01 * tx) * (1 - ty) + (v10 * (1 - tx) + v11 * tx) * ty
    }

    // 2. Cases traversées par le contour : on les découpera exactement.
    const edges = edgesOf(building)
    const crossed = new Uint8Array(w * h)
    for (const poly of building.polygons)
      for (const ring of poly)
        for (let i = 0; i + 1 < ring.length; i++) {
          const [ax, ay] = ring[i]
          const [bx, by] = ring[i + 1]
          const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (res / 5)))
          for (let s = 0; s <= steps; s++) {
            const x = ax + ((bx - ax) * s) / steps
            const y = ay + ((by - ay) * s) / steps
            const qc = Math.floor((x - mns.minX) / res - 0.5)
            const qr = Math.floor((mns.maxY - y) / res - 0.5)
            if (qc >= c0 && qr >= r0 && qc < c1 && qr < r1) crossed[at(qr, qc)] = 1
          }
        }

    // 3. Toit : cases pleines en deux triangles (sommets partagés), cases de bord découpées.
    const shared = new Int32Array(w * h).fill(-1)
    const vertex = (r: number, c: number): number => {
      const i = at(r, c)
      if (shared[i] < 0) shared[i] = push(vx(c), vy(r), roof[i], kind)
      return shared[i]
    }
    for (let r = r0; r < r1; r++)
      for (let c = c0; c < c1; c++) {
        const corners = [isInside(r, c), isInside(r, c + 1), isInside(r + 1, c), isInside(r + 1, c + 1)]
        const anyInside = corners.some(Boolean)
        const cut = crossed[at(r, c)] === 1
        if (!cut && corners.every(Boolean)) {
          const a = vertex(r, c)
          const b = vertex(r, c + 1)
          const d = vertex(r + 1, c)
          const e = vertex(r + 1, c + 1)
          out.indices.push(a, d, b, b, d, e)
          continue
        }
        if (!cut && !anyInside) continue
        // Case de bord : partie exacte de la case couverte par l'emprise (cours comprises).
        for (const tri of fillCell(edges, vx(c), vy(r + 1), vx(c + 1), vy(r))) {
          for (const [x, y] of tri) out.indices.push(push(x, y, roofAt(x, y), kind))
        }
      }

    // 4. Murs : chaque arête du contour, coupée aux lignes de grille, extrudée du sol au toit.
    for (const poly of building.polygons)
      for (const ring of poly)
        for (let i = 0; i + 1 < ring.length; i++) {
          const [ax, ay] = ring[i]
          const [bx, by] = ring[i + 1]
          const ts = [0, 1]
          const cross = (p0: number, p1: number, origin: number, sign: number) => {
            // Lignes de grille (centres de pixels) traversées entre p0 et p1.
            const f0 = (sign * (p0 - origin)) / res - 0.5
            const f1 = (sign * (p1 - origin)) / res - 0.5
            const lo = Math.ceil(Math.min(f0, f1))
            const hi = Math.floor(Math.max(f0, f1))
            for (let g = lo; g <= hi; g++) {
              const t = (g - f0) / (f1 - f0)
              if (t > 1e-6 && t < 1 - 1e-6) ts.push(t)
            }
          }
          if (bx !== ax) cross(ax, bx, mns.minX, 1)
          if (by !== ay) cross(ay, by, mns.maxY, -1)
          ts.sort((p, q) => p - q)
          for (let s = 0; s + 1 < ts.length; s++) {
            const p = [ax + (bx - ax) * ts[s], ay + (by - ay) * ts[s]] as const
            const q = [ax + (bx - ax) * ts[s + 1], ay + (by - ay) * ts[s + 1]] as const
            const gp = groundAltitude(p[0], p[1])
            const gq = groundAltitude(q[0], q[1])
            const tp = roofAt(p[0], p[1])
            const tq = roofAt(q[0], q[1])
            const bp = (Number.isNaN(gp) ? tp - 10 : gp) - WALL_FOOTING_M
            const bq = (Number.isNaN(gq) ? tq - 10 : gq) - WALL_FOOTING_M
            if (tp <= bp && tq <= bq) continue
            const i0 = push(p[0], p[1], bp, kind, gp)
            const i1 = push(q[0], q[1], bq, kind, gq)
            const i2 = push(q[0], q[1], tq, kind, gq)
            const i3 = push(p[0], p[1], tp, kind, gp)
            out.indices.push(i0, i1, i2, i0, i2, i3)
            // Haut du mur : ligne de toit.
            line(p[0], p[1], tp, q[0], q[1], tq)
          }
          // Angle du bâtiment, s'il est marqué (changement de direction de plus de 20°).
          const prev = ring[i === 0 ? ring.length - 2 : i - 1]
          const d1x = ax - prev[0]
          const d1y = ay - prev[1]
          const d2x = bx - ax
          const d2y = by - ay
          const cos = (d1x * d2x + d1y * d2y) / (Math.hypot(d1x, d1y) * Math.hypot(d2x, d2y) || 1)
          if (cos < Math.cos((20 * Math.PI) / 180)) {
            const g = groundAltitude(ax, ay)
            const top = roofAt(ax, ay)
            if (!Number.isNaN(g) && top > g) line(ax, ay, g, ax, ay, top)
          }
        }
  })

  return out
}
