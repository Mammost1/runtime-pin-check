import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseDockerfile, splitImageRef } from '../../../src/extract/shared'

const real = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8')

describe('splitImageRef', () => {
  it('splits name, tag and digest', () => {
    expect(splitImageRef('node:22.11.0-bookworm-slim@sha256:abc')).toEqual({ image: 'node', tag: '22.11.0-bookworm-slim', digest: 'sha256:abc' })
    expect(splitImageRef('node')).toEqual({ image: 'node' })
    expect(splitImageRef('node@sha256:abc')).toEqual({ image: 'node', digest: 'sha256:abc' })
  })
  it('keeps registry and path, and does not take a registry port for a tag', () => {
    expect(splitImageRef('public.ecr.aws/lambda/nodejs:24')).toEqual({ image: 'public.ecr.aws/lambda/nodejs', tag: '24' })
    expect(splitImageRef('localhost:5000/team/node')).toEqual({ image: 'localhost:5000/team/node' })
    expect(splitImageRef('localhost:5000/team/node:22')).toEqual({ image: 'localhost:5000/team/node', tag: '22' })
  })
})

describe('parseDockerfile on real Dockerfiles (fixtures/*.Dockerfile, named owner-repo)', () => {
  it('nearai/ironclaw: tag plus @sha256 digest, multi-stage, stages named by AS', () => {
    const froms = parseDockerfile(real('nearai-ironclaw.Dockerfile'))
    expect(froms[0]).toMatchObject({ image: 'node', tag: '22.23.1-bookworm-slim', line: 16, stage: 'node_toolchain' })
    expect(froms[0]?.digest).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(froms.map((f) => f.stage)).toEqual(['node_toolchain', 'railway_cli', 'chef', 'planner', 'deps', 'builder', 'runtime'])
    // A stage reference is just an image name here; the runtime module decides it is not node.
    expect(froms.find((f) => f.stage === 'planner')).toMatchObject({ image: 'chef' })
  })

  it('botpress/botpress: global ARG default substituted into FROM, with the ARG line reported', () => {
    const froms = parseDockerfile(real('botpress-botpress.Dockerfile'))
    expect(froms[0]).toMatchObject({
      image: 'node',
      tag: '22.17.0-bullseye-slim',
      line: 9,
      stage: 'build',
      raw: 'node:${NODE_VERSION}-bullseye-slim',
      arg: { name: 'NODE_VERSION', line: 6 },
    })
  })

  it('eritislami/evobot: ARG default with a suffix, lower-case `as`', () => {
    const froms = parseDockerfile(real('eritislami-evobot.Dockerfile'))
    expect(froms[0]).toMatchObject({ image: 'node', tag: '18.18.2-slim', line: 2, stage: 'base', raw: 'node:${NODE_VERSION}', arg: { name: 'NODE_VERSION', line: 1 } })
    expect(froms[2]).toMatchObject({ image: 'node', tag: '18.18.2-slim', stage: 'prod' })
  })

  it('DefGuard/defguard: registry-prefixed library image', () => {
    const froms = parseDockerfile(real('defguard-defguard.Dockerfile'))
    expect(froms[0]).toMatchObject({ image: 'public.ecr.aws/docker/library/node', tag: '26-alpine', line: 1, stage: 'web' })
  })

  it('humanmade/tachyon: a different image name (lambda nodejs)', () => {
    expect(parseDockerfile(real('humanmade-tachyon.Dockerfile'))[0]).toMatchObject({ image: 'public.ecr.aws/lambda/nodejs', tag: '24', line: 1 })
  })

  it('raineorshine/npm-check-updates: alias tag with digest', () => {
    const f = parseDockerfile(real('raineorshine-npm-check-updates.Dockerfile'))[0]
    expect(f).toMatchObject({ image: 'node', tag: 'lts-alpine', line: 1 })
    expect(f?.digest).toMatch(/^sha256:/)
  })

  it('genuinetools/weather: variant-only tag and no stage on the last FROM', () => {
    const froms = parseDockerfile(real('genuinetools-weather.Dockerfile'))
    expect(froms[0]).toMatchObject({ image: 'golang', tag: 'alpine', stage: 'builder' })
    expect(froms[1]).toMatchObject({ image: 'alpine', tag: 'latest' })
  })
})

describe('parseDockerfile syntax', () => {
  it('ignores instructions that are not FROM and reads keywords case-insensitively', () => {
    expect(parseDockerfile('RUN echo FROM node:1\nfrom node:22 as X')).toEqual([
      { image: 'node', tag: '22', line: 2, column: 6, stage: 'X', raw: 'node:22' },
    ])
  })

  it('joins continuation lines and skips comments inside them; reports the line of FROM', () => {
    const froms = parseDockerfile('# comment\nFROM \\\n  # a comment\n  node:22-alpine \\\n  AS web\n')
    expect(froms).toHaveLength(1)
    expect(froms[0]).toMatchObject({ image: 'node', tag: '22-alpine', line: 2, stage: 'web' })
  })

  it('honours the backtick escape directive', () => {
    expect(parseDockerfile('# escape=`\nFROM `\nnode:22')[0]).toMatchObject({ image: 'node', tag: '22' })
  })

  it('skips --platform flags', () => {
    expect(parseDockerfile('FROM --platform=$BUILDPLATFORM golang:1.22 AS go')[0]).toMatchObject({ image: 'golang', tag: '1.22', stage: 'go' })
  })

  it('substitutes $VAR, ${VAR} and ${VAR:-default}', () => {
    const text = 'ARG A=22\nARG B="20"\nFROM node:$A\nFROM node:${B}\nFROM node:${C:-18}\nFROM node:${A}-${B}'
    expect(parseDockerfile(text).map((f) => f.tag)).toEqual(['22', '20', '18', '22-20'])
  })

  it('leaves a variable with no default raw, and an ARG with no value counts as no default', () => {
    expect(parseDockerfile('ARG V\nFROM node:${V}-alpine')[0]).toMatchObject({ tag: '${V}-alpine', raw: 'node:${V}-alpine' })
    expect(parseDockerfile('FROM node:${V}')[0]?.arg).toBeUndefined()
    expect(parseDockerfile('FROM ${BASE}')[0]).toMatchObject({ image: '${BASE}' })
  })

  it('does not use an ARG declared after the first FROM', () => {
    expect(parseDockerfile('FROM node:22 AS a\nARG V=18\nFROM node:${V}')[1]?.tag).toBe('${V}')
  })

  it('handles FROM scratch, CRLF and a file with no FROM', () => {
    expect(parseDockerfile('FROM scratch\r\n')[0]).toMatchObject({ image: 'scratch', line: 1 })
    expect(parseDockerfile('RUN echo hi\n')).toEqual([])
    expect(parseDockerfile('')).toEqual([])
  })

  it('reports the column of the image reference', () => {
    expect(parseDockerfile('  FROM   node:22')[0]?.column).toBe(10)
  })

  it('never throws on garbage', () => {
    for (const junk of ['\u0000\u0001', 'FROM', 'FROM ', 'ARG', 'FROM \\', '$'.repeat(5000), 'FROM --platform']) {
      expect(() => parseDockerfile(junk)).not.toThrow()
    }
  })
})
