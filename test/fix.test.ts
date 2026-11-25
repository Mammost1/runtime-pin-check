import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { run } from '../src/cli'
import { extractGo } from '../src/extract/go/index'
import { extractNode } from '../src/extract/node/index'
import { extractPython } from '../src/extract/python/index'
import { applyEdits, BOM, exactUtf8, FixError, isLockfile, planFix, rereadProblem, splitBom, unifiedDiff, type FixOptions, type FixPlan } from '../src/fix'
import type { Runtime, Source } from '../src/types'

const extractAll = (file: string, text: string): Source[] => [...extractNode(file, text), ...extractPython(file, text), ...extractGo(file, text)]

/** Plans a fix for one file read with the real extractors; `after` is its text after the fix. */
function fixOne(file: string, text: string, to: string, options: Partial<FixOptions> = {}): { plan: FixPlan; after: string } {
  const plan = planFix({ sources: extractAll(file, text), files: new Map([[file, text]]), to, ...options })
  return { plan, after: plan.files.get(file) ?? text }
}

describe('what is rewritten, and how the style is kept', () => {
  const cases: [string, string, string, string, Partial<FixOptions>][] = [
    // [file, before, to, after, options]
    ['.nvmrc', 'v22.22.3\n', '24.3.0', 'v24.3.0\n', {}],
    ['.nvmrc', '22\n', '24.3.0', '24\n', {}],
    ['.node-version', '22.22.1', '24.3.0', '24.3.0', {}], // no final newline stays absent
    ['.tool-versions', 'nodejs 22.23.1\npython 3.10.5\n', '24.3.0', 'nodejs 24.3.0\npython 3.10.5\n', { runtime: 'node' }],
    ['.tool-versions', 'golang 1.27.3 # ไทย 1.27.3\n', '1.28.0', 'golang 1.28.0 # ไทย 1.27.3\n', { runtime: 'go' }], // only the pin, not the comment
    ['mise.toml', '[tools]\nnode = "22"\npython = "3.12"\n', '24.3.0', '[tools]\nnode = "24"\npython = "3.12"\n', { runtime: 'node' }],
    ['package.json', '{\n  "volta": { "node": "22.22.2" }\n}\n', '24.3.0', '{\n  "volta": { "node": "24.3.0" }\n}\n', {}],
    ['Dockerfile', 'FROM node:22.23.1-bookworm-slim AS build\n', '24.3.0', 'FROM node:24.3.0-bookworm-slim AS build\n', {}],
    ['Dockerfile', 'FROM node:26-alpine AS web\n', '24.3.0', 'FROM node:24-alpine AS web\n', {}],
    ['Dockerfile', 'ARG NODE_VERSION=18.18.2-slim\nFROM node:${NODE_VERSION} AS a\n', '24.3.0', 'ARG NODE_VERSION=24.3.0-slim\nFROM node:${NODE_VERSION} AS a\n', {}],
    ['Dockerfile', 'FROM node:22\nFROM node:22 AS two\n', '24.3.0', 'FROM node:24\nFROM node:24 AS two\n', {}], // every stage moves
    ['.github/workflows/ci.yml', 'jobs:\n  t:\n    steps:\n      - uses: actions/setup-node@v4\n        with:\n          node-version: "22.x"\n', '24.3.0', 'jobs:\n  t:\n    steps:\n      - uses: actions/setup-node@v4\n        with:\n          node-version: "24.x"\n', {}],
    ['.github/workflows/ci.yml', 'jobs:\n  t:\n    steps:\n      - uses: actions/setup-node@v4\n        with: { node-version: 20 }\n', '24.3.0', 'jobs:\n  t:\n    steps:\n      - uses: actions/setup-node@v4\n        with: { node-version: 24 }\n', {}],
    ['.gitlab-ci.yml', 'build:\n  image: node:22-alpine\n', '24.3.0', 'build:\n  image: node:24-alpine\n', {}],
    ['.python-version', '3.12.11\n', '3.13.2', '3.13.2\n', { runtime: 'python' }],
    ['.python-version', '3.12\n', '3.13.2', '3.13\n', { runtime: 'python' }],
    ['runtime.txt', 'python-3.7.6\n', '3.13.2', 'python-3.13.2\n', { runtime: 'python' }],
    ['Dockerfile', 'FROM python:3.12-slim\n', '3.13.2', 'FROM python:3.13-slim\n', { runtime: 'python' }],
    ['go.mod', 'module x\n\ngo 1.24.0\n\ntoolchain go1.24.4\n', '1.27.3', 'module x\n\ngo 1.24.0\n\ntoolchain go1.27.3\n', { runtime: 'go' }], // go 1.24.0 already allows 1.27.3
    ['Dockerfile', 'FROM golang:1.24\n', '1.27.3', 'FROM golang:1.27\n', { runtime: 'go' }],
  ]
  it.each(cases)('%s: %j -> %j', (file, before, to, after, options) => {
    const r = fixOne(file, before, to, options)
    expect(r.after).toBe(after)
    expect(r.plan.edits.length).toBeGreaterThan(0)
  })

  it('moves a pin that is already at the target nowhere, and reports it as unchanged', () => {
    const r = fixOne('.nvmrc', 'v24.3.0\n', '24.3.0')
    expect(r.plan.edits).toEqual([])
    expect(r.plan.unchanged).toHaveLength(1)
    expect(r.plan.files.size).toBe(0)
    expect(fixOne('mise.toml', '[tools]\nnode = "24"\n', '24.3.0').plan.unchanged).toHaveLength(1)
  })

  it('is idempotent: fixing the fixed text changes nothing', () => {
    const text = 'FROM node:22.23.1-bookworm-slim AS a\nFROM node:26-alpine AS b\n'
    const once = fixOne('Dockerfile', text, '24.3.0')
    const twice = fixOne('Dockerfile', once.after, '24.3.0')
    expect(twice.plan.edits).toEqual([])
    expect(twice.after).toBe(once.after)
  })

  it('records where each edit is and which sources it moves', () => {
    const r = fixOne('Dockerfile', 'FROM node:22-alpine\n', '24.3.0')
    expect(r.plan.edits).toHaveLength(1)
    expect(r.plan.edits[0]).toMatchObject({ file: 'Dockerfile', line: 1, column: 11, from: '22-alpine', to: '24-alpine' })
    expect(r.plan.edits[0]?.sources[0]?.kind).toBe('dockerfile')
  })

  it('accepts a v-prefixed target and a partial one', () => {
    expect(fixOne('.nvmrc', 'v22.22.3\n', 'v24.3.0').after).toBe('v24.3.0\n')
    expect(fixOne('.nvmrc', '22\n', '24').after).toBe('24\n')
  })
})

