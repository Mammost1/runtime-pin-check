import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { extractGo } from '../../../src/extract/go'

const real = (f: string) => readFileSync(new URL(`../../fixtures/go/${f}`, import.meta.url), 'utf8')
const pick = (s: ReturnType<typeof extractGo>) => s.map((x) => [x.kind, x.line, x.raw, x.constraint])

describe('dispatch', () => {
  it('returns [] for files it does not handle and never throws', () => {
    expect(extractGo('go.sum', 'go 1.22')).toEqual([])
    expect(extractGo('go.work', 'go 1.22\n')).toEqual([])
    expect(extractGo('README.md', 'golang 1.22')).toEqual([])
    for (const f of ['go.mod', '.tool-versions', 'mise.toml', 'Dockerfile', '.github/workflows/a.yml']) {
      expect(() => extractGo(f, '\u0000{{[[\n= = =\n')).not.toThrow()
    }
  })
})

describe('go.mod (real: RoaringBitmap/roaring, apache/dubbo-admin, gin-gonic/gin)', () => {
  it('go is a minimum (range), toolchain is exact', () => {
    expect(pick(extractGo('go.mod', real('roaringbitmap-roaring.go.mod')))).toEqual([
      ['go-mod', 3, '1.24.0', { kind: 'range', range: '>=1.24.0' }],
      ['go-toolchain', 5, 'go1.24.4', { kind: 'exact', version: '1.24.4' }],
    ])
    expect(pick(extractGo('svc/go.mod', real('apache-dubbo-admin.go.mod')))).toEqual([
      ['go-mod', 18, '1.24.0', { kind: 'range', range: '>=1.24.0' }],
      ['go-toolchain', 20, 'go1.24.11', { kind: 'exact', version: '1.24.11' }],
    ])
    expect(pick(extractGo('go.mod', real('gin-gonic-gin.go.mod')))).toEqual([['go-mod', 3, '1.26.0', { kind: 'range', range: '>=1.26.0' }]])
  })
  it('go 1.22 means at least 1.22.0; the column points at the version', () => {
    const [s] = extractGo('go.mod', 'module x\n\ngo 1.22\n')
    expect(s).toMatchObject({ line: 3, column: 4, raw: '1.22', constraint: { kind: 'range', range: '>=1.22.0' } })
  })
  it('ignores comments and anything inside ( … ) blocks, takes indented directives', () => {
    const text = 'module x // go 1.1\n\n// go 1.2\nrequire (\n\tgo 1.3\n\texample.com/y v1.0.0\n)\n  go 1.21.5 // minimum\n'
    expect(pick(extractGo('go.mod', text))).toEqual([['go-mod', 8, '1.21.5', { kind: 'range', range: '>=1.21.5' }]])
  })
  it('odd directives are UNPARSEABLE, not skipped and not guessed', () => {
    expect(extractGo('go.mod', 'go 1.22rc1\n')[0]?.constraint).toMatchObject({ kind: 'unknown' })
    expect(extractGo('go.mod', 'go 1.22\ntoolchain default\n')[1]?.constraint).toEqual({ kind: 'unknown', reason: 'toolchain default selects the toolchain at build time' })
    expect(extractGo('go.mod', 'toolchain local\n')[0]?.constraint).toMatchObject({ kind: 'unknown' })
  })
  it('a go.mod without directives has no sources', () => {
    expect(extractGo('go.mod', 'module x\n')).toEqual([])
    expect(extractGo('go.mod', '')).toEqual([])
  })
})

describe('.tool-versions and mise (real: authgear, chainlink, replicate/cog)', () => {
  it('golang lines, with the line number', () => {
    expect(pick(extractGo('.tool-versions', real('authgear-authgear-server.tool-versions')))).toEqual([['tool-versions', 1, '1.26.11', { kind: 'exact', version: '1.26.11' }]])
    expect(pick(extractGo('.tool-versions', real('smartcontractkit-chainlink.tool-versions')))).toEqual([['tool-versions', 1, '1.27.3', { kind: 'exact', version: '1.27.3' }]])
    expect(pick(extractGo('.tool-versions', 'go 1.22.1 1.21.0\n'))).toEqual([['tool-versions', 1, '1.22.1', { kind: 'exact', version: '1.22.1' }]])
  })
  it('mise go = "latest" (replicate/cog) is a floating alias; go and golang keys both work', () => {
    expect(pick(extractGo('mise.toml', real('replicate-cog.mise.toml')))).toEqual([['mise', 35, 'latest', { kind: 'alias', alias: 'latest' }]])
    expect(extractGo('.mise.toml', '[tools]\ngolang = "1.22"\n')[0]?.constraint).toEqual({ kind: 'partial', version: '1.22' })
  })
})

