/**
 * Repère local autour d'un point d'origine : mètres vers l'Est (e) et le Nord (n).
 * Approximation plane, exacte au millimètre à l'échelle de quelques centaines de mètres.
 */
export interface LocalFrame {
  lat0: number
  lon0: number
  mPerDegLat: number
  mPerDegLon: number
}

export function localFrame(lat0: number, lon0: number): LocalFrame {
  const phi = (lat0 * Math.PI) / 180
  return {
    lat0,
    lon0,
    mPerDegLat: 111_132.954 - 559.822 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi),
    mPerDegLon: ((Math.PI / 180) * 6_378_137 * Math.cos(phi)) / Math.sqrt(1 - 0.00669438 * Math.sin(phi) ** 2)
  }
}

export function toLocal(f: LocalFrame, lat: number, lon: number): { e: number; n: number } {
  return { e: (lon - f.lon0) * f.mPerDegLon, n: (lat - f.lat0) * f.mPerDegLat }
}

export function fromLocal(f: LocalFrame, e: number, n: number): { lat: number; lon: number } {
  return { lat: f.lat0 + n / f.mPerDegLat, lon: f.lon0 + e / f.mPerDegLon }
}

/** Déplacement de `forward` mètres vers l'azimut donné et `right` mètres sur la droite. */
export function stepToward(azimuthDeg: number, forward: number, right: number): { e: number; n: number } {
  const a = (azimuthDeg * Math.PI) / 180
  return {
    e: forward * Math.sin(a) + right * Math.cos(a),
    n: forward * Math.cos(a) - right * Math.sin(a)
  }
}

export function distanceM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const f = localFrame(a.lat, a.lon)
  const d = toLocal(f, b.lat, b.lon)
  return Math.hypot(d.e, d.n)
}
