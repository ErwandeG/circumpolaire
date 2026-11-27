/**
 * Cache disque des réponses (IndexedDB) : une zone déjà chargée ne repart pas sur le réseau.
 * Taille bornée : au-delà de CACHE_LIMIT_BYTES, les réponses inutilisées depuis le plus longtemps
 * sont supprimées. Tout échec du cache est silencieux : on retombe sur le réseau.
 */
const DB_NAME = 'circumpolaire'
const STORE = 'responses'
/** Taille et dernière utilisation de chaque réponse, pour choisir quoi supprimer. */
const META = 'meta'
export const CACHE_LIMIT_BYTES = 1_000_000_000
/** Après un nettoyage, on redescend à 80 % de la limite pour ne pas nettoyer à chaque ajout. */
const CACHE_TARGET = 0.8

interface Meta {
  size: number
  /** Dernière utilisation (ms depuis 1970) ; 0 pour les réponses d'avant ce suivi. */
  t: number
}

let dbPromise: Promise<IDBDatabase | null> | null = null

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 2)
      req.onupgradeneeded = (e) => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
        if (!db.objectStoreNames.contains(META)) {
          const meta = db.createObjectStore(META)
          meta.createIndex('t', 't')
          // Réponses déjà en cache (version 1) : comptées, et premières à partir si besoin.
          if (e.oldVersion >= 1) {
            const tx = req.transaction!
            tx.objectStore(STORE).openCursor().onsuccess = (ev) => {
              const cur = (ev.target as IDBRequest<IDBCursorWithValue | null>).result
              if (!cur) return
              const size = cur.value instanceof ArrayBuffer ? cur.value.byteLength : 0
              tx.objectStore(META).put({ size, t: 0 } satisfies Meta, cur.key)
              cur.continue()
            }
          }
        }
      }
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
      const tx = db.transaction([STORE, META], 'readwrite')
      const req = tx.objectStore(STORE).get(key)
      req.onsuccess = () => {
        const value = req.result instanceof ArrayBuffer ? req.result : null
        // Utilisée à l'instant : elle passe en dernier dans l'ordre de suppression.
        if (value) tx.objectStore(META).put({ size: value.byteLength, t: Date.now() } satisfies Meta, key)
        resolve(value)
      }
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
      const tx = db.transaction([STORE, META], 'readwrite')
      tx.objectStore(STORE).put(value, key)
      tx.objectStore(META).put({ size: value.byteLength, t: Date.now() } satisfies Meta, key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    } catch {
      resolve()
    }
  })
  scheduleTrim()
}

let trimTimer: ReturnType<typeof setTimeout> | undefined
function scheduleTrim(): void {
  clearTimeout(trimTimer)
  trimTimer = setTimeout(() => void trimCache(), 2000)
}

/** Supprime les réponses les moins récemment utilisées tant que le cache dépasse la limite. */
export async function trimCache(limit = CACHE_LIMIT_BYTES): Promise<void> {
  const { bytes } = await cacheStats()
  if (bytes <= limit) return
  const db = await openDb()
  if (!db) return
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction([STORE, META], 'readwrite')
      let total = bytes
      tx.objectStore(META).index('t').openCursor().onsuccess = (ev) => {
        const cur = (ev.target as IDBRequest<IDBCursorWithValue | null>).result
        if (!cur || total <= limit * CACHE_TARGET) return
        total -= (cur.value as Meta).size
        tx.objectStore(STORE).delete(cur.primaryKey)
        cur.delete()
        cur.continue()
      }
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    } catch {
      resolve()
    }
  })
}

/** Taille totale du cache (octets) et nombre de réponses. */
export async function cacheStats(): Promise<{ bytes: number; entries: number }> {
  const db = await openDb()
  if (!db) return { bytes: 0, entries: 0 }
  return new Promise((resolve) => {
    let bytes = 0
    let entries = 0
    try {
      const req = db.transaction(META, 'readonly').objectStore(META).openCursor()
      req.onsuccess = () => {
        const cur = req.result
        if (!cur) return resolve({ bytes, entries })
        bytes += (cur.value as Meta).size
        entries++
        cur.continue()
      }
      req.onerror = () => resolve({ bytes, entries })
    } catch {
      resolve({ bytes, entries })
    }
  })
}

/** Vide entièrement le cache. */
export async function cacheClear(): Promise<void> {
  const db = await openDb()
  if (!db) return
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction([STORE, META], 'readwrite')
      tx.objectStore(STORE).clear()
      tx.objectStore(META).clear()
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

/** Avancement d'un téléchargement : octets reçus et taille totale (0 si inconnue). */
export type ByteProgress = (loaded: number, total: number) => void

async function fetchOnce(url: string, timeoutMs: number, onProgress?: ByteProgress, expected = 0): Promise<ArrayBuffer> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) throw new HttpError(res.status)
    if (!onProgress || !res.body) return await res.arrayBuffer()
    // Lecture morceau par morceau pour suivre l'avancement.
    const total = Number(res.headers.get('content-length')) || expected
    const reader = res.body.getReader()
    const chunks: Uint8Array[] = []
    let loaded = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      loaded += value.length
      onProgress(loaded, total)
    }
    const out = new Uint8Array(loaded)
    let o = 0
    for (const c of chunks) {
      out.set(c, o)
      o += c.length
    }
    return out.buffer
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Télécharge une ressource binaire, en passant par le cache.
 * Les pannes passagères (erreur 5xx, coupure réseau) sont réessayées deux fois ;
 * un délai dépassé ne l'est pas (le serveur est trop lent, réessayer doublerait l'attente).
 * onProgress suit les octets reçus (`expected` : taille attendue si le serveur ne la donne pas).
 */
export async function fetchCached(
  url: string,
  timeoutMs = 30_000,
  onProgress?: ByteProgress,
  expected = 0
): Promise<ArrayBuffer> {
  const hit = await cacheGet(url)
  if (hit) {
    onProgress?.(hit.byteLength, hit.byteLength)
    return hit
  }
  for (let attempt = 0; ; attempt++) {
    try {
      const buf = await fetchOnce(url, timeoutMs, onProgress, expected)
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
