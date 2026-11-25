import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { findProjectRoots, globMatcher, isFixtureDir, manifestRuntimesOf, projectRootsOf, scanFiles, walkFiles } from '../src/scan'

let dir: string

async function put(path: string, content = ''): Promise<void> {
  await mkdir(join(dir, path, '..'), { recursive: true })
  await writeFile(join(dir, path), content)
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'rpc-scan-'))
  await put('package.json', '{}')
  await put('.nvmrc', '22')
  await put('packages/web/package.json', '{}')
  await put('services/api/pyproject.toml', '')
  await put('services/worker/go.mod', 'module x\n\ngo 1.24.0\n')
  await put('services/worker/cmd/main.go', '')
  await put('docs/readme.md', '')
  for (const ignored of ['node_modules/left-pad', '.git/x', 'dist/pkg', 'build/out', 'vendor/lib', '.venv/lib', 'packages/web/node_modules/dep']) {
    await put(`${ignored}/package.json`, '{}')
  }
  await symlink(join(dir, 'packages'), join(dir, 'packages', 'web', 'loop'))
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('findProjectRoots', () => {
  it('returns the repo root plus every manifest directory outside ignored folders', async () => {
    expect(await findProjectRoots(dir)).toEqual(['.', 'packages/web', 'services/api', 'services/worker'])
  })

  it('always includes the repo root, even without a manifest', () => {
    expect(projectRootsOf(['README.md', 'app/go.mod'])).toEqual(['.', 'app'])
  })

  it('ignores manifests under ignored directories at any depth', () => {
    expect(projectRootsOf(['a/node_modules/b/package.json', 'a/package.json', 'x/.venv/pyproject.toml'])).toEqual(['.', 'a'])
  })
})

