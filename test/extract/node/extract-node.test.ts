import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { extractNode } from '../../../src/extract/node'

const fixture = (name: string): string => readFileSync(new URL(`../../fixtures/node/${name}`, import.meta.url), 'utf8')
const brief = (file: string, text: string) =>
  extractNode(file, text).map((s) => ({ kind: s.kind, line: s.line, raw: s.raw, c: s.constraint }))

describe('.nvmrc and .node-version', () => {
  it('reads real samples: v22.22.3, lts/*, 22.22.1 (no trailing newline)', () => {
    expect(extractNode('src/portal/.nvmrc', fixture('goharbor-harbor.nvmrc'))).toEqual([
      { runtime: 'node', file: 'src/portal/.nvmrc', line: 1, column: 1, raw: 'v22.22.3', kind: 'nvmrc', constraint: { kind: 'exact', version: '22.22.3' } },
    ])
    expect(brief('.nvmrc', fixture('kodu-ai-claude-coder.nvmrc'))[0]!.c).toEqual({ kind: 'alias', alias: 'lts/*' })
    expect(brief('.node-version', fixture('nomcopter-react-mosaic.node-version'))).toEqual([
      { kind: 'node-version', line: 1, raw: '22.22.1', c: { kind: 'exact', version: '22.22.1' } },
    ])
  })
  it('skips comments and blanks, handles CRLF, and keeps unreadable text as unknown', () => {
    expect(brief('.nvmrc', '# pinned\r\n\r\n  v22  \r\n')).toEqual([{ kind: 'nvmrc', line: 3, raw: 'v22', c: { kind: 'partial', version: '22' } }])
    expect(brief('.nvmrc', 'node 22')[0]!.c.kind).toBe('unknown')
    expect(brief('.nvmrc', '')).toEqual([])
    expect(brief('.nvmrc', '# only a comment\n')).toEqual([])
  })
  it('accepts the 22.x and lts/<name> forms', () => {
    expect(brief('.nvmrc', '22.x')[0]!.c).toEqual({ kind: 'partial', version: '22' })
    expect(brief('.nvmrc', 'lts/iron')[0]!.c).toEqual({ kind: 'alias', alias: 'lts/iron' })
  })
})

describe('package.json', () => {
  it('reads engines.node with an || range (bofandra/satusehat-integration-sdk)', () => {
    const [s] = extractNode('sdks/node/package.json', fixture('bofandra-satusehat.package.json'))
    expect(s).toMatchObject({ kind: 'engines', line: 17, raw: '>=20 <23 || >=24 <25', constraint: { kind: 'range' } })
    expect(s!.column).toBe(14)
  })
  it('reads volta.node (preactjs/preact)', () => {
    expect(brief('package.json', fixture('preactjs-preact.package.json'))).toEqual([
      { kind: 'volta', line: 225, raw: '22.22.2', c: { kind: 'exact', version: '22.22.2' } },
    ])
  })
  it('reads devEngines.runtime (pure-css/pure) and only for name node', () => {
    expect(brief('package.json', fixture('pure-css-pure.package.json'))).toEqual([
      { kind: 'dev-engines', line: 39, raw: '>=26', c: { kind: 'range', range: '>=26.0.0' } },
    ])
    const many = JSON.stringify({ devEngines: { runtime: [{ name: 'bun', version: '1' }, { name: 'node', version: '22' }] } }, null, 2)
    const out = extractNode('package.json', many)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ raw: '22', line: 10 })
  })
  it('reports the same field in several places as separate sources', () => {
    const text = '{\n  "engines": { "node": ">=20" },\n  "volta": { "node": "22.1.0" }\n}'
    expect(brief('package.json', text).map((s) => [s.kind, s.line])).toEqual([['engines', 2], ['volta', 3]])
  })
  it('keeps a non-string node field as unknown, ignores files without node, and never throws on bad JSON', () => {
    expect(brief('package.json', '{"engines":{"node":22}}')[0]!.c.kind).toBe('unknown')
    expect(brief('package.json', '{"name":"x","engines":{"npm":">=9"}}')).toEqual([])
    expect(brief('package.json', '{ not json')).toEqual([])
    expect(brief('package.json', '[1,2]')).toEqual([])
  })
  it('finds the node entry even when another engine has the same value', () => {
    const text = '{\n  "engines": {\n    "npm": "20",\n    "node": "20"\n  }\n}'
    expect(extractNode('package.json', text)[0]).toMatchObject({ line: 4, column: 14 })
  })
})

