/** Un lieu choisi par l'utilisateur. Coordonnées WGS84 en degrés. */
export interface Place {
  label: string
  lat: number
  lon: number
  /** Précision du résultat : adresse, rue, lieu-dit ou commune. */
  kind: PlaceKind
  /** Contexte lisible, par exemple « 67, Bas-Rhin, Grand Est ». */
  context?: string
}

export type PlaceKind = 'housenumber' | 'street' | 'locality' | 'municipality'

export const DEFAULT_PLACE: Place = {
  label: 'Strasbourg',
  lat: 48.5734,
  lon: 7.7521,
  kind: 'municipality',
  context: '67, Bas-Rhin, Grand Est'
}

/**
 * Rectangle englobant la France métropolitaine, Corse comprise.
 * Volontairement un peu large : il sert de garde-fou, pas de frontière exacte.
 */
const METRO_BOUNDS = { south: 41.3, north: 51.15, west: -5.2, east: 9.6 }

/** Vrai si le département est d'outre-mer (971 à 976, codes à 3 chiffres en 97x). */
export function isOverseasDepartment(depcode: string | undefined): boolean {
  return depcode !== undefined && /^97\d$/.test(depcode)
}

export function isInMetropolitanBounds(lat: number, lon: number): boolean {
  return (
    lat >= METRO_BOUNDS.south &&
    lat <= METRO_BOUNDS.north &&
    lon >= METRO_BOUNDS.west &&
    lon <= METRO_BOUNDS.east
  )
}

/** Zoom de carte adapté à la précision du lieu. */
export function zoomFor(kind: PlaceKind): number {
  switch (kind) {
    case 'housenumber':
      return 18
    case 'street':
      return 17
    case 'locality':
      return 15
    case 'municipality':
      return 13
  }
}

const KIND_LABELS: Record<PlaceKind, string> = {
  housenumber: 'Adresse',
  street: 'Rue',
  locality: 'Lieu-dit',
  municipality: 'Commune'
}

export function kindLabel(kind: PlaceKind): string {
  return KIND_LABELS[kind]
}

/** Valide un objet relu depuis le stockage local. */
export function isPlace(value: unknown): value is Place {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.label === 'string' &&
    typeof v.lat === 'number' &&
    typeof v.lon === 'number' &&
    Number.isFinite(v.lat) &&
    Number.isFinite(v.lon) &&
    typeof v.kind === 'string' &&
    v.kind in KIND_LABELS &&
    isInMetropolitanBounds(v.lat, v.lon)
  )
}
