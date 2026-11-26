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
