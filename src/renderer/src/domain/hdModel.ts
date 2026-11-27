/**
 * Bâtiments HD : maquette 3D 2022 de l'Eurométropole de Strasbourg (LoD2, format OBJ, licence Etalab).
 * Lecture du sommaire d'une archive zip et des fichiers OBJ, sans réseau ni interface.
 */

/** Les OBJ sont exprimés en CC48 (EPSG:3948) moins ce décalage, en mètres ; z = altitude. */
export const HD_OFFSET_X = 2_035_000
export const HD_OFFSET_Y = 7_255_000
/** Côté d'une dalle de la maquette (m). Son nom donne son coin sud-ouest en millimètres CC48. */
export const HD_TILE_M = 409.6

export interface ZipEntry {
  name: string
  /** 0 = stocké, 8 = compressé (deflate). */
  method: number
  compressedSize: number
  /** Position de l'en-tête local dans l'archive. */
  localHeaderOffset: number
}

/**
 * Sommaire d'une archive zip à partir de sa fin (qui doit contenir le répertoire central entier).
 * Renvoie null si le répertoire central commence avant le morceau fourni : il faut lire plus loin.
 * tailStart = position dans l'archive du premier octet de `tail`.
 */
export function parseZipDirectory(tail: Uint8Array, tailStart: number): ZipEntry[] | null {
  const v = new DataView(tail.buffer, tail.byteOffset, tail.byteLength)
  let eocd = -1
  for (let i = tail.length - 22; i >= Math.max(0, tail.length - 66_000); i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('Archive zip illisible (fin introuvable)')
  const size = v.getUint32(eocd + 12, true)
  const offset = v.getUint32(eocd + 16, true)
  let p = offset - tailStart
  if (p < 0) return null
  const end = p + size
  const dec = new TextDecoder()
  const out: ZipEntry[] = []
  while (p < end && v.getUint32(p, true) === 0x02014b50) {
    const nameLen = v.getUint16(p + 28, true)
    const extraLen = v.getUint16(p + 30, true)
    const commentLen = v.getUint16(p + 32, true)
    out.push({
      name: dec.decode(tail.subarray(p + 46, p + 46 + nameLen)),
      method: v.getUint16(p + 10, true),
      compressedSize: v.getUint32(p + 20, true),
      localHeaderOffset: v.getUint32(p + 42, true)
    })
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}

/** Données d'une entrée, à partir de son en-tête local (encore compressées si method = 8). */
export function entryData(local: Uint8Array, entry: ZipEntry): Uint8Array {
  const v = new DataView(local.buffer, local.byteOffset, local.byteLength)
  if (v.getUint32(0, true) !== 0x04034b50) throw new Error('Entrée zip illisible')
  const start = 30 + v.getUint16(26, true) + v.getUint16(28, true)
  return local.subarray(start, start + entry.compressedSize)
}

/**
 * Triangles d'un fichier OBJ : [x, y, z] à la suite, trois sommets par triangle, dans le repère du fichier.
 * Les faces à plus de trois sommets sont découpées en éventail.
 */
export function parseObjTriangles(text: string): Float32Array {
  const verts: number[] = []
  const tris: number[] = []
  for (const line of text.split('\n')) {
    if (line.startsWith('v ')) {
      const p = line.trim().split(/\s+/)
      verts.push(+p[1], +p[2], +p[3])
    } else if (line.startsWith('f ')) {
      const idx = line
        .trim()
        .split(/\s+/)
        .slice(1)
        .map((s) => {
          const k = parseInt(s, 10)
          return k < 0 ? verts.length / 3 + k : k - 1
        })
      for (let i = 1; i + 1 < idx.length; i++) {
        for (const k of [idx[0], idx[i], idx[i + 1]]) tris.push(verts[k * 3], verts[k * 3 + 1], verts[k * 3 + 2])
      }
    }
  }
  return Float32Array.from(tris)
}

/** Coin sud-ouest CC48 (m) d'une dalle à partir de son nom « 2049974400_7275240000 » (millimètres). */
export function tileOrigin(name: string): { x: number; y: number } {
  const [x, y] = name.split('_').map((s) => Number(s) / 1000)
  return { x, y }
}

/**
 * Emprise d'une dalle en Lambert 93 : coin p0 et vecteurs d'un mètre le long des côtés de la dalle
 * (transformation affine CC48 → Lambert 93). Données simples, transmissibles à une tâche de fond.
 */
export interface HdTileFrame {
  p0x: number
  p0y: number
  axx: number
  axy: number
  ayx: number
  ayy: number
}

/** Le point (Lambert 93) est-il dans l'une des dalles ? */
export function hdCovers(tiles: readonly HdTileFrame[], x: number, y: number): boolean {
  for (const t of tiles) {
    const det = t.axx * t.ayy - t.ayx * t.axy
    const rx = x - t.p0x
    const ry = y - t.p0y
    const u = (rx * t.ayy - ry * t.ayx) / det
    const v = (t.axx * ry - t.axy * rx) / det
    if (u >= 0 && u <= HD_TILE_M && v >= 0 && v <= HD_TILE_M) return true
  }
  return false
}