describe('ranges (--fix-ranges)', () => {
  it('leaves a range alone without the switch, and says so', () => {
    const r = fixOne('package.json', '{\n  "engines": { "node": ">=20 <23" }\n}\n', '24.3.0')
    expect(r.after).toContain('>=20 <23')
    expect(r.plan.skipped.map((s) => s.reason)).toEqual(['range'])
    expect(r.plan.skipped[0]?.detail).toContain('--fix-ranges')
  })

  it('rewrites a range to >=<major> with the switch (Node)', () => {
    const r = fixOne('package.json', '{\n  "engines": { "node": ">=20 <23 || >=24 <25" }\n}\n', '26.1.0', { fixRanges: true })
    expect(r.after).toBe('{\n  "engines": { "node": ">=26" }\n}\n')
  })

  it('rewrites Python and Go ranges to >=<major.minor>', () => {
    expect(fixOne('pyproject.toml', '[project]\nrequires-python = ">=3.10,<3.12"\n', '3.13.2', { fixRanges: true }).after).toBe('[project]\nrequires-python = ">=3.13"\n')
    expect(fixOne('.github/workflows/ci.yml', 'jobs:\n  t:\n    steps:\n      - uses: actions/setup-go@v5\n        with:\n          go-version: "~1.24"\n', '1.27.3', { fixRanges: true }).after).toContain('go-version: ">=1.27"')
  })

  it('an unquoted YAML value cannot start with ">": it is skipped with a clear reason, never broken', () => {
    const text = 'jobs:\n  t:\n    steps:\n      - uses: actions/setup-go@v5\n        with:\n          go-version: ~1.24\n'
    const r = fixOne('.github/workflows/ci.yml', text, '1.27.3', { fixRanges: true })
    expect(r.after).toBe(text)
    expect(r.plan.skipped.map((s) => s.reason)).toEqual(['syntax'])
    expect(r.plan.skipped[0]?.detail).toContain('quoted')
    // The same range in a file where it needs no quotes is fine.
    expect(fixOne('pyproject.toml', '[project]\nrequires-python = ">=3.10,<3.12"\n', '3.13.2', { fixRanges: true }).plan.edits).toHaveLength(1)
  })

  it('an unquoted YAML number that would lose its zero (3.9 -> 3.10) is skipped before the edit, with a clear reason', () => {
    const wf = (v: string) => `jobs:\n  t:\n    steps:\n      - uses: actions/setup-python@v5\n        with:\n          python-version: ${v}\n`
    const bare = fixOne('.github/workflows/ci.yml', wf('3.9'), '3.10.2', { runtime: 'python' })
    expect(bare.after).toBe(wf('3.9'))
    expect(bare.plan.skipped.map((s) => s.reason)).toEqual(['syntax'])
    expect(bare.plan.skipped[0]?.detail).toContain('"3.10"')
    expect(bare.plan.skipped[0]?.detail).toContain('number 3.1')
    expect(bare.plan.skipped[0]?.detail).toContain('quote')
    // Quoted, the same edit is fine; and 3.9 -> 3.13 needs no quotes because 3.13 reads as written.
    expect(fixOne('.github/workflows/ci.yml', wf('"3.9"'), '3.10.2', { runtime: 'python' }).after).toBe(wf('"3.10"'))
    expect(fixOne('.github/workflows/ci.yml', wf("'3.9'"), '3.10.2', { runtime: 'python' }).after).toBe(wf("'3.10'"))
    expect(fixOne('.github/workflows/ci.yml', wf('3.9'), '3.13.2', { runtime: 'python' }).after).toBe(wf('3.13'))
    expect(fixOne('.github/workflows/ci.yml', wf('3.8.1'), '3.10.2', { runtime: 'python' }).after).toBe(wf('3.10.2')) // three parts: a string, safe
    // Outside YAML (a .python-version file) there is no such hazard.
    expect(fixOne('.python-version', '3.9\n', '3.10.2', { runtime: 'python' }).after).toBe('3.10\n')
  })

  it('the re-read message names what really differs (same text, but no longer a version)', () => {
    // 3.9 -> 3.10 written bare in YAML: the extractor still sees the text "3.10", but YAML reads it
    // as the number 3.1, so it is no longer a version. The message must not say "3.10, not 3.10".
    const wf = (v: string) => `jobs:\n  t:\n    steps:\n      - uses: actions/setup-python@v5\n        with:\n          python-version: ${v}\n`
    const file = '.github/workflows/ci.yml'
    const before = wf('3.9')
    const [pin] = extractAll(file, before)
    const edit = { file, line: 6, column: 27, from: '3.9', to: '3.10', sources: [pin as Source] }
    const detail = rereadProblem(file, before, applyEdits(before, [edit]), [edit]) ?? ''
    expect(detail).toContain('still reads "3.10"')
    expect(detail).toContain('no longer as a partial version')
    expect(detail).toContain('now unknown')
    expect(detail).toContain('number 3.1') // the extractor's own reason is passed on
    expect(detail).not.toMatch(/reads as "(\S+)" after the edit, not "\1"/)
    // A value that really changed is still reported as before.
    const wrong = rereadProblem('.nvmrc', 'v22\n', 'v23\n', [{ file: '.nvmrc', line: 1, column: 2, from: '22', to: '24', sources: extractAll('.nvmrc', 'v22\n') }]) ?? ''
    expect(wrong).toContain('reads as "v23" after the edit, not "24"')
  })

  it('never narrows a range that already allows the whole target', () => {
    for (const to of ['24.3.0', '24']) {
      const r = fixOne('package.json', '{\n  "engines": { "node": ">=22" }\n}\n', to, { fixRanges: true })
      expect(r.after).toContain('">=22"')
      expect(r.plan.skipped.map((s) => s.reason)).toEqual(['range-allows-target'])
    }
  })

  it('go.mod: the go directive is a bare minimum, written as a version, not as >=', () => {
    const lowered = fixOne('go.mod', 'module x\n\ngo 1.24.0\n', '1.22.5', { runtime: 'go', fixRanges: true })
    expect(lowered.after).toBe('module x\n\ngo 1.22.5\n')
    const kept = fixOne('go.mod', 'module x\n\ngo 1.24.0\n', '1.27.3', { runtime: 'go', fixRanges: true })
    expect(kept.after).toBe('module x\n\ngo 1.24.0\n') // 1.24.0 already allows 1.27.3
  })
})