describe('.tool-versions and mise', () => {
  it('reads nodejs from real files, including aligned columns (gitlabhq, chainlink)', () => {
    expect(brief('.tool-versions', fixture('gitlabhq-gitlabhq.tool-versions'))).toEqual([
      { kind: 'tool-versions', line: 2, raw: '22.23.1', c: { kind: 'exact', version: '22.23.1' } },
    ])
    const [chain] = extractNode('.tool-versions', fixture('smartcontractkit-chainlink.tool-versions'))
    expect(chain).toMatchObject({ line: 3, raw: '22.12.0', column: 15 })
  })
  it('uses only the first version on a line (the rest are asdf fallbacks) and flags a bare tool', () => {
    expect(brief('.tool-versions', 'nodejs 22.1.0 20.0.0\n')).toHaveLength(1)
    expect(brief('.tool-versions', 'nodejs\n')[0]!.c.kind).toBe('unknown')
    expect(brief('.tool-versions', 'nodejs system\n')[0]!.c).toEqual({ kind: 'alias', alias: 'system' })
    expect(brief('.tool-versions', 'python 3.12.1\n')).toEqual([])
  })
  it('reads [tools] node from real mise files and ignores the idiomatic-file setting (metabase)', () => {
    expect(brief('.mise.toml', fixture('butlerx-wetty.mise.toml'))[0]).toMatchObject({ kind: 'mise', line: 2, raw: 'lts' })
    expect(brief('.mise.toml', fixture('conventional-changelog-commitlint.mise.toml'))[0]!.c).toEqual({ kind: 'partial', version: '22' })
    expect(brief('mise.toml', fixture('devexpress-devextreme.mise.toml'))[0]!.c).toEqual({ kind: 'exact', version: '24.16.0' })
    expect(brief('mise.toml', fixture('metabase-metabase.mise.toml'))).toEqual([])
  })
  it('points the column at the version text, not the TOML quote or bracket (--fix relies on it)', () => {
    const col = (text: string) => extractNode('mise.toml', `[tools]\n${text}\n`)[0]!.column
    expect(col('node = "22"')).toBe(9)
    expect(col("node = '22'")).toBe(9)
    expect(col('node = ["22", "20"]')).toBe(10)
    expect(col('node = { version = "22.1.0" }')).toBe(21)
    expect(col('node = 22')).toBe(8)
    const real = fixture('conventional-changelog-commitlint.mise.toml').split('\n')[1]!
    expect(real.slice((col(`${real}`) ?? 0) - 1, (col(`${real}`) ?? 0) + 1)).toBe('22')
    const [src] = extractNode('.mise.toml', fixture('conventional-changelog-commitlint.mise.toml'))
    expect(real.slice(src!.column! - 1, src!.column! - 1 + src!.raw.length)).toBe(src!.raw)
  })
  it('handles arrays and inline tables, and recognises the mise file names', () => {
    expect(brief('mise.toml', '[tools]\nnode = ["22", "20"]\n')).toHaveLength(1)
    expect(brief('mise.toml', '[tools]\nnode = { version = "22.1.0" }\n')[0]!.c).toEqual({ kind: 'exact', version: '22.1.0' })
    expect(brief('mise.toml', '[tools]\nnode = { postinstall = "x" }\n')).toEqual([])
    for (const f of ['mise.toml', '.mise.toml', 'mise.local.toml', '.config/mise.toml', '.config/mise/config.toml', 'a/b/.mise.toml']) {
      expect(brief(f, '[tools]\nnode = "22"\n'), f).toHaveLength(1)
    }
    expect(brief('mise.toml', '[tools\nnode =')).toEqual([])
  })
})

