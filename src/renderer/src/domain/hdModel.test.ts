import { describe, expect, it } from 'vitest'
import { entryData, parseObjTriangles, parseZipDirectory, tileOrigin } from './hdModel'

/** Petite archive zip (une entrée stockée, non compressée) construite à la main. */
function tinyZip(name: string, data: string): Uint8Array {
  const enc = new TextEncoder()
  const n = enc.encode(name)
  const d = enc.encode(data)
  const local = new Uint8Array(30 + n.length + d.length)
  const lv = new DataView(local.buffer)
  lv.setUint32(0, 0x04034b50, true)
  lv.setUint32(18, d.length, true)
  lv.setUint32(22, d.length, true)
  lv.setUint16(26, n.length, true)
  local.set(n, 30)
  local.set(d, 30 + n.length)
  const central = new Uint8Array(46 + n.length)
  const cv = new DataView(central.buffer)
  cv.setUint32(0, 0x02014b50, true)
  cv.setUint32(20, d.length, true)
  cv.setUint16(28, n.length, true)
  cv.setUint32(42, 0, true)
  central.set(n, 46)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint32(12, central.length, true)
  ev.setUint32(16, local.length, true)
  const zip = new Uint8Array(local.length + central.length + end.length)
  zip.set(local)
  zip.set(central, local.length)
  zip.set(end, local.length + central.length)
  return zip
}

describe('bâtiments HD (maquette 3D de Strasbourg)', () => {
  const obj = 'v 0 0 140\nv 10 0 140\nv 10 5 140\nv 0 5 150\nvt 0 0\nf 1/1 2/1 3/1 4/1\n'

  it('lit le sommaire de l’archive depuis sa fin, puis une entrée', () => {
    const zip = tinyZip('T/BATI3D_LOD2/A.obj', obj)
    const tailStart = 10
    const entries = parseZipDirectory(zip.subarray(tailStart), tailStart)
    expect(entries).toHaveLength(1)
    expect(entries![0].name).toBe('T/BATI3D_LOD2/A.obj')
    const data = entryData(zip.subarray(entries![0].localHeaderOffset), entries![0])
    expect(new TextDecoder().decode(data)).toBe(obj)
  })

  it('demande à lire plus loin si le sommaire est coupé', () => {
    const zip = tinyZip('A.obj', obj)
    expect(parseZipDirectory(zip.subarray(zip.length - 30), zip.length - 30)).toBeNull()
  })

  it('découpe les faces en triangles', () => {
    const t = parseObjTriangles(obj)
    expect(t.length).toBe(2 * 3 * 3)
    expect(Array.from(t.subarray(0, 9))).toEqual([0, 0, 140, 10, 0, 140, 10, 5, 140])
    expect(Array.from(t.subarray(15, 18))).toEqual([0, 5, 150])
  })

  it('lit le coin d’une dalle dans son nom', () => {
    expect(tileOrigin('2049974400_7275240000')).toEqual({ x: 2049974.4, y: 7275240 })
  })
})
