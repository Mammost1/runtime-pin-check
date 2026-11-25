import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { compareSources } from '../src/compare'
import { parseConstraint } from '../src/constraint'
import {
  bundledSnapshot,
  checkDate,
  createAliasResolver,
  eolFindings,
  EOL_SOON_DAYS,
  parseSnapshot,
  type EolSnapshot,
} from '../src/eol'
import type { Runtime, Source } from '../src/types'

/** A small snapshot with the real dates of 2026-11-25 (docs/recon.md, section 4), so tests do not move with the data. */
const SNAP: EolSnapshot = {
  schema: 1,
  fetchedAt: '2026-11-25',
  attribution: 'test',
  sources: [{ name: 'n', url: 'https://example.test', license: 'MIT', copyright: 'c', usedFor: 'tests' }],
  products: {
    node: [
      { cycle: '26', eolFrom: '2029-04-30', ltsFrom: '2026-10-28', latest: '26.13.1', codename: 'lithium' },
      { cycle: '25', eolFrom: '2026-06-01', ltsFrom: null, latest: '25.9.0', codename: null },
      { cycle: '24', eolFrom: '2028-04-30', ltsFrom: '2025-10-28', latest: '24.22.3', codename: 'krypton' },
      { cycle: '22', eolFrom: '2027-04-30', ltsFrom: '2024-10-29', latest: '22.23.5', codename: 'jod' },
      { cycle: '20', eolFrom: '2026-04-30', ltsFrom: '2023-10-24', latest: '20.20.2', codename: 'iron' },
      { cycle: '18', eolFrom: '2025-04-30', ltsFrom: '2022-10-25', latest: '18.20.8', codename: 'hydrogen' },
    ],
    python: [
      { cycle: '3.12', eolFrom: '2028-10-31', ltsFrom: null, latest: '3.12.16' },
      { cycle: '3.11', eolFrom: '2027-10-31', ltsFrom: null, latest: '3.11.18' },
      { cycle: '3.10', eolFrom: '2026-10-01', ltsFrom: null, latest: '3.10.22' },
      { cycle: '3.9', eolFrom: '2025-10-31', ltsFrom: null, latest: '3.9.25' },
    ],
    go: [
      { cycle: '1.27', eolFrom: null, ltsFrom: null, latest: '1.27.4' },
      { cycle: '1.26', eolFrom: null, ltsFrom: null, latest: '1.26.11' },
      { cycle: '1.25', eolFrom: '2026-08-19', ltsFrom: null, latest: '1.25.14' },
      { cycle: '1.24', eolFrom: '2026-02-10', ltsFrom: null, latest: '1.24.13' },
    ],
  },
}

const TODAY = '2026-11-25'

function src(runtime: Runtime, raw: string, file = '.nvmrc', line = 1, extra: Partial<Source> = {}): Source {
  return { runtime, file, line, raw, kind: 'test', constraint: parseConstraint(raw, runtime), ...extra }
}

function codes(sources: Source[], date = TODAY, roots?: string[]): string[] {
  return eolFindings(sources, roots, { snapshot: SNAP, date }).map((f) => `${f.code}:${f.sources[0]?.raw}`)
}