describe('what is never rewritten', () => {
  const skips = (r: { plan: FixPlan }): string[] => r.plan.skipped.map((s) => s.reason)

  it('matrix entries', () => {
    const text = 'jobs:\n  t:\n    strategy:\n      matrix:\n        node-version: [18, 20]\n    steps:\n      - uses: actions/setup-node@v4\n        with:\n          node-version: ${{ matrix.node-version }}\n'
    const r = fixOne('.github/workflows/ci.yml', text, '24.3.0')
    expect(r.after).toBe(text)
    expect(skips(r).length).toBeGreaterThan(0)
    expect(new Set(skips(r))).toEqual(new Set(['matrix']))
  })

  it('aliases and unreadable values', () => {
    expect(skips(fixOne('.nvmrc', 'lts/*\n', '24.3.0'))).toEqual(['alias'])
    expect(skips(fixOne('.gitlab-ci.yml', 'test:\n  image: node:${NODE_VERSION}\n', '24.3.0'))).toEqual(['unparseable'])
    expect(skips(fixOne('mise.toml', '[tools]\nnode = "lts"\n', '24.3.0'))).toEqual(['alias'])
  })

  it('a Docker reference pinned by digest (a new tag would no longer match the digest)', () => {
    const text = 'FROM node:22.23.1-bookworm-slim@sha256:813a AS d\n'
    const r = fixOne('Dockerfile', text, '24.3.0')
    expect(r.after).toBe(text)
    expect(skips(r)).toEqual(['digest'])
  })

  it('a version file that lists several versions on purpose', () => {
    const text = '3.12.11\n3.11.13\n'
    const r = fixOne('.python-version', text, '3.13.2', { runtime: 'python' })
    expect(r.after).toBe(text)
    expect(skips(r)).toEqual(['multi-version-file', 'multi-version-file'])
  })

  it('a pin that needs more parts than --to has', () => {
    expect(skips(fixOne('.nvmrc', 'v22.22.3\n', '24'))).toEqual(['precision']) // exact needs a full version
    expect(skips(fixOne('mise.toml', '[tools]\npython = "3.12"\n', '3', { runtime: 'python' }))).toEqual(['precision']) // 3.12 needs major.minor
    expect(fixOne('.nvmrc', 'v22.22.3\n', '24').plan.skipped[0]?.detail).toContain('24.1.0')
  })

  it('lockfiles, by name, even if a source claims to be in one', () => {
    expect(isLockfile('package-lock.json')).toBe(true)
    expect(isLockfile('apps/web/pnpm-lock.yaml')).toBe(true)
    expect(isLockfile('yarn.lock')).toBe(true)
    expect(isLockfile('poetry.lock')).toBe(true)
    expect(isLockfile('go.sum')).toBe(true)
    expect(isLockfile('package.json')).toBe(false)
    expect(isLockfile('.nvmrc')).toBe(false)
    const fake: Source = { runtime: 'node', file: 'package-lock.json', line: 1, column: 1, raw: '22', kind: 'engines', constraint: { kind: 'partial', version: '22' } }
    const plan = planFix({ sources: [fake], files: new Map([['package-lock.json', '22']]), to: '24.3.0' })
    expect(plan.edits).toEqual([])
    expect(plan.skipped.map((s) => s.reason)).toEqual(['lockfile'])
  })

  it('a source with no column is never guessed', () => {
    const [real] = extractAll('.tool-versions', 'nodejs 22.23.1\n')
    const { column: _column, ...noColumn } = real as Source
    const plan = planFix({ sources: [noColumn], files: new Map([['.tool-versions', 'nodejs 22.23.1\n']]), to: '24.3.0' })
    expect(plan.edits).toEqual([])
    expect(plan.skipped.map((s) => s.reason)).toEqual(['no-column'])
  })

  it('a source whose line/column do not hold raw (stale, or a wrong column)', () => {
    const text = 'nodejs 22.23.1\n'
    const [real] = extractAll('.tool-versions', text)
    for (const wrong of [{ column: 9 }, { column: 1 }, { line: 2 }, { line: 9, column: 1 }, { column: 99 }, { column: 0 }]) {
      const plan = planFix({ sources: [{ ...(real as Source), ...wrong }], files: new Map([['.tool-versions', text]]), to: '24.3.0' })
      expect(plan.edits, JSON.stringify(wrong)).toEqual([])
      expect(plan.skipped.map((s) => s.reason)).toEqual(['raw-not-at-column'])
    }
    // The file changed after the sources were read.
    const stale = planFix({ sources: [real as Source], files: new Map([['.tool-versions', 'nodejs 20.1.0\n']]), to: '24.3.0' })
    expect(stale.skipped.map((s) => s.reason)).toEqual(['raw-not-at-column'])
  })

  it('a file the caller could not supply', () => {
    const [real] = extractAll('.nvmrc', 'v22.22.3\n')
    const plan = planFix({ sources: [real as Source], files: new Map(), to: '24.3.0' })
    expect(plan.skipped.map((s) => s.reason)).toEqual(['file-unreadable'])
  })

  it('two sources at the same place: one edit when they agree, neither when they disagree', () => {
    // The same pin seen twice (an ARG used by two FROM lines does this): one edit that moves both.
    const docker = 'FROM node:22\n'
    const [pin] = extractAll('Dockerfile', docker)
    const twice = planFix({ sources: [pin as Source, { ...(pin as Source) }], files: new Map([['Dockerfile', docker]]), to: '24.3.0' })
    expect(twice.edits).toHaveLength(1)
    expect(twice.edits[0]?.sources).toHaveLength(2)
    expect(twice.files.get('Dockerfile')).toBe('FROM node:24\n')
    // The same bytes read as a partial pin and as a range want different results.
    const asRange: Source = { ...(pin as Source), constraint: { kind: 'range', range: '>=20.0.0 <23.0.0-0' } }
    const clash = planFix({ sources: [pin as Source, asRange], files: new Map([['Dockerfile', docker]]), to: '24.3.0', fixRanges: true })
    expect(clash.edits).toEqual([])
    expect(clash.skipped.map((s) => s.reason)).toEqual(['conflict', 'conflict'])
    expect(clash.files.size).toBe(0)
  })

  it('a rewrite that does not read back as expected leaves the file alone', () => {
    // A source that claims a kind the file does not have: after the edit the extractor finds no such pin.
    const [real] = extractAll('.nvmrc', 'v22.22.3\n')
    const liar: Source = { ...(real as Source), kind: 'engines' }
    const plan = planFix({ sources: [liar], files: new Map([['.nvmrc', 'v22.22.3\n']]), to: '24.3.0' })
    expect(plan.edits).toEqual([])
    expect(plan.files.size).toBe(0)
    expect(plan.skipped.map((s) => s.reason)).toEqual(['reread'])
  })
})

