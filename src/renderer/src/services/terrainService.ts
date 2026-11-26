import { moveOutside, parseBuildings, type Building } from '../domain/geo/buildings'
import { fromLambert93, toLambert93 } from '../domain/geo/lambert93'
import {
  SCENE_RADIUS_M,
  buildTerrain,
  gridResFor,
  cleanNoData,
  sceneExtent,
  type ElevationGrid,
  type TerrainMesh,
  type TerrainOptions,
  type WalkContext
} from '../domain/terrain'
import { localFrame } from '../domain/geo/local'
import { fetchCached } from './cache'

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
  res: number
): Promise<ElevationGrid> {
  const cols = Math.round((maxX - minX) / res)
  const rows = Math.round((maxY - minY) / res)
  const url =
    `${WMS}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=${LAYERS[layer]}&STYLES=` +
    `&CRS=EPSG:2154&BBOX=${minX},${minY},${maxX},${maxY}&WIDTH=${cols}&HEIGHT=${rows}` +
    `&FORMAT=image/x-bil;bits=32`
  const buf = await fetchCached(url)
  if (buf.byteLength !== cols * rows * 4) throw new Error(`Réponse ${layer} inattendue (${buf.byteLength} octets)`)
  const view = new DataView(buf)
  const values = new Float32Array(cols * rows)
  for (let i = 0; i < values.length; i++) values[i] = view.getFloat32(i * 4, true)
  return { minX, maxY, res, cols, rows, values: cleanNoData(values) }
}

/** Taille des pages du WFS : à 500 m, un centre-ville compte plusieurs milliers de bâtiments. */
const WFS_PAGE = 1000
const WFS_MAX_PAGES = 20

async function fetchBuildings(x: number, y: number, radius: number): Promise<Building[]> {
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
      /** Sol et bâtiments pour se déplacer dans la scène sans la recharger. */
      walk: WalkContext
    }
  | { status: 'error'; message: string }

export async function loadTerrain(
  lat: number,
  lon: number,
  radius: number = SCENE_RADIUS_M,
  options: TerrainOptions = {}
): Promise<TerrainResult> {
  try {
    const p0 = toLambert93(lat, lon)
    const buildings = await fetchBuildings(p0.x, p0.y, radius)
    const moved = moveOutside(buildings, p0.x, p0.y)
    const geo = moved.moved > 0 ? fromLambert93(moved.x, moved.y) : { lat, lon }
    const ext = sceneExtent(moved.x, moved.y, buildings, radius)
    const res = gridResFor(radius)
    const [mns, mnt] = await Promise.all([
      fetchGrid('mns', ext.minX, ext.minY, ext.maxX, ext.maxY, res),
      fetchGrid('mnt', ext.minX, ext.minY, ext.maxX, ext.maxY, res)
    ])
    const mesh = buildTerrain({ x: moved.x, y: moved.y, lat: geo.lat, lon: geo.lon }, mns, mnt, buildings, radius, options)
    return {
      status: 'ok',
      mesh,
      lat: geo.lat,
      lon: geo.lon,
      movedM: moved.moved,
      buildingCount: ext.touched.length,
      walk: { frame: localFrame(geo.lat, geo.lon), eyeAltitude: mesh.eyeAltitude, mnt, mns, buildings }
    }
  } catch (e) {
    const offline = e instanceof TypeError || (e instanceof DOMException && e.name === 'AbortError')
    return {
      status: 'error',
      message: offline
        ? 'Bâtiments indisponibles : pas de connexion aux services de l’IGN.'
        : `Bâtiments indisponibles : ${(e as Error).message}`
    }
  }
}