describe('eolFindings: EOL_RUNTIME', () => {
  it('flags Node 20 after its end-of-life (2026-04-30) with file, line and date', () => {
    const [f] = eolFindings([src('node', '20', '.nvmrc', 3)], ['.'], { snapshot: SNAP, date: TODAY })
    expect(f).toMatchObject({ code: 'EOL_RUNTIME', severity: 'warning', runtime: 'node', scopes: ['.'] })
    expect(f?.sources).toEqual([{ file: '.nvmrc', line: 3, raw: '20', constraint: { kind: 'partial', version: '20' } }])
    expect(f?.message).toContain('.nvmrc:3')
    expect(f?.message).toContain('node 20 reached end-of-life on 2026-04-30')
    expect(f?.message).toContain('check date 2026-11-25')
  })

  it('treats the end-of-life day itself as ended, and the day before as soon', () => {
    expect(codes([src('node', '20')], '2026-04-30')).toEqual(['EOL_RUNTIME:20'])
    expect(codes([src('node', '20')], '2026-04-29')).toEqual(['EOL_SOON:20'])
  })

  it('reads exact pins by their line', () => {
    expect(codes([src('node', '18.20.8')])).toEqual(['EOL_RUNTIME:18.20.8'])
    expect(codes([src('node', 'v22.11.0')])).toEqual([])
  })

  it('flags a range only when every line it allows is past end-of-life', () => {
    expect(codes([src('node', '>=18 <21')])).toEqual(['EOL_RUNTIME:>=18 <21'])
    const [f] = eolFindings([src('node', '>=18 <21')], ['.'], { snapshot: SNAP, date: TODAY })
    expect(f?.message).toContain('every node line it allows (20, 18) is past end-of-life')
    expect(codes([src('node', '>=18 <23')])).toEqual([]) // 22 is still supported
  })

  it('never flags a range that reaches past the newest line the snapshot knows', () => {
    expect(codes([src('node', '>=18')])).toEqual([])
    expect(codes([src('node', '>=25')])).toEqual([])
  })

  it('handles Python minor lines and Go lines, including an unannounced Go end-of-life', () => {
    expect(codes([src('python', '3.10', '.python-version')])).toEqual(['EOL_RUNTIME:3.10'])
    expect(codes([src('python', '3.12', '.python-version')])).toEqual([])
    expect(codes([src('go', '1.25', 'go.mod')])).toEqual(['EOL_RUNTIME:1.25'])
    expect(codes([src('go', '1.26', 'go.mod')])).toEqual([]) // eolFrom null: nothing announced
    expect(codes([src('python', '>=3.9,<3.11', 'pyproject.toml')])).toEqual(['EOL_RUNTIME:>=3.9,<3.11'])
  })

  it('judges CI matrix entries like any other source', () => {
    const f = eolFindings([src('node', '18', '.github/workflows/ci.yml', 12, { matrix: true })], ['.'], { snapshot: SNAP, date: TODAY })
    expect(f.map((x) => x.code)).toEqual(['EOL_RUNTIME'])
  })
})

describe('eolFindings: EOL_SOON', () => {
  it(`reports an end-of-life within ${EOL_SOON_DAYS} days as info`, () => {
    const [f] = eolFindings([src('node', '22')], ['.'], { snapshot: SNAP, date: '2027-02-01' })
    expect(f).toMatchObject({ code: 'EOL_SOON', severity: 'info' })
    expect(f?.message).toContain('node 22 reaches end-of-life on 2027-04-30')
    expect(f?.message).toContain(`within ${EOL_SOON_DAYS} days`)
  })

  it('draws the line at exactly 90 days', () => {
    expect(codes([src('node', '22')], '2027-01-30')).toEqual(['EOL_SOON:22']) // 90 days before 2027-04-30
    expect(codes([src('node', '22')], '2027-01-29')).toEqual([]) // 91 days
  })

  it('does not warn when a supported line is also allowed', () => {
    expect(codes([src('node', '>=22 <25')], '2027-04-01')).toEqual([])
    expect(codes([src('node', '>=20 <23')], '2026-04-29')).toEqual([]) // 22 is far from its end
  })

  it('reports a range whose newest line ends soon', () => {
    expect(codes([src('node', '>=18 <23')], '2027-03-01')).toEqual(['EOL_SOON:>=18 <23'])
  })
})

describe('eolFindings: what it leaves alone', () => {
  it('skips floating aliases, unreadable sources and aliases it cannot resolve', () => {
    expect(codes([src('node', 'latest'), src('node', 'node', 'a', 2), src('node', '${NODE_VERSION}', 'b', 3), src('node', 'lts/nope', 'c', 4)])).toEqual([])
    expect(codes([src('python', 'lts/iron', '.python-version')])).toEqual([])
  })

  it('judges a resolved alias: lts/hydrogen is Node 18', () => {
    expect(codes([src('node', 'lts/hydrogen')])).toEqual(['EOL_RUNTIME:lts/hydrogen'])
    expect(codes([src('node', 'lts/*')])).toEqual([])
  })

  it('returns nothing for no sources', () => {
    expect(eolFindings([], ['.'], { snapshot: SNAP, date: TODAY })).toEqual([])
  })
})

