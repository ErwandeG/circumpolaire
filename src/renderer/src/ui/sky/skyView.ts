import starData from '../../data/stars.json'
import { nightWindow } from '../../domain/astro/night'
import { StarField, enuToAltAz, moonState, northCelestialPole, type StarRow } from '../../domain/astro/sky'
import {
  DURATION_MAX,
  DURATION_MIN,
  SENSORS,
  SIDEREAL_DEG_PER_MIN,
  fieldOfView,
  focalFromSlider,
  frameSize,
  roundFocal,
  sliderFromFocal,
  type FrameOrientation
} from '../../domain/optics'
import { formatParisTime, parisDayOf, parisTime, type CalendarDay } from '../../domain/time'
import { distanceM, fromLocal, localFrame, stepToward } from '../../domain/geo/local'
import {
  EYE_HEIGHT_M,
  eyePosition,
  isBlocked,
  type SceneRadius,
  type WalkContext
} from '../../domain/terrain'
import { checkPointInFrance } from '../../services/geocoding'
import { STAR_COUNT_MIN, STAR_COUNT_STEP } from '../../domain/preferences'
import { loadPreferences, savePreferences } from '../../services/storage'
import { loadTerrain } from '../../services/terrainService'
import { EXPORT_LONG_SIDE_PX, composeCapture, saveCapture, type CaptureInfo } from './exportImage'
import { createMiniMap } from './miniMap'
import { SkyScene } from './scene'
import { setupWalker } from './walker'

export interface Observer {
  lat: number
  lon: number
  label: string
}

interface SkyElements {
  root: HTMLElement
  back: HTMLButtonElement
  pole: HTMLButtonElement
  moon: HTMLButtonElement
  exportButton: HTMLButtonElement
  place: HTMLElement
  coords: HTMLElement
  terrain: HTMLElement
  stage: HTMLElement
  frame: HTMLElement
  canvas: HTMLCanvasElement
  hud: HTMLElement
  warnings: HTMLElement
  focal: HTMLInputElement
  focalOut: HTMLOutputElement
  duration: HTMLInputElement
  durationOut: HTMLOutputElement
  stars: HTMLInputElement
  starsOut: HTMLOutputElement
  radius50: HTMLButtonElement
  radius150: HTMLButtonElement
  radius500: HTMLButtonElement
  sensor: HTMLSelectElement
  landscape: HTMLButtonElement
  portrait: HTMLButtonElement
  date: HTMLInputElement
  time: HTMLInputElement
  miniMapBox: HTMLElement
  miniMap: HTMLElement
  miniMapToggle: HTMLButtonElement
}

export interface SkyView {
  open(observer: Observer, night: CalendarDay): void
}

/** Catalogue trié par éclat : afficher N étoiles = prendre les N premières. */
const allStars = starData.stars as StarRow[]
const fields = new Map<number, StarField>()
function starField(count: number): StarField {
  let f = fields.get(count)
  if (!f) {
    f = new StarField(allStars.slice(0, count))
    fields.set(count, f)
  }
  return f
}
/** Nombre de points par filé : au plus ~400 000 sommets calculés, pour rester fluide à 15 000 étoiles. */
function trailSamples(durationMin: number, count: number): number {
  const wanted = Math.round(durationMin / 2) + 1
  const budget = Math.floor(400_000 / count)
  return Math.max(4, Math.min(61, wanted, budget))
}
const pad = (n: number) => String(n).padStart(2, '0')
const fmt1 = (x: number) => x.toLocaleString('fr-FR', { maximumFractionDigits: 1 })