describe('walkFiles', () => {
  it('lists files with / separators, sorted, skipping ignored dirs and symlinks', async () => {
    const files = await walkFiles(dir)
    expect(files).toContain('.nvmrc')
    expect(files).toContain('services/worker/cmd/main.go')
    expect(files.some((f) => /(^|\/)(node_modules|\.git|dist|build|vendor|\.venv)\//.test(f))).toBe(false)
    expect(files.some((f) => f.includes('/loop/'))).toBe(false)
    expect([...files].sort()).toEqual(files)
  })

  it('reuses a file list instead of walking again', async () => {
    expect(await findProjectRoots('/does/not/exist', ['package.json', 'x/go.mod'])).toEqual(['.', 'x'])
  })
})

describe('fixture exclusion and --exclude (A10)', () => {
  let repo: string

  beforeAll(async () => {
    repo = await mkdtemp(join(tmpdir(), 'rpc-scan-ex-'))
    const files = [
      '.nvmrc',
      'test/fixtures/a/package.json',
      'tests/unit/fixtures/b/.nvmrc',
      'src/__fixtures__/c/Dockerfile',
      'pkg/testdata/go.mod',
      'e2e/test-fixtures/d/.nvmrc',
      'examples/demo/package.json',
      'docs/guide/Dockerfile',
      'api.Dockerfile',
    ]
    for (const f of files) {
      await mkdir(join(repo, f, '..'), { recursive: true })
      await writeFile(join(repo, f), '')
    }
  })

  afterAll(async () => {
    await rm(repo, { recursive: true, force: true })
  })

  it('skips fixture folders by default and counts their files', async () => {
    expect(await scanFiles(repo)).toEqual({ files: ['.nvmrc', 'api.Dockerfile', 'docs/guide/Dockerfile', 'examples/demo/package.json'], excluded: 5 })
    expect(await findProjectRoots(repo)).toEqual(['.', 'examples/demo'])
  })

  it('scans fixtures with includeFixtures', async () => {
    const r = await scanFiles(repo, { includeFixtures: true })
    expect(r.excluded).toBe(0)
    expect(r.files).toHaveLength(9)
  })

  it('applies exclude globs to directories and files', async () => {
    const r = await scanFiles(repo, { exclude: ['examples', 'docs/**', '*.Dockerfile'] })
    expect(r).toEqual({ files: ['.nvmrc'], excluded: 8 })
    expect(await walkFiles(repo, { exclude: ['docs/guide'] })).not.toContain('docs/guide/Dockerfile')
  })

  it('globMatcher: name patterns match at any depth, path patterns are anchored', () => {
    expect(globMatcher('examples')('a/b/examples')).toBe(true)
    expect(globMatcher('*.Dockerfile')('svc/api.Dockerfile')).toBe(true)
    expect(globMatcher('docs/**')('docs/a/b.md')).toBe(true)
    expect(globMatcher('docs/**')('src/docs/a.md')).toBe(false)
    expect(globMatcher('**/legacy')('services/legacy')).toBe(true)
    expect(globMatcher('**/legacy')('legacy')).toBe(true)
    expect(globMatcher('./services/?pi/')('services/api')).toBe(true)
    expect(globMatcher('a.b')('axb')).toBe(false)
  })
})

describe('A12 fixture regex and manifests', () => {
  it.each(['fixtures', 'fixture', '__fixtures__', 'testdata', 'test_data', 'test-data', '_testdata', 'test-fixtures', 'test_fixtures', 'testfixtures', 'TestData', 'Fixtures'])(
    'skips %s',
    (name) => expect(isFixtureDir(name)).toBe(true),
  )

  it.each(['test', 'tests', 'src', 'fixtures-docs', 'my_fixtures', 'data', 'e2e'])('keeps %s', (name) => expect(isFixtureDir(name)).toBe(false))

  it('updatecli shape: pkg/x/test_fixtures/*.Dockerfile is skipped', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'rpc-scan-uc-'))
    try {
      for (const f of ['go.mod', 'pkg/plugins/dockerfile/test_fixtures/node.Dockerfile', 'pkg/plugins/dockerfile/test_fixtures/sub/Dockerfile', 'pkg/core/Dockerfile']) {
        await mkdir(join(repo, f, '..'), { recursive: true })
        await writeFile(join(repo, f), '')
      }
      expect(await scanFiles(repo)).toEqual({ files: ['go.mod', 'pkg/core/Dockerfile'], excluded: 2 })
    } finally {
      await rm(repo, { recursive: true, force: true })
    }
  })

  it('maps manifests to runtimes per directory (setup.py and setup.cfg count for python)', () => {
    const m = manifestRuntimesOf(['package.json', 'setup.py', 'api/setup.cfg', 'svc/go.mod', 'web/package.json', 'README.md'])
    expect([...m].map(([d, rs]) => [d, [...rs].sort()])).toEqual([
      ['.', ['node', 'python']],
      ['api', ['python']],
      ['svc', ['go']],
      ['web', ['node']],
    ])
  })
})

describe('plain test folders are not fixtures (A14 note)', () => {
  it('keeps tests/foo_runtime/ and makes it a project root', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'rpc-scan-tests-'))
    try {
      for (const f of ['pyproject.toml', 'tests/foo_runtime/pyproject.toml', 'tests/foo_runtime/.python-version', 'test/bar_runtime/package.json', 'tests/fixtures/x/.python-version']) {
        await mkdir(join(repo, f, '..'), { recursive: true })
        await writeFile(join(repo, f), '')
      }
      const r = await scanFiles(repo)
      expect(r.files).toEqual(['pyproject.toml', 'test/bar_runtime/package.json', 'tests/foo_runtime/.python-version', 'tests/foo_runtime/pyproject.toml'])
      expect(r.excluded).toBe(1)
      expect(projectRootsOf(r.files)).toEqual(['.', 'test/bar_runtime', 'tests/foo_runtime'])
    } finally {
      await rm(repo, { recursive: true, force: true })
    }
  })
})

