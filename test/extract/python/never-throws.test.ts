import { describe, expect, it } from 'vitest'
import { extractGo } from '../../../src/extract/go'
import { extractPython } from '../../../src/extract/python'

/** A8: extractors are pure and never throw, whatever the file name and bytes. */
function junk(seed: number): string {
  let a = seed
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const parts = ['go ', 'toolchain ', 'python', '[project]', 'requires-python = ', '"', '>=3.9', '1.22', 'python-', 'FROM python:', 'FROM golang:', '${', '}', 'uses: actions/setup-go@v5', 'go-version:', 'python-version:', 'with:', 'jobs:', '\n', '  ', '[tools]', '=', '(', ')', '//', '#', '\u0000', '\r\n', ' ', 'matrix:', '[', ']']
  let out = ''
  for (let i = 0; i < 50; i++) out += parts[Math.floor(next() * parts.length)]
  return out
}

describe('python and go extractors', () => {
  it('return arrays and do not throw on seeded junk under every handled file name', () => {
    const files = ['.python-version', 'pyproject.toml', 'runtime.txt', '.tool-versions', 'mise.toml', 'Dockerfile', '.github/workflows/ci.yml', 'go.mod']
    for (let seed = 1; seed <= 200; seed++) {
      const text = junk(seed)
      for (const file of files) {
        for (const extract of [extractPython, extractGo]) {
          let result: unknown
          expect(() => {
            result = extract(file, text)
          }, `${extract.name} ${file} seed ${seed}`).not.toThrow()
          expect(Array.isArray(result)).toBe(true)
        }
      }
    }
  })
})