describe('eolFindings: scopes and order', () => {
  it('reports a root-level file once with every project root', () => {
    const f = eolFindings([src('node', '20', '.nvmrc')], ['.', 'packages/a', 'packages/b'], { snapshot: SNAP, date: TODAY })
    expect(f).toHaveLength(1)
    expect(f[0]?.scopes).toEqual(['.', 'packages/a', 'packages/b'])
  })

  it('keeps a manifest in its own project root', () => {
    const f = eolFindings([src('node', '>=18 <21', 'packages/a/package.json', 5)], ['.', 'packages/a'], { snapshot: SNAP, date: TODAY })
    expect(f[0]?.scopes).toEqual(['packages/a'])
  })

  it('sorts by severity, then file and line', () => {
    const sources = [src('node', '22', 'z.txt', 1), src('node', '18', 'b.txt', 9), src('node', '20', 'a.txt', 2)]
    const f = eolFindings(sources, ['.'], { snapshot: SNAP, date: '2027-03-01' })
    expect(f.map((x) => `${x.code}@${x.sources[0]?.file}`)).toEqual(['EOL_RUNTIME@a.txt', 'EOL_RUNTIME@b.txt', 'EOL_SOON@z.txt'])
  })

  it('is deterministic for the same date', () => {
    const sources = [src('node', '20'), src('python', '3.9', '.python-version'), src('go', '1.24', 'go.mod')]
    const a = eolFindings(sources, ['.'], { snapshot: SNAP, date: TODAY })
    expect(eolFindings(sources, ['.'], { snapshot: SNAP, date: TODAY })).toEqual(a)
    expect(a).toHaveLength(3)
  })
})

describe('createAliasResolver', () => {
  const at = (date: string) => createAliasResolver(SNAP, date)

  it('resolves lts/* to the newest line that is LTS on the date', () => {
    expect(at('2026-11-25')('node', 'lts/*')).toBe('>=26.0.0 <27.0.0-0')
    expect(at('2026-10-01')('node', 'lts/*')).toBe('>=24.0.0 <25.0.0-0') // 26 is not LTS yet
    expect(at('2026-11-25')('node', 'lts')).toBe('>=26.0.0 <27.0.0-0')
  })

  it('resolves lts/-n to earlier LTS lines', () => {
    expect(at('2026-11-25')('node', 'lts/-1')).toBe('>=24.0.0 <25.0.0-0')
    expect(at('2026-11-25')('node', 'lts/-2')).toBe('>=22.0.0 <23.0.0-0')
    expect(at('2026-11-25')('node', 'lts/-9')).toBeUndefined()
  })

  it('resolves codenames, in any letter case', () => {
    expect(at(TODAY)('node', 'lts/iron')).toBe('>=20.0.0 <21.0.0-0')
    expect(at(TODAY)('node', 'LTS/Jod')).toBe('>=22.0.0 <23.0.0-0')
  })

  it('resolves nothing it does not know', () => {
    expect(at(TODAY)('node', 'lts/nope')).toBeUndefined()
    expect(at(TODAY)('node', 'latest')).toBeUndefined()
    expect(at(TODAY)('python', 'lts/*')).toBeUndefined()
    expect(at(TODAY)('go', 'lts/iron')).toBeUndefined()
  })

  it('lets compareSources compare an alias with the other pins', () => {
    const sources = [src('node', 'lts/iron', '.nvmrc', 1), src('node', '>=22', 'package.json', 7)]
    expect(compareSources(sources, ['.'], {})).toEqual([]) // without a resolver the alias cannot be compared
    const withResolver = compareSources(sources, ['.'], { resolveAlias: at(TODAY) })
    expect(withResolver.map((f) => f.code)).toEqual(['OUTSIDE_RANGE'])
    expect(withResolver[0]?.sources.map((s) => s.file)).toEqual(['.nvmrc', 'package.json'])
  })
})

describe('checkDate', () => {
  it('accepts real dates and defaults to today in UTC', () => {
    expect(checkDate('2026-11-25')).toBe('2026-11-25')
    expect(checkDate()).toBe(new Date().toISOString().slice(0, 10))
  })

  it('rejects text that is not a calendar date', () => {
    for (const bad of ['2026-13-01', '2026-02-30', '25/11/2026', '2026-1-1', '', 'tomorrow']) {
      expect(() => checkDate(bad), bad).toThrow(RangeError)
    }
  })

  it('eolFindings refuses a bad --date', () => {
    expect(() => eolFindings([src('node', '20')], ['.'], { snapshot: SNAP, date: '2026-02-30' })).toThrow(RangeError)
  })
})

