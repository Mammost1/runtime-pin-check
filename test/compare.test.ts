import { describe, expect, it } from 'vitest'
import { bindSources, compareSources, groupByScope, isSharedFile, scopesOf } from '../src/compare'
import { parseConstraint } from '../src/constraint'
import type { Runtime, Source } from '../src/types'

// Hand-built sources, as extractors will produce them.
function src(file: string, line: number, raw: string, kind: string, runtime: Runtime = 'node', extra: Partial<Source> = {}): Source {
  return { runtime, file, line, raw, kind, constraint: parseConstraint(raw, runtime), ...extra }
}

const codes = (sources: Source[], roots?: string[]) => compareSources(sources, roots).map((f) => f.code)

describe('per-scope comparison: every non-EOL code', () => {
  it('VERSION_CONFLICT: two pins with no common version', () => {
    const f = compareSources([src('.nvmrc', 1, '20', 'nvmrc'), src('Dockerfile', 3, '22', 'dockerfile')])
    expect(f).toHaveLength(1)
    expect(f[0]).toMatchObject({ code: 'VERSION_CONFLICT', severity: 'error', runtime: 'node', scopes: ['.'] })
    expect(f[0]?.sources.map((s) => `${s.file}:${s.line}`)).toEqual(['.nvmrc:1', 'Dockerfile:3'])
    expect(f[0]?.message).toContain('.nvmrc:1')
    expect(f[0]?.message).toContain('Dockerfile:3')
  })

  it('VERSION_CONFLICT: two ranges with nothing in common', () => {
    expect(codes([src('package.json', 5, '>=20 <22', 'engines'), src('package.json', 9, '>=22', 'devEngines')])).toEqual([
      'VERSION_CONFLICT',
    ])
  })

  it('OUTSIDE_RANGE: a pin outside a range source (.nvmrc 18 vs engines >=20)', () => {
    const f = compareSources([src('.nvmrc', 1, '18', 'nvmrc'), src('package.json', 12, '>=20', 'engines')])
    expect(f.map((x) => x.code)).toEqual(['OUTSIDE_RANGE'])
    expect(f[0]?.message).toMatch(/\.nvmrc:1 pins node 18, outside the range >=20\.0\.0 required by package\.json:12/)
  })

  it('PRECISION_MISMATCH: agreeing pins at different precision', () => {
    const f = compareSources([src('.nvmrc', 1, '22', 'nvmrc'), src('.node-version', 1, '22.11.0', 'node-version')])
    expect(f).toEqual([expect.objectContaining({ code: 'PRECISION_MISMATCH', severity: 'info' })])
  })

  it('FLOATING_ALIAS: latest/node/stable are reported and never compared', () => {
    const f = compareSources([src('.nvmrc', 1, 'node', 'nvmrc'), src('package.json', 3, '18', 'volta')])
    expect(f.map((x) => x.code)).toEqual(['FLOATING_ALIAS'])
  })

  it('UNPARSEABLE: an unreadable value is an info finding with file and line', () => {
    const f = compareSources([src('.gitlab-ci.yml', 11, '${NODE_VERSION}', 'gitlab-ci')])
    expect(f).toEqual([
      expect.objectContaining({ code: 'UNPARSEABLE', severity: 'info', sources: [expect.objectContaining({ file: '.gitlab-ci.yml', line: 11 })] }),
    ])
  })

  it('reports nothing when everything agrees, or when a scope has a single source', () => {
    expect(codes([src('.nvmrc', 1, '22.11.0', 'nvmrc'), src('package.json', 4, '>=22', 'engines'), src('Dockerfile', 1, '22.11.0', 'dockerfile')])).toEqual([])
    expect(codes([src('.nvmrc', 1, '18', 'nvmrc')])).toEqual([])
  })

  it('reports every pair, errors first', () => {
    const f = compareSources([
      src('.nvmrc', 1, '22', 'nvmrc'),
      src('.node-version', 1, '22.11.0', 'node-version'),
      src('package.json', 7, '>=20 <22', 'engines'),
    ])
    expect(f.map((x) => x.code)).toEqual(['OUTSIDE_RANGE', 'OUTSIDE_RANGE', 'PRECISION_MISMATCH'])
  })
})

