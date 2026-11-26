/**
 * Cache disque des réponses (IndexedDB) : une zone déjà chargée ne repart pas sur le réseau.
 * Tout échec du cache est silencieux : on retombe sur le réseau.
 */
const DB_NAME = 'circumpolaire'
const STORE = 'responses'

let dbPromise: Promise<IDBDatabase | null> | null = null

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return dbPromise
}

export async function cacheGet(key: string): Promise<ArrayBuffer | null> {
  const db = await openDb()
  if (!db) return null
  return new Promise((resolve) => {
    try {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key)
      req.onsuccess = () => resolve(req.result instanceof ArrayBuffer ? req.result : null)
      req.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

export async function cachePut(key: string, value: ArrayBuffer): Promise<void> {
  const db = await openDb()
  if (!db) return
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(value, key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    } catch {
      resolve()
    }
  })
}

/** Réponse d'erreur du serveur (code HTTP). */
export class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`)
  }
}

/** Serveur surchargé ou en panne passagère : cela vaut la peine de réessayer. */
const TRANSIENT = new Set([429, 500, 502, 503, 504])
/** Attentes avant chaque nouvel essai. */
const RETRY_DELAYS_MS = [1500, 4000]

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function fetchOnce(url: string, timeoutMs: number): Promise<ArrayBuffer> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) throw new HttpError(res.status)
    return await res.arrayBuffer()
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Télécharge une ressource binaire, en passant par le cache.
 * Les pannes passagères (erreur 5xx, coupure réseau) sont réessayées deux fois ;
 * un délai dépassé ne l'est pas (le serveur est trop lent, réessayer doublerait l'attente).
 */
export async function fetchCached(url: string, timeoutMs = 30_000): Promise<ArrayBuffer> {
  const hit = await cacheGet(url)
  if (hit) return hit
  for (let attempt = 0; ; attempt++) {
    try {
      const buf = await fetchOnce(url, timeoutMs)
      void cachePut(url, buf)
      return buf
    } catch (e) {
      const transient = (e instanceof HttpError && TRANSIENT.has(e.status)) || e instanceof TypeError
      if (!transient || attempt >= RETRY_DELAYS_MS.length) throw e
      await sleep(RETRY_DELAYS_MS[attempt])
    }
  }
}

/** Message d'erreur compréhensible pour un chargement depuis l'IGN. */
export function describeFetchError(e: unknown, what: string): string {
  if (e instanceof HttpError && e.status >= 500) {
    return (
      `${what} : le service de l’IGN ne répond pas pour l’instant (erreur ${e.status}). ` +
      'Réessayez dans quelques minutes ; les lieux déjà consultés restent disponibles.'
    )
  }
  if (e instanceof TypeError || (e instanceof DOMException && e.name === 'AbortError')) {
    return `${what} : pas de connexion aux services de l’IGN.`
  }
  return `${what} : ${(e as Error).message}`
}
