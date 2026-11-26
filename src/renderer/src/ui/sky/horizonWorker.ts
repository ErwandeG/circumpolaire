/// <reference lib="webworker" />
// Calcul du profil d'horizon hors du fil principal : l'interface reste fluide.
import { computeHorizon, ridgeSegments, type HorizonParams } from '../../domain/horizon'

self.onmessage = (e: MessageEvent<{ id: number; params: HorizonParams }>) => {
  const { id, params } = e.data
  const profile = computeHorizon(params)
  const segments = ridgeSegments(profile)
  ;(self as unknown as Worker).postMessage({ id, profile, segments }, [
    profile.skyline.buffer,
    profile.skylineDistance.buffer,
    profile.ridges.buffer,
    segments.buffer
  ])
}