export function setupSkyView(el: SkyElements, onClose: () => void): SkyView {
  const scene = new SkyScene(el.canvas)
  const prefs = loadPreferences()
  const state = {
    observer: { lat: 48.5734, lon: 7.7521, label: 'Strasbourg' } as Observer,
    start: new Date(),
    durationMin: prefs.durationMin,
    focalMm: prefs.focalMm,
    sensorId: SENSORS[0].id,
    orientation: prefs.orientation as FrameOrientation,
    azimuth: 0,
    altitude: 48.6,
    starCount: Math.min(prefs.starCount, allStars.length),
    radius: prefs.radius as SceneRadius,
    miniMapCollapsed: prefs.miniMapCollapsed
  }

  // Les réglages sont enregistrés peu après chaque changement, pour le lancement suivant.
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  function rememberSettings(): void {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(
      () =>
        savePreferences({
          focalMm: state.focalMm,
          durationMin: state.durationMin,
          orientation: state.orientation,
          starCount: state.starCount,
          radius: state.radius,
          miniMapCollapsed: state.miniMapCollapsed
        }),
      300
    )
  }

  for (const s of SENSORS) {
    const opt = document.createElement('option')
    opt.value = s.id
    opt.textContent = s.label
    el.sensor.append(opt)
  }
  // Un seul capteur pour l'instant : la liste est prête pour la suite.
  el.sensor.disabled = SENSORS.length < 2

  const sensor = () => SENSORS.find((s) => s.id === state.sensorId) ?? SENSORS[0]
  const frame = () => frameSize(sensor(), state.orientation)
  const fov = () => ({
    h: fieldOfView(frame().width, state.focalMm),
    v: fieldOfView(frame().height, state.focalMm)
  })

  // --- Calculs du ciel (seulement quand le lieu, l'heure ou la durée changent) ---
  let moonInfo = { fraction: 0, altitude: 0, azimuth: 0 }
  function recomputeSky(): void {
    const { lat, lon } = state.observer
    const field = starField(state.starCount)
    const stars = allStars.slice(0, state.starCount)
    const samples = trailSamples(state.durationMin, state.starCount)
    const starStart = field.trails(state.start, 0, 1, lat, lon)
    const trails = field.trails(state.start, state.durationMin, samples, lat, lon)
    const moon = moonState(state.start, state.durationMin, Math.min(samples, 25), lat, lon)
    const moonPos = enuToAltAz(moon.direction)
    moonInfo = { fraction: moon.illuminatedFraction, altitude: moonPos.altitude, azimuth: moonPos.azimuth }
    el.moon.disabled = moonPos.altitude < -1
    el.moon.title = el.moon.disabled ? 'La Lune est sous l’horizon au début de la pose' : ''
    scene.setContent({
      stars,
      starStart,
      trails,
      samples,
      polarisIndex: starData.polarisIndex,
      pole: northCelestialPole(state.start, lat, lon),
      moon
    })
    renderWarnings()
  }

  // --- Cadre : le canevas a exactement le rapport du capteur, centré dans la zone ---
  function layout(): void {
    const { width: fw, height: fh } = frame()
    const aspect = fw / fh
    const box = el.stage.getBoundingClientRect()
    const maxW = Math.max(100, box.width - 24)
    const maxH = Math.max(100, box.height - 24)
    let w = maxW
    let h = w / aspect
    if (h > maxH) {
      h = maxH
      w = h * aspect
    }
    el.frame.style.width = `${Math.floor(w)}px`
    el.frame.style.height = `${Math.floor(h)}px`
    scene.setSize(Math.floor(w), Math.floor(h))
    draw()
  }

  let pending = false
  function draw(): void {
    if (pending) return
    pending = true
    requestAnimationFrame(() => {
      pending = false
      const { width: fw, height: fh } = frame()
      scene.setView(state.azimuth, state.altitude, fov().v, fw / fh)
      scene.render()
      renderHud()
      // La mini-carte suit sans être redessinée à chaque image.
      const now = performance.now()
      if (now - lastMiniMap > 80) {
        lastMiniMap = now
        miniMap.update(state.observer.lat, state.observer.lon, state.azimuth, fov().h)
      }
    })
  }
  let lastMiniMap = 0

  let skyPending = false
  function scheduleSky(): void {
    if (skyPending) return
    skyPending = true
    requestAnimationFrame(() => {
      skyPending = false
      recomputeSky()
      draw()
    })
  }

  // --- Textes ---
  function renderHud(): void {
    const f = fov()
    const arc = state.durationMin * SIDEREAL_DEG_PER_MIN
    const az = ((state.azimuth % 360) + 360) % 360
    const moon =
      moonInfo.altitude > 0
        ? `Lune ${Math.round(moonInfo.fraction * 100)} %, à ${fmt1(moonInfo.altitude)}° de hauteur`
        : `Lune couchée (${Math.round(moonInfo.fraction * 100)} %)`
    el.hud.textContent =
      `Visée az ${Math.round(az)}°, haut. ${fmt1(state.altitude)}° · Champ ${fmt1(f.h)}° × ${fmt1(f.v)}° · ` +
      `Arc des filés ${fmt1(arc)}° · ${moon}`
    el.focalOut.textContent = `${roundFocal(state.focalMm)} mm`
    const limit = allStars[state.starCount - 1][2]
    el.starsOut.textContent = `${state.starCount.toLocaleString('fr-FR')} (magnitude ≤ ${fmt1(limit)})`
    el.durationOut.textContent = `${state.durationMin} min`
  }

  function renderWarnings(): void {
    const { lat, lon } = state.observer
    // La nuit du jour J va de midi J à midi J+1 (heure de Paris).
    const nightDay = parisDayOf(new Date(state.start.getTime() - 12 * 3600_000))
    const w = nightWindow(nightDay, lat, lon)
    const end = new Date(state.start.getTime() + state.durationMin * 60_000)
    const msgs: string[] = []
    if (w.kind === 'none') {
      msgs.push('Pas de nuit noire cette nuit-là : le Soleil ne descend pas sous −12°.')
    } else {
      const which = w.kind === 'astronomical' ? 'nuit astronomique' : 'nuit nautique'
      if (state.start < w.start) msgs.push(`La pose commence avant le début de la ${which} (${formatParisTime(w.start)}).`)
      if (end > w.end) msgs.push(`La pose se termine après la fin de la ${which} (${formatParisTime(w.end)}).`)
    }
    el.warnings.replaceChildren(
      ...msgs.map((m) => {
        const p = document.createElement('p')
        p.className = 'sky-warning'
        p.textContent = `⚠ ${m}`
        return p
      })
    )
  }

  function syncInputs(): void {
    el.focal.value = String(Math.round(sliderFromFocal(state.focalMm) * 1000))
    el.duration.min = String(DURATION_MIN)
    el.duration.max = String(DURATION_MAX)
    el.duration.value = String(state.durationMin)
    el.stars.min = String(STAR_COUNT_MIN)
    el.stars.max = String(Math.min(15000, allStars.length))
    el.stars.step = String(STAR_COUNT_STEP)
    el.stars.value = String(state.starCount)
    el.sensor.value = state.sensorId
    el.radius50.setAttribute('aria-pressed', String(state.radius === 50))
    el.radius150.setAttribute('aria-pressed', String(state.radius === 150))
    el.radius500.setAttribute('aria-pressed', String(state.radius === 500))
    el.landscape.setAttribute('aria-pressed', String(state.orientation === 'landscape'))
    el.portrait.setAttribute('aria-pressed', String(state.orientation === 'portrait'))
    const d = parisDayOf(state.start)
    el.date.value = `${d.year}-${pad(d.month)}-${pad(d.day)}`
    el.time.value = formatParisTime(state.start)
  }

  function aimAtPole(): void {
    const p = enuToAltAz(northCelestialPole(state.start, state.observer.lat, state.observer.lon))
    state.azimuth = p.azimuth > 180 ? p.azimuth - 360 : p.azimuth
    state.altitude = p.altitude
    draw()
  }

  // --- Interactions ---
  el.focal.addEventListener('input', () => {
    state.focalMm = focalFromSlider(Number(el.focal.value) / 1000)
    rememberSettings()
    draw()
  })
  el.duration.addEventListener('input', () => {
    state.durationMin = Number(el.duration.value)
    rememberSettings()
    renderHud()
    scheduleSky()
  })
  el.stars.addEventListener('input', () => {
    state.starCount = Number(el.stars.value)
    rememberSettings()
    renderHud()
    scheduleSky()
  })
  const setRadius = (r: SceneRadius) => {
    if (state.radius === r) return
    state.radius = r
    rememberSettings()
    syncInputs()
    // On garde la scène affichée pendant le chargement de la nouvelle zone.
    void loadBuildings(true)
  }
  el.radius50.addEventListener('click', () => setRadius(50))
  el.radius150.addEventListener('click', () => setRadius(150))
  el.radius500.addEventListener('click', () => setRadius(500))
  el.landscape.addEventListener('click', () => {
    state.orientation = 'landscape'
    rememberSettings()
    syncInputs()
    layout()
  })
  el.portrait.addEventListener('click', () => {
    state.orientation = 'portrait'
    rememberSettings()
    syncInputs()
    layout()
  })
  const onDateTime = () => {
    const [y, m, d] = el.date.value.split('-').map(Number)
    const [hh, mm] = el.time.value.split(':').map(Number)
    if (![y, m, d, hh, mm].every(Number.isFinite)) return
    state.start = parisTime({ year: y, month: m, day: d }, hh, mm)
    scheduleSky()
  }
  el.date.addEventListener('change', onDateTime)
  el.time.addEventListener('change', onDateTime)
  el.pole.addEventListener('click', aimAtPole)

  // --- Export de l'image du cadre ---
  function captureInfo(): CaptureInfo {
    const d = parisDayOf(state.start)
    const f = fov()
    const arc = state.durationMin * SIDEREAL_DEG_PER_MIN
    const moon =
      moonInfo.altitude > 0
        ? `Lune ${Math.round(moonInfo.fraction * 100)} % à ${fmt1(moonInfo.altitude)}°`
        : `Lune couchée (${Math.round(moonInfo.fraction * 100)} %)`
    return {
      place: state.observer.label,
      when: `${pad(d.day)}/${pad(d.month)}/${d.year} à ${formatParisTime(state.start)} (heure de Paris)`,
      settings:
        `${roundFocal(state.focalMm)} mm plein format, ${state.orientation === 'landscape' ? 'paysage' : 'portrait'} · ` +
        `champ ${fmt1(f.h)}° × ${fmt1(f.v)}° · pose ${state.durationMin} min (arc ${fmt1(arc)}°) · ` +
        `visée az ${Math.round(((state.azimuth % 360) + 360) % 360)}°, haut. ${fmt1(state.altitude)}° · ${moon}`,
      coords: `${state.observer.lat.toFixed(5)}° N, ${state.observer.lon.toFixed(5)}° E`
    }
  }

  function captureFileName(): string {
    const d = parisDayOf(state.start)
    const t = formatParisTime(state.start).replace(':', '')
    return `circumpolaire-${d.year}${pad(d.month)}${pad(d.day)}-${t}-${roundFocal(state.focalMm)}mm.png`
  }

  /** Rendu en haute définition (2 400 px sur le grand côté), puis retour à la taille d'écran. */
  function renderForExport(): HTMLCanvasElement {
    const { width: fw, height: fh } = frame()
    const aspect = fw / fh
    const w = aspect >= 1 ? EXPORT_LONG_SIDE_PX : Math.round(EXPORT_LONG_SIDE_PX * aspect)
    const h = aspect >= 1 ? Math.round(EXPORT_LONG_SIDE_PX / aspect) : EXPORT_LONG_SIDE_PX
    const ratio = window.devicePixelRatio
    scene.renderer.setPixelRatio(1)
    scene.setSize(w, h)
    scene.setPointScale(w / Math.max(1, el.canvas.clientWidth))
    scene.setView(state.azimuth, state.altitude, fov().v, aspect)
    scene.render()
    const capture = composeCapture(el.canvas, captureInfo())
    scene.renderer.setPixelRatio(ratio)
    scene.setPointScale(ratio)
    layout()
    return capture
  }

  el.exportButton.addEventListener('click', async () => {
    try {
      await saveCapture(renderForExport(), captureFileName())
    } catch (e) {
      el.terrain.textContent = `Export impossible : ${(e as Error).message}`
      el.terrain.dataset.tone = 'error'
    }
  })
  el.moon.addEventListener('click', () => {
    // On garde la continuité de l'azimut pour ne pas faire un tour complet.
    let az = moonInfo.azimuth
    while (az - state.azimuth > 180) az -= 360
    while (state.azimuth - az > 180) az += 360
    state.azimuth = az
    state.altitude = moonInfo.altitude
    draw()
  })
  el.back.addEventListener('click', () => {
    el.root.hidden = true
    onClose()
  })

  // Glisser pour tourner : on « attrape » le ciel.
  let drag: { x: number; y: number; az: number; alt: number } | null = null
  el.canvas.tabIndex = 0
  el.canvas.addEventListener('pointerdown', (e) => {
    // Le focus quitte les curseurs : les flèches du clavier servent alors à marcher.
    el.canvas.focus()
    drag = { x: e.clientX, y: e.clientY, az: state.azimuth, alt: state.altitude }
    el.canvas.setPointerCapture(e.pointerId)
  })
  el.canvas.addEventListener('pointermove', (e) => {
    if (!drag) return
    const degPerPx = fov().v / el.canvas.clientHeight
    state.azimuth = drag.az - (e.clientX - drag.x) * degPerPx
    state.altitude = Math.max(-30, Math.min(90, drag.alt + (e.clientY - drag.y) * degPerPx))
    draw()
  })
  const endDrag = () => {
    drag = null
  }
  el.canvas.addEventListener('pointerup', endDrag)
  el.canvas.addEventListener('pointercancel', endDrag)

  new ResizeObserver(() => {
    if (!el.root.hidden) layout()
  }).observe(el.stage)

  function showCoords(): void {
    el.coords.textContent = `${state.observer.lat.toFixed(5)}° N, ${state.observer.lon.toFixed(5)}° E · œil à 1,70 m`
  }

  // --- Relief et bâtiments ---
  let walk: WalkContext | null = null
  let lastGround = Number.NaN
  let loading = false
  let terrainRequest = 0

  /** Place l'œil au point courant, à 1,70 m au-dessus du sol de la scène chargée. */
  function placeEye(): void {
    if (!walk) {
      scene.setEye(0, 0, 0)
      return
    }
    const fallback = Number.isNaN(lastGround) ? walk.eyeAltitude - EYE_HEIGHT_M : lastGround
    const eye = eyePosition(walk, state.observer.lat, state.observer.lon, fallback)
    lastGround = eye.ground
    scene.setEye(eye.x, eye.y, eye.z)
  }

  /**
   * Charge les bâtiments autour du point courant.
   * keepCurrent : on garde la scène affichée pendant le chargement (déplacement à pied).
   */
  async function loadBuildings(keepCurrent: boolean): Promise<void> {
    const id = ++terrainRequest
    loading = true
    if (!keepCurrent) {
      walk = null
      lastGround = Number.NaN
      scene.setTerrain(null)
      placeEye()
    }
    el.terrain.textContent = 'Chargement des bâtiments et du relief (LiDAR HD)…'
    delete el.terrain.dataset.tone
    const res = await loadTerrain(state.observer.lat, state.observer.lon, state.radius)
    if (id !== terrainRequest) return // une autre vue a été ouverte entre-temps
    loading = false
    if (res.status === 'error') {
      el.terrain.textContent = keepCurrent && walk ? `${res.message} Zone précédente conservée.` : `${res.message} Horizon plat.`
      el.terrain.dataset.tone = 'error'
      draw()
      return
    }
    const parts = [`${res.buildingCount} bâtiment${res.buildingCount > 1 ? 's' : ''} dans les ${state.radius} m`]
    if (res.mesh.fallbackShare > 0.01) {
      parts.push(`${Math.round(res.mesh.fallbackShare * 100)} % sans LiDAR (volumes BD TOPO en orange)`)
    }
    if (res.movedM > 0 && !keepCurrent) {
      parts.push(`point déplacé de ${fmt1(res.movedM)} m pour sortir du bâtiment`)
      state.observer = { ...state.observer, lat: res.lat, lon: res.lon }
      showCoords()
      recomputeSky()
    }
    el.terrain.textContent = parts.join(' · ')
    walk = res.walk
    scene.setTerrain(res.mesh, state.radius)
    miniMap.setZone(res.walk.frame.lat0, res.walk.frame.lon0, state.radius)
    placeEye()
    draw()
  }

  // --- Déplacement à pied : 1 m/s, flèches de l'écran ou du clavier ---
  /** Au-delà de la moitié du rayon depuis le point de chargement, on recharge la zone en marchant. */
  const reloadDistance = () => state.radius / 2

  function step(forward: number, right: number): void {
    const d = stepToward(state.azimuth, forward, right)
    const f = localFrame(state.observer.lat, state.observer.lon)
    const tryMove = (e: number, n: number): boolean => {
      const p = fromLocal(f, e, n)
      if (walk && isBlocked(walk, p.lat, p.lon)) return false
      state.observer = { ...state.observer, lat: p.lat, lon: p.lon }
      return true
    }
    // Contre une façade, on glisse le long du mur sur l'axe resté libre.
    if (!tryMove(d.e, d.n) && !tryMove(d.e, 0)) tryMove(0, d.n)
    placeEye()
    showCoords()
    draw()
    const origin = walk ? { lat: walk.frame.lat0, lon: walk.frame.lon0 } : null
    if (origin && !loading && distanceM(origin, state.observer) > reloadDistance()) void loadBuildings(true)
  }

  let stopTimer: ReturnType<typeof setTimeout> | undefined
  function stopWalking(): void {
    clearTimeout(stopTimer)
    // À l'arrêt, on recharge la zone autour du nouveau point et on recalcule le ciel.
    stopTimer = setTimeout(() => {
      const origin = walk ? { lat: walk.frame.lat0, lon: walk.frame.lon0 } : null
      if (!origin || distanceM(origin, state.observer) < 1) return
      recomputeSky()
      draw()
      void loadBuildings(true)
    }, 700)
  }

  setupWalker({
    isActive: () => !el.root.hidden,
    onStep: step,
    onStop: stopWalking
  })

  // --- Mini-carte : où l'on est, ce que l'on vise ; un clic déplace le point de vue ---
  async function moveTo(lat: number, lon: number): Promise<void> {
    const check = await checkPointInFrance(lat, lon)
    if (check.status === 'outside') {
      el.terrain.textContent = 'Ce point est hors de France métropolitaine.'
      el.terrain.dataset.tone = 'error'
      return
    }
    state.observer = {
      lat,
      lon,
      label: check.status === 'inside' && check.label ? `Près de ${check.label}` : 'Point choisi sur la carte'
    }
    el.place.textContent = state.observer.label
    showCoords()
    recomputeSky()
    draw()
    void loadBuildings(false)
  }
  const miniMap = createMiniMap(
    el.miniMapBox,
    el.miniMap,
    el.miniMapToggle,
    (lat, lon) => void moveTo(lat, lon),
    state.miniMapCollapsed,
    (collapsed) => {
      state.miniMapCollapsed = collapsed
      rememberSettings()
    }
  )

  return {
    open(observer, night) {
      state.observer = observer
      // Début par défaut : début de la fenêtre de nuit de la date choisie, sinon 23:00.
      const w = nightWindow(night, observer.lat, observer.lon)
      state.start = w.kind === 'none' ? parisTime(night, 23) : new Date(Math.ceil(w.start.getTime() / 60_000) * 60_000)
      el.place.textContent = observer.label
      showCoords()
      el.root.hidden = false
      syncInputs()
      recomputeSky()
      aimAtPole()
      layout()
      miniMap.setZone(observer.lat, observer.lon, state.radius)
      miniMap.refresh(observer.lat, observer.lon)
      void loadBuildings(false)
    }
  }
}
