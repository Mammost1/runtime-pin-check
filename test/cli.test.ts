import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { checkDirectory, collectSources, parseCliArgs, run, type CliIo } from '../src/cli'
import { aliasNote, formatAnnotations, humanRange } from '../src/report'
import type { Finding } from '../src/types'

const REPOS = resolve(__dirname, 'fixtures/repos')

/** The alias-drift fixture plus a root package.json, so the root CI step binds to the root (A12). */
async function aliasDriftWithManifest(): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), 'rpc-alias-'))
  await cp(join(REPOS, 'alias-drift'), repo, { recursive: true })
  await writeFile(join(repo, 'package.json'), '{ "name": "alias-drift", "private": true }\n')
  return repo
}
const DATE = ['--date', '2026-11-25']

async function cli(args: string[], env: Record<string, string> = {}) {
  let stdout = ''
  let stderr = ''
  const io: CliIo = { stdout: (t) => (stdout += t), stderr: (t) => (stderr += t), env, cwd: REPOS }
  const code = await run(args, io)
  return { code, stdout, stderr }
}

describe('single-source section (rpc-night R2-3)', () => {
  it('prints an inherited root pin once, with the number of project roots, and keeps --json whole', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rpc-inherit-'))
    try {
      await writeFile(join(dir, '.nvmrc'), '24\n')
      for (const d of ['a', 'b', 'c']) {
        await mkdir(join(dir, d))
        await writeFile(join(dir, d, 'package.json'), `{"name":"${d}"}\n`)
      }
      const text = (await cli([dir, ...DATE])).stdout
      expect(text.match(/\.nvmrc:1/g)).toHaveLength(1)
      expect(text).toContain('node 24  .nvmrc:1  (the same pin in 4 project roots)')
      const json = JSON.parse((await cli([dir, ...DATE, '--json'])).stdout)
      expect(json.summary.singleSource).toHaveLength(4) // unchanged: JSON still lists every root
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('--fix summary (rpc-night R2-5)', () => {
  it('does not call a shorter pin "already at" the target: it says the precision is kept', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rpc-fixprec-'))
    try {
      await writeFile(join(dir, 'go.mod'), 'module x\n\ngo 1.27.4\n')
      await writeFile(join(dir, 'Dockerfile'), 'FROM golang:1.27-alpine3.24\nFROM golang:1.27.4\n')
      const r = await cli([dir, '--fix', '--to', '1.27.4', '--runtime', 'go', '--dry-run'])
      expect(r.code).toBe(0)
      expect(r.stderr).toContain('already at 1.27.4: 1 pin')
      expect(r.stderr).toContain('kept at their own precision (not rewritten): Dockerfile:1 "1.27-alpine3.24"')
      // A pin with as many parts as --to is simply at the target.
      await writeFile(join(dir, 'Dockerfile'), 'FROM golang:1.27-alpine3.24\n')
      const same = await cli([dir, '--fix', '--to', '1.27', '--runtime', 'go', '--dry-run'])
      expect(same.stderr).toContain('already at 1.27: 1 pin')
      expect(same.stderr).not.toContain('kept at their own precision')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('exit codes', () => {
  it('0 when nothing is at or above --fail-on, 1 when something is', async () => {
    expect((await cli(['clean', ...DATE])).code).toBe(0)
    expect((await cli(['mixed', ...DATE])).code).toBe(1)
    expect((await cli(['floating', ...DATE])).code).toBe(0)
    expect((await cli(['floating', ...DATE, '--fail-on', 'info'])).code).toBe(1)
    expect((await cli(['monorepo', ...DATE, '--runtime', 'python', '--fail-on', 'warning'])).code).toBe(0)
  })

  it.each([
    [['--nope']],
    [['--runtime', 'ruby']],
    [['--fail-on', 'fatal']],
    [['--to', '22']],
    [['--dry-run']],
    [['--fix']],
    [['--fix', '--to', '22', '--json']],
    [['a', 'b']],
    [['--date', '2026-02-30']],
    [['does-not-exist']],
    [['clean/.nvmrc']],
  ])('2 for a usage or I/O error: %j', async (args) => {
    const r = await cli(args)
    expect(r.code).toBe(2)
    expect(r.stderr).toMatch(/^runtime-pin-check: /)
    expect(r.stdout).toBe('')
  })

  it('--fix is wired to src/fix.ts: a dry run exits 0, writes nothing and explains what it left alone', async () => {
    const r = await cli(['clean', '--fix', '--to', '24', '--runtime', 'node', '--dry-run'])
    expect(r.code).toBe(0)
    expect(r.stdout).toBe('') // no diff: every pin here needs a fuller --to or --fix-ranges
    expect(r.stderr).toContain('dry run: nothing written')
    expect(r.stderr).toContain('(precision)')
    expect(r.stderr).not.toContain('not available')
  })

  it('--version and -v print the package version and exit 0 (rpc-harden F5)', async () => {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8')) as { version: string }
    for (const flag of ['--version', '-v']) {
      const r = await cli([flag])
      expect(r.code).toBe(0)
      expect(r.stdout).toBe(`${pkg.version}\n`)
    }
  })

  it('--help prints the usage and exits 0', async () => {
    const r = await cli(['--help'])
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('Usage: runtime-pin-check')
  })
})

describe('text report', () => {
  it('names every file and line, groups by project root and ends with counts', async () => {
    const { stdout } = await cli(['mixed', ...DATE])
    expect(stdout).toContain('.nvmrc:1 pins node 18, outside the range >=20.0.0 required by package.json:5.')
    expect(stdout).toContain('node: 2 different versions across 2 files: 18 (.nvmrc:1), 22 (Dockerfile:1); no version satisfies all of them.')
    expect(stdout).toContain('.python-version:1 pins python 3.9, outside the range >=3.11.0 required by pyproject.toml:3.')
    expect(stdout).toContain('.tool-versions:1 pins go 1.25.4, outside the range >=1.26.0 required by go.mod:3.')
    // The CI matrix value 18.x is checked against engines; 22.x is not reported.
    expect(stdout).toContain('.github/workflows/ci.yml:8 pins node 18, outside the range')
    expect(stdout).not.toContain('pins node 22.x')
    expect(stdout.trimEnd().split('\n').at(-1)).toBe('5 errors, 4 warnings, 0 info')
  })

  it('explains an lts/* conflict with what the alias meant on the check date', async () => {
    const repo = await aliasDriftWithManifest()
    try {
      await explainsAlias(repo)
    } finally {
      await rm(repo, { recursive: true, force: true })
    }
  })

  it('without a root manifest the root CI pin is not tied to a project (A12) and conflicts with nothing', async () => {
    const r = await cli(['alias-drift', ...DATE])
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('Not tied to a project')
    expect(r.stdout).toContain('node lts/*  .github/workflows/ci.yml:9')
  })

  async function explainsAlias(repo: string) {
    const now = await cli([repo, ...DATE])
    expect(now.code).toBe(1)
    expect(now.stdout).toContain('node: 2 different versions across 2 files: lts/* (.github/workflows/ci.yml:9), 24 (.nvmrc:1)')
    expect(now.stdout).toContain('(lts/* means node 26.x on 2026-11-25, per the bundled release data; it moves when a new line becomes LTS)')
    // Before Node 26 became LTS (2026-10-28) the same files agreed.
    const before = await cli([repo, '--date', '2026-10-01'])
    expect(before.code).toBe(0)
    expect(before.stdout).toContain('No problems found.')
  }

  it('reports per project root and never compares sibling packages', async () => {
    const { stdout } = await cli(['monorepo', ...DATE])
    expect(stdout).toMatch(/^packages\/a$/m)
    expect(stdout).toContain('.nvmrc:1 pins node 22, outside the range >=18.0.0 <21.0.0-0 required by packages/a/package.json:4.')
    expect(stdout).not.toMatch(/^packages\/b$/m)
  })

  it('lists pins that had nothing to compare with, without repeating findings', async () => {
    expect((await cli(['clean', ...DATE])).stdout).toContain('Pinned in one place only (nothing to compare):\n  . (repo root)  go 1.26.0  go.mod:3')
    expect((await cli(['floating', ...DATE])).stdout).not.toContain('Pinned in one place only')
  })

  it('filters by --runtime', async () => {
    const { stdout } = await cli(['mixed', ...DATE, '--runtime', 'python'])
    expect(stdout).toContain('python 3.9')
    expect(stdout).not.toMatch(/ node\b/)
    expect(stdout.trimEnd().split('\n').at(-1)).toBe('1 error, 1 warning, 0 info')
  })
})

describe('exclusions (A10)', () => {
  async function repoWithFixtures() {
    const dir = await mkdtemp(join(tmpdir(), 'rpc-cli-ex-'))
    await mkdir(join(dir, 'test', 'unit', 'fixtures'), { recursive: true })
    await mkdir(join(dir, 'testdata'), { recursive: true })
    await mkdir(join(dir, 'examples', 'old'), { recursive: true })
    await writeFile(join(dir, '.nvmrc'), '22\n')
    // A root manifest makes the root a node project, so examples/old/Dockerfile binds to it (A14).
    await writeFile(join(dir, 'package.json'), '{}\n')
    await writeFile(join(dir, 'test', 'unit', 'fixtures', 'Dockerfile'), 'FROM node:18\n')
    await writeFile(join(dir, 'testdata', '.nvmrc'), '16\n')
    await writeFile(join(dir, 'examples', 'old', 'Dockerfile'), 'FROM node:20\n')
    return dir
  }

  it('skips fixture folders by default and says how many files it skipped', async () => {
    const dir = await repoWithFixtures()
    try {
      const r = await cli([dir, ...DATE])
      expect(r.code).toBe(1)
      expect(r.stdout).toContain('node: 2 different versions across 2 files: 22 (.nvmrc:1), 20 (examples/old/Dockerfile:1)')
      expect(r.stdout).toContain('2 files skipped by exclusion')
      const all = await cli([dir, ...DATE, '--include-fixtures', '--json'])
      const doc = JSON.parse(all.stdout)
      expect(doc.summary.excludedFiles).toBe(0)
      expect(doc.findings.find((f: Finding) => f.code === 'VERSION_CONFLICT').sources).toHaveLength(4)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('--exclude takes repeatable globs', async () => {
    const dir = await repoWithFixtures()
    try {
      const r = await cli([dir, ...DATE, '--exclude', 'examples', '--json'])
      const doc = JSON.parse(r.stdout)
      expect(r.code).toBe(0)
      expect(doc.summary).toMatchObject({ excludedFiles: 3, sources: 1 })
      const two = JSON.parse((await cli([dir, ...DATE, '--include-fixtures', '--exclude', 'examples/**', '--exclude', '**/fixtures', '--json'])).stdout)
      expect(two.sources.map((s: { file: string }) => s.file)).toEqual(['.nvmrc', 'testdata/.nvmrc'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('this repo has no findings by default: its test fixtures are skipped', async () => {
    // examples/conflict-demo conflicts on purpose (docs/TASKS.md A18), so the self-scan leaves examples out.
    const report = await checkDirectory(resolve(__dirname, '..'), { date: '2026-11-25', exclude: ['examples/**'] })
    expect(report.findings).toEqual([])
    expect(report.excludedFiles).toBeGreaterThan(0)
  })

  it('the example projects behave as documented: clean-demo is clean, conflict-demo conflicts', async () => {
    const clean = await checkDirectory(resolve(__dirname, '..', 'examples', 'clean-demo'), { date: '2026-11-25' })
    expect(clean.findings).toEqual([])
    const conflict = await checkDirectory(resolve(__dirname, '..', 'examples', 'conflict-demo'), { date: '2026-11-25' })
    expect(conflict.findings.map((f) => f.code).sort()).toEqual(['EOL_RUNTIME', 'EOL_RUNTIME', 'OUTSIDE_RANGE', 'OUTSIDE_RANGE', 'OUTSIDE_RANGE', 'VERSION_CONFLICT'])
  })
})

describe('--json', () => {
  it('prints one parseable document with summary, findings and sources', async () => {
    const { stdout, code } = await cli(['mixed', ...DATE, '--json'])
    expect(code).toBe(1)
    const doc = JSON.parse(stdout)
    expect(doc).toMatchObject({ schema: 1, directory: 'mixed', date: '2026-11-25', roots: ['.'] })
    expect(doc.summary).toMatchObject({ error: 5, warning: 4, info: 0, sources: 9 })
    expect(doc.findings[0]).toMatchObject({ code: 'OUTSIDE_RANGE', severity: 'error', runtime: 'node', scopes: ['.'] })
    expect(doc.findings.every((f: Finding) => f.sources.every((s) => typeof s.file === 'string' && s.line > 0))).toBe(true)
    expect(doc.sources.find((s: { file: string }) => s.file === 'go.mod')).toMatchObject({ kind: 'go-mod', constraintText: '>=1.26.0' })
  })

  it('carries the alias note on the alias source', async () => {
    const repo = await aliasDriftWithManifest()
    try {
      const doc = JSON.parse((await cli([repo, ...DATE, '--json'])).stdout)
      const alias = doc.findings[0].sources.find((s: { raw: string }) => s.raw === 'lts/*')
      expect(alias.note).toContain('lts/* means node 26.x on 2026-11-25')
    } finally {
      await rm(repo, { recursive: true, force: true })
    }
  })
})

describe('GitHub Actions annotations', () => {
  it('adds ::error / ::warning / ::notice lines under GITHUB_ACTIONS=true only', async () => {
    const plain = await cli(['mixed', ...DATE])
    expect(plain.stdout).not.toContain('::error')
    const gha = await cli(['mixed', ...DATE], { GITHUB_ACTIONS: 'true' })
    expect(gha.stdout).toContain('::error file=mixed/.github/workflows/ci.yml,line=8,title=OUTSIDE_RANGE::')
    expect(gha.stdout).toContain('::warning file=mixed/.nvmrc,line=1,title=EOL_RUNTIME::')
    const info = await cli(['floating', ...DATE], { GITHUB_ACTIONS: 'true' })
    expect(info.stdout).toContain('::notice file=floating/Dockerfile,line=1,title=FLOATING_ALIAS::')
  })

  it('keeps stdout valid JSON with --json and sends annotations to stderr', async () => {
    const r = await cli(['mixed', ...DATE, '--json'], { GITHUB_ACTIONS: 'true' })
    expect(() => JSON.parse(r.stdout)).not.toThrow()
    expect(r.stderr).toContain('::error file=mixed/')
  })

  it('escapes workflow command characters', () => {
    const f: Finding = {
      code: 'UNPARSEABLE',
      severity: 'info',
      runtime: 'node',
      sources: [{ file: 'a,b:c.yml', line: 3, raw: 'x', constraint: { kind: 'unknown', reason: 'r' } }],
      scopes: ['.'],
      message: '50% sure\nsecond line',
    }
    expect(formatAnnotations([f])).toBe('::notice file=a%2Cb%3Ac.yml,line=3,title=UNPARSEABLE::50%25 sure%0Asecond line\n')
    expect(formatAnnotations([])).toBe('')
  })
})

describe('library helpers', () => {
  it('parseCliArgs fills defaults', () => {
    expect(parseCliArgs([])).toMatchObject({ dir: '.', json: false, runtimes: ['node', 'python', 'go'], failOn: 'error', fix: false })
    expect(parseCliArgs(['x', '--runtime', 'Go, node,go']).runtimes).toEqual(['go', 'node'])
  })

  it('humanRange and aliasNote', () => {
    expect(humanRange('>=26.0.0 <27.0.0-0')).toBe('26.x')
    expect(humanRange('>=3.12.0 <3.13.0-0')).toBe('3.12.x')
    expect(humanRange('>=20.0.0')).toBe('>=20.0.0')
    expect(aliasNote('node', 'latest', '2026-11-25', () => '>=1.0.0')).toBeUndefined()
    expect(aliasNote('node', 'lts/bogus', '2026-11-25', () => undefined)).toBeUndefined()
  })

  it('skips files over 1 MB and files that cannot hold a pin', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rpc-cli-'))
    try {
      await writeFile(join(dir, '.nvmrc'), '22\n')
      await writeFile(join(dir, 'notes.txt'), '18\n')
      await writeFile(join(dir, 'package.json'), `{"engines":{"node":">=24"},"pad":"${'x'.repeat(1024 * 1024)}"}`)
      const report = await checkDirectory(dir, { date: '2026-11-25' })
      expect(report.sources.map((s) => s.file)).toEqual(['.nvmrc'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('files that start with a UTF-8 byte-order mark', () => {
  const BOM_REPO = resolve(REPOS, 'bom')
  const FILES = ['package.json', '.nvmrc', 'pyproject.toml']

  it('the fixture files really start with the 3 BOM bytes (an editor must not strip them)', () => {
    for (const f of FILES) expect([...readFileSync(resolve(BOM_REPO, f)).subarray(0, 3)], f).toEqual([0xef, 0xbb, 0xbf])
  })

  it('a BOM package.json yields its pins, like every other file (it used to yield none)', async () => {
    const sources = await collectSources(BOM_REPO, FILES)
    expect(sources.map((s) => `${s.file}:${s.kind}:${s.raw}`).sort()).toEqual([
      '.nvmrc:nvmrc:v20.18.0',
      'package.json:engines:>=22',
      'package.json:volta:22.22.2',
      'pyproject.toml:requires-python:>=3.10',
    ])
  })

  it('line and column are what an editor shows: the BOM is not counted', async () => {
    const sources = await collectSources(BOM_REPO, FILES)
    for (const s of sources) {
      const text = readFileSync(resolve(BOM_REPO, s.file), 'utf8').replace(/^\uFEFF/, '')
      const line = text.split('\n')[s.line - 1] ?? ''
      expect(line.slice((s.column as number) - 1, (s.column as number) - 1 + s.raw.length), `${s.file}:${s.line}`).toBe(s.raw)
    }
    const nvmrc = sources.find((s) => s.file === '.nvmrc')
    expect([nvmrc?.line, nvmrc?.column]).toEqual([1, 1]) // line 1, column 1, not column 2
  })

  it('the check finds the conflict across the BOM files and reports file:line', async () => {
    const report = await checkDirectory(BOM_REPO)
    const f = report.findings.find((x) => x.code === 'OUTSIDE_RANGE')
    expect(f?.severity).toBe('error')
    expect(f?.sources.map((s) => `${s.file}:${s.line}`).sort()).toEqual(['.nvmrc:1', 'package.json:3'])
    const r = await cli(['bom'])
    expect(r.code).toBe(1)
    expect(r.stdout).toContain('package.json:3')
    expect(r.stdout).toContain('.nvmrc:1')
  })

  it('only ONE BOM is stripped: a second one stays in the text, so the column accounts for it', async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const dir = mkdtempSync(resolve(tmpdir(), 'rpc-bom2-'))
    try {
      writeFileSync(resolve(dir, '.nvmrc'), '\uFEFF\uFEFFv22.22.3\n')
      const [s] = await collectSources(dir, ['.nvmrc'])
      expect([s?.raw, s?.line, s?.column]).toEqual(['v22.22.3', 1, 2]) // the second BOM is still a character before the value
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('rpc-read-diag: files that cannot be fully read are reported, never silent', () => {
  async function brokenRepo(): Promise<string> {
    const repo = await mkdtemp(join(tmpdir(), 'rpc-diag-'))
    await mkdir(join(repo, '.github', 'workflows'), { recursive: true })
    await writeFile(join(repo, '.nvmrc'), '22\n')
    await writeFile(join(repo, 'package.json'), '{ "name": "x", "engines": { "node": ">=22" } }\n')
    await writeFile(join(repo, '.github', 'workflows', 'ci.yml'), 'jobs:\n  a:\n    steps:\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 22\n  bad: [unclosed\n')
    await mkdir(join(repo, 'svc'), { recursive: true })
    await writeFile(join(repo, 'svc', 'pyproject.toml'), '[project\nrequires-python = ">=3.9"\n')
    return repo
  }
  const run2 = async (repo: string, args: string[], env: Record<string, string> = {}) => {
    let stdout = ''
    let stderr = ''
    const io: CliIo = { stdout: (t) => (stdout += t), stderr: (t) => (stderr += t), env, cwd: repo }
    const code = await run(['.', ...args, ...DATE], io)
    return { code, stdout, stderr }
  }

  it('--json: a diagnostics array with file, line, column and message; summary.unreadable; exit code unchanged (0)', async () => {
    const repo = await brokenRepo()
    try {
      const r = await run2(repo, ['--json'])
      expect(r.code).toBe(0)
      const doc = JSON.parse(r.stdout)
      expect(doc.summary.unreadable).toBe(2)
      expect(doc.diagnostics.map((d: { file: string }) => d.file).sort()).toEqual(['.github/workflows/ci.yml', 'svc/pyproject.toml'])
      const yaml = doc.diagnostics.find((d: { file: string }) => d.file.endsWith('ci.yml'))
      expect(yaml).toMatchObject({ file: '.github/workflows/ci.yml', line: 8 })
      expect(yaml.message).toContain('YAML syntax error')
      // The yaml parser reports an unclosed flow sequence at the end of the file; the pin before the error was still read.
      expect(doc.sources.some((s: { file: string; raw: string }) => s.file.endsWith('ci.yml') && s.raw === '22')).toBe(true)
    } finally {
      await rm(repo, { recursive: true, force: true })
    }
  })

  it('a broken pyproject.toml is reported once: a diagnostic, and no UNPARSEABLE finding or junk source from it (review R1)', async () => {
    const repo = await brokenRepo()
    try {
      const doc = JSON.parse((await run2(repo, ['--json'])).stdout)
      expect(doc.diagnostics.filter((d: { file: string }) => d.file === 'svc/pyproject.toml')).toHaveLength(1)
      expect(doc.findings.filter((f: { sources: { file: string }[] }) => f.sources.some((s) => s.file === 'svc/pyproject.toml'))).toEqual([])
      expect(doc.sources.filter((s: { file: string }) => s.file === 'svc/pyproject.toml')).toEqual([])
    } finally {
      await rm(repo, { recursive: true, force: true })
    }
  })

  it('text report: a "Could not fully read" block with file:line:column and the message', async () => {
    const repo = await brokenRepo()
    try {
      const r = await run2(repo, [])
      expect(r.code).toBe(0)
      expect(r.stdout).toContain('Could not fully read (syntax errors; they do not change the exit code):')
      expect(r.stdout).toMatch(/\.github\/workflows\/ci\.yml:8:\d+ +YAML syntax error/)
      expect(r.stdout).toMatch(/svc\/pyproject\.toml:1:\d+ +TOML syntax error/)
    } finally {
      await rm(repo, { recursive: true, force: true })
    }
  })

  it('GITHUB_ACTIONS: a ::warning per file on the error line, on stdout for text and on stderr for --json (stdout stays JSON)', async () => {
    const repo = await brokenRepo()
    try {
      const text = await run2(repo, [], { GITHUB_ACTIONS: 'true' })
      expect(text.stdout).toMatch(/::warning file=\.github\/workflows\/ci\.yml,line=8,col=\d+,title=UNREADABLE_FILE::YAML syntax error/)
      expect(text.stdout).toMatch(/::warning file=svc\/pyproject\.toml,line=1,col=\d+,title=UNREADABLE_FILE::TOML syntax error/)
      const json = await run2(repo, ['--json'], { GITHUB_ACTIONS: 'true' })
      expect(() => JSON.parse(json.stdout)).not.toThrow()
      expect(json.stderr).toContain('title=UNREADABLE_FILE')
      const plain = await run2(repo, [], {})
      expect(plain.stdout).not.toContain('::warning')
    } finally {
      await rm(repo, { recursive: true, force: true })
    }
  })

  it('a clean repo has no block, an empty diagnostics array and unreadable 0; a real finding still exits 1', async () => {
    const clean = await cli(['clean', ...DATE, '--json'])
    const doc = JSON.parse(clean.stdout)
    expect(doc.diagnostics).toEqual([])
    expect(doc.summary.unreadable).toBe(0)
    expect((await cli(['clean', ...DATE])).stdout).not.toContain('Could not fully read')
    const repo = await brokenRepo()
    try {
      await writeFile(join(repo, '.node-version'), '20\n')
      expect((await run2(repo, [])).code).toBe(1)
    } finally {
      await rm(repo, { recursive: true, force: true })
    }
  })
})

describe('rpc-diag-scope: valid YAML under .github/workflows/ subfolders is not reported (A15)', () => {
  it('a repo with the chronograf shape has no diagnostics and exit code 0', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'rpc-diag-scope-'))
    try {
      await mkdir(join(repo, '.github', 'workflows', 'resources'), { recursive: true })
      await writeFile(join(repo, '.nvmrc'), '22\n')
      const fx = (f: string) => readFileSync(resolve(__dirname, 'extract/shared/fixtures', f), 'utf8')
      await writeFile(join(repo, '.github', 'workflows', 'resources', 'test-resources.yaml'), fx('influxdata-chronograf.resources.test-resources.yaml'))
      await writeFile(join(repo, '.github', 'workflows', 'resources', 'kind-config.yaml'), fx('influxdata-chronograf.resources.kind-config.yaml'))
      let stdout = ''
      const io: CliIo = { stdout: (t) => (stdout += t), stderr: () => undefined, env: {}, cwd: repo }
      expect(await run(['.', '--json', ...DATE], io)).toBe(0)
      const doc = JSON.parse(stdout)
      expect(doc.diagnostics).toEqual([])
      expect(doc.summary.unreadable).toBe(0)
    } finally {
      await rm(repo, { recursive: true, force: true })
    }
  })
})
