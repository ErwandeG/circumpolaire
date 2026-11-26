import { DEFAULT_PLACE, isPlace, type Place } from '../domain/place'

const LAST_PLACE_KEY = 'circumpolaire.lastPlace'

/** Stockage minimal, injectable pour les tests. */
export interface KeyValueStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

function defaultStore(): KeyValueStore | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/** Dernier lieu choisi, ou Strasbourg si rien de valide n'est mémorisé. */
export function loadLastPlace(store: KeyValueStore | null = defaultStore()): Place {
  if (!store) return DEFAULT_PLACE
  try {
    const raw = store.getItem(LAST_PLACE_KEY)
    if (!raw) return DEFAULT_PLACE
    const parsed: unknown = JSON.parse(raw)
    return isPlace(parsed) ? parsed : DEFAULT_PLACE
  } catch {
    return DEFAULT_PLACE
  }
}

export function saveLastPlace(place: Place, store: KeyValueStore | null = defaultStore()): void {
  if (!store) return
  try {
    store.setItem(LAST_PLACE_KEY, JSON.stringify(place))
  } catch {
    // Stockage indisponible : on garde simplement le lieu pour cette session.
  }
}
