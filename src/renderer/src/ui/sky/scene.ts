import * as THREE from 'three'
import type { Enu, MoonState, StarRow } from '../../domain/astro/sky'
import { SurfaceKind, type TerrainMesh } from '../../domain/terrain'

/** Couleurs de la surface : sol, bâtiment, végétation, volume BD TOPO de repli. */
export const SURFACE_COLORS: Record<number, [number, number, number]> = {
  [SurfaceKind.Ground]: [0.14, 0.15, 0.18],
  [SurfaceKind.Building]: [0.42, 0.45, 0.5],
  [SurfaceKind.Vegetation]: [0.17, 0.28, 0.19],
  [SurfaceKind.Fallback]: [0.6, 0.39, 0.2]
}

/** Halo lumineux de la ville au ras de l'horizon : couleur de la brume. */
const FOG_COLOR = 0x171d2c

/**
 * Rendu three.js de la vue à hauteur d'homme.
 * Repère three : X = Est, Y = haut, Z = Sud (la caméra regarde vers −Z = Nord quand l'azimut vaut 0).
 * La caméra est à l'origine, à hauteur d'œil ; le sol est 1,70 m plus bas.
 */
export const EYE_HEIGHT_M = 1.7
const SKY_RADIUS = 5000

export function toVec3(v: Enu, radius = SKY_RADIUS): THREE.Vector3 {
  return new THREE.Vector3(v.e * radius, v.u * radius, -v.n * radius)
}

/** Couleur approximative d'une étoile selon son indice B−V. */
function starColor(bv: number): THREE.Color {
  const stops: [number, [number, number, number]][] = [
    [-0.3, [0.62, 0.72, 1.0]],
    [0.0, [0.8, 0.86, 1.0]],
    [0.4, [1.0, 0.98, 0.95]],
    [0.8, [1.0, 0.92, 0.75]],
    [1.2, [1.0, 0.82, 0.6]],
    [2.0, [1.0, 0.7, 0.45]]
  ]
  const x = Math.max(-0.3, Math.min(2.0, bv))
  for (let i = 1; i < stops.length; i++) {
    const [b0, c0] = stops[i - 1]
    const [b1, c1] = stops[i]
    if (x <= b1) {
      const t = (x - b0) / (b1 - b0)
      return new THREE.Color(c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t)
    }
  }
  return new THREE.Color(1, 0.7, 0.45)
}

/** Taille d'un point d'étoile en pixels selon la magnitude. */
function starSizePx(mag: number): number {
  return Math.max(1.1, Math.min(9, 1.6 + (5.2 - mag) * 1.15))
}

/** Les étoiles faibles (jusqu'à la magnitude 7) restent discrètes pour ne pas noyer les filés brillants. */
function trailAlpha(mag: number): number {
  return Math.max(0.05, Math.min(0.95, 0.2 + (5.2 - mag) * 0.14))
}

// Les objets célestes sous l'horizon (y < 0) sont masqués.
const pointsVertex = /* glsl */ `
  attribute float size;
  attribute vec3 color;
  varying vec3 vColor;
  varying float vAbove;
  uniform float pixelRatio;
  void main() {
    vColor = color;
    vAbove = position.y;
    gl_PointSize = size * pixelRatio;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const pointsFragment = /* glsl */ `
  varying vec3 vColor;
  varying float vAbove;
  void main() {
    if (vAbove < 0.0) discard;
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    float a = smoothstep(0.5, 0.15, d);
    gl_FragColor = vec4(vColor, a);
  }
`
const linesVertex = /* glsl */ `
  attribute vec4 rgba;
  varying vec4 vRgba;
  varying float vAbove;
  void main() {
    vRgba = rgba;
    vAbove = position.y;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const linesFragment = /* glsl */ `
  varying vec4 vRgba;
  varying float vAbove;
  void main() {
    if (vAbove < 0.0) discard;
    gl_FragColor = vRgba;
  }
`

function textSprite(text: string, color: string, sizePx = 13): THREE.Sprite {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!
  const font = `600 ${sizePx * 2}px "Segoe UI", system-ui, sans-serif`
  ctx.font = font
  const w = Math.ceil(ctx.measureText(text).width) + 8
  canvas.width = w
  canvas.height = sizePx * 2 + 8
  ctx.font = font
  ctx.fillStyle = color
  ctx.textBaseline = 'middle'
  ctx.fillText(text, 4, canvas.height / 2)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ fog: false, map: tex, depthTest: false, transparent: true }))
  sprite.userData.pixelSize = { w: canvas.width / 2, h: canvas.height / 2 }
  sprite.center.set(0, 0.5)
  sprite.renderOrder = 10
  return sprite
}

