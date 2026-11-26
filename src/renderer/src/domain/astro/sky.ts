import {
  Body,
  Equator,
  Horizon,
  Illumination,
  MakeTime,
  Observer,
  Refraction,
  Rotation_EQD_HOR,
  Rotation_EQJ_HOR,
  type RotationMatrix
} from 'astronomy-engine'

/**
 * Repère local de l'observateur, vecteurs unitaires :
 * e = vers l'Est, n = vers le Nord, u = vers le zénith.
 */
export interface Enu {
  e: number
  n: number
  u: number
}

const DEG = Math.PI / 180

export interface SkyOptions {
  /** Réfraction atmosphérique standard appliquée aux hauteurs (oui par défaut). */
  refraction?: boolean
}

export function altAzToEnu(azimuthDeg: number, altitudeDeg: number): Enu {
  const az = azimuthDeg * DEG
  const alt = altitudeDeg * DEG
  return { e: Math.cos(alt) * Math.sin(az), n: Math.cos(alt) * Math.cos(az), u: Math.sin(alt) }
}

export function enuToAltAz(v: Enu): { azimuth: number; altitude: number } {
  const altitude = Math.asin(Math.max(-1, Math.min(1, v.u))) / DEG
  let azimuth = Math.atan2(v.e, v.n) / DEG
  if (azimuth < 0) azimuth += 360
  return { azimuth, altitude }
}

/** Remonte la hauteur apparente d'un vecteur selon la réfraction standard, azimut inchangé. */
function refract(e: number, n: number, u: number): Enu {
  const alt = Math.asin(Math.max(-1, Math.min(1, u))) / DEG
  const corrected = (alt + Refraction('normal', alt)) * DEG
  const h = Math.hypot(e, n)
  if (h < 1e-12) return { e, n, u }
  const c = Math.cos(corrected) / h
  return { e: e * c, n: n * c, u: Math.sin(corrected) }
}

/**
 * Applique une matrice astronomy-engine (repère équatorial → horizontal) à un vecteur.
 * Repère horizontal d'astronomy-engine : x = Nord, y = Ouest, z = zénith.
 */
function toEnu(m: RotationMatrix, x: number, y: number, z: number, refraction: boolean): Enu {
  const r = m.rot
  const hx = r[0][0] * x + r[1][0] * y + r[2][0] * z
  const hy = r[0][1] * x + r[1][1] * y + r[2][1] * z
  const hz = r[0][2] * x + r[1][2] * y + r[2][2] * z
  return refraction ? refract(-hy, hx, hz) : { e: -hy, n: hx, u: hz }
}

/** Catalogue réduit : [ascension droite °, déclinaison °, magnitude, B−V], équinoxe J2000. */
export type StarRow = [number, number, number, number]

export class StarField {
  /** Vecteurs unitaires équatoriaux J2000, 3 nombres par étoile. */
  private readonly eqj: Float64Array
  readonly count: number

  constructor(rows: readonly StarRow[]) {
    this.count = rows.length
    this.eqj = new Float64Array(rows.length * 3)
    rows.forEach(([ra, dec], i) => {
      const a = ra * DEG
      const d = dec * DEG
      this.eqj[i * 3] = Math.cos(d) * Math.cos(a)
      this.eqj[i * 3 + 1] = Math.cos(d) * Math.sin(a)
      this.eqj[i * 3 + 2] = Math.sin(d)
    })
  }

  /** Position d'une étoile dans le repère local à l'instant t. */
  position(i: number, t: Date, lat: number, lon: number, opts: SkyOptions = {}): Enu {
    const m = Rotation_EQJ_HOR(MakeTime(t), new Observer(lat, lon, 0))
    return toEnu(m, this.eqj[i * 3], this.eqj[i * 3 + 1], this.eqj[i * 3 + 2], opts.refraction ?? true)
  }

  /**
   * Filés d'étoiles : pour chaque étoile, `samples` points régulièrement espacés de t0 à t0 + durée.
   * Résultat : [étoile][échantillon][e, n, u] aplati, prêt pour un tampon de rendu.
   */
  trails(t0: Date, durationMin: number, samples: number, lat: number, lon: number, opts: SkyOptions = {}): Float32Array {
    const refraction = opts.refraction ?? true
    const observer = new Observer(lat, lon, 0)
    const out = new Float32Array(this.count * samples * 3)
    const step = samples > 1 ? (durationMin * 60_000) / (samples - 1) : 0
    for (let k = 0; k < samples; k++) {
      const m = Rotation_EQJ_HOR(MakeTime(new Date(t0.getTime() + k * step)), observer)
      for (let i = 0; i < this.count; i++) {
        const v = toEnu(m, this.eqj[i * 3], this.eqj[i * 3 + 1], this.eqj[i * 3 + 2], refraction)
        const o = (i * samples + k) * 3
        out[o] = v.e
        out[o + 1] = v.n
        out[o + 2] = v.u
      }
    }
    return out
  }
}

/** Pôle céleste nord vrai (de la date), dans le repère local. */
export function northCelestialPole(t: Date, lat: number, lon: number, opts: SkyOptions = {}): Enu {
  const m = Rotation_EQD_HOR(MakeTime(t), new Observer(lat, lon, 0))
  return toEnu(m, 0, 0, 1, opts.refraction ?? true)
}

function bodyDirection(body: Body, t: Date, lat: number, lon: number, refraction: boolean): Enu {
  const observer = new Observer(lat, lon, 0)
  const eq = Equator(body, t, observer, true, true)
  const hor = Horizon(t, observer, eq.ra, eq.dec, refraction ? 'normal' : undefined)
  return altAzToEnu(hor.azimuth, hor.altitude)
}

export interface MoonState {
  /** Direction de la Lune au début de la pose. */
  direction: Enu
  /** Positions successives pendant la pose (début → fin). */
  track: Enu[]
  /** Direction du Soleil, pour éclairer le disque lunaire (phase et orientation). */
  sunDirection: Enu
  illuminatedFraction: number
  /** Diamètre apparent, en degrés. */
  diameterDeg: number
}

export function moonState(t0: Date, durationMin: number, samples: number, lat: number, lon: number): MoonState {
  const track: Enu[] = []
  const step = samples > 1 ? (durationMin * 60_000) / (samples - 1) : 0
  for (let k = 0; k < samples; k++) {
    track.push(bodyDirection(Body.Moon, new Date(t0.getTime() + k * step), lat, lon, true))
  }
  const eq = Equator(Body.Moon, t0, new Observer(lat, lon, 0), true, true)
  const MOON_RADIUS_KM = 1737.4
  const AU_KM = 149_597_870.7
  return {
    direction: track[0],
    track,
    sunDirection: bodyDirection(Body.Sun, t0, lat, lon, false),
    illuminatedFraction: Illumination(Body.Moon, t0).phase_fraction,
    diameterDeg: (2 * Math.atan(MOON_RADIUS_KM / (eq.dist * AU_KM))) / DEG
  }
}

/** Angle entre deux directions, en degrés. */
export function angleBetween(a: Enu, b: Enu): number {
  const dot = a.e * b.e + a.n * b.n + a.u * b.u
  return Math.acos(Math.max(-1, Math.min(1, dot / (Math.hypot(a.e, a.n, a.u) * Math.hypot(b.e, b.n, b.u))))) / DEG
}