describe('Dockerfile', () => {
  it.each([
    ['nearai-ironclaw.Dockerfile', 16, '22.23.1-bookworm-slim', { kind: 'exact', version: '22.23.1' }],
    ['raineorshine-npm-check-updates.Dockerfile', 1, 'lts-alpine', { kind: 'alias', alias: 'lts' }],
    ['defguard-defguard.Dockerfile', 1, '26-alpine', { kind: 'partial', version: '26' }],
    ['humanmade-tachyon.Dockerfile', 1, '24', { kind: 'partial', version: '24' }],
  ])('%s', (name, line, raw, constraint) => {
    expect(brief('Dockerfile', fixture(name))).toEqual([{ kind: 'dockerfile', line, raw, c: constraint }])
  })
  it('reads the digest-pinned tag without the digest (ironclaw)', () => {
    expect(fixture('nearai-ironclaw.Dockerfile')).toContain('@sha256:')
    expect(extractNode('Dockerfile', fixture('nearai-ironclaw.Dockerfile'))[0]!.raw).not.toContain('sha256')
  })
  it('points an ARG-driven FROM at the ARG value, once (botpress, evobot with a suffix default)', () => {
    const bot = extractNode('Dockerfile', fixture('botpress-botpress.Dockerfile'))
    expect(bot).toHaveLength(1)
    expect(bot[0]).toMatchObject({ line: 6, raw: '22.17.0', column: 18, constraint: { kind: 'exact', version: '22.17.0' } })
    expect(fixture('botpress-botpress.Dockerfile').split('\n')[5]!.slice(17)).toMatch(/^22\.17\.0/)
    const evo = extractNode('Dockerfile', fixture('eritislami-evobot.Dockerfile'))
    expect(evo).toHaveLength(1)
    expect(evo[0]).toMatchObject({ line: 1, raw: '18.18.2-slim', constraint: { kind: 'exact', version: '18.18.2' } })
  })
  it('ignores non-node images and reads lambda nodejs (genuinetools/weather has none)', () => {
    expect(brief('Dockerfile', fixture('genuinetools-weather.Dockerfile'))).toEqual([])
    expect(brief('Dockerfile', 'FROM python:3.12\n')).toEqual([])
    expect(brief('Dockerfile', 'FROM public.ecr.aws/lambda/nodejs:22\n')[0]!.c).toEqual({ kind: 'partial', version: '22' })
  })
  it('lists each node stage of a multi-stage build and skips a stage that is named node', () => {
    const text = 'FROM node:20 AS node\nFROM node AS app\nFROM node:22-alpine\n'
    expect(brief('Dockerfile', text).map((s) => [s.line, s.raw])).toEqual([[1, '20'], [3, '22-alpine']])
  })
  it('treats a digest-only reference as unknown (a digest is immutable, not floating)', () => {
    const [s] = extractNode('Dockerfile', 'FROM node@sha256:abcdef0123456789\n')
    expect(s!.constraint).toMatchObject({ kind: 'unknown', reason: expect.stringContaining('digest') })
    expect(brief('Dockerfile', 'FROM node:22@sha256:abcdef0123456789\n')[0]!.c).toEqual({ kind: 'partial', version: '22' })
    expect(brief('.gitlab-ci.yml', 'image: node@sha256:abcdef0123456789\n')[0]!.c.kind).toBe('unknown')
  })
  it('treats a bare node image as floating latest and an unresolved ARG as unknown', () => {
    expect(brief('Dockerfile', 'FROM node\n')[0]!.c).toEqual({ kind: 'alias', alias: 'latest' })
    expect(brief('Dockerfile', 'ARG V\nFROM node:${V}-alpine\n')[0]!.c.kind).toBe('unknown')
  })
  it('recognises Dockerfile names', () => {
    for (const f of ['Dockerfile', 'Dockerfile.dev', 'docker/web.Dockerfile', 'dockerfile', 'app/Dockerfile.prod']) {
      expect(brief(f, 'FROM node:22\n'), f).toHaveLength(1)
    }
    expect(brief('Dockerfile.md', 'FROM node:22\n')).toEqual([])
  })
})

