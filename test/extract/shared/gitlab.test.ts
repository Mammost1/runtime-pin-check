import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseGitlabCi } from '../../../src/extract/shared'

const real = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8')

describe('parseGitlabCi', () => {
  it('manfredsteger/polly (.gitlab-ci.yml.restored): ${NODE_VERSION} in the tag stays raw, per job with line', () => {
    const images = parseGitlabCi(real('manfredsteger-polly.gitlab-ci.yml'))
    expect(images[0]).toMatchObject({ image: 'node', tag: '${NODE_VERSION}', raw: 'node:${NODE_VERSION}', job: 'build', line: 11 })
    expect(images.filter((i) => i.image === 'node').length).toBeGreaterThan(3)
    expect(images.some((i) => i.image === 'mcr.microsoft.com/playwright')).toBe(true)
  })

  it('reads the top-level image, default.image, and the {name:} form', () => {
    const text = `image: node:20\ndefault:\n  image: python:3.12\nbuild:\n  image:\n    name: golang:1.22\n    entrypoint: [""]\ntest:\n  image: node:22-alpine@sha256:abc\n.tmpl:\n  image: node\n`
    expect(parseGitlabCi(text).map((i) => [i.job, i.image, i.tag, i.digest, i.line])).toEqual([
      ['default', 'node', '20', undefined, 1],
      ['default', 'python', '3.12', undefined, 3],
      ['build', 'golang', '1.22', undefined, 6],
      ['test', 'node', '22-alpine', 'sha256:abc', 9],
      ['.tmpl', 'node', undefined, undefined, 11],
    ])
  })

  it('follows merge keys and skips non-job sections', () => {
    const text = `.base: &base\n  image: node:18\nstages: [a]\nvariables:\n  image: nope\njob:\n  <<: *base\n  script: [x]\n`
    expect(parseGitlabCi(text).map((i) => [i.job, i.tag])).toEqual([['.base', '18'], ['job', '18']])
  })

  it('returns [] for invalid or empty files and never throws', () => {
    expect(parseGitlabCi('')).toEqual([])
    expect(parseGitlabCi('[1, 2')).toEqual([])
    expect(() => parseGitlabCi('image: [1]\njob: 5\n')).not.toThrow()
  })
})