describe('runtimes and aliases', () => {
  it('compares each runtime separately', () => {
    const f = compareSources([
      src('.python-version', 1, '3.12', 'python-version', 'python'),
      src('pyproject.toml', 8, '>=3.8,<3.12', 'requires-python', 'python'),
      src('go.mod', 3, '1.24.0', 'go-mod', 'go'),
      src('.tool-versions', 1, '1.23.4', 'tool-versions', 'go'),
      src('.nvmrc', 1, '22', 'nvmrc'),
    ])
    // Errors sorted by their first file: .python-version before .tool-versions.
    expect(f.map((x) => [x.code, x.runtime])).toEqual([
      ['OUTSIDE_RANGE', 'python'],
      ['VERSION_CONFLICT', 'go'],
    ])
  })

  it('compares an lts alias only when a resolver is given', () => {
    const sources = [src('.nvmrc', 1, 'lts/iron', 'nvmrc'), src('Dockerfile', 1, '22', 'dockerfile')]
    expect(compareSources(sources)).toEqual([])
    const resolveAlias = (_: Runtime, alias: string) => (alias === 'lts/iron' ? '>=20.0.0 <21.0.0-0' : undefined)
    expect(compareSources(sources, ['.'], { resolveAlias }).map((x) => x.code)).toEqual(['VERSION_CONFLICT'])
  })

  it('reports an alias the resolver cannot resolve as UNPARSEABLE instead of skipping it (review F1)', () => {
    const resolveAlias = () => undefined
    const f = compareSources([src('.nvmrc', 1, 'lts/bogus', 'nvmrc'), src('Dockerfile', 1, '22', 'dockerfile')], ['.'], { resolveAlias })
    expect(f).toEqual([
      expect.objectContaining({ code: 'UNPARSEABLE', severity: 'info', sources: [expect.objectContaining({ file: '.nvmrc', line: 1, raw: 'lts/bogus' })] }),
    ])
  })

  it('treats node:alpine3.20 as a floating pin, not an unparseable one (review F2)', () => {
    const f = compareSources([{ runtime: 'node', file: 'Dockerfile', line: 1, raw: 'alpine3.20', kind: 'dockerfile', constraint: { kind: 'alias', alias: 'latest' } }])
    expect(f.map((x) => x.code)).toEqual(['FLOATING_ALIAS'])
  })
})

describe('CI matrix', () => {
  it('checks matrix entries only against range sources', () => {
    const sources = [
      src('.github/workflows/ci.yml', 15, '18.x', 'setup-node', 'node', { matrix: true }),
      src('.github/workflows/ci.yml', 15, '20.x', 'setup-node', 'node', { matrix: true }),
      src('.nvmrc', 1, '20', 'nvmrc'),
      src('package.json', 4, '>=20', 'engines'),
    ]
    const f = compareSources(sources)
    expect(f.map((x) => x.code)).toEqual(['OUTSIDE_RANGE'])
    expect(f[0]?.sources.map((s) => s.raw)).toEqual(['18.x', '>=20'])
  })
})