describe('the request itself', () => {
  it.each(['lts/*', '>=24', 'abc', '', 'latest', '24.x.y'])('rejects --to %j', (to) => {
    expect(() => fixOne('.nvmrc', 'v22.22.3\n', to)).toThrow(FixError)
  })

  it('needs --runtime when pins of several runtimes could be fixed', () => {
    const files = new Map([
      ['.tool-versions', 'nodejs 22.23.1\npython 3.10.5\n'],
    ])
    const sources = extractAll('.tool-versions', files.get('.tool-versions') as string)
    expect(() => planFix({ sources, files, to: '24.3.0' })).toThrow(/several runtimes \(node, python\)/)
    expect(planFix({ sources, files, to: '24.3.0', runtime: 'node' }).edits).toHaveLength(1)
    expect(planFix({ sources, files, to: '3.13.2', runtime: 'python' }).edits).toHaveLength(1)
  })

  it('does not insist on --runtime when only one runtime has anything to fix', () => {
    const text = 'nodejs 22.23.1\npython >=3.10\n'.replace('python >=3.10', 'python lts')
    const files = new Map([['.tool-versions', text]])
    expect(planFix({ sources: extractAll('.tool-versions', text), files, to: '24.3.0' }).edits).toHaveLength(1)
  })

  it('--runtime limits the plan to that runtime and leaves the rest untouched', () => {
    const text = 'nodejs 22.23.1\npython 3.10.5\ngolang 1.27.3\n'
    const r = fixOne('.tool-versions', text, '24.3.0', { runtime: 'node' })
    expect(r.after).toBe('nodejs 24.3.0\npython 3.10.5\ngolang 1.27.3\n')
    expect(r.plan.skipped).toEqual([])
  })
})

describe('applyEdits', () => {
  const edit = (line: number, column: number, from: string, to: string) => ({ line, column, from, to })

  it('replaces only the given bytes, whatever the length change', () => {
    expect(applyEdits('a 22 b\nc 22\n', [edit(1, 3, '22', '24.3.0'), edit(2, 3, '22', '4')])).toBe('a 24.3.0 b\nc 4\n')
  })

  it('applies several edits on one line from the right place', () => {
    expect(applyEdits('x=22 y=22', [edit(1, 3, '22', '24.1.0'), edit(1, 8, '22', '24.1.0')])).toBe('x=24.1.0 y=24.1.0')
  })

  it('keeps CRLF endings, a BOM and a missing final newline', () => {
    expect(applyEdits('22\r\n22\r\n', [edit(2, 1, '22', '24')])).toBe('22\r\n24\r\n')
    expect(applyEdits('\uFEFF22', [edit(1, 2, '22', '24')])).toBe('\uFEFF24')
    expect(applyEdits('v22', [edit(1, 2, '22', '24')])).toBe('v24')
  })

  it('counts columns in UTF-16 units, so non-ASCII text before the value is fine', () => {
    expect(applyEdits('ไทย 🙂 22\n', [edit(1, 8, '22', '24')])).toBe('ไทย 🙂 24\n')
  })

  it('refuses a position that does not hold the text, and overlapping edits', () => {
    expect(() => applyEdits('a 22\n', [edit(1, 2, '22', '24')])).toThrow(RangeError)
    expect(() => applyEdits('a 22\n', [edit(2, 1, '22', '24')])).toThrow(RangeError)
    expect(() => applyEdits('a 22\n', [edit(1, 99, '22', '24')])).toThrow(RangeError)
    expect(() => applyEdits('a 2222\n', [edit(1, 3, '222', 'x'), edit(1, 5, '22', 'y')])).toThrow(/overlap/)
    expect(() => applyEdits('a 22\nb\n', [edit(1, 3, '22\nb', 'x')])).toThrow(RangeError)
  })

  it('no edits: the same text', () => {
    expect(applyEdits('abc', [])).toBe('abc')
  })
})

