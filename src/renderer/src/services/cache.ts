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

/** Télécharge une ressource binaire, en passant par le cache. */
export async function fetchCached(url: string, timeoutMs = 30_000): Promise<ArrayBuffer> {
  const hit = await cacheGet(url)
  if (hit) return hit
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const buf = await res.arrayBuffer()
    void cachePut(url, buf)
    return buf
  } finally {
    clearTimeout(timer)
  }
}
