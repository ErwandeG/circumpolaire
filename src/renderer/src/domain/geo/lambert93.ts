/**
 * Projection Lambert 93 (EPSG:2154) : conique conforme sécante, ellipsoïde GRS80.
 * Formules de Snyder (USGS Professional Paper 1395, § 15).
 * Le système des données IGN (BD TOPO, LiDAR HD).
 */
const A = 6378137
const F = 1 / 298.257222101
const E = Math.sqrt(2 * F - F * F)
const DEG = Math.PI / 180
const LON0 = 3 * DEG
const LAT0 = 46.5 * DEG
const LAT1 = 49 * DEG
const LAT2 = 44 * DEG
const X0 = 700_000
const Y0 = 6_600_000

const m = (phi: number) => Math.cos(phi) / Math.sqrt(1 - E * E * Math.sin(phi) ** 2)
const t = (phi: number) =>
  Math.tan(Math.PI / 4 - phi / 2) / ((1 - E * Math.sin(phi)) / (1 + E * Math.sin(phi))) ** (E / 2)

const N = (Math.log(m(LAT1)) - Math.log(m(LAT2))) / (Math.log(t(LAT1)) - Math.log(t(LAT2)))
const FF = m(LAT1) / (N * t(LAT1) ** N)
const RHO0 = A * FF * t(LAT0) ** N

export interface L93 {
  x: number
  y: number
}

export function toLambert93(lat: number, lon: number): L93 {
  const rho = A * FF * t(lat * DEG) ** N
  const theta = N * (lon * DEG - LON0)
  return { x: X0 + rho * Math.sin(theta), y: Y0 + RHO0 - rho * Math.cos(theta) }
}

export function fromLambert93(x: number, y: number): { lat: number; lon: number } {
  const dx = x - X0
  const dy = RHO0 - (y - Y0)
  const rho = Math.sign(N) * Math.hypot(dx, dy)
  const tt = (rho / (A * FF)) ** (1 / N)
  const theta = Math.atan2(dx, dy)
  let phi = Math.PI / 2 - 2 * Math.atan(tt)
  for (let i = 0; i < 8; i++) {
    const s = E * Math.sin(phi)
    phi = Math.PI / 2 - 2 * Math.atan(tt * ((1 - s) / (1 + s)) ** (E / 2))
  }
  return { lat: phi / DEG, lon: (theta / N + LON0) / DEG }
}

/**
 * Convergence des méridiens (degrés) : angle entre le nord du quadrillage Lambert et le nord vrai.
 * Environ +3,4° à Strasbourg, −5,5° à Brest : à corriger pour aligner bâtiments et ciel.
 */
export function meridianConvergence(lon: number): number {
  return (N * (lon * DEG - LON0)) / DEG
}

/**
 * Lambert conique conforme « CC48 » (EPSG:3948), zone 48° des coniques conformes 9 zones :
 * système de la maquette 3D de l'Eurométropole de Strasbourg. Mêmes formules de Snyder.
 */
function lambertConformal(lon0: number, lat0: number, lat1: number, lat2: number, x0: number, y0: number) {
  const n = (Math.log(m(lat1 * DEG)) - Math.log(m(lat2 * DEG))) / (Math.log(t(lat1 * DEG)) - Math.log(t(lat2 * DEG)))
  const ff = m(lat1 * DEG) / (n * t(lat1 * DEG) ** n)
  const rho0 = A * ff * t(lat0 * DEG) ** n
  return {
    forward(lat: number, lon: number): L93 {
      const rho = A * ff * t(lat * DEG) ** n
      const theta = n * (lon * DEG - lon0 * DEG)
      return { x: x0 + rho * Math.sin(theta), y: y0 + rho0 - rho * Math.cos(theta) }
    },
    inverse(x: number, y: number): { lat: number; lon: number } {
      const dx = x - x0
      const dy = rho0 - (y - y0)
      const tt = (Math.sign(n) * Math.hypot(dx, dy) / (A * ff)) ** (1 / n)
      let phi = Math.PI / 2 - 2 * Math.atan(tt)
      for (let i = 0; i < 8; i++) {
        const s = E * Math.sin(phi)
        phi = Math.PI / 2 - 2 * Math.atan(tt * ((1 - s) / (1 + s)) ** (E / 2))
      }
      return { lat: phi / DEG, lon: (Math.atan2(dx, dy) / n) / DEG + lon0 }
    }
  }
}

const CC48 = lambertConformal(3, 48, 47.25, 48.75, 1_700_000, 7_200_000)
export const toCC48 = CC48.forward
export const fromCC48 = CC48.inverse
