import { moveOutside, parseBuildings, type Building } from '../domain/geo/buildings'
import { fromLambert93, toLambert93 } from '../domain/geo/lambert93'
import {
  SCENE_RADIUS_M,
  gridResFor,
  cleanNoData,
  sceneExtent,
  type ElevationGrid,
  type TerrainMesh,
  type TerrainOptions,
  type WalkContext
} from '../domain/terrain'
import { localFrame } from '../domain/geo/local'
import { describeFetchError, fetchCached } from './cache'
import { loadHdBuildings } from './hdService'
import { buildTerrainAsync } from './terrainClient'

const WMS = 'https://data.geopf.fr/wms-r'
const WFS = 'https://data.geopf.fr/wfs/ows'
const LAYERS = {
  mns: 'IGNF_LIDAR-HD_MNS_ELEVATION.ELEVATIONGRIDCOVERAGE.LAMB93',
  mnt: 'IGNF_LIDAR-HD_MNT_ELEVATION.ELEVATIONGRIDCOVERAGE.LAMB93'
} as const

/** Grille MNS ou MNT LiDAR HD (flottants 32 bits bruts), exactement sur la zone demandée. */
async function fetchGrid(
  layer: keyof typeof LAYERS,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  res: number,
  onProgress?: (fraction: number) => void
): Promise<ElevationGrid> {
  const cols = Math.round((maxX - minX) / res)
  const rows = Math.round((maxY - minY) / res)
  const url =
    `${WMS}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=${LAYERS[layer]}&STYLES=` +
    `&CRS=EPSG:2154&BBOX=${minX},${minY},${maxX},${maxY}&WIDTH=${cols}&HEIGHT=${rows}` +
    `&FORMAT=image/x-bil;bits=32`
  // Taille connue d'avance (flottants 32 bits) : l'avancement est exact même sans en-tête de taille.
  const buf = await fetchCached(url, 30_000, onProgress && ((l, t) => onProgress(t ? l / t : 0)), cols * rows * 4)
  if (buf.byteLength !== cols * rows * 4) throw new Error(`Réponse ${layer} inattendue (${buf.byteLength} octets)`)
  const view = new DataView(buf)
  const values = new Float32Array(cols * rows)
  for (let i = 0; i < values.length; i++) values[i] = view.getFloat32(i * 4, true)
  return { minX, maxY, res, cols, rows, values: cleanNoData(values) }
}

/** Taille des pages du WFS : à 500 m, un centre-ville compte plusieurs milliers de bâtiments. */
const WFS_PAGE = 1000
const WFS_MAX_PAGES = 20

async function fetchBuildings(
  x: number,
  y: number,
  radius: number,
  onPage?: (page: number) => void
): Promise<Building[]> {
  const r = radius + 5
  const base =
    `${WFS}?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=BDTOPO_V3:batiment` +
    `&SRSNAME=EPSG:2154&BBOX=${x - r},${y - r},${x + r},${y + r},urn:ogc:def:crs:EPSG::2154` +
    `&OUTPUTFORMAT=application/json&COUNT=${WFS_PAGE}`
  const all: Building[] = []
  for (let page = 0; page < WFS_MAX_PAGES; page++) {
    const buf = await fetchCached(`${base}&STARTINDEX=${page * WFS_PAGE}`)
    const json = JSON.parse(new TextDecoder().decode(buf)) as { features?: unknown[] }
    all.push(...parseBuildings(json))
    onPage?.(page + 1)
    if (!Array.isArray(json.features) || json.features.length < WFS_PAGE) break
  }
  return all
}

export type TerrainResult =
  | {
      status: 'ok'
      mesh: TerrainMesh
      /** Position finale de l'observateur (éventuellement sortie d'un bâtiment). */
      lat: number
      lon: number
      movedM: number
      buildingCount: number
      /** Dalles de bâtiments HD utilisées (0 : aucune, ou bâtiments HD désactivés). */
      hdTiles: number
      /** Sol et bâtiments pour se déplacer dans la scène sans la recharger. */
      walk: WalkContext
    }
  | { status: 'error'; message: string }

export async function loadTerrain(
  lat: number,
  lon: number,
  radius: number = SCENE_RADIUS_M,
  options: TerrainOptions & {
    hdBuildings?: boolean
    /** Avancement de 0 à 1 et ce qui se charge (pour la barre de progression). */
    onProgress?: (fraction: number, label: string, working?: boolean) => void
  } = {}
): Promise<TerrainResult> {
  const report = options.onProgress ?? (() => {})
  try {
    const p0 = toLambert93(lat, lon)
    // Étapes pondérées : contours 0 → 15 %, grilles LiDAR (+ bâtiments HD) → 85 %, construction → 100 %.
    report(0, 'Contours des bâtiments')
    const buildings = await fetchBuildings(p0.x, p0.y, radius, (pages) =>
      report(0.15 * (1 - 1 / (pages + 1)), `Contours des bâtiments (page ${pages})`)
    )
    const moved = moveOutside(buildings, p0.x, p0.y)
    const geo = moved.moved > 0 ? fromLambert93(moved.x, moved.y) : { lat, lon }
    const ext = sceneExtent(moved.x, moved.y, buildings, radius)
    const res = gridResFor(radius)
    const parts = { mns: 0, mnt: 0, hd: 0, hdText: '' }
    const withHd = options.hdBuildings === true
    const update = () => {
      const grids = (parts.mns + parts.mnt) / 2
      const f = withHd ? 0.15 + 0.35 * grids + 0.35 * parts.hd : 0.15 + 0.7 * grids
      report(f, parts.hdText && grids >= 1 ? parts.hdText : `Relief et bâtiments LiDAR : ${Math.round(grids * 100)} %`)
    }
    update()
    const [mns, mnt, hd] = await Promise.all([
      fetchGrid('mns', ext.minX, ext.minY, ext.maxX, ext.maxY, res, (f) => {
        parts.mns = f
        update()
      }),
      fetchGrid('mnt', ext.minX, ext.minY, ext.maxX, ext.maxY, res, (f) => {
        parts.mnt = f
        update()
      }),
      // Bâtiments HD (Strasbourg) : un échec n'empêche pas la vue, on garde alors les bâtiments reconstruits.
      withHd
        ? loadHdBuildings(geo.lat, geo.lon, radius, (done, total) => {
            parts.hd = total ? done / total : 0
            parts.hdText = `Bâtiments HD : ${done} / ${total} fichiers`
            update()
          }).catch(() => null)
        : Promise.resolve(null)
    ])
    // Construction dans une tâche de fond : l'interface ne se fige pas pendant le calcul.
    report(0.85, 'Construction des volumes 3D', true)
    const mesh = await buildTerrainAsync({
      observer: { x: moved.x, y: moved.y, lat: geo.lat, lon: geo.lon },
      mns,
      mnt,
      buildings,
      radius,
      trees: options.trees !== false,
      hd: hd ? { anchorX: hd.anchorX, anchorY: hd.anchorY, triangles: hd.triangles, tiles: hd.tiles } : undefined
    })
    return {
      status: 'ok',
      mesh,
      lat: geo.lat,
      lon: geo.lon,
      movedM: moved.moved,
      buildingCount: ext.touched.length,
      hdTiles: hd?.tileCount ?? 0,
      walk: { frame: localFrame(geo.lat, geo.lon), eyeAltitude: mesh.eyeAltitude, mnt, mns, buildings }
    }
  } catch (e) {
    return { status: 'error', message: describeFetchError(e, 'Bâtiments indisponibles') }
  }
}
