import type { ViewPreferences } from '../../domain/preferences'
import type { FrameOrientation } from '../../domain/optics'
import type { SceneRadius } from '../../domain/terrain'

export interface Observer {
  lat: number
  lon: number
  label: string
}

/** État de la vue du ciel : lieu, instant, visée et réglages, repris des préférences enregistrées. */
export function createSkyState(prefs: ViewPreferences, starMax: number) {
  return {
    observer: { lat: 48.5734, lon: 7.7521, label: 'Strasbourg' } as Observer,
    start: new Date(),
    durationMin: prefs.durationMin,
    focalMm: prefs.focalMm,
    sensorId: prefs.sensorId,
    orientation: prefs.orientation as FrameOrientation,
    azimuth: 0,
    altitude: 48.6,
    /** Rotation tonneau du cadre (degrés), autour de l'axe de visée. */
    roll: 0,
    starCount: Math.min(prefs.starCount, starMax),
    radius: prefs.radius as SceneRadius,
    miniMapCollapsed: prefs.miniMapCollapsed,
    controlsCollapsed: prefs.controlsCollapsed,
    eyeHeight: prefs.eyeHeight,
    showTrees: prefs.showTrees,
    hdBuildings: prefs.hdBuildings,
    reliefOn: prefs.reliefOn,
    reliefDistance: prefs.reliefDistanceM
  }
}

export type SkyState = ReturnType<typeof createSkyState>

/** Réglages à retrouver au lancement suivant. */
export function toPreferences(s: SkyState): ViewPreferences {
  return {
    focalMm: s.focalMm,
    sensorId: s.sensorId,
    durationMin: s.durationMin,
    orientation: s.orientation,
    starCount: s.starCount,
    radius: s.radius,
    miniMapCollapsed: s.miniMapCollapsed,
    controlsCollapsed: s.controlsCollapsed,
    eyeHeight: s.eyeHeight,
    showTrees: s.showTrees,
    hdBuildings: s.hdBuildings,
    reliefOn: s.reliefOn,
    reliefDistanceM: s.reliefDistance
  }
}
