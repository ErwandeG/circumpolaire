import { fromCC48, toLambert93 } from '../domain/geo/lambert93'
import {
  HD_OFFSET_X,
  HD_OFFSET_Y,
  HD_TILE_M,
  entryData,
  parseObjTriangles,
  parseZipDirectory,
  tileOrigin,
  type ZipEntry
} from '../domain/hdModel'
import { cacheGet, cachePut, fetchCached } from './cache'

/** Catalogue des dalles de la maquette 3D 2022 (Eurométropole de Strasbourg, licence Etalab 2.0). */
const CATALOG = 'https://data.strasbourg.eu/api/explore/v2.1/catalog/datasets/odata3d_maquette_2022/records'
/** Seule la géométrie des bâtiments détaillés est lue, pas les textures (93 % du poids d'une dalle). */
const LOD2 = /\/BATI3D_LOD2\/[^/]+\.obj$/i
const PARALLEL = 16
const CACHE_KEY = 'hd-lod2-v1:'

/** Bâtiments HD autour d'un point, en Lambert 93 relatif à `anchor` (précision des flottants 32 bits). */
export interface HdGeometry {
  anchorX: number
  anchorY: number
  /** Triangles : [x − anchorX, y − anchorY, altitude] à la suite, trois sommets par triangle. */
  triangles: Float32Array
  /** Le point (Lambert 93) est-il dans une dalle qui a des bâtiments HD ? */
  covers(x: number, y: number): boolean
  tileCount: number
}

/** Lecture partielle d'un fichier distant (le serveur des dalles accepte les requêtes « Range »). */
async function range(url: string, header: string): Promise<Uint8Array> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { Range: header } })
      if (res.status !== 206 && !res.ok) throw new Error(`HTTP ${res.status}`)
      return new Uint8Array(await res.arrayBuffer())
    } catch (e) {
      if (attempt >= 2) throw e
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
    }
  }
}

async function inflate(data: Uint8Array): Promise<string> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Response(stream).text()
}

/** Triangles LoD2 d'une dalle, dans le repère des OBJ (CC48 décalé), depuis le cache ou le réseau. */
async function tileTriangles(name: string, url: string): Promise<Float32Array> {
  const hit = await cacheGet(CACHE_KEY + name)
  if (hit) return new Float32Array(hit)

  // Fin de l'archive : sommaire (répertoire central). On relit plus large s'il est coupé.
  let entries: ZipEntry[] | null = null
  for (const tailSize of [300_000, 3_000_000]) {
    const tail = await range(url, `bytes=-${tailSize}`)
    // Position du morceau reçu dans l'archive : la fiche de fin suit immédiatement le sommaire,
    // dont elle donne la position et la taille.
    const v = new DataView(tail.buffer, tail.byteOffset, tail.byteLength)
    let eocd = -1
    for (let i = tail.length - 22; i >= 0; i--) {
      if (v.getUint32(i, true) === 0x06054b50) {
        eocd = i
        break
      }
    }
    if (eocd < 0) continue
    const cdEnd = v.getUint32(eocd + 16, true) + v.getUint32(eocd + 12, true)
    const tailStart = cdEnd - eocd
    entries = parseZipDirectory(tail, tailStart)
    if (entries) break
  }
  if (!entries) throw new Error('Maquette 3D : sommaire de dalle illisible')

  const wanted = entries.filter((e) => LOD2.test(e.name))
  const parts: Float32Array[] = new Array(wanted.length)
  let next = 0
  async function worker(): Promise<void> {
    while (next < wanted.length) {
      const k = next++
      const e = wanted[k]
      // En-tête local (30 octets + nom + champ extra, au plus quelques centaines d'octets) puis données.
      const local = await range(url, `bytes=${e.localHeaderOffset}-${e.localHeaderOffset + 1024 + e.compressedSize}`)
      const data = entryData(local, e)
      const text = e.method === 8 ? await inflate(data) : new TextDecoder().decode(data)
      parts[k] = parseObjTriangles(text)
    }
  }
  await Promise.all(Array.from({ length: Math.min(PARALLEL, wanted.length) }, worker))
  const out = new Float32Array(parts.reduce((s, p) => s + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  void cachePut(CACHE_KEY + name, out.buffer)
  return out
}

/**
 * Bâtiments HD qui touchent le cercle de rayon `radius` autour du point.
 * null hors de la maquette (seule l'Eurométropole de Strasbourg est couverte).
 */
export async function loadHdBuildings(lat: number, lon: number, radius: number): Promise<HdGeometry | null> {
  // Dalles dont le centre est à moins du rayon plus une demi-diagonale de dalle.
  const reach = Math.ceil(radius + HD_TILE_M * 0.75)
  const url =
    `${CATALOG}?select=dalle,url&limit=100&where=` +
    encodeURIComponent(`within_distance(geo_point_2d, geom'POINT(${lon} ${lat})', ${reach}m)`)
  const list = JSON.parse(new TextDecoder().decode(await fetchCached(url))) as {
    results?: { dalle: string; url: string }[]
  }
  const tiles = list.results ?? []
  if (tiles.length === 0) return null

  const anchor = toLambert93(lat, lon)
  // Passage CC48 → Lambert 93 par dalle : transformation affine calée sur trois coins (écart < 1 mm sur 410 m).
  const toL93 = (x: number, y: number) => {
    const g = fromCC48(x, y)
    return toLambert93(g.lat, g.lon)
  }
  const loaded = await Promise.all(
    tiles.map(async (t) => {
      const tri = await tileTriangles(t.dalle, t.url)
      const o = tileOrigin(t.dalle)
      const p0 = toL93(o.x, o.y)
      const px = toL93(o.x + HD_TILE_M, o.y)
      const py = toL93(o.x, o.y + HD_TILE_M)
      const ax = { x: (px.x - p0.x) / HD_TILE_M, y: (px.y - p0.y) / HD_TILE_M }
      const ay = { x: (py.x - p0.x) / HD_TILE_M, y: (py.y - p0.y) / HD_TILE_M }
      return { tri, o, p0, ax, ay }
    })
  )
  const withData = loaded.filter((t) => t.tri.length > 0)
  if (withData.length === 0) return null

  const triangles = new Float32Array(withData.reduce((s, t) => s + t.tri.length, 0))
  let w = 0
  for (const t of withData) {
    for (let i = 0; i < t.tri.length; i += 3) {
      const dx = t.tri[i] + HD_OFFSET_X - t.o.x
      const dy = t.tri[i + 1] + HD_OFFSET_Y - t.o.y
      triangles[w++] = t.p0.x + dx * t.ax.x + dy * t.ay.x - anchor.x
      triangles[w++] = t.p0.y + dx * t.ax.y + dy * t.ay.y - anchor.y
      triangles[w++] = t.tri[i + 2]
    }
  }

  // Inverse des transformations affines : un point Lambert 93 est-il dans une dalle chargée ?
  const inverses = withData.map((t) => {
    const det = t.ax.x * t.ay.y - t.ay.x * t.ax.y
    return { t, det }
  })
  return {
    anchorX: anchor.x,
    anchorY: anchor.y,
    triangles,
    tileCount: withData.length,
    covers(x, y) {
      for (const { t, det } of inverses) {
        const rx = x - t.p0.x
        const ry = y - t.p0.y
        const u = (rx * t.ay.y - ry * t.ay.x) / det
        const v = (t.ax.x * ry - t.ax.y * rx) / det
        if (u >= 0 && u <= HD_TILE_M && v >= 0 && v <= HD_TILE_M) return true
      }
      return false
    }
  }
}
