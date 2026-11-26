/** Emprises de bâtiments en Lambert 93 (mètres). */
export type Ring = [number, number][]

export interface Building {
  /** Polygones : premier anneau = contour extérieur, suivants = trous (cours intérieures). */
  polygons: Ring[][]
  /** Hauteur BD TOPO en mètres, si connue. */
  height?: number
  floors?: number
}

/** Hauteur de repli : BD TOPO, sinon étages × 3 m, sinon 10 m. */
export function fallbackHeight(b: Building): { height: number; estimated: boolean } {
  if (b.height !== undefined && b.height > 0) return { height: b.height, estimated: false }
  if (b.floors !== undefined && b.floors > 0) return { height: b.floors * 3, estimated: true }
  return { height: 10, estimated: true }
}

function inRing(x: number, y: number, ring: Ring): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Vrai si le point est dans le bâtiment (une cour intérieure compte comme extérieur). */
export function contains(b: Building, x: number, y: number): boolean {
  return b.polygons.some(([outer, ...holes]) => inRing(x, y, outer) && !holes.some((h) => inRing(x, y, h)))
}

export function bbox(b: Building): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const poly of b.polygons)
    for (const [x, y] of poly[0]) {
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  return { minX, minY, maxX, maxY }
}

function closestOnSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): [number, number] {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
  return [ax + t * dx, ay + t * dy]
}

/** Distance minimale d'un point au contour d'un bâtiment (m). */
export function distanceToBuilding(b: Building, x: number, y: number): number {
  let best = Infinity
  for (const poly of b.polygons)
    for (const ring of poly)
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [cx, cy] = closestOnSegment(x, y, ring[j][0], ring[j][1], ring[i][0], ring[i][1])
        best = Math.min(best, Math.hypot(cx - x, cy - y))
      }
  return contains(b, x, y) ? 0 : best
}

export interface Relocation {
  x: number
  y: number
  /** Distance parcourue pour sortir du bâtiment, 0 si le point était déjà dehors. */
  moved: number
}

/**
 * Sort l'observateur d'un bâtiment : point extérieur le plus proche, avec 0,5 m de marge.
 * Les bâtiments mitoyens sont pris ensemble : le point retenu ne doit tomber dans aucun d'eux.
 */
export function moveOutside(buildings: readonly Building[], x: number, y: number, margin = 0.5): Relocation {
  const inside = (px: number, py: number) => buildings.some((b) => contains(b, px, py))
  if (!inside(x, y)) return { x, y, moved: 0 }

  const candidates: { cx: number; cy: number; nx: number; ny: number; d: number }[] = []
  for (const b of buildings)
    for (const poly of b.polygons)
      for (const ring of poly)
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const [ax, ay] = ring[j]
          const [bx, by] = ring[i]
          const [cx, cy] = closestOnSegment(x, y, ax, ay, bx, by)
          const d = Math.hypot(cx - x, cy - y)
          // Direction de sortie : du point vers le contour, ou normale de l'arête si on est dessus.
          let nx = cx - x
          let ny = cy - y
          if (d < 1e-6) {
            const len = Math.hypot(bx - ax, by - ay) || 1
            nx = (by - ay) / len
            ny = -(bx - ax) / len
          } else {
            nx /= d
            ny /= d
          }
          candidates.push({ cx, cy, nx, ny, d })
        }
  candidates.sort((a, b) => a.d - b.d)
  for (const c of candidates) {
    for (const sign of [1, -1]) {
      const px = c.cx + sign * c.nx * margin
      const py = c.cy + sign * c.ny * margin
      if (!inside(px, py)) return { x: px, y: py, moved: Math.hypot(px - x, py - y) }
    }
  }
  return { x, y, moved: 0 }
}

/** Lit une réponse GeoJSON BD TOPO (EPSG:2154) en bâtiments. */
export function parseBuildings(geojson: unknown): Building[] {
  const features = (geojson as { features?: unknown[] })?.features
  if (!Array.isArray(features)) return []
  const out: Building[] = []
  for (const f of features as { geometry?: { type?: string; coordinates?: unknown }; properties?: Record<string, unknown> }[]) {
    const g = f.geometry
    if (!g || !Array.isArray(g.coordinates)) continue
    const raw = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []
    const polygons: Ring[][] = (raw as number[][][][]).map((poly) =>
      poly.map((ring) => ring.map((c) => [c[0], c[1]] as [number, number]))
    )
    if (polygons.length === 0) continue
    const h = Number(f.properties?.hauteur)
    const fl = Number(f.properties?.nombre_d_etages)
    out.push({
      polygons,
      height: Number.isFinite(h) && h > 0 ? h : undefined,
      floors: Number.isFinite(fl) && fl > 0 ? fl : undefined
    })
  }
  return out
}