describe('project-root scopes', () => {
  const roots = ['.', 'packages/a', 'packages/b']

  it('treats .github/ (any case), .gitlab-ci.yml and root version files as shared', () => {
    expect(isSharedFile('.github/workflows/ci.yml')).toBe(true)
    expect(isSharedFile('.GitHub/workflows/Ci.Yml')).toBe(true)
    expect(isSharedFile('.gitlab-ci.yml')).toBe(true)
    expect(isSharedFile('.nvmrc')).toBe(true)
    expect(isSharedFile('package.json')).toBe(false)
    expect(isSharedFile('Dockerfile')).toBe(false)
    expect(isSharedFile('api.dockerfile')).toBe(false)
    expect(isSharedFile('packages/a/.nvmrc')).toBe(false)
  })

  it('places a file in its deepest project root, shared files in every root', () => {
    expect(scopesOf(src('packages/a/package.json', 3, '>=20', 'engines'), roots)).toEqual(['packages/a'])
    expect(scopesOf(src('packages/a/src/Dockerfile', 1, '22', 'dockerfile'), roots)).toEqual(['packages/a'])
    expect(scopesOf(src('tools/Dockerfile', 1, '22', 'dockerfile'), roots)).toEqual(['.'])
    expect(scopesOf(src('.nvmrc', 1, '22', 'nvmrc'), roots)).toEqual(roots)
    expect(scopesOf(src('.github/workflows/ci.yml', 9, '22', 'setup-node', 'node', { workingDirectory: './packages/b/' }), roots)).toEqual([
      'packages/b',
    ])
  })

  it('finds drift inside one package and reports a shared conflict once with every root', () => {
    const f = compareSources(
      [
        src('.nvmrc', 1, '22', 'nvmrc'),
        src('package.json', 4, '>=22', 'engines'),
        src('packages/a/package.json', 4, '>=18 <21', 'engines'),
        src('packages/b/package.json', 4, '>=22', 'engines'),
        src('.github/workflows/ci.yml', 20, '20', 'setup-node'),
      ],
      roots,
    )
    const conflict = f.find((x) => x.code === 'VERSION_CONFLICT')
    expect(conflict?.scopes).toEqual(['.', 'packages/a', 'packages/b'])
    const outside = f.filter((x) => x.code === 'OUTSIDE_RANGE').map((x) => [x.sources.map((s) => s.file).join(' vs '), x.scopes])
    expect(outside).toEqual(
      expect.arrayContaining([
        ['.github/workflows/ci.yml vs package.json', ['.']],
        ['.nvmrc vs packages/a/package.json', ['packages/a']],
        ['.github/workflows/ci.yml vs packages/b/package.json', ['packages/b']],
      ]),
    )
    // packages/a and packages/b are never compared with each other.
    expect(f.some((x) => x.sources.some((s) => s.file === 'packages/a/package.json') && x.sources.some((s) => s.file === 'packages/b/package.json'))).toBe(false)
  })

  it('groups by root and runtime in a stable order', () => {
    const groups = groupByScope([src('packages/a/.python-version', 1, '3.12', 'python-version', 'python'), src('.nvmrc', 1, '22', 'nvmrc')], roots)
    expect(groups.map((g) => `${g.root}:${g.runtime}`)).toEqual(['.:node', 'packages/a:node', 'packages/a:python', 'packages/b:node'])
  })
})

describe('grouped findings (A10)', () => {
  it('collapses every conflicting pin of a runtime into ONE VERSION_CONFLICT grouped by version', () => {
    const f = compareSources([
      src('.nvmrc', 1, '18', 'nvmrc'),
      src('.github/workflows/ci.yml', 9, '20', 'setup-node'),
      src('.github/workflows/ci.yml', 22, '20', 'setup-node'),
      src('Dockerfile', 1, '22.x', 'dockerfile'),
      src('Dockerfile', 7, '22', 'dockerfile'),
    ])
    expect(f.map((x) => x.code)).toEqual(['VERSION_CONFLICT'])
    expect(f[0]?.sources).toHaveLength(5)
    expect(f[0]?.message).toBe(
      'node: 3 different versions across 3 files: 20 (.github/workflows/ci.yml:9, .github/workflows/ci.yml:22), 18 (.nvmrc:1), 22 (Dockerfile:1, Dockerfile:7); no version satisfies all of them.',
    )
  })

  it('keeps OUTSIDE_RANGE per (pin, range) pair', () => {
    const f = compareSources([
      src('.nvmrc', 1, '18', 'nvmrc'),
      src('Dockerfile', 1, '18', 'dockerfile'),
      src('package.json', 4, '>=20', 'engines'),
    ])
    expect(f.map((x) => x.code)).toEqual(['OUTSIDE_RANGE', 'OUTSIDE_RANGE', 'PRECISION_MISMATCH'].slice(0, 2))
  })

  it('lists ranges in the conflict only when ranges disagree among themselves', () => {
    const pinsOnly = compareSources([src('.nvmrc', 1, '20', 'nvmrc'), src('Dockerfile', 1, '22', 'dockerfile'), src('package.json', 4, '>=20', 'engines')])
    expect(pinsOnly.find((x) => x.code === 'VERSION_CONFLICT')?.sources.map((s) => s.file)).toEqual(['.nvmrc', 'Dockerfile'])
    const both = compareSources([
      src('.nvmrc', 1, '20', 'nvmrc'),
      src('Dockerfile', 1, '22', 'dockerfile'),
      src('package.json', 4, '>=20 <22', 'engines'),
      src('package.json', 9, '>=22', 'devEngines'),
    ])
    const vc = both.filter((x) => x.code === 'VERSION_CONFLICT')
    expect(vc).toHaveLength(1)
    expect(vc[0]?.sources).toHaveLength(4)
  })

  it('reports ONE PRECISION_MISMATCH per runtime and scope', () => {
    const f = compareSources([
      src('.nvmrc', 1, '22', 'nvmrc'),
      src('.node-version', 1, '22.11.0', 'node-version'),
      src('Dockerfile', 1, '22.11', 'dockerfile'),
    ])
    expect(f.map((x) => x.code)).toEqual(['PRECISION_MISMATCH'])
    expect(f[0]?.sources).toHaveLength(3)
    expect(f[0]?.message).toBe('node: pins that agree but are written at different precision: 22 (.nvmrc:1) includes 22.11.0 (.node-version:1), 22.11 (Dockerfile:1).')
  })

  it('still merges a conflict between shared root files across every root', () => {
    const roots = ['.', 'packages/a']
    const f = compareSources([src('.nvmrc', 1, '20', 'nvmrc'), src('.github/workflows/ci.yml', 9, '22', 'setup-node'), src('packages/a/package.json', 4, '>=20', 'engines')], roots)
    expect(f.filter((x) => x.code === 'VERSION_CONFLICT').map((x) => x.scopes)).toEqual([['.', 'packages/a']])
  })
})


