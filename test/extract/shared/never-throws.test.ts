import { describe, expect, it } from 'vitest'
import { parseDockerfile, parseGitlabCi, parseMise, parseToolVersions, parseWorkflow } from '../../../src/extract/shared'

/** Seeded junk: the parsers are pure and must never throw, whatever bytes they are given (A8). */
function junk(seed: number): string {
  let a = seed
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const alphabet = ['FROM ', 'ARG ', 'AS ', '\n', '\r\n', ':', '@', '${', '}', '$', '"', "'", '[', ']', '{', '}', '#', ' ', '\\', '- ', 'uses: ', 'with:', 'jobs:', 'steps:', 'matrix:', 'image:', '[tools]', '=', '.', '<<: *a', '&a ', 'node', '22', '\u0000', '๑๒']
  let out = ''
  for (let i = 0; i < 60; i++) out += alphabet[Math.floor(next() * alphabet.length)]
  return out
}

describe('every shared parser', () => {
  it('returns an array and does not throw on 300 seeded junk inputs', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const text = junk(seed)
      for (const parse of [parseDockerfile, parseGitlabCi, parseMise, parseToolVersions, parseWorkflow]) {
        let result: unknown
        expect(() => {
          result = parse(text)
        }, `${parse.name} seed ${seed}`).not.toThrow()
        expect(Array.isArray(result)).toBe(true)
      }
    }
  })
})
