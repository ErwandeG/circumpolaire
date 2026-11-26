import { afterEach, describe, expect, it, vi } from 'vitest'
import { HttpError, describeFetchError, fetchCached } from './cache'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

/** Faux réseau : renvoie les codes donnés dans l'ordre, puis 200. */
function stubFetch(statuses: number[]) {
  const calls: string[] = []
  vi.stubGlobal('fetch', async (url: string) => {
    calls.push(url)
    const status = statuses.shift() ?? 200
    return new Response(new Uint8Array([1, 2, 3, 4]), { status })
  })
  return calls
}

describe('fetchCached', () => {
  it('réessaie après une panne passagère du serveur (504)', async () => {
    vi.useFakeTimers()
    const calls = stubFetch([504, 504])
    const p = fetchCached('https://exemple.test/a')
    await vi.runAllTimersAsync()
    expect((await p).byteLength).toBe(4)
    expect(calls).toHaveLength(3)
  })

  it('abandonne après deux nouveaux essais', async () => {
    vi.useFakeTimers()
    const calls = stubFetch([504, 504, 504, 504])
    const p = fetchCached('https://exemple.test/b')
    const check = expect(p).rejects.toBeInstanceOf(HttpError)
    await vi.runAllTimersAsync()
    await check
    expect(calls).toHaveLength(3)
  })

  it('ne réessaie pas une erreur définitive (404)', async () => {
    const calls = stubFetch([404])
    await expect(fetchCached('https://exemple.test/c')).rejects.toBeInstanceOf(HttpError)
    expect(calls).toHaveLength(1)
  })
})

describe('describeFetchError', () => {
  it('explique une panne du service', () => {
    const m = describeFetchError(new HttpError(504), 'Relief lointain indisponible')
    expect(m).toContain('ne répond pas pour l’instant')
    expect(m).toContain('504')
  })

  it('signale une absence de connexion', () => {
    expect(describeFetchError(new TypeError('Failed to fetch'), 'X')).toBe('X : pas de connexion aux services de l’IGN.')
  })
})