describe('Dockerfile (real: genuinetools/weather)', () => {
  it('FROM golang:alpine is floating latest; the second FROM alpine is not Go', () => {
    expect(pick(extractGo('Dockerfile', real('genuinetools-weather.Dockerfile')))).toEqual([['dockerfile', 1, 'alpine', { kind: 'alias', alias: 'latest' }]])
  })
  it('tags and ARG defaults', () => {
    const s = extractGo('Dockerfile', 'ARG GO=1.22.3\nFROM golang:${GO}-bookworm AS build\nFROM golang:1.21-alpine\nFROM golang:${X}\nFROM public.ecr.aws/docker/library/golang:1.23\n')
    expect(s.map((x) => [x.line, x.raw, x.constraint.kind])).toEqual([[2, '${GO}-bookworm', 'exact'], [3, '1.21-alpine', 'partial'], [4, '${X}', 'unknown'], [5, '1.23', 'partial']])
  })
})

describe('review N2/N1 for go', () => {
  it('golang@sha256 is unknown (pinned by digest), tag + digest reads the tag', () => {
    const digest = `sha256:${'b'.repeat(64)}`
    const s = extractGo('Dockerfile', `FROM golang@${digest}\nFROM golang:1.22@${digest}\n`)
    expect(s[0]?.constraint).toEqual({ kind: 'unknown', reason: 'image is pinned by digest only, so its version cannot be read' })
    expect(s[1]?.constraint).toEqual({ kind: 'partial', version: '1.22' })
  })
  it('mise column points at the version text', () => {
    expect(extractGo('mise.toml', '[tools]\ngo = "1.22"\n')[0]).toMatchObject({ line: 2, column: 7, raw: '1.22' })
    expect(extractGo('mise.toml', '[tools]\ngo = ["1.22", "1.21"]\n')[0]).toMatchObject({ line: 2, column: 8, raw: '1.22' })
    expect(extractGo('mise.toml', real('replicate-cog.mise.toml'))[0]).toMatchObject({ line: 35, column: 7, raw: 'latest' })
    for (const text of ['[tools]\ngo = "1.22"\n', '[tools]\ngo = ["1.22", "1.21"]\n', '[tools]\ngo = { version = "1.22" }\n']) {
      const s = extractGo('mise.toml', text)[0]
      expect((text.split('\n')[(s?.line ?? 1) - 1] ?? '').slice((s?.column ?? 1) - 1).startsWith(s?.raw ?? '?')).toBe(true)
    }
  })
})