describe('GitHub workflows', () => {
  it('reads lts/* (Playwright-Proyectos) and a quoted lts/* (expressjs)', () => {
    expect(brief('.github/workflows/playwright.yml', fixture('vickynovarese-playwright.yml'))).toEqual([
      { kind: 'setup-node', line: 15, raw: 'lts/*', c: { kind: 'alias', alias: 'lts/*' } },
    ])
    const express = extractNode('.github/workflows/ci.yml', fixture('expressjs-express.ci.yml'))
    expect(express[0]).toMatchObject({ raw: 'lts/*', line: 36 })
    expect(express[0]!.matrix).toBeUndefined()
  })
  it('turns every matrix value into a matrix source with its own line and column (expressjs, got)', () => {
    const express = extractNode('.github/workflows/ci.yml', fixture('expressjs-express.ci.yml')).filter((s) => s.matrix)
    expect(express.map((s) => s.raw)).toEqual(['18', '19', '20', '21', '22', '23', '24', '25', '26'])
    expect(new Set(express.map((s) => s.line))).toEqual(new Set([49]))
    expect(express.map((s) => s.column)).toEqual([24, 28, 32, 36, 40, 44, 48, 52, 56])
    const got = extractNode('.github/workflows/main.yml', fixture('sindresorhus-got.main.yml'))
    expect(got.map((s) => [s.line, s.raw, s.matrix])).toEqual([[15, '26', true], [16, '24', true], [17, '22', true]])
  })
  it('treats node-version-file as a reference, not a pin, under a mixed-case path (Fillo001/greenledger)', () => {
    expect(extractNode('.GitHub/workflows/Ci.Yml', fixture('fillo001-greenledger.Ci.yml'))).toEqual([])
    const lower = 'jobs:\n  a:\n    steps:\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 20.x\n'
    expect(brief('.GitHub/Workflows/CI.YML', lower)).toEqual([{ kind: 'setup-node', line: 6, raw: '20.x', c: { kind: 'partial', version: '20' } }])
  })
  it('ignores other actions and workflow files outside .github', () => {
    const text = 'jobs:\n  a:\n    steps:\n      - uses: actions/setup-python@v5\n        with:\n          node-version: 20\n'
    expect(brief('.github/workflows/a.yml', text)).toEqual([])
    const node = text.replace('setup-python', 'setup-node')
    expect(brief('docs/a.yml', node)).toEqual([])
    expect(brief('.github/actions/setup/action.yml', node.replace('jobs:\n  a:\n    steps:', 'runs:\n  steps:'))).toHaveLength(1)
  })
  it('sets workingDirectory only from the step or defaults, normalised', () => {
    const own = 'jobs:\n  a:\n    steps:\n      - uses: actions/setup-node@v4\n        working-directory: ./packages/web/\n        with:\n          node-version: 22\n'
    expect(extractNode('.github/workflows/a.yml', own)[0]!.workingDirectory).toBe('packages/web')
    const defaults = 'jobs:\n  a:\n    defaults:\n      run:\n        working-directory: app\n    steps:\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 22\n'
    expect(extractNode('.github/workflows/a.yml', defaults)[0]!.workingDirectory).toBe('app')
    const root = own.replace('./packages/web/', '.')
    expect(extractNode('.github/workflows/a.yml', root)[0]!.workingDirectory).toBe('.')
    const runOnly = 'jobs:\n  a:\n    steps:\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 22\n      - run: npm ci\n        working-directory: web\n'
    expect(extractNode('.github/workflows/a.yml', runOnly)[0]!.workingDirectory).toBeUndefined()
    const templ = own.replace('./packages/web/', '${{ inputs.dir }}')
    expect(extractNode('.github/workflows/a.yml', templ)[0]!.workingDirectory).toBeUndefined()
  })
  it('does not narrow setup-node by a run step elsewhere in the job, and keeps root steps (regression)', () => {
    // setup-node at the repo root, then run steps in two different subdirectories: no inference.
    const mixed = [
      'jobs:', '  a:', '    steps:',
      '      - uses: actions/setup-node@v4', '        with:', '          node-version: 22',
      '      - run: npm ci', '        working-directory: web',
      '      - run: npm test', '        working-directory: api', '',
    ].join('\n')
    const [s, ...rest] = extractNode('.github/workflows/a.yml', mixed)
    expect(rest).toEqual([])
    expect(s).toMatchObject({ raw: '22', line: 6 })
    expect(s!.workingDirectory).toBeUndefined()
    // Two setup-node steps in one job: the one with no working-directory is kept at the root.
    const two = [
      'jobs:', '  a:', '    steps:',
      '      - uses: actions/setup-node@v4', '        with:', '          node-version: 22',
      '      - uses: actions/setup-node@v4', '        working-directory: web', '        with:', '          node-version: 20', '',
    ].join('\n')
    const out = extractNode('.github/workflows/a.yml', two)
    expect(out.map((x) => [x.raw, x.workingDirectory])).toEqual([['22', undefined], ['20', 'web']])
  })
  it('keeps a computed matrix or expression as unknown', () => {
    const text = 'jobs:\n  a:\n    strategy:\n      matrix:\n        node: ${{ fromJSON(needs.x.outputs.v) }}\n    steps:\n      - uses: actions/setup-node@v4\n        with:\n          node-version: ${{ matrix.node }}\n'
    const [s] = extractNode('.github/workflows/a.yml', text)
    expect(s).toMatchObject({ matrix: true, line: 9, constraint: { kind: 'unknown' } })
    const plain = text.replace(/    strategy:[\s\S]*?    steps:/, '    steps:').replace('${{ matrix.node }}', '${{ inputs.v }}')
    expect(extractNode('.github/workflows/a.yml', plain)[0]!.constraint.kind).toBe('unknown')
  })
})