describe('A12 binding of sources to project roots', () => {
  const manifests = (entries: Record<string, Runtime[]>) => new Map(Object.entries(entries).map(([d, rs]) => [d, new Set(rs)]))
  const bound = (sources: Source[], roots: string[], m: Record<string, Runtime[]>) =>
    Object.fromEntries(bindSources(sources, roots, manifests(m)).map((s) => [`${s.file}:${s.line}`, s.boundTo]))

  it('OpenEnv #1 shape: root CI python with a root pyproject binds to the root only', () => {
    const roots = ['.', 'envs/unity_env', 'envs/chess_env']
    const sources = [
      src('.github/workflows/package-ci.yml', 20, '3.12', 'setup-python', 'python'),
      src('pyproject.toml', 5, '>=3.10', 'requires-python', 'python'),
      src('envs/unity_env/pyproject.toml', 6, '>=3.9,<=3.10.12', 'requires-python', 'python'),
    ]
    const m = { '.': ['python'] as Runtime[], 'envs/unity_env': ['python'] as Runtime[], 'envs/chess_env': ['python'] as Runtime[] }
    expect(bound(sources, roots, m)['.github/workflows/package-ci.yml:20']).toEqual(['.'])
    const f = compareSources(bindSources(sources, roots, manifests(m)), roots)
    expect(f.filter((x) => x.code === 'OUTSIDE_RANGE' || x.code === 'VERSION_CONFLICT')).toEqual([])
  })

  it('boxlite shape: root CI node 20 with cache-dependency-path binds to sdks/node only', () => {
    const roots = ['.', 'apps/web', 'sdks/node']
    const sources = [
      src('.github/workflows/lint.yml', 204, '20', 'setup-node', 'node', { paths: ['sdks/node/package-lock.json'] }),
      src('apps/web/package.json', 8, '>=22', 'engines'),
      src('sdks/node/package.json', 9, '>=18', 'engines'),
    ]
    const m = { 'apps/web': ['node'] as Runtime[], 'sdks/node': ['node'] as Runtime[] }
    expect(bound(sources, roots, m)['.github/workflows/lint.yml:204']).toEqual(['sdks/node'])
    expect(compareSources(bindSources(sources, roots, manifests(m)), roots)).toEqual([])
  })

  it('a root CI pin with no working-directory, no root manifest and no path is UNBOUND', () => {
    const roots = ['.', 'apps/web']
    const sources = [
      src('.github/workflows/ci.yml', 9, '20', 'setup-node'),
      src('.github/workflows/ci.yml', 30, 'latest', 'setup-node'),
      src('Dockerfile', 1, '18', 'dockerfile'),
      src('apps/web/package.json', 8, '>=22', 'engines'),
    ]
    const b = bindSources(sources, roots, manifests({ 'apps/web': ['node'] }))
    expect(b.map((s) => s.boundTo)).toEqual([[], [], [], ['apps/web']])
    const f = compareSources(b, roots)
    // Never compared, but its own problems are still reported, with no scope.
    expect(f).toEqual([expect.objectContaining({ code: 'FLOATING_ALIAS', scopes: [] })])
  })

  it('working-directory and the root manifest rule also apply to a root Dockerfile', () => {
    const roots = ['.', 'svc']
    expect(bound([src('Dockerfile', 1, '22', 'dockerfile')], roots, { '.': ['node'] })['Dockerfile:1']).toEqual(['.'])
    expect(bound([src('.github/workflows/ci.yml', 9, '20', 'setup-node', 'node', { workingDirectory: './svc/' })], roots, {})['.github/workflows/ci.yml:9']).toEqual(['svc'])
    // A Dockerfile inside a project binds to that project only.
    expect(bound([src('svc/deploy/Dockerfile', 1, '22', 'dockerfile')], roots, {})['svc/deploy/Dockerfile:1']).toEqual(['svc'])
  })

  it('a root .nvmrc is inherited by sub-projects without their own .nvmrc, not by those with one', () => {
    const roots = ['.', 'packages/a', 'packages/b']
    const sources = [
      src('.nvmrc', 1, '22', 'nvmrc'),
      src('packages/b/.nvmrc', 1, '20', 'nvmrc'),
      src('packages/a/package.json', 4, '>=22', 'engines'),
      src('packages/b/package.json', 4, '>=20 <21', 'engines'),
    ]
    const b = bound(sources, roots, {})
    expect(b['.nvmrc:1']).toEqual(['.', 'packages/a'])
    expect(b['packages/b/.nvmrc:1']).toEqual(['packages/b'])
    expect(compareSources(bindSources(sources, roots, manifests({})), roots)).toEqual([])
    // Inherited where no closer pin exists: a real drift in packages/a is still found.
    const drift = bindSources([...sources.slice(0, 2), src('packages/a/package.json', 4, '>=24', 'engines')], roots, manifests({}))
    expect(compareSources(drift, roots).map((x) => [x.code, x.scopes])).toEqual([['OUTSIDE_RANGE', ['packages/a']]])
  })

  it('a pin file in an intermediate folder applies to the projects below it only', () => {
    const roots = ['.', 'packages/a', 'packages/b']
    expect(bound([src('packages/.nvmrc', 1, '22', 'nvmrc')], roots, {})['packages/.nvmrc:1']).toEqual(['packages/a', 'packages/b'])
    expect(bound([src('packages/a/src/.nvmrc', 1, '22', 'nvmrc')], roots, {})['packages/a/src/.nvmrc:1']).toEqual(['packages/a'])
  })

  it('.tool-versions overrides per runtime: a sub-project listing only python still inherits root nodejs', () => {
    const roots = ['.', 'api']
    const b = bound(
      [src('.tool-versions', 1, '22.11.0', 'tool-versions'), src('.tool-versions', 2, '3.12.1', 'tool-versions', 'python'), src('api/.tool-versions', 1, '3.11.4', 'tool-versions', 'python')],
      roots,
      {},
    )
    expect(b['.tool-versions:1']).toEqual(['.', 'api'])
    expect(b['.tool-versions:2']).toEqual(['.'])
    expect(b['api/.tool-versions:1']).toEqual(['api'])
  })

  it('scopesOf returns the binding once bindSources has run', () => {
    const [s] = bindSources([src('.github/workflows/ci.yml', 9, '20', 'setup-node')], ['.', 'x'], manifests({}))
    expect(scopesOf(s as Source, ['.', 'x'])).toEqual([])
  })
})