function ringSprite(color: string, sizePx: number, cross = false): THREE.Sprite {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 64
  const ctx = canvas.getContext('2d')!
  ctx.strokeStyle = color
  ctx.lineWidth = 3
  ctx.beginPath()
  if (cross) {
    ctx.moveTo(32, 8)
    ctx.lineTo(32, 56)
    ctx.moveTo(8, 32)
    ctx.lineTo(56, 32)
  } else {
    ctx.arc(32, 32, 26, 0, Math.PI * 2)
  }
  ctx.stroke()
  const tex = new THREE.CanvasTexture(canvas)
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ fog: false, map: tex, depthTest: false, transparent: true }))
  sprite.userData.pixelSize = { w: sizePx, h: sizePx }
  sprite.renderOrder = 10
  return sprite
}

/** Halo de taille fixe en pixels : garde la Lune repérable en grand-angle. */
function glowSprite(sizePx: number): THREE.Sprite {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 64
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 32)
  g.addColorStop(0, 'rgba(255, 244, 214, 0.9)')
  g.addColorStop(0.25, 'rgba(255, 236, 190, 0.35)')
  g.addColorStop(1, 'rgba(255, 236, 190, 0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 64, 64)
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ fog: false,
      map: new THREE.CanvasTexture(canvas),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    })
  )
  sprite.userData.pixelSize = { w: sizePx, h: sizePx }
  sprite.renderOrder = 5
  return sprite
}

export interface SkyContent {
  stars: readonly StarRow[]
  /** Positions au début de la pose, une par étoile. */
  starStart: Float32Array
  /** Filés : [étoile][échantillon][e, n, u]. */
  trails: Float32Array
  samples: number
  polarisIndex: number
  pole: Enu
  moon: MoonState
}