describe('GitHub workflows (real: gin-gonic/gin)', () => {
  it('a literal range, and a matrix with a line per value; go-version-file is a reference', () => {
    const s = extractGo('.github/workflows/gin.yml', real('gin-gonic-gin.gin.yml'))
    expect(s.map((x) => [x.line, x.raw, x.constraint, x.matrix])).toEqual([
      [25, '^1', { kind: 'range', range: '>=1.0.0 <2.0.0-0' }, undefined],
      [39, '1.26', { kind: 'partial', version: '1.26' }, true],
      [39, '1.27', { kind: 'partial', version: '1.27' }, true],
    ])
    const ref = extractGo('.github/workflows/ci.yml', 'jobs:\n  a:\n    steps:\n      - uses: actions/setup-go@v5\n        with:\n          go-version-file: go.mod\n')
    expect(ref).toEqual([])
  })
  it('stable and oldstable are floating aliases; an unquoted 1.20 is read by YAML as 1.2', () => {
    const wf = (v: string) => `jobs:\n  a:\n    steps:\n      - uses: actions/setup-go@v5\n        with:\n          go-version: ${v}\n`
    expect(extractGo('.github/workflows/ci.yml', wf('stable'))[0]?.constraint).toEqual({ kind: 'alias', alias: 'stable' })
    expect(extractGo('.github/workflows/ci.yml', wf('oldstable'))[0]?.constraint).toEqual({ kind: 'alias', alias: 'oldstable' })
    const bad = extractGo('.github/workflows/ci.yml', wf('1.20'))[0]
    expect(bad?.constraint).toMatchObject({ kind: 'unknown' })
    expect((bad?.constraint as { reason: string }).reason).toContain('number 1.2')
    expect(extractGo('.github/workflows/ci.yml', wf("'1.20'"))[0]?.constraint).toEqual({ kind: 'partial', version: '1.20' })
  })
  it('only the step\'s own working-directory (or defaults.run) is carried; run steps do not narrow the scope (review F1)', () => {
    const wf = (stepExtra: string) => `jobs:\n  a:\n    steps:\n      - uses: actions/setup-go@v5\n${stepExtra}        with:\n          go-version: "1.22"\n      - run: go test ./...\n        working-directory: services/api\n`
    expect(extractGo('.github/workflows/ci.yml', wf(''))[0]?.workingDirectory).toBeUndefined()
    expect(extractGo('.github/workflows/ci.yml', wf('        working-directory: ./tools/\n'))[0]?.workingDirectory).toBe('tools')
  })
  it('review F3: a composite action stored under .github/workflows/<dir>/action.yml is read', () => {
    const text = 'runs:\n  using: composite\n  steps:\n    - uses: actions/setup-go@v5\n      with:\n        go-version: "1.23"\n'
    expect(extractGo('.github/workflows/env/action.yml', text)[0]).toMatchObject({ raw: '1.23', line: 6 })
  })
})

describe('rpc-pygo-column (go)', () => {
  it('every Source from .tool-versions has a column that points at raw; go and golang keys, tool name inside the version text', () => {
    for (const f of ['authgear-authgear-server.tool-versions', 'smartcontractkit-chainlink.tool-versions']) {
      const text = real(f)
      const sources = extractGo('.tool-versions', text)
      expect(sources.length, f).toBeGreaterThan(0)
      for (const s of sources) expect((text.split('\n')[s.line - 1] ?? '').slice((s.column ?? 0) - 1, (s.column ?? 0) - 1 + s.raw.length), f).toBe(s.raw)
    }
    const text = 'golang   go1.22 1.21\ngo\t1.20.5\n'
    const sources = extractGo('.tool-versions', text)
    expect(sources.map((s) => [s.line, s.column, s.raw])).toEqual([[1, 10, 'go1.22'], [2, 4, '1.20.5']])
  })
})

describe('rpc-pygo-column review F1 (go)', () => {
  it('block-scalar go-version forms: moved to their own line or without a column, never a wrong offset', () => {
    const wf = (v: string) => `jobs:\n  a:\n    steps:\n      - uses: actions/setup-go@v5\n        with:\n          go-version: ${v}\n`
    for (const v of ['|\n            1.22\n', '>-\n            1.22\n', '|2\n            1.22\n', '"1.2\n            2"\n']) {
      const text = wf(v)
      for (const s of extractGo('.github/workflows/ci.yml', text)) {
        if (s.column !== undefined) expect((text.split('\n')[s.line - 1] ?? '').slice(s.column - 1, s.column - 1 + s.raw.length), v).toBe(s.raw)
      }
    }
    const text = wf('|\n            1.22\n')
    expect(extractGo('.github/workflows/ci.yml', text)[0]).toMatchObject({ line: 7, column: 13, raw: '1.22' })
  })
})

describe('rpc-harden F7: .gitlab-ci.yml golang images', () => {
  it('reads job-level official golang images and ignores others', () => {
    const text = 'build:\n  image: golang:1.24-alpine\ntest:\n  image: docker.io/library/golang:1.23\nx:\n  image: acme/golang:9\n'
    const s = extractGo('.gitlab-ci.yml', text)
    expect(s.map((x) => [x.line, x.raw, x.constraint])).toEqual([
      [2, '1.24-alpine', { kind: 'partial', version: '1.24' }],
      [4, '1.23', { kind: 'partial', version: '1.23' }],
    ])
  })
})

