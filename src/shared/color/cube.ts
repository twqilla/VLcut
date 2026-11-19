/** Reading and writing .cube 3-D colour lookup tables, the format every grading tool exchanges. */

export interface Lut {
  id: string
  name: string
  /** Samples per side. */
  size: number
  /** Base64 of little-endian 16-bit red/green/blue triples, red varying fastest. */
  data: string
}

export interface LutTable {
  size: number
  /** r, g, b per entry in 0..1, red varying fastest. */
  data: Float32Array
}

/** Largest table kept; bigger ones are resampled down so projects stay small. */
export const MAX_LUT_SIZE = 33

export function parseCube(text: string): { name: string; table: LutTable } {
  let size = 0
  let name = 'LUT'
  let min = [0, 0, 0]
  let max = [1, 1, 1]
  const values: number[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const [key, ...rest] = line.split(/\s+/)
    if (key === 'TITLE') name = line.replace(/^TITLE\s*/, '').replace(/^"|"$/g, '') || name
    else if (key === 'LUT_3D_SIZE') size = Number(rest[0])
    else if (key === 'LUT_1D_SIZE') throw new Error('This is a 1-D LUT. Only 3-D .cube files are supported.')
    else if (key === 'DOMAIN_MIN') min = rest.map(Number)
    else if (key === 'DOMAIN_MAX') max = rest.map(Number)
    else if (/^[-+\d.]/.test(key)) {
      const v = [key, ...rest].map(Number)
      if (v.length === 3 && v.every(Number.isFinite)) values.push((v[0] - min[0]) / (max[0] - min[0] || 1), (v[1] - min[1]) / (max[1] - min[1] || 1), (v[2] - min[2]) / (max[2] - min[2] || 1))
    }
  }
  if (!Number.isInteger(size) || size < 2 || size > 256) throw new Error('The file has no valid LUT_3D_SIZE line.')
  if (values.length !== size ** 3 * 3) throw new Error(`Expected ${size ** 3} colour entries but found ${values.length / 3}.`)
  let table: LutTable = { size, data: Float32Array.from(values) }
  if (size > MAX_LUT_SIZE) table = resample(table, MAX_LUT_SIZE)
  return { name, table }
}

export function serializeCube(name: string, table: LutTable): string {
  const rows: string[] = [`TITLE "${name.replace(/"/g, '')}"`, `LUT_3D_SIZE ${table.size}`, 'DOMAIN_MIN 0.0 0.0 0.0', 'DOMAIN_MAX 1.0 1.0 1.0', '']
  for (let i = 0; i < table.data.length; i += 3) rows.push(`${table.data[i].toFixed(6)} ${table.data[i + 1].toFixed(6)} ${table.data[i + 2].toFixed(6)}`)
  return rows.join('\n') + '\n'
}

/** Trilinear lookup of one colour (inputs and outputs 0..1) into `out`. */
export function sampleLut(t: LutTable, r: number, g: number, b: number, out: number[]): void {
  const n = t.size - 1
  const [fr, fg, fb] = [Math.min(1, Math.max(0, r)) * n, Math.min(1, Math.max(0, g)) * n, Math.min(1, Math.max(0, b)) * n]
  const [r0, g0, b0] = [Math.min(n - 1, Math.floor(fr)), Math.min(n - 1, Math.floor(fg)), Math.min(n - 1, Math.floor(fb))]
  const [dr, dg, db] = [fr - r0, fg - g0, fb - b0]
  const at = (ri: number, gi: number, bi: number): number => (ri + gi * t.size + bi * t.size * t.size) * 3
  out[0] = out[1] = out[2] = 0
  for (let c = 0; c < 8; c++) {
    const [x, y, z] = [c & 1, (c >> 1) & 1, (c >> 2) & 1]
    const w = (x ? dr : 1 - dr) * (y ? dg : 1 - dg) * (z ? db : 1 - db)
    if (w === 0) continue
    const i = at(r0 + x, g0 + y, b0 + z)
    out[0] += t.data[i] * w
    out[1] += t.data[i + 1] * w
    out[2] += t.data[i + 2] * w
  }
}

export function resample(t: LutTable, size: number): LutTable {
  const data = new Float32Array(size ** 3 * 3)
  const out = [0, 0, 0]
  for (let b = 0; b < size; b++)
    for (let g = 0; g < size; g++)
      for (let r = 0; r < size; r++) {
        sampleLut(t, r / (size - 1), g / (size - 1), b / (size - 1), out)
        data.set(out, (r + g * size + b * size * size) * 3)
      }
  return { size, data }
}

export function identityLut(size: number): LutTable {
  const data = new Float32Array(size ** 3 * 3)
  for (let b = 0; b < size; b++)
    for (let g = 0; g < size; g++)
      for (let r = 0; r < size; r++) data.set([r / (size - 1), g / (size - 1), b / (size - 1)], (r + g * size + b * size * size) * 3)
  return { size, data }
}

export function encodeLut(t: LutTable): string {
  const bytes = new Uint8Array(t.data.length * 2)
  t.data.forEach((v, i) => {
    const q = Math.round(Math.min(1, Math.max(0, v)) * 65535)
    bytes[i * 2] = q & 255
    bytes[i * 2 + 1] = q >> 8
  })
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

export function decodeLut(lut: Lut): LutTable {
  const bin = atob(lut.data)
  const data = new Float32Array(bin.length / 2)
  for (let i = 0; i < data.length; i++) data[i] = (bin.charCodeAt(i * 2) | (bin.charCodeAt(i * 2 + 1) << 8)) / 65535
  return { size: lut.size, data }
}