export class SkyScene {
  readonly renderer: THREE.WebGLRenderer
  readonly camera: THREE.PerspectiveCamera
  private readonly scene = new THREE.Scene()
  private starPoints?: THREE.Points
  private trailLines?: THREE.LineSegments
  private moonGroup = new THREE.Group()
  private moonMesh: THREE.Mesh
  private moonTrail?: THREE.Line
  private sun = new THREE.DirectionalLight(0xffffff, 3)
  private readonly labels: THREE.Sprite[] = []
  private polarisRing = ringSprite('#7dd3fc', 26)
  private polarisLabel = textSprite('Polaire', '#7dd3fc')
  private poleMark = ringSprite('#fca5a5', 14, true)
  private poleLabel = textSprite('Pôle', '#fca5a5', 11)
  private moonLabel = textSprite('Lune', '#fde68a')
  private moonGlow = glowSprite(34)
  /**
   * Tout ce qui est « à l'infini » (ciel, horizon, sol lointain) suit la caméra :
   * se déplacer de quelques mètres ne doit pas décaler les étoiles, même à 600 mm.
   */
  private readonly sky = new THREE.Group()

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true })
    this.renderer.setPixelRatio(window.devicePixelRatio)
    this.scene.background = new THREE.Color(0x060b18)
    this.camera = new THREE.PerspectiveCamera(50, 1.5, 0.1, 50_000)
    this.camera.rotation.order = 'YXZ'
    this.scene.add(this.sky)
    // L'étiquette de la Lune disparaît avec elle derrière les bâtiments.
    this.moonLabel.material.depthTest = true

    // Sol : disque sombre à 1,70 m sous l'œil.
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(20_000, 96),
      new THREE.MeshBasicMaterial({ color: 0x0d1117 })
    )
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -EYE_HEIGHT_M
    this.groundDisc = ground
    this.sky.add(ground)

    // Ligne d'horizon et points cardinaux.
    const horizonPts: THREE.Vector3[] = []
    for (let i = 0; i <= 360; i += 2) {
      const a = (i * Math.PI) / 180
      horizonPts.push(new THREE.Vector3(Math.sin(a) * SKY_RADIUS, 0.5, -Math.cos(a) * SKY_RADIUS))
    }
    this.sky.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(horizonPts),
        new THREE.LineBasicMaterial({ color: 0x3b4a63, fog: false })
      )
    )
    const cardinals: [string, number][] = [
      ['N', 0], ['NE', 45], ['E', 90], ['SE', 135], ['S', 180], ['SO', 225], ['O', 270], ['NO', 315]
    ]
    for (const [label, az] of cardinals) {
      const s = textSprite(label, label.length === 1 ? '#cbd5e1' : '#64748b', label.length === 1 ? 14 : 11)
      const a = (az * Math.PI) / 180
      s.position.set(Math.sin(a) * SKY_RADIUS, SKY_RADIUS * Math.sin((0.8 * Math.PI) / 180), -Math.cos(a) * SKY_RADIUS)
      s.center.set(0.5, 0)
      // Les points cardinaux passent derrière les bâtiments.
      s.material.depthTest = true
      this.labels.push(s)
      this.sky.add(s)
    }

    // Lune : sphère éclairée par le Soleil, donc phase et orientation exactes.
    this.moonMesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 48, 32),
      new THREE.MeshStandardMaterial({ color: 0xe8e4d8, roughness: 1, metalness: 0, fog: false })
    )
    this.moonGroup.add(this.moonMesh)
    this.sky.add(this.moonGroup)
    this.sky.add(this.sun)
    this.sky.add(this.sun.target)
    this.sky.add(new THREE.AmbientLight(0xffffff, 0.04))

    for (const s of [this.moonGlow, this.polarisRing, this.polarisLabel, this.poleMark, this.poleLabel, this.moonLabel]) {
      this.labels.push(s)
      this.sky.add(s)
    }
  }

  setContent(c: SkyContent): void {
    // Étoiles au début de la pose.
    const n = c.stars.length
    const sizes = new Float32Array(n)
    const colors = new Float32Array(n * 3)
    const positions = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      const [, , mag, bv] = c.stars[i]
      sizes[i] = starSizePx(mag)
      const col = starColor(bv)
      colors.set([col.r, col.g, col.b], i * 3)
      const v = toVec3({ e: c.starStart[i * 3], n: c.starStart[i * 3 + 1], u: c.starStart[i * 3 + 2] })
      positions.set([v.x, v.y, v.z], i * 3)
    }
    if (!this.starPoints) {
      const geom = new THREE.BufferGeometry()
      this.starPoints = new THREE.Points(
        geom,
        new THREE.ShaderMaterial({
          vertexShader: pointsVertex,
          fragmentShader: pointsFragment,
          uniforms: { pixelRatio: { value: this.pointScale } },
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending
        })
      )
      this.starPoints.frustumCulled = false
      this.sky.add(this.starPoints)
    }
    // Nouvelle géométrie à chaque calcul, l'ancienne est libérée de la carte graphique
    // (sinon les tampons s'accumulent et tout ralentit à 15 000 étoiles).
    this.starPoints.geometry.dispose()
    const sg = new THREE.BufferGeometry()
    this.starPoints.geometry = sg
    sg.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    sg.setAttribute('size', new THREE.BufferAttribute(sizes, 1))
    sg.setAttribute('color', new THREE.BufferAttribute(colors, 3))

    // Filés : un segment entre chaque paire d'échantillons consécutifs.
    const segs = c.samples - 1
    const linePos = new Float32Array(n * segs * 2 * 3)
    const lineCol = new Float32Array(n * segs * 2 * 4)
    let p = 0
    let q = 0
    for (let i = 0; i < n; i++) {
      const [, , mag, bv] = c.stars[i]
      const col = starColor(bv)
      const a = trailAlpha(mag)
      for (let k = 0; k < segs; k++) {
        for (const kk of [k, k + 1]) {
          const o = (i * c.samples + kk) * 3
          linePos[p++] = c.trails[o] * SKY_RADIUS
          linePos[p++] = c.trails[o + 2] * SKY_RADIUS
          linePos[p++] = -c.trails[o + 1] * SKY_RADIUS
          lineCol[q++] = col.r
          lineCol[q++] = col.g
          lineCol[q++] = col.b
          lineCol[q++] = a
        }
      }
    }
    if (!this.trailLines) {
      this.trailLines = new THREE.LineSegments(
        new THREE.BufferGeometry(),
        new THREE.ShaderMaterial({
          vertexShader: linesVertex,
          fragmentShader: linesFragment,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending
        })
      )
      this.trailLines.frustumCulled = false
      this.sky.add(this.trailLines)
    }
    this.trailLines.geometry.dispose()
    const tg = new THREE.BufferGeometry()
    this.trailLines.geometry = tg
    tg.setAttribute('position', new THREE.BufferAttribute(linePos, 3))
    tg.setAttribute('rgba', new THREE.BufferAttribute(lineCol, 4))

    // Polaire et pôle.
    const pi = c.polarisIndex
    const polaris = toVec3({ e: c.starStart[pi * 3], n: c.starStart[pi * 3 + 1], u: c.starStart[pi * 3 + 2] })
    this.polarisRing.position.copy(polaris)
    this.polarisLabel.position.copy(polaris)
    this.polarisLabel.userData.offsetPx = { x: 16, y: 0 }
    const pole = toVec3(c.pole)
    this.poleMark.position.copy(pole)
    this.poleLabel.position.copy(pole)
    this.poleLabel.userData.offsetPx = { x: 10, y: -12 }

    // Lune : taille réelle (diamètre apparent) à distance du ciel.
    const moonPos = toVec3(c.moon.direction)
    const radius = SKY_RADIUS * Math.tan(((c.moon.diameterDeg / 2) * Math.PI) / 180)
    this.moonMesh.scale.setScalar(radius)
    this.moonGroup.position.copy(moonPos)
    this.moonGroup.visible = c.moon.direction.u > -0.01
    const sunDir = toVec3(c.moon.sunDirection, 1).normalize()
    this.sun.position.copy(moonPos).addScaledVector(sunDir, 1000)
    this.sun.target.position.copy(moonPos)
    this.moonLabel.position.copy(moonPos)
    this.moonLabel.userData.offsetPx = { x: 12, y: 0 }
    this.moonLabel.visible = this.moonGroup.visible
    this.moonGlow.position.copy(moonPos)
    this.moonGlow.visible = this.moonGroup.visible
    this.moonGlow.material.opacity = 0.25 + 0.75 * c.moon.illuminatedFraction

    if (this.moonTrail) {
      this.sky.remove(this.moonTrail)
      this.moonTrail.geometry.dispose()
    }
    const trackPos = new Float32Array(c.moon.track.length * 3)
    const trackCol = new Float32Array(c.moon.track.length * 4)
    c.moon.track.forEach((v, i) => {
      const t = toVec3(v)
      trackPos.set([t.x, t.y, t.z], i * 3)
      trackCol.set([0.99, 0.9, 0.55, 0.55], i * 4)
    })
    const mg = new THREE.BufferGeometry()
    mg.setAttribute('position', new THREE.BufferAttribute(trackPos, 3))
    mg.setAttribute('rgba', new THREE.BufferAttribute(trackCol, 4))
    this.moonTrail = new THREE.Line(
      mg,
      new THREE.ShaderMaterial({ vertexShader: linesVertex, fragmentShader: linesFragment, transparent: true, depthWrite: false })
    )
    this.moonTrail.frustumCulled = false
    this.sky.add(this.moonTrail)
  }

  private terrain?: THREE.Mesh
  private outline?: THREE.LineSegments

  /**
   * Surface LiDAR (bâtiments, arbres, relief). Opaque : elle cache étoiles, filés et Lune.
   *
   * Éclairage de nuit calculé par sommet, indépendant des lumières three.js
   * (le Soleil, qui éclaire la Lune, ne doit pas éclairer les façades) :
   * - lumière du ciel nocturne, surtout sur les toits ; façades nuancées selon leur orientation ;
   * - lueur chaude de l'éclairage public, forte au ras du sol, éteinte vers 10 m ;
   * - ombres de contact au pied des murs et sur le sol autour des bâtiments ;
   * - brume de distance (la ville s'estompe dans le halo lumineux) ; arêtes soulignées.
   */
  setTerrain(mesh: TerrainMesh | null, radius = 50): void {
    if (this.terrain) {
      this.scene.remove(this.terrain)
      this.terrain.geometry.dispose()
      ;(this.terrain.material as THREE.Material).dispose()
      this.terrain = undefined
    }
    if (this.outline) {
      this.scene.remove(this.outline)
      this.outline.geometry.dispose()
      ;(this.outline.material as THREE.Material).dispose()
      this.outline = undefined
    }
    if (!mesh) {
      this.scene.fog = null
      return
    }
    const geom = new THREE.BufferGeometry()
    geom.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3))
    geom.setIndex(new THREE.BufferAttribute(mesh.indices, 1))
    geom.computeVertexNormals()
    const normals = geom.getAttribute('normal')
    const colors = new Float32Array(mesh.kinds.length * 3)
    const tmp = new THREE.Color()
    for (let i = 0; i < mesh.kinds.length; i++) {
      const kind = mesh.kinds[i]
      const [r, g, b] = SURFACE_COLORS[kind] ?? SURFACE_COLORS[SurfaceKind.Ground]
      // Les faces n'ont pas toutes le même sens : on raisonne sur la valeur absolue des normales.
      const ny = Math.abs(normals.getY(i))
      const nx = Math.abs(normals.getX(i))
      const elev = mesh.elevation[i]
      const isBuilding = kind === SurfaceKind.Building || kind === SurfaceKind.Fallback
      // Ciel nocturne : toits nettement plus clairs, façades est/ouest un peu plus que nord/sud.
      const sky = 0.46 + 0.36 * ny + 0.16 * nx * (1 - ny)
      // Éclairage public : lueur chaude près du sol, surtout sur les façades.
      const glow = 0.62 * Math.exp(-elev / 7) * (1 - 0.55 * ny)
      // Ombre de contact : pied des murs, et sol autour des bâtiments.
      const contact = (isBuilding ? 0.6 + 0.4 * Math.min(1, elev / 3) : 1) * mesh.contact[i]
      tmp.setRGB(
        (r * sky + glow * 0.34) * contact,
        (g * sky + glow * 0.22) * contact,
        (b * sky + glow * 0.12) * contact,
        THREE.SRGBColorSpace
      )
      colors[i * 3] = tmp.r
      colors[i * 3 + 1] = tmp.g
      colors[i * 3 + 2] = tmp.b
    }
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    this.terrain = new THREE.Mesh(
      geom,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        side: THREE.DoubleSide,
        // Faces légèrement repoussées : le liseré des arêtes passe devant sans scintiller.
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1
      })
    )
    this.terrain.renderOrder = -1
    this.scene.add(this.terrain)

    if (mesh.outline.length > 0) {
      const lg = new THREE.BufferGeometry()
      lg.setAttribute('position', new THREE.BufferAttribute(mesh.outline, 3))
      this.outline = new THREE.LineSegments(
        lg,
        new THREE.LineBasicMaterial({ color: 0xb8c4d6, transparent: true, opacity: 0.3 })
      )
      this.scene.add(this.outline)
    }

    // Brume : plus le rayon est grand, plus elle est légère (≈ 35 % à la limite du cercle).
    this.scene.fog = new THREE.FogExp2(FOG_COLOR, 0.45 / (radius + 80))
  }

  /** Oriente la caméra : azimut et hauteur du centre du cadre, champ vertical, rapport largeur/hauteur. */
  setView(azimuthDeg: number, altitudeDeg: number, vFovDeg: number, aspect: number): void {
    this.camera.rotation.y = (-azimuthDeg * Math.PI) / 180
    this.camera.rotation.x = (altitudeDeg * Math.PI) / 180
    this.camera.fov = vFovDeg
    this.camera.aspect = aspect
    this.camera.updateProjectionMatrix()
  }

  /**
   * Taille des points d'étoiles en pixels de rendu par pixel d'écran.
   * Pour un export agrandi, les étoiles gardent la même taille relative qu'à l'écran.
   */
  setPointScale(scale: number): void {
    this.pointScale = scale
    const mat = this.starPoints?.material as THREE.ShaderMaterial | undefined
    if (mat) mat.uniforms.pixelRatio.value = scale
  }
  private pointScale = window.devicePixelRatio

  /** Position de l'œil dans le repère de la scène chargée (mètres). */
  setEye(x: number, y: number, z: number, eyeHeight = EYE_HEIGHT_M): void {
    this.camera.position.set(x, y, z)
    // Le sol lointain suit la caméra : il reste à la hauteur d'œil sous elle.
    this.groundDisc.position.y = -eyeHeight
  }
  private groundDisc!: THREE.Mesh

  setSize(width: number, height: number): void {
    this.renderer.setSize(width, height, false)
  }

  render(): void {
    // Étiquettes à taille constante en pixels, décalées à côté de leur repère.
    const h = this.renderer.domElement.clientHeight || 1
    const worldPerPx = (d: number) => (2 * d * Math.tan((this.camera.fov * Math.PI) / 360)) / h
    this.sky.position.copy(this.camera.position)
    this.camera.updateMatrixWorld()
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0)
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1)
    for (const s of this.labels) {
      const base = (s.userData.basePosition as THREE.Vector3 | undefined) ?? s.position.clone()
      s.userData.basePosition = base
      const d = base.length()
      const k = worldPerPx(d)
      const px = s.userData.pixelSize as { w: number; h: number }
      s.scale.set(px.w * k, px.h * k, 1)
      let off = s.userData.offsetPx as { x: number; y: number } | undefined
      // L'étiquette de la Lune se place après le disque, quelle que soit la focale.
      if (s === this.moonLabel && off) off = { x: off.x + this.moonMesh.scale.x / k, y: off.y }
      s.position.copy(base)
      if (off) s.position.addScaledVector(right, off.x * k).addScaledVector(up, off.y * k)
    }
    this.renderer.render(this.scene, this.camera)
    for (const s of this.labels) {
      s.position.copy(s.userData.basePosition as THREE.Vector3)
      delete s.userData.basePosition
    }
  }

  dispose(): void {
    this.renderer.dispose()
  }
}