describe('A14: container files in non-project folders of a manifest-less root', () => {
  const manifests = (entries: Record<string, Runtime[]>) => new Map(Object.entries(entries).map(([d, rs]) => [d, new Set(rs)]))
  const roots = ['.', 'apps/web', 'sdks/node']

  it.each(['docker/Dockerfile', 'deploy/prod.Dockerfile', '.devcontainer/Dockerfile', 'docker/compose.yaml'])('%s is UNBOUND, not bound to the root', (file) => {
    const [s] = bindSources([src(file, 1, '18', 'dockerfile')], roots, manifests({ 'apps/web': ['node'] }))
    expect(s?.boundTo).toEqual([])
  })

  it('binds through workingDirectory or paths, and to the root when the root has a manifest', () => {
    const m = manifests({ 'apps/web': ['node'] })
    expect(bindSources([src('docker/Dockerfile', 1, '22', 'dockerfile', 'node', { paths: ['apps/web/package.json'] })], roots, m)[0]?.boundTo).toEqual(['apps/web'])
    expect(bindSources([src('deploy/Dockerfile', 1, '22', 'dockerfile', 'node', { workingDirectory: 'sdks/node' })], roots, m)[0]?.boundTo).toEqual(['sdks/node'])
    expect(bindSources([src('docker/Dockerfile', 1, '22', 'dockerfile')], roots, manifests({ '.': ['node'] }))[0]?.boundTo).toEqual(['.'])
  })

  it('a Dockerfile inside a project and a tool pin in a non-project folder keep their rules', () => {
    const m = manifests({ 'apps/web': ['node'] })
    expect(bindSources([src('apps/web/docker/Dockerfile', 1, '22', 'dockerfile')], roots, m)[0]?.boundTo).toEqual(['apps/web'])
    expect(bindSources([src('scripts/.nvmrc', 1, '22', 'nvmrc')], roots, m)[0]?.boundTo).toEqual(['.'])
  })

  it('ignores glob paths when binding', () => {
    const m = manifests({ 'apps/web': ['node'] })
    const [s] = bindSources([src('.github/workflows/ci.yml', 9, '20', 'setup-node', 'node', { paths: ['**/package-lock.json', 'apps/*/yarn.lock', 'sdks/node/package-lock.json'] })], roots, m)
    expect(s?.boundTo).toEqual(['sdks/node'])
    const [g] = bindSources([src('.github/workflows/ci.yml', 9, '20', 'setup-node', 'node', { paths: ['**/package-lock.json'] })], roots, m)
    expect(g?.boundTo).toEqual([])
  })
})