describe('unifiedDiff', () => {
  it('prints a diff -u style hunk with 3 lines of context', () => {
    const before = 'l1\nl2\nl3\nFROM node:22\nl5\nl6\nl7\nl8\n'
    const after = 'l1\nl2\nl3\nFROM node:24\nl5\nl6\nl7\nl8\n'
    expect(unifiedDiff('Dockerfile', before, after)).toBe(
      '--- a/Dockerfile\n+++ b/Dockerfile\n@@ -1,7 +1,7 @@\n l1\n l2\n l3\n-FROM node:22\n+FROM node:24\n l5\n l6\n l7\n',
    )
  })

  it('clips context at the start and end of the file, and omits ",1" for a one-line hunk', () => {
    expect(unifiedDiff('.nvmrc', '22\n', '24\n')).toBe('--- a/.nvmrc\n+++ b/.nvmrc\n@@ -1 +1 @@\n-22\n+24\n')
  })

  it('merges changes that are close, and splits hunks that are far apart', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line${i + 1}`)
    const changeAt = (...at: number[]) => lines.map((l, i) => (at.includes(i) ? `${l}!` : l)).join('\n') + '\n'
    const before = lines.join('\n') + '\n'
    expect(unifiedDiff('f', before, changeAt(5, 9)).match(/^@@/gm)).toHaveLength(1) // 3 context lines touch
    expect(unifiedDiff('f', before, changeAt(5, 20)).match(/^@@/gm)).toHaveLength(2)
    expect(unifiedDiff('f', before, changeAt(5, 20))).toContain('@@ -3,7 +3,7 @@')
    expect(unifiedDiff('f', before, changeAt(5, 20))).toContain('@@ -18,7 +18,7 @@')
  })

  it('marks a last line without a newline, on both sides when it changed', () => {
    expect(unifiedDiff('.node-version', '22.22.1', '24.3.0')).toBe(
      '--- a/.node-version\n+++ b/.node-version\n@@ -1 +1 @@\n-22.22.1\n\\ No newline at end of file\n+24.3.0\n\\ No newline at end of file\n',
    )
    expect(unifiedDiff('f', 'a\n22', 'b\n22')).toContain(' 22\n\\ No newline at end of file\n')
  })

  it('keeps carriage returns as part of the lines', () => {
    expect(unifiedDiff('f', '22\r\n', '24\r\n')).toBe('--- a/f\n+++ b/f\n@@ -1 +1 @@\n-22\r\n+24\r\n')
  })

  it('is empty when nothing changed, and refuses texts of different length', () => {
    expect(unifiedDiff('f', 'a\n', 'a\n')).toBe('')
    expect(() => unifiedDiff('f', 'a\n', 'a\nb\n')).toThrow(RangeError)
  })

  it('agrees with a real plan', () => {
    const r = fixOne('Dockerfile', 'FROM node:22-alpine AS a\nFROM node:20 AS b\n', '24.3.0')
    expect(unifiedDiff('Dockerfile', 'FROM node:22-alpine AS a\nFROM node:20 AS b\n', r.after)).toBe(
      '--- a/Dockerfile\n+++ b/Dockerfile\n@@ -1,2 +1,2 @@\n-FROM node:22-alpine AS a\n-FROM node:20 AS b\n+FROM node:24-alpine AS a\n+FROM node:24 AS b\n',
    )
  })
})

describe('exactUtf8', () => {
  it('decodes valid UTF-8 (BOM kept) and refuses bytes that would not survive a rewrite', () => {
    expect(exactUtf8(Buffer.from('22\n', 'utf8'))).toBe('22\n')
    expect(exactUtf8(Buffer.from('\uFEFF22', 'utf8'))).toBe('\uFEFF22')
    expect(exactUtf8(Buffer.from([0x32, 0x32, 0xff, 0x0a]))).toBeUndefined() // a stray 0xFF byte
    expect(exactUtf8(Buffer.from([0xe0, 0xb8]))).toBeUndefined() // a cut-off Thai letter
  })
})

// ---------------------------------------------------------------------------------------------
// Byte preservation on every fixture: only the version bytes change.
// ---------------------------------------------------------------------------------------------

const FIXTURE_DIRS = ['fixtures/node', 'fixtures/python', 'fixtures/go', 'extract/shared/fixtures']
const TARGET: Record<Runtime, string> = { node: '24.3.0', python: '3.13.2', go: '1.27.3' }
/** Beyond every range in the fixtures, so range rewriting runs on real files too. */
const FAR: Record<Runtime, string> = { node: '40.1.0', python: '3.40.1', go: '1.90.1' }

/** `owner-repo.<real file name>` -> a repo-relative path the extractors dispatch on. */
function repoPath(fixture: string): string {
  const real = fixture.slice(fixture.indexOf('.') + 1)
  if (['nvmrc', 'node-version', 'tool-versions', 'python-version'].includes(real)) return `.${real}`
  if (/gitlab-ci\.ya?ml$/.test(real)) return '.gitlab-ci.yml'
  if (/\.ya?ml$/.test(real)) return `.github/workflows/${real}`
  return real
}

interface Fixture {
  name: string
  file: string
  text: string
}

function fixtures(): Fixture[] {
  const out: Fixture[] = []
  for (const dir of FIXTURE_DIRS) {
    for (const name of readdirSync(join(__dirname, dir)).sort()) {
      if (name === 'SOURCES.md') continue
      out.push({ name: `${dir}/${name}`, file: repoPath(name), text: readFileSync(join(__dirname, dir, name), 'utf8') })
    }
  }
  return out
}

/** Variants of a file that stress "every other byte": line endings, a BOM, no final newline. */
const VARIANTS: [string, (t: string) => string][] = [
  ['as is', (t) => t],
  ['CRLF', (t) => t.replace(/\r?\n/g, '\r\n')],
  ['BOM', (t) => `\uFEFF${t}`],
  ['no final newline', (t) => t.replace(/(\r?\n)+$/, '')],
]

/**
 * Rebuilds the expected result from the original text and the edits, in a different way from
 * `applyEdits` (split into lines, splice the line), so the two cannot share a bug.
 */
function expectedAfter(before: string, edits: FixPlan['edits']): string {
  const lines = before.split('\n')
  const byLine = new Map<number, FixPlan['edits']>()
  for (const e of edits) byLine.set(e.line, [...(byLine.get(e.line) ?? []), e])
  for (const [line, list] of byLine) {
    let text = lines[line - 1] as string
    for (const e of [...list].sort((a, b) => b.column - a.column)) {
      expect(text.slice(e.column - 1, e.column - 1 + e.from.length)).toBe(e.from)
      text = text.slice(0, e.column - 1) + e.to + text.slice(e.column - 1 + e.from.length)
    }
    lines[line - 1] = text
  }
  return lines.join('\n')
}

describe('byte preservation on every fixture: only the version bytes change', () => {
  const all = fixtures()
  const stats = { files: 0, edits: 0, kinds: new Set<string>(), edited: new Set<string>() }

  for (const f of all) {
    for (const [variant, transform] of VARIANTS) {
      for (const runtime of ['node', 'python', 'go'] as const) {
        for (const [fixRanges, goal] of [[false, TARGET], [true, TARGET], [true, FAR]] as const) {
          it(`${f.name} [${variant}] ${runtime} ranges=${fixRanges} to ${goal[runtime]}`, () => {
            const before = transform(f.text)
            const sources = extractAll(f.file, before)
            const plan = planFix({ sources, files: new Map([[f.file, before]]), to: goal[runtime], runtime, fixRanges })
            const after = plan.files.get(f.file) ?? before
            stats.files++

            // 1. The new text is the old text with exactly the planned replacements, nothing else.
            expect(after).toBe(expectedAfter(before, plan.edits))
            expect(plan.files.has(f.file)).toBe(plan.edits.length > 0)
            expect(Buffer.byteLength(after)).toBe(Buffer.byteLength(before) + plan.edits.reduce((n, e) => n + Buffer.byteLength(e.to) - Buffer.byteLength(e.from), 0))

            // 2. Same number of lines and line endings; only lines holding an edit differ.
            const a = before.split('\n')
            const b = after.split('\n')
            expect(b).toHaveLength(a.length)
            const editLines = new Set(plan.edits.map((e) => e.line))
            a.forEach((line, i) => {
              if (!editLines.has(i + 1)) expect(b[i]).toBe(line)
              else expect(b[i]?.endsWith('\r')).toBe(line.endsWith('\r'))
            })
            expect(after.startsWith('\uFEFF')).toBe(before.startsWith('\uFEFF'))
            expect(after.endsWith('\n')).toBe(before.endsWith('\n'))

            // 3. Read back: edited pins show the new value in place; every other pin is unchanged.
            const now = extractAll(f.file, after)
            expect(now).toHaveLength(sources.length)
            const edited = new Map<string, string>()
            for (const e of plan.edits) for (const s of e.sources) edited.set(`${s.kind}\0${s.line}\0${s.column}`, e.to)
            sources.forEach((s, i) => {
              const n = now[i] as Source
              const to = edited.get(`${s.kind}\0${s.line}\0${s.column}`)
              expect([n.runtime, n.kind, n.line, n.column]).toEqual([s.runtime, s.kind, s.line, s.column])
              expect(n.raw).toBe(to ?? s.raw)
              if (to === undefined) expect(n.constraint).toEqual(s.constraint)
              if (to !== undefined) stats.edited.add(s.kind)
            })
            stats.edits += plan.edits.length
            for (const s of sources) stats.kinds.add(s.kind)

            // 4. Idempotent, and a diff exists exactly when something changed.
            const again = planFix({ sources: now, files: new Map([[f.file, after]]), to: goal[runtime], runtime, fixRanges })
            expect(again.edits).toEqual([])
            expect(unifiedDiff(f.file, before, after) === '').toBe(plan.edits.length === 0)

            // 5. Every source is accounted for: edited, unchanged or skipped with a reason.
            const accounted = plan.edits.reduce((n, e) => n + e.sources.length, 0) + plan.unchanged.length + plan.skipped.length
            expect(accounted).toBe(sources.filter((s) => s.runtime === runtime).length)
          })
        }
      }
    }
  }

  it('the suite really exercised the fixtures (not vacuous)', () => {
    expect(all.length).toBeGreaterThanOrEqual(40)
    expect(stats.edits).toBeGreaterThanOrEqual(250)
    for (const kind of ['dockerfile', 'setup-node', 'setup-python', 'setup-go', 'nvmrc', 'node-version', 'python-version', 'tool-versions', 'mise', 'volta', 'go-toolchain', 'gitlab-ci', 'engines', 'requires-python']) {
      expect(stats.kinds.has(kind), `kind ${kind} appears in the fixtures`).toBe(true)
    }
    for (const kind of ['dockerfile', 'nvmrc', 'node-version', 'tool-versions', 'mise', 'volta', 'go-toolchain', 'engines', 'runtime-txt', 'poetry-python']) {
      expect(stats.edited.has(kind), `kind ${kind} was edited at least once`).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------------------------
// The command: `runtime-pin-check --fix` through run()
// ---------------------------------------------------------------------------------------------

describe('--fix through the command line', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  })

  /** A temp repo with the given files (string or bytes). */
  function repo(files: Record<string, string | Buffer>): string {
    const dir = mkdtempSync(join(tmpdir(), 'rpc-fix-'))
    dirs.push(dir)
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true })
      writeFileSync(join(dir, path), content)
    }
    return dir
  }
  const read = (dir: string, path: string): Buffer => readFileSync(join(dir, path))

  async function fix(dir: string, ...args: string[]): Promise<{ code: number; out: string; err: string }> {
    let out = ''
    let err = ''
    const code = await run(['--fix', ...args], { stdout: (t) => (out += t), stderr: (t) => (err += t), env: {}, cwd: dir })
    return { code, out, err }
  }

  const WORKFLOW = 'jobs:\n  t:\n    steps:\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 22\n'

  it('rewrites the pins on disk, byte for byte except the versions, and says what it did', async () => {
    const files = {
      '.nvmrc': 'v22.22.3\r\n', // CRLF kept
      'Dockerfile': '# build\nFROM node:22-alpine AS web\nRUN echo "22"\n',
      '.github/workflows/ci.yml': WORKFLOW,
      'packages/app/.node-version': '20.11.0', // no final newline, in a sub-project
      'README.md': 'Node 22 is required.\n',
    }
    const dir = repo(files)
    const r = await fix(dir, '--to', '24.3.0')
    expect(r.code).toBe(0)
    expect(read(dir, '.nvmrc').toString()).toBe('v24.3.0\r\n')
    expect(read(dir, 'Dockerfile').toString()).toBe('# build\nFROM node:24-alpine AS web\nRUN echo "22"\n')
    expect(read(dir, '.github/workflows/ci.yml').toString()).toBe(WORKFLOW.replace('node-version: 22', 'node-version: 24'))
    expect(read(dir, 'packages/app/.node-version').toString()).toBe('24.3.0')
    expect(read(dir, 'README.md').toString()).toBe(files['README.md']) // not a pin file
    expect(r.out).toContain('changed 4 pins in 4 files')
    expect(r.out).toContain('.nvmrc:1  v22.22.3 -> v24.3.0')
    expect(r.out).toContain('packages/app/.node-version:1  20.11.0 -> 24.3.0')
    expect(r.err).toBe('')
  })

  it('--dry-run prints a unified diff on stdout, the summary on stderr, and writes nothing', async () => {
    const files = { '.nvmrc': 'v22.22.3\n', 'Dockerfile': 'FROM node:22\n' }
    const dir = repo(files)
    const r = await fix(dir, '--to', '24.3.0', '--dry-run')
    expect(r.code).toBe(0)
    expect(read(dir, '.nvmrc').toString()).toBe(files['.nvmrc'])
    expect(read(dir, 'Dockerfile').toString()).toBe(files['Dockerfile'])
    expect(r.out).toBe(
      '--- a/.nvmrc\n+++ b/.nvmrc\n@@ -1 +1 @@\n-v22.22.3\n+v24.3.0\n--- a/Dockerfile\n+++ b/Dockerfile\n@@ -1 +1 @@\n-FROM node:22\n+FROM node:24\n',
    )
    expect(r.err).toContain('dry run: nothing written')
    expect(r.err).toContain('would change 2 pins in 2 files')
  })

  it('never touches a lockfile, a matrix, an alias or a digest-pinned image, and lists them', async () => {
    const lock = '{\n  "packages": { "": { "engines": { "node": "22" } } }\n}\n'
    const files = {
      'package-lock.json': lock,
      '.nvmrc': 'lts/*\n',
      'Dockerfile': 'FROM node:22.23.1@sha256:813a\n',
      '.github/workflows/ci.yml': 'jobs:\n  t:\n    strategy:\n      matrix:\n        node-version: [18, 20]\n    steps:\n      - uses: actions/setup-node@v4\n        with:\n          node-version: ${{ matrix.node-version }}\n',
    }
    const dir = repo(files)
    const r = await fix(dir, '--to', '24.3.0')
    expect(r.code).toBe(0)
    for (const [path, text] of Object.entries(files)) expect(read(dir, path).toString(), path).toBe(text)
    expect(r.out).toContain('nothing to change')
    expect(r.out).toContain('nothing is guessed')
    for (const reason of ['(alias)', '(digest)', '(matrix)']) expect(r.out).toContain(reason)
  })

  it('skips fixture directories like the check does, unless --include-fixtures; --exclude is honoured', async () => {
    const files = { '.nvmrc': 'v22.22.3\n', 'test/fixtures/.nvmrc': 'v22.22.3\n', 'legacy/.nvmrc': 'v20.1.0\n' }
    const dir = repo(files)
    await fix(dir, '--to', '24.3.0', '--exclude', 'legacy')
    expect(read(dir, '.nvmrc').toString()).toBe('v24.3.0\n')
    expect(read(dir, 'test/fixtures/.nvmrc').toString()).toBe('v22.22.3\n')
    expect(read(dir, 'legacy/.nvmrc').toString()).toBe('v20.1.0\n')
    await fix(dir, '--to', '24.3.0', '--include-fixtures')
    expect(read(dir, 'test/fixtures/.nvmrc').toString()).toBe('v24.3.0\n')
    expect(read(dir, 'legacy/.nvmrc').toString()).toBe('v24.3.0\n')
  })

  it('needs --runtime when several runtimes could be fixed, and then touches only that one', async () => {
    const text = 'nodejs 22.23.1\npython 3.10.5\n'
    const dir = repo({ '.tool-versions': text })
    const ambiguous = await fix(dir, '--to', '24.3.0')
    expect(ambiguous.code).toBe(2)
    expect(ambiguous.err).toContain('several runtimes (node, python)')
    expect(ambiguous.err).toContain('--runtime')
    expect(read(dir, '.tool-versions').toString()).toBe(text)
    expect((await fix(dir, '--to', '24.3.0', '--runtime', 'node,python')).code).toBe(2)
    expect((await fix(dir, '--to', '24.3.0', '--runtime', 'node')).code).toBe(0)
    expect(read(dir, '.tool-versions').toString()).toBe('nodejs 24.3.0\npython 3.10.5\n')
  })

  it('--fix-ranges rewrites a range; without it the range is left and listed', async () => {
    const pkg = '{\n  "engines": { "node": ">=20 <23" }\n}\n'
    const dir = repo({ 'package.json': pkg })
    const plain = await fix(dir, '--to', '24.3.0')
    expect(plain.out).toContain('(range)')
    expect(read(dir, 'package.json').toString()).toBe(pkg)
    const ranges = await fix(dir, '--to', '24.3.0', '--fix-ranges')
    expect(ranges.code).toBe(0)
    expect(read(dir, 'package.json').toString()).toBe('{\n  "engines": { "node": ">=24" }\n}\n')
  })

  it('refuses a file that is not valid UTF-8 instead of damaging it', async () => {
    const bytes = Buffer.concat([Buffer.from('# caf'), Buffer.from([0xe9]), Buffer.from('\nFROM node:22\n')]) // a Latin-1 e-acute
    const dir = repo({ Dockerfile: bytes })
    const r = await fix(dir, '--to', '24.3.0')
    expect(r.code).toBe(0)
    expect(read(dir, 'Dockerfile').equals(bytes)).toBe(true)
    expect(r.out).toContain('(file-unreadable)')
  })

  it('is idempotent: a second run changes nothing', async () => {
    const dir = repo({ '.nvmrc': 'v22.22.3\n', Dockerfile: 'FROM node:22-alpine\n' })
    await fix(dir, '--to', '24.3.0')
    const snapshot = [read(dir, '.nvmrc'), read(dir, 'Dockerfile')]
    const again = await fix(dir, '--to', '24.3.0')
    expect(again.out).toContain('nothing to change')
    expect([read(dir, '.nvmrc'), read(dir, 'Dockerfile')]).toEqual(snapshot)
  })

  it('exits 2 with a message for a bad --to or a missing directory, and writes nothing', async () => {
    const dir = repo({ '.nvmrc': 'v22.22.3\n' })
    for (const to of ['lts/*', '>=24', 'abc']) {
      const r = await fix(dir, '--to', to)
      expect(r.code, to).toBe(2)
      expect(r.err).toContain('--to must be a version')
    }
    expect(read(dir, '.nvmrc').toString()).toBe('v22.22.3\n')
    const missing = await fix(dir, '--to', '24.3.0', join(dir, 'nope'))
    expect(missing.code).toBe(2)
    expect(missing.err).toContain('cannot read')
  })

  it('the existing usage rules still hold: --fix needs --to and cannot be combined with --json', async () => {
    const dir = repo({ '.nvmrc': 'v22.22.3\n' })
    expect((await fix(dir)).code).toBe(2)
    expect((await fix(dir, '--to', '24', '--json')).code).toBe(2)
  })
})

// ---------------------------------------------------------------------------------------------
// Files that start with a UTF-8 byte-order mark: read like any other, and the BOM survives --fix.
// ---------------------------------------------------------------------------------------------

describe('splitBom', () => {
  it('splits off one leading BOM and nothing else; bom + body is always the original', () => {
    expect(splitBom(`${BOM}22\n`)).toEqual({ bom: BOM, body: '22\n' })
    expect(splitBom('22\n')).toEqual({ bom: '', body: '22\n' })
    expect(splitBom(`${BOM}${BOM}22`)).toEqual({ bom: BOM, body: `${BOM}22` }) // only one
    expect(splitBom(`22${BOM}`)).toEqual({ bom: '', body: `22${BOM}` }) // a BOM that is not first is content
    expect(splitBom('')).toEqual({ bom: '', body: '' })
    for (const t of [`${BOM}a`, 'a', `${BOM}${BOM}`, '']) expect(splitBom(t).bom + splitBom(t).body).toBe(t)
  })
})

describe('--fix on files with a byte-order mark', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  })
  const EF = [0xef, 0xbb, 0xbf]

  function repo(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), 'rpc-bomfix-'))
    dirs.push(dir)
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true })
      writeFileSync(join(dir, path), content)
    }
    return dir
  }
  async function fix(dir: string, ...args: string[]): Promise<{ code: number; out: string; err: string }> {
    let out = ''
    let err = ''
    const code = await run(['--fix', ...args], { stdout: (t) => (out += t), stderr: (t) => (err += t), env: {}, cwd: dir })
    return { code, out, err }
  }
  const bytes = (dir: string, path: string): Buffer => readFileSync(join(dir, path))

  /** Replaces text in a Buffer without going through strings, to compare bytes independently. */
  function replaceBytes(b: Buffer, from: string, to: string): Buffer {
    const at = b.indexOf(from)
    expect(at).toBeGreaterThanOrEqual(0)
    return Buffer.concat([b.subarray(0, at), Buffer.from(to), b.subarray(at + from.length)])
  }

  const PKG = `${BOM}{\n  "name": "x",\n  "volta": { "node": "22.22.2" }\n}\n`

  it('a BOM package.json is fixed: only the version bytes change, and the 3 BOM bytes stay', async () => {
    const dir = repo({ 'package.json': PKG })
    const before = bytes(dir, 'package.json')
    const r = await fix(dir, '--to', '24.3.0')
    expect(r.code).toBe(0)
    const after = bytes(dir, 'package.json')
    expect([...after.subarray(0, 3)]).toEqual(EF)
    expect(after.equals(replaceBytes(before, '22.22.2', '24.3.0'))).toBe(true)
    expect(after.length).toBe(before.length - 1) // '24.3.0' is one byte shorter than '22.22.2'
    expect(r.out).toContain('package.json:3  22.22.2 -> 24.3.0')
  })

  it('a pin on line 1 of a BOM file lands on the right bytes (the column is counted after the BOM)', async () => {
    const dir = repo({ '.nvmrc': `${BOM}v22.22.3\n`, '.node-version': `${BOM}22\n` })
    const r = await fix(dir, '--to', '24.3.0')
    expect(r.code).toBe(0)
    expect(bytes(dir, '.nvmrc').equals(Buffer.concat([Buffer.from(EF), Buffer.from('v24.3.0\n')]))).toBe(true)
    expect(bytes(dir, '.node-version').equals(Buffer.concat([Buffer.from(EF), Buffer.from('24\n')]))).toBe(true)
  })

  it('BOM together with CRLF: both survive', async () => {
    const dir = repo({ 'package.json': PKG.replace(/\n/g, '\r\n'), '.nvmrc': `${BOM}v22.22.3\r\n` })
    const before = bytes(dir, 'package.json')
    expect((await fix(dir, '--to', '24.3.0')).code).toBe(0)
    const after = bytes(dir, 'package.json')
    expect([...after.subarray(0, 3)]).toEqual(EF)
    expect(after.equals(replaceBytes(before, '22.22.2', '24.3.0'))).toBe(true)
    expect(after.toString().split('\r\n').length).toBe(before.toString().split('\r\n').length)
    expect(bytes(dir, '.nvmrc').toString()).toBe(`${BOM}v24.3.0\r\n`)
  })

  it('BOM TOML with --fix-ranges', async () => {
    const dir = repo({ 'pyproject.toml': `${BOM}[project]\nrequires-python = ">=3.10,<3.12"\n` })
    expect((await fix(dir, '--to', '3.13.2', '--fix-ranges')).code).toBe(0)
    expect(bytes(dir, 'pyproject.toml').toString()).toBe(`${BOM}[project]\nrequires-python = ">=3.13"\n`)
  })

  it('two BOMs: only one is treated as the mark, both are kept, and the pin still moves correctly', async () => {
    const dir = repo({ '.nvmrc': `${BOM}${BOM}v22.22.3\n` })
    expect((await fix(dir, '--to', '24.3.0')).code).toBe(0)
    expect(bytes(dir, '.nvmrc').toString()).toBe(`${BOM}${BOM}v24.3.0\n`)
  })

  it('--dry-run shows the BOM on line 1, writes nothing, and the diff applies cleanly with git', async () => {
    const files = { '.nvmrc': `${BOM}v22.22.3\n`, 'Dockerfile': `${BOM}FROM node:22\n` }
    const dir = repo(files)
    const r = await fix(dir, '--to', '24.3.0', '--dry-run')
    expect(r.code).toBe(0)
    expect(bytes(dir, '.nvmrc').toString()).toBe(files['.nvmrc'])
    expect(r.out).toContain(`-${BOM}v22.22.3\n+${BOM}v24.3.0\n`)
    expect(r.out).toContain(`-${BOM}FROM node:22\n+${BOM}FROM node:24\n`)
    const git = spawnSync('git', ['--version'])
    if (git.status === 0) {
      writeFileSync(join(dir, 'fix.diff'), r.out)
      const check = spawnSync('git', ['apply', '--check', 'fix.diff'], { cwd: dir, encoding: 'utf8' })
      expect(check.stderr, 'git apply --check').toBe('')
      expect(check.status).toBe(0)
      // Applying the diff gives exactly what the real run gives.
      const applied = spawnSync('git', ['apply', 'fix.diff'], { cwd: dir })
      expect(applied.status).toBe(0)
      const viaDiff = [bytes(dir, '.nvmrc'), bytes(dir, 'Dockerfile')]
      writeFileSync(join(dir, '.nvmrc'), files['.nvmrc'])
      writeFileSync(join(dir, 'Dockerfile'), files['Dockerfile'])
      await fix(dir, '--to', '24.3.0')
      expect([bytes(dir, '.nvmrc'), bytes(dir, 'Dockerfile')]).toEqual(viaDiff)
    }
  })

  it('is idempotent and never adds or removes a BOM', async () => {
    const files = { 'package.json': PKG, '.nvmrc': `${BOM}v22.22.3\n`, 'plain/.nvmrc': 'v22.22.3\n' }
    const dir = repo(files)
    await fix(dir, '--to', '24.3.0')
    const once = Object.keys(files).map((f) => bytes(dir, f))
    const again = await fix(dir, '--to', '24.3.0')
    expect(again.out).toContain('nothing to change')
    expect(Object.keys(files).map((f) => bytes(dir, f))).toEqual(once)
    expect([...bytes(dir, 'plain/.nvmrc').subarray(0, 3)]).not.toEqual(EF) // a file without a BOM stays without
    expect([...bytes(dir, '.nvmrc').subarray(0, 3)]).toEqual(EF)
  })

  it('every fixture, with a BOM, is fixed the same as without one (apart from the BOM itself)', () => {
    // The library level: plan on the BOM-less body with Sources read from it, as the command does.
    let compared = 0
    for (const f of fixtures()) {
      for (const runtime of ['node', 'python', 'go'] as const) {
        const plain = f.text.replace(/^\uFEFF/, '')
        const sources = extractAll(f.file, plain)
        const a = planFix({ sources, files: new Map([[f.file, plain]]), to: TARGET[runtime], runtime })
        const bom = `${BOM}${plain}`
        const b = planFix({ sources: extractAll(f.file, splitBom(bom).body), files: new Map([[f.file, splitBom(bom).body]]), to: TARGET[runtime], runtime })
        expect(b.edits.map((e) => [e.line, e.column, e.from, e.to])).toEqual(a.edits.map((e) => [e.line, e.column, e.from, e.to]))
        expect(`${BOM}${b.files.get(f.file) ?? plain}`).toBe(`${BOM}${a.files.get(f.file) ?? plain}`)
        compared += a.edits.length
      }
    }
    expect(compared).toBeGreaterThanOrEqual(30)
  })
})