describe('parseSnapshot and the bundled snapshot', () => {
  it('accepts the test snapshot unchanged', () => {
    expect(parseSnapshot(JSON.parse(JSON.stringify(SNAP)))).toEqual(SNAP)
  })

  it('names the broken field', () => {
    const copy = () => JSON.parse(JSON.stringify(SNAP)) as Record<string, any>
    const cases: Array<[(s: Record<string, any>) => void, RegExp]> = [
      [(s) => (s.schema = 2), /schema must be 1/],
      [(s) => (s.fetchedAt = 'yesterday'), /fetchedAt/],
      [(s) => (s.sources = []), /sources/],
      [(s) => delete s.products.go, /products\.go/],
      [(s) => (s.products.node[0].eolFrom = '2029-02-30'), /products\.node\[0\]\.eolFrom/],
      [(s) => (s.products.python[1].cycle = 'three'), /cycle must look like/],
      [(s) => (s.attribution = ''), /attribution/],
    ]
    for (const [mutate, message] of cases) {
      const s = copy()
      mutate(s)
      expect(() => parseSnapshot(s)).toThrow(message)
    }
    expect(() => parseSnapshot(null)).toThrow(TypeError)
  })

  it('ships real data with its source, licence and attribution recorded', () => {
    const s = bundledSnapshot()
    expect(s.attribution).toMatch(/endoflife\.date/)
    expect(s.attribution).toMatch(/MIT License/)
    expect(s.sources[0]).toMatchObject({ name: 'endoflife.date', license: 'MIT' })
    expect(s.products.node.length).toBeGreaterThan(10)
    expect(s.products.python.length).toBeGreaterThan(10)
    expect(s.products.go.length).toBeGreaterThan(10)
    expect(s.products.node.find((c) => c.cycle === '22')?.codename).toBe('jod')
  })

  it('stores no product descriptions (they derive from Wikipedia, CC BY-SA)', () => {
    const raw = readFileSync(new URL('../data/eol.json', import.meta.url), 'utf8')
    expect(raw).not.toMatch(/"description"/i)
    for (const runtime of ['node', 'python', 'go'] as const) {
      for (const c of bundledSnapshot().products[runtime]) {
        expect(Object.keys(c).filter((k) => !['cycle', 'eolFrom', 'ltsFrom', 'latest', 'codename'].includes(k))).toEqual([])
      }
    }
  })

  it('agrees with the facts recorded in docs/recon.md for 2026-11-25', () => {
    const f = eolFindings([src('node', '20'), src('node', '22', 'x', 2)], ['.'], { date: '2026-11-25' })
    expect(f.map((x) => `${x.code}:${x.sources[0]?.raw}`)).toEqual(['EOL_RUNTIME:20'])
    expect(createAliasResolver(undefined, '2026-11-25')('node', 'lts/iron')).toBe('>=20.0.0 <21.0.0-0')
  })
})

