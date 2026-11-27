/**
 * Textes de la vue du ciel, calculés à partir de l'état : bandeau d'infos, résumé des réglages,
 * avertissements, légende de l'image exportée. Sans accès à la page : testables à part.
 */
import { nightWindow } from '../../domain/astro/night'
import { SIDEREAL_DEG_PER_MIN, cropFactor, equivalentFocal, roundFocal, sensorById } from '../../domain/optics'
import { formatParisTime, parisDayOf } from '../../domain/time'
import type { CaptureInfo } from './exportImage'
import type { SkyState } from './skyState'

export const pad = (n: number) => String(n).padStart(2, '0')
export const fmt1 = (x: number) => x.toLocaleString('fr-FR', { maximumFractionDigits: 1 })

export interface FieldOfView {
  h: number
  v: number
}
export interface MoonInfo {
  fraction: number
  altitude: number
  azimuth: number
}

const azimuth360 = (az: number) => ((az % 360) + 360) % 360

/** Focale réelle, et son équivalent plein format hors 24×36 : « 16 mm APS-C (≈ 25 mm éq. 24×36) ». */
export function focalText(s: SkyState): string {
  const sensor = sensorById(s.sensorId)
  const f = Math.round(s.focalMm)
  if (Math.abs(cropFactor(sensor) - 1) < 0.01) return `${f} mm plein format`
  return `${f} mm ${sensor.short} (≈ ${Math.round(equivalentFocal(sensor, s.focalMm))} mm éq. 24×36)`
}

/** À côté du nom « Focale » : équivalent 24×36 et facteur de recadrage, vide en plein format. */
export function focalEquivalentText(s: SkyState): string {
  const sensor = sensorById(s.sensorId)
  const crop = cropFactor(sensor)
  if (Math.abs(crop - 1) < 0.01) return ''
  return `(≈ ${Math.round(equivalentFocal(sensor, s.focalMm))} mm éq. 24×36, ×${crop.toLocaleString('fr-FR', { maximumFractionDigits: 2 })})`
}

/** Bandeau en bas de l'image : visée, champ, arc des filés, Lune. */
export function hudLine(s: SkyState, f: FieldOfView, moon: MoonInfo): string {
  const arc = s.durationMin * SIDEREAL_DEG_PER_MIN
  const moonText =
    moon.altitude > 0
      ? `Lune ${Math.round(moon.fraction * 100)} %, à ${fmt1(moon.altitude)}° de hauteur`
      : `Lune couchée (${Math.round(moon.fraction * 100)} %)`
  const roll = s.roll ? `, rotation ${fmt1(s.roll)}°` : ''
  return (
    `Visée az ${Math.round(azimuth360(s.azimuth))}°, haut. ${fmt1(s.altitude)}°${roll} · Champ ${fmt1(f.h)}° × ${fmt1(f.v)}° · ` +
    `Arc des filés ${fmt1(arc)}° · ${moonText}`
  )
}

/** Réglages en une ligne, lisibles quand le panneau est replié. */
export function settingsSummary(s: SkyState): string {
  const nf = (x: number, digits = 1) => x.toLocaleString('fr-FR', { maximumFractionDigits: digits })
  const parts = [
    `${focalText(s)} ${s.orientation === 'portrait' ? 'portrait' : 'paysage'}`,
    `${formatParisTime(s.start)}, pose ${s.durationMin} min`,
    `${nf(s.starCount, 0)} étoiles`,
    `œil à ${nf(s.eyeHeight)} m`,
    `volumes ${s.radius} m`,
    s.reliefOn ? `relief ${nf(s.reliefDistance / 1000)} km` : 'relief masqué'
  ]
  if (!s.showTrees) parts.push('arbres masqués')
  return parts.join(' · ')
}

/** Pose qui déborde de la nuit noire (astronomique, sinon nautique). */
export function exposureWarnings(s: SkyState): string[] {
  const { lat, lon } = s.observer
  // La nuit du jour J va de midi J à midi J+1 (heure de Paris).
  const nightDay = parisDayOf(new Date(s.start.getTime() - 12 * 3600_000))
  const w = nightWindow(nightDay, lat, lon)
  const end = new Date(s.start.getTime() + s.durationMin * 60_000)
  if (w.kind === 'none') return ['Pas de nuit noire cette nuit-là : le Soleil ne descend pas sous −12°.']
  const which = w.kind === 'astronomical' ? 'nuit astronomique' : 'nuit nautique'
  const msgs: string[] = []
  if (s.start < w.start) msgs.push(`La pose commence avant le début de la ${which} (${formatParisTime(w.start)}).`)
  if (end > w.end) msgs.push(`La pose se termine après la fin de la ${which} (${formatParisTime(w.end)}).`)
  return msgs
}

/** Légende de l'image exportée. */
export function captureInfo(s: SkyState, f: FieldOfView, moon: MoonInfo): CaptureInfo {
  const d = parisDayOf(s.start)
  const arc = s.durationMin * SIDEREAL_DEG_PER_MIN
  const moonText =
    moon.altitude > 0
      ? `Lune ${Math.round(moon.fraction * 100)} % à ${fmt1(moon.altitude)}°`
      : `Lune couchée (${Math.round(moon.fraction * 100)} %)`
  return {
    place: s.observer.label,
    when: `${pad(d.day)}/${pad(d.month)}/${d.year} à ${formatParisTime(s.start)} (heure de Paris)`,
    settings:
      `${focalText(s)}, ${s.orientation === 'landscape' ? 'paysage' : 'portrait'} · ` +
      `champ ${fmt1(f.h)}° × ${fmt1(f.v)}° · pose ${s.durationMin} min (arc ${fmt1(arc)}°) · ` +
      `visée az ${Math.round(azimuth360(s.azimuth))}°, haut. ${fmt1(s.altitude)}° · ${moonText}`,
    coords: `${s.observer.lat.toFixed(5)}° N, ${s.observer.lon.toFixed(5)}° E`
  }
}

/** Nom du fichier PNG exporté : date, heure et focale. */
export function captureFileName(s: SkyState): string {
  const d = parisDayOf(s.start)
  const t = formatParisTime(s.start).replace(':', '')
  return `star-trail-planner-${d.year}${pad(d.month)}${pad(d.day)}-${t}-${roundFocal(s.focalMm)}mm.png`
}
