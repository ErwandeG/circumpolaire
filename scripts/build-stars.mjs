// Génère src/renderer/src/data/stars.json à partir de la base HYG v4.1.
// Usage : node scripts/build-stars.mjs <chemin vers hygdata_v41.csv>
// Source : https://github.com/astronexus/HYG-Database (licence CC BY-SA 4.0),
// compilation des catalogues Hipparcos, Yale Bright Star et Gliese.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const COUNT = 2000
const csvPath = process.argv[2]
if (!csvPath) {
  console.error('Usage : node scripts/build-stars.mjs <hygdata_v41.csv>')
  process.exit(1)
}

/** Découpe une ligne CSV en respectant les guillemets. */
function splitCsv(line) {
  const out = []
  let cur = ''
  let quoted = false
  for (const ch of line) {
    if (ch === '"') quoted = !quoted
    else if (ch === ',' && !quoted) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out
}

const lines = readFileSync(csvPath, 'utf8').split(/\r?\n/).filter(Boolean)
const header = splitCsv(lines[0])
const col = (name) => {
  const i = header.indexOf(name)
  if (i < 0) throw new Error(`Colonne ${name} absente`)
  return i
}
const iId = col('id'), iRa = col('ra'), iDec = col('dec'), iMag = col('mag'), iCi = col('ci')
const iProper = col('proper'), iHr = col('hr'), iBayer = col('bayer'), iCon = col('con')

const stars = []
for (const line of lines.slice(1)) {
  const f = splitCsv(line)
  if (f[iId] === '0') continue // le Soleil
  const mag = Number(f[iMag])
  const ra = Number(f[iRa])
  const dec = Number(f[iDec])
  if (!Number.isFinite(mag) || !Number.isFinite(ra) || !Number.isFinite(dec)) continue
  const ci = Number(f[iCi])
  stars.push({
    ra: ra * 15, // heures → degrés
    dec,
    mag,
    bv: Number.isFinite(ci) && f[iCi] !== '' ? ci : 0.6,
    name: f[iProper] || (f[iBayer] && f[iCon] ? `${f[iBayer]} ${f[iCon]}` : ''),
    hr: f[iHr] ? Number(f[iHr]) : null
  })
}

stars.sort((a, b) => a.mag - b.mag)
const selected = stars.slice(0, COUNT)
const polarisIndex = selected.findIndex((s) => s.name === 'Polaris')
if (polarisIndex < 0) throw new Error('Polaris absente de la sélection')

const r = (x, d) => Math.round(x * 10 ** d) / 10 ** d
const data = {
  source: 'HYG v4.1 (CC BY-SA 4.0), https://github.com/astronexus/HYG-Database',
  equinox: 'J2000',
  count: selected.length,
  limitingMagnitude: r(selected.at(-1).mag, 2),
  polarisIndex,
  // [ascension droite °, déclinaison °, magnitude, indice de couleur B−V]
  stars: selected.map((s) => [r(s.ra, 5), r(s.dec, 5), r(s.mag, 2), r(s.bv, 2)]),
  // Noms propres des étoiles qui en ont un, par indice.
  names: Object.fromEntries(
    selected.flatMap((s, i) => (s.name && !s.name.includes(' ') ? [[i, s.name]] : []))
  )
}

const here = dirname(fileURLToPath(import.meta.url))
const outPath = join(here, '..', 'src', 'renderer', 'src', 'data', 'stars.json')
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, JSON.stringify(data))
console.log(`${data.count} étoiles, magnitude limite ${data.limitingMagnitude}, Polaris n°${polarisIndex} → ${outPath}`)