describe('scripts/update-eol.mjs', () => {
  const script = new URL('../scripts/update-eol.mjs', import.meta.url)

  const v1 = (rows: Array<[string, string | null, string | null, string]>) => ({
    schema_version: '1.2.1',
    result: {
      name: 'x',
      description: 'must not be copied',
      releases: rows.map(([name, eolFrom, ltsFrom, latest]) => ({ name, codename: null, eolFrom, ltsFrom, latest: { name: latest, date: '2026-01-01' }, isEol: false })),
    },
  })
  const nodeIndex = [
    { version: 'v22.5.0', lts: 'Jod' },
    { version: 'v22.4.0', lts: 'Jod' },
    { version: 'v21.0.0', lts: false },
    { version: 'v20.1.0', lts: 'Iron' },
  ]
  const input = {
    nodejs: v1([['22', '2027-04-30', '2024-10-29', '22.23.5'], ['21', '2024-06-01', null, '21.7.3'], ['20', '2026-04-30', '2023-10-24', '20.20.2']]),
    python: v1([['3.12', '2028-10-31', null, '3.12.16']]),
    go: [{ cycle: '1.26', eol: false, lts: false, latest: '1.26.11' }, { cycle: '1.25', eol: '2026-08-19', lts: false, latest: '1.25.14' }],
    nodeIndex,
    fetchedAt: '2026-11-25',
  }

  async function load(): Promise<{ buildSnapshot: (i: unknown, withInfo?: boolean) => unknown }> {
    return (await import(script.href)) as { buildSnapshot: (i: unknown, withInfo?: boolean) => unknown }
  }

  it('builds a valid snapshot from recorded responses (v1 and legacy shapes) with codenames', async () => {
    const { buildSnapshot } = await load()
    const snap = parseSnapshot(buildSnapshot(input))
    expect(snap.products.node.map((c) => [c.cycle, c.codename])).toEqual([['22', 'jod'], ['21', null], ['20', 'iron']])
    expect(snap.products.node[0]).toMatchObject({ eolFrom: '2027-04-30', ltsFrom: '2024-10-29', latest: '22.23.5' })
    expect(snap.products.go).toEqual([
      { cycle: '1.26', eolFrom: null, ltsFrom: null, latest: '1.26.11' },
      { cycle: '1.25', eolFrom: '2026-08-19', ltsFrom: null, latest: '1.25.14' },
    ])
    expect(snap.attribution).toContain('fetched 2026-11-25')
    expect(JSON.stringify(snap)).not.toContain('must not be copied')
  })

  it('is deterministic for the same input', async () => {
    const { buildSnapshot } = await load()
    expect(JSON.stringify(buildSnapshot(input))).toBe(JSON.stringify(buildSnapshot(input)))
  })

  it('refuses a response it does not understand instead of writing a partial file', async () => {
    const { buildSnapshot } = await load()
    expect(() => buildSnapshot({ ...input, python: { unexpected: true } })).toThrow(/unexpected response shape/)
    expect(() => buildSnapshot({ ...input, nodejs: v1([['22', '2027-13-45', null, '22.0.0']]) })).toThrow(/eolFrom/)
    expect(() => buildSnapshot({ ...input, go: [{ cycle: '1.25', eol: true, lts: false, latest: '1.25.0' }] })).toThrow(/boolean/)
    expect(() => buildSnapshot({ ...input, nodejs: v1([]) })).toThrow(/no release lines/)
    expect(() => buildSnapshot({ ...input, fetchedAt: 'today' })).toThrow(/fetchedAt/)
  })

  it('writes the file from recorded responses with --from-dir, without the network', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rpc-eol-'))
    try {
      writeFileSync(join(dir, 'nodejs.json'), JSON.stringify(input.nodejs))
      writeFileSync(join(dir, 'python.json'), JSON.stringify(input.python))
      writeFileSync(join(dir, 'go.json'), JSON.stringify(input.go))
      writeFileSync(join(dir, 'node-index.json'), JSON.stringify(input.nodeIndex))
      const out = join(dir, 'eol.json')
      const stdout = execFileSync(process.execPath, [script.pathname, '--from-dir', dir, '--out', out, '--fetched-at', '2026-11-25'], { encoding: 'utf8' })
      expect(stdout).toContain('wrote')
      expect(parseSnapshot(JSON.parse(readFileSync(out, 'utf8'))).fetchedAt).toBe('2026-11-25')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  describe('codename fallback (nodejs.org unreachable or malformed)', () => {
    const previous = new Map([['22', 'jod'], ['20', 'iron']])

    it('keeps the previous pairs when the index is missing, malformed or empty, and says so', async () => {
      const { buildSnapshot } = await load()
      for (const nodeIndex of [undefined, 'oops', { not: 'an array' }, [], [{ version: 'v22.0.0', lts: false }]]) {
        const out = buildSnapshot({ ...input, nodeIndex, previous }, true) as { snapshot: EolSnapshot; codenamesKept: boolean; indexProblem?: string }
        expect(out.snapshot.products.node.map((c) => c.codename), JSON.stringify(nodeIndex)).toEqual(['jod', null, 'iron'])
        expect(out.codenamesKept).toBe(true)
        expect(out.indexProblem).toBeTruthy()
        parseSnapshot(out.snapshot)
      }
    })

    it('prefers fresh pairs and only falls back for lines the index lacks', async () => {
      const { buildSnapshot } = await load()
      const out = buildSnapshot({ ...input, nodeIndex: [{ version: 'v22.9.0', lts: 'Jod' }], previous }, true) as { snapshot: EolSnapshot; codenamesKept: boolean }
      expect(out.snapshot.products.node.map((c) => c.codename)).toEqual(['jod', null, 'iron'])
      expect(out.codenamesKept).toBe(true)
      const fresh = buildSnapshot({ ...input, nodeIndex: [{ version: 'v22.9.0', lts: 'Renamed' }], previous }) as EolSnapshot
      expect(fresh.products.node[0]?.codename).toBe('renamed')
    })

    it('stops instead of writing Node lines without codenames when there is nothing to keep', async () => {
      const { buildSnapshot } = await load()
      expect(() => buildSnapshot({ ...input, nodeIndex: undefined, previous: new Map() })).toThrow(/no earlier codenames to keep/)
    })

    it('the command keeps the previous codenames in the existing file when node-index.json is unusable', () => {
      const dir = mkdtempSync(join(tmpdir(), 'rpc-eol-'))
      try {
        writeFileSync(join(dir, 'nodejs.json'), JSON.stringify(input.nodejs))
        writeFileSync(join(dir, 'python.json'), JSON.stringify(input.python))
        writeFileSync(join(dir, 'go.json'), JSON.stringify(input.go))
        writeFileSync(join(dir, 'node-index.json'), '{broken')
        const out = join(dir, 'eol.json')
        const args = [script.pathname, '--from-dir', dir, '--out', out, '--fetched-at', '2026-11-25']
        // No previous file and no usable index: nothing is written.
        expect(() => execFileSync(process.execPath, args, { stdio: 'pipe' })).toThrow()
        expect(() => readFileSync(out)).toThrow()
        // A previous file with pairs: they survive.
        writeFileSync(out, JSON.stringify({ ...SNAP, products: { ...SNAP.products, node: SNAP.products.node } }))
        const run = execFileSync(process.execPath, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
        expect(run).toContain('wrote')
        const after = parseSnapshot(JSON.parse(readFileSync(out, 'utf8')))
        expect(after.products.node.map((c) => c.codename)).toEqual(['jod', null, 'iron'])
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })
  })

  describe('--from-dir: a missing or empty node-index.json keeps the existing pairs (exit 0, warning)', () => {
    for (const [label, writeIndex] of [
      ['missing', undefined],
      ['empty array (zero pairs)', '[]'],
    ] as const) {
      it(`${label}`, () => {
        const dir = mkdtempSync(join(tmpdir(), 'rpc-eol-'))
        try {
          writeFileSync(join(dir, 'nodejs.json'), JSON.stringify(input.nodejs))
          writeFileSync(join(dir, 'python.json'), JSON.stringify(input.python))
          writeFileSync(join(dir, 'go.json'), JSON.stringify(input.go))
          if (writeIndex !== undefined) writeFileSync(join(dir, 'node-index.json'), writeIndex)
          const out = join(dir, 'eol.json')
          writeFileSync(out, JSON.stringify(SNAP))
          const r = spawnSync(process.execPath, [script.pathname, '--from-dir', dir, '--out', out, '--fetched-at', '2026-11-25'], { encoding: 'utf8' })
          expect(r.status).toBe(0)
          expect(r.stderr).toMatch(/kept the \d+ previous pairs/)
          const after = parseSnapshot(JSON.parse(readFileSync(out, 'utf8')))
          expect(after.products.node.map((c) => c.codename)).toEqual(['jod', null, 'iron'])
          expect(after.fetchedAt).toBe('2026-11-25') // the EOL part still refreshed
        } finally {
          rmSync(dir, { recursive: true, force: true })
        }
      })
    }
  })

  it('exits non-zero and writes nothing on bad input', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rpc-eol-'))
    try {
      for (const f of ['nodejs.json', 'python.json', 'go.json']) writeFileSync(join(dir, f), '{"nope":1}')
      writeFileSync(join(dir, 'node-index.json'), '[]')
      const out = join(dir, 'eol.json')
      expect(() => execFileSync(process.execPath, [script.pathname, '--from-dir', dir, '--out', out], { stdio: 'pipe' })).toThrow()
      expect(() => readFileSync(out)).toThrow()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
