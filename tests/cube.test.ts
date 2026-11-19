import { expect, test } from 'vitest'
import { decodeLut, encodeLut, identityLut, parseCube, resample, sampleLut, serializeCube } from '../src/shared/color/cube'

test('a .cube file survives a write and read, and the identity table changes nothing', () => {
  const id = identityLut(5)
  const { name, table } = parseCube(serializeCube('Test grade', id))
  expect(name).toBe('Test grade')
  expect(table.size).toBe(5)
  const out = [0, 0, 0]
  for (const c of [[0.1, 0.5, 0.9], [1, 0, 0.25], [0.33, 0.66, 0.99]]) {
    sampleLut(table, c[0], c[1], c[2], out)
    out.forEach((v, i) => expect(v).toBeCloseTo(c[i], 4))
  }
})

test('a table is stored compactly and decoded back within 16-bit precision', () => {
  const t = identityLut(9)
  const back = decodeLut({ id: 'x', name: 'x', size: 9, data: encodeLut(t) })
  expect(back.size).toBe(9)
  back.data.forEach((v, i) => expect(Math.abs(v - t.data[i])).toBeLessThan(2 / 65535))
})

test('an inverting LUT is honoured and a 64-point table is cut down to 33', () => {
  const big = identityLut(64)
  for (let i = 0; i < big.data.length; i++) big.data[i] = 1 - big.data[i]
  const { table } = parseCube(serializeCube('invert', big))
  expect(table.size).toBe(33)
  const out = [0, 0, 0]
  sampleLut(table, 0.2, 0.6, 1, out)
  expect(out[0]).toBeCloseTo(0.8, 2)
  expect(out[1]).toBeCloseTo(0.4, 2)
  expect(out[2]).toBeCloseTo(0, 2)
  expect(resample(identityLut(3), 7).size).toBe(7)
})

test('broken or unsupported files are rejected with a reason', () => {
  expect(() => parseCube('LUT_1D_SIZE 16\n0 0 0')).toThrow(/1-D/)
  expect(() => parseCube('TITLE "x"\n0 0 0')).toThrow(/LUT_3D_SIZE/)
  expect(() => parseCube('LUT_3D_SIZE 2\n0 0 0\n1 1 1')).toThrow(/Expected 8/)
})
