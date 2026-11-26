import { Body, Equator, Horizon, Illumination, Observer, SearchRiseSet } from 'astronomy-engine'

/** Fraction éclairée du disque lunaire, de 0 (nouvelle Lune) à 1 (pleine Lune). */
export function moonIlluminatedFraction(instant: Date): number {
  return Illumination(Body.Moon, instant).phase_fraction
}

export type MoonPresenceState = 'absent' | 'partial' | 'present'

export interface MoonPresence {
  state: MoonPresenceState
  /** Intervalles où la Lune est au-dessus de l'horizon, bornés à la fenêtre. */
  intervals: { from: Date; to: Date }[]
  /** Levers et couchers qui tombent dans la fenêtre. */
  rises: Date[]
  sets: Date[]
}

const DAY_MS = 86_400_000
const STEP_MS = 60_000

/**
 * Lever et coucher : bord supérieur du disque sur l'horizon, réfraction standard
 * (convention de SearchRiseSet). Ni relief ni bâtiments.
 */
function nextEvent(observer: Observer, direction: 1 | -1, from: Date, until: Date): Date | null {
  const limit = (until.getTime() - from.getTime()) / DAY_MS
  if (limit <= 0) return null
  const t = SearchRiseSet(Body.Moon, observer, direction, from, limit)
  return t && t.date < until ? t.date : null
}

function isMoonUp(observer: Observer, instant: Date): boolean {
  // Repli rarement utilisé : hauteur du centre avec réfraction, seuil du bord supérieur (≈ −0,25°).
  const eq = Equator(Body.Moon, instant, observer, true, true)
  const hor = Horizon(instant, observer, eq.ra, eq.dec, 'normal')
  return hor.altitude > -0.27
}

export function moonPresence(start: Date, end: Date, lat: number, lon: number): MoonPresence {
  const observer = new Observer(lat, lon, 0)
  const horizon = new Date(end.getTime() + 2 * DAY_MS)

  // État au début de la fenêtre : la Lune est levée si son prochain événement est un coucher.
  const firstRise = nextEvent(observer, 1, start, horizon)
  const firstSet = nextEvent(observer, -1, start, horizon)
  let up: boolean
  if (firstSet && (!firstRise || firstSet < firstRise)) up = true
  else if (firstRise && (!firstSet || firstRise < firstSet)) up = false
  else up = isMoonUp(observer, start)

  const intervals: { from: Date; to: Date }[] = []
  const rises: Date[] = []
  const sets: Date[] = []
  let cursor = start
  let openedAt: Date | null = up ? start : null

  for (let i = 0; i < 6; i++) {
    const ev = nextEvent(observer, up ? -1 : 1, cursor, end)
    if (!ev) break
    if (up) {
      sets.push(ev)
      if (openedAt) intervals.push({ from: openedAt, to: ev })
      openedAt = null
    } else {
      rises.push(ev)
      openedAt = ev
    }
    up = !up
    cursor = new Date(ev.getTime() + STEP_MS)
  }
  if (openedAt) intervals.push({ from: openedAt, to: end })

  const presentMs = intervals.reduce((s, i) => s + (i.to.getTime() - i.from.getTime()), 0)
  const windowMs = end.getTime() - start.getTime()
  const state: MoonPresenceState =
    presentMs <= STEP_MS ? 'absent' : presentMs >= windowMs - STEP_MS ? 'present' : 'partial'

  return { state, intervals, rises, sets }
}