describe('rpc-harden F1: PRECISION_MISMATCH only groups pins that agree', () => {
  it('keeps 24.x and 26.x apart (published 0.1.0 listed them as one agreeing set)', () => {
    const f = compareSources([
      src('.nvmrc', 1, '24', 'nvmrc'),
      src('Dockerfile', 1, '26', 'dockerfile'),
      src('.github/workflows/a.yml', 9, '24.22.2', 'setup-node'),
      src('.github/workflows/b.yml', 9, '26.13.0', 'setup-node'),
    ])
    const pm = f.find((x) => x.code === 'PRECISION_MISMATCH')
    expect(pm?.message).toBe(
      'node: pins that agree but are written at different precision: 24 (.nvmrc:1) includes 24.22.2 (.github/workflows/a.yml:9); 26 (Dockerfile:1) includes 26.13.0 (.github/workflows/b.yml:9).',
    )
    // The disagreement itself is the VERSION_CONFLICT, reported separately.
    expect(f.map((x) => x.code)).toEqual(['VERSION_CONFLICT', 'PRECISION_MISMATCH'])
  })

  it('never says two finer pins agree with each other when they do not', () => {
    const f = compareSources([src('.nvmrc', 1, '22', 'nvmrc'), src('.node-version', 1, '22.11.0', 'node-version'), src('Dockerfile', 1, '22.12.0', 'dockerfile')])
    expect(f.find((x) => x.code === 'PRECISION_MISMATCH')?.message).toBe(
      'node: pins that agree but are written at different precision: 22 (.nvmrc:1) includes 22.11.0 (.node-version:1), 22.12.0 (Dockerfile:1).',
    )
  })
})

