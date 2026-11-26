import {
  isInMetropolitanBounds,
  isOverseasDepartment,
  type Place,
  type PlaceKind
} from '../domain/place'

/** Service d'adresses de l'IGN (Géoplateforme). Gratuit, sans clé. */
const ENDPOINT = 'https://data.geopf.fr/geocodage/search'
const MAX_RESULTS = 10
const TIMEOUT_MS = 8000

export type GeocodeResult =
  | { status: 'ok'; places: Place[] }
  | { status: 'empty' }
  | { status: 'network-error' }
  | { status: 'service-error'; httpStatus: number }

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>

const KINDS: readonly PlaceKind[] = ['housenumber', 'street', 'locality', 'municipality']

/**
 * Transforme la réponse GeoJSON du service en lieux utilisables.
 * Écarte l'outre-mer et tout point hors de la métropole.
 */
export function parseGeocodeResponse(body: unknown): Place[] {
  if (typeof body !== 'object' || body === null) return []
  const features = (body as { features?: unknown }).features
  if (!Array.isArray(features)) return []

  const places: Place[] = []
  for (const f of features) {
    const coords = f?.geometry?.coordinates
    const p = f?.properties
    if (!Array.isArray(coords) || typeof p !== 'object' || p === null) continue
    const [lon, lat] = coords
    if (typeof lat !== 'number' || typeof lon !== 'number') continue
    if (isOverseasDepartment(p.depcode)) continue
    if (!isInMetropolitanBounds(lat, lon)) continue
    const kind: PlaceKind = KINDS.includes(p.type) ? p.type : 'locality'
    places.push({
      label: typeof p.label === 'string' ? p.label : `${lat.toFixed(4)}, ${lon.toFixed(4)}`,
      lat,
      lon,
      kind,
      context: typeof p.context === 'string' ? p.context : undefined
    })
  }
  return places
}

const REVERSE_ENDPOINT = 'https://data.geopf.fr/geocodage/reverse'
/** Au-delà de cette distance de l'adresse française la plus proche, le point est jugé hors de France. */
const MAX_REVERSE_DISTANCE_M = 5000

export type PointCheck =
  | { status: 'inside'; label?: string }
  | { status: 'outside' }
  /** Service injoignable : seul le rectangle de la métropole a pu être vérifié. */
  | { status: 'unverified' }

function distanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000
  const toRad = Math.PI / 180
  const dLat = (lat2 - lat1) * toRad
  const dLon = (lon2 - lon1) * toRad
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

const firstString = (v: unknown): string | undefined =>
  typeof v === 'string' ? v : Array.isArray(v) && typeof v[0] === 'string' ? v[0] : undefined

/**
 * Lieu nommé français le plus proche (commune, sommet, cours d'eau, lieu-dit…), à moins de 5 km.
 * Seuls les lieux de métropole rattachés à une commune comptent : le Léman, sans commune, ne
 * suffit pas à rendre Lausanne française.
 */
export function parseReversePoi(body: unknown, lat: number, lon: number): { label: string } | null {
  const features = (body as { features?: unknown } | null)?.features
  if (!Array.isArray(features)) return null
  for (const f of features) {
    const coords = f?.geometry?.coordinates
    const p = f?.properties
    if (!Array.isArray(coords) || typeof p !== 'object' || p === null) continue
    const [plon, plat] = coords
    if (typeof plat !== 'number' || typeof plon !== 'number') continue
    if (p.territory !== 'METROPOLE' || !firstString(p.citycode)) continue
    if (distanceM(lat, lon, plat, plon) > MAX_REVERSE_DISTANCE_M) continue
    const name = firstString(p.toponym) ?? firstString(p.name)
    const city = firstString(p.city)
    const label = name && city && city !== name ? `${name}, ${city}` : (name ?? city)
    if (label) return { label }
  }
  return null
}

/**
 * Vérifie qu'un point cliqué est en France métropolitaine : rectangle de la métropole,
 * puis adresse française la plus proche à moins de 5 km (géocodage inverse IGN).
 * En montagne ou en forêt, aucune adresse n'est assez proche : on cherche alors un lieu nommé
 * (commune, sommet, ruisseau…) de la base des toponymes de l'IGN.
 */
export async function checkPointInFrance(lat: number, lon: number, fetchFn: FetchFn = fetch): Promise<PointCheck> {
  if (!isInMetropolitanBounds(lat, lon)) return { status: 'outside' }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  const base = `${REVERSE_ENDPOINT}?lat=${lat}&lon=${lon}&limit=1`
  try {
    const res = await fetchFn(base, { signal: controller.signal })
    if (!res.ok) return { status: 'unverified' }
    const [place] = parseGeocodeResponse(await res.json())
    if (place && distanceM(lat, lon, place.lat, place.lon) <= MAX_REVERSE_DISTANCE_M) {
      return { status: 'inside', label: place.label }
    }
    const poiRes = await fetchFn(`${base}&index=poi`, { signal: controller.signal })
    if (!poiRes.ok) return { status: 'unverified' }
    const poi = parseReversePoi(await poiRes.json(), lat, lon)
    return poi ? { status: 'inside', label: poi.label } : { status: 'outside' }
  } catch {
    return { status: 'unverified' }
  } finally {
    clearTimeout(timer)
  }
}

export async function geocode(query: string, fetchFn: FetchFn = fetch): Promise<GeocodeResult> {
  const q = query.trim()
  // Le service exige au moins 3 caractères.
  if (q.length < 3) return { status: 'empty' }

  const url = `${ENDPOINT}?q=${encodeURIComponent(q)}&limit=${MAX_RESULTS}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  let response: Response
  try {
    response = await fetchFn(url, { signal: controller.signal })
  } catch {
    return { status: 'network-error' }
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) return { status: 'service-error', httpStatus: response.status }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    return { status: 'service-error', httpStatus: response.status }
  }

  const places = parseGeocodeResponse(body)
  return places.length > 0 ? { status: 'ok', places } : { status: 'empty' }
}