describe('.gitlab-ci.yml', () => {
  it('keeps ${NODE_VERSION} as unknown instead of crashing (manfredsteger/polly)', () => {
    const out = extractNode('.gitlab-ci.yml', fixture('manfredsteger-polly.gitlab-ci.yml'))
    expect(out.length).toBeGreaterThan(0)
    expect(out.every((s) => s.kind === 'gitlab-ci' && s.constraint.kind === 'unknown')).toBe(true)
    expect(out[0]).toMatchObject({ line: 11, raw: '${NODE_VERSION}' })
  })
  it('reads a literal tag and ignores other images', () => {
    const text = 'default:\n  image: node:22-alpine\ntest:\n  image:\n    name: node:20.11.0\nlint:\n  image: python:3.12\n'
    expect(brief('.gitlab-ci.yml', text).map((s) => [s.line, s.raw])).toEqual([[2, '22-alpine'], [5, '20.11.0']])
    expect(brief('ci/.gitlab-ci.yaml', text)).toHaveLength(2)
  })
})

describe('contract', () => {
  it('returns [] for files it does not handle', () => {
    for (const f of ['README.md', 'src/index.ts', 'go.mod', '.python-version', 'pyproject.toml']) expect(extractNode(f, 'node 22')).toEqual([])
  })
  it('uses forward slashes and keeps the given path', () => {
    expect(extractNode('a/b/.nvmrc', '22')[0]!.file).toBe('a/b/.nvmrc')
  })
  it('never throws on garbage in any recognised file', () => {
    const junk = ['', '\u0000\u0001', '{', '[[[', 'FROM', 'ARG\nFROM ${', 'jobs: [', '\uFEFF22', ':::', 'a: &x\n  <<: *y']
    for (const f of ['.nvmrc', '.node-version', 'package.json', '.tool-versions', 'mise.toml', 'Dockerfile', '.gitlab-ci.yml', '.github/workflows/a.yml']) {
      for (const text of junk) expect(() => extractNode(f, text), `${f} ${JSON.stringify(text)}`).not.toThrow()
    }
  })
  it('every source is a node source with a 1-based line', () => {
    for (const [f, name] of [['.nvmrc', 'goharbor-harbor.nvmrc'], ['Dockerfile', 'botpress-botpress.Dockerfile'], ['.github/workflows/ci.yml', 'expressjs-express.ci.yml']] as const) {
      for (const s of extractNode(f, fixture(name))) {
        expect(s.runtime).toBe('node')
        expect(s.line).toBeGreaterThanOrEqual(1)
      }
    }
  })
})
