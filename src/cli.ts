#!/usr/bin/env node
/**
 * Command line (docs/TASKS.md, CLI):
 * `runtime-pin-check [dir] [--json] [--runtime node,python,go] [--fail-on error|warning|info]
 *  [--date YYYY-MM-DD] [--fix --to <version> [--runtime <one>] [--dry-run] [--fix-ranges]]`
 *
 * Exit codes: 0 = no finding at or above `--fail-on` (default `error`); 1 = at least one;
 * 2 = usage or I/O error. Under `GITHUB_ACTIONS=true` it also prints workflow annotations.
 * Offline: reads only the files of the scanned directory and the bundled end-of-life data.
 */
import { realpathSync } from 'node:fs'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { bindSources, compareSources, groupByScope } from './compare'
import { isFloatingAlias } from './constraint'
import { bundledSnapshot, checkDate, createAliasResolver, eolFindings } from './eol'
import { diagnoseFile } from './extract/diagnose'
import { extractGo } from './extract/go'
import { extractNode } from './extract/node'
import { extractPython } from './extract/python'
import { exactUtf8, FixError, planFix, splitBom, unifiedDiff, type FixPlan } from './fix'
import { failsAt, formatAnnotations, formatDiagnosticAnnotations, formatJson, formatText, type CheckReport } from './report'
import { manifestRuntimesOf, projectRootsOf, scanFiles } from './scan'
import type { Diagnostic, Finding, Runtime, Severity, Source } from './types'
import packageJson from '../package.json'

/** The package version, from package.json at build time. */
export const VERSION: string = packageJson.version

const RUNTIMES: readonly Runtime[] = ['node', 'python', 'go']
const SEVERITIES: readonly Severity[] = ['error', 'warning', 'info']
const RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 }

/** Files larger than this are not version files; they are skipped unread. */
const MAX_FILE_BYTES = 1024 * 1024

/**
 * Names that can hold a pin. The extractors decide precisely; this only avoids reading every file
 * of a large repo.
 */
const CANDIDATE =
  /(^|\/)(\.nvmrc|\.node-version|\.python-version|\.tool-versions|package\.json|pyproject\.toml|runtime\.txt|go\.mod|[^/]*mise[^/]*\.toml|config\.toml|[^/]*dockerfile[^/]*|\.gitlab-ci\.ya?ml|action\.ya?ml)$/i
const GITHUB_YAML = /^\.github\/.+\.ya?ml$/i

export const USAGE = `Usage: runtime-pin-check [dir] [options]

Finds Node, Python and Go version pins that disagree across a repo's files.

Options:
  --json                      print the result as JSON
  --runtime node,python,go    only these runtimes (default: all)
  --fail-on error|warning|info  exit 1 when a finding is at or above this level (default: error)
  --date YYYY-MM-DD           check end-of-life and LTS aliases as of this date (default: today, UTC)
  --include-fixtures          also scan fixture folders (skipped by default: fixtures/, fixture/,
                              __fixtures__/, test_fixtures/, test-fixtures/, testdata/, test_data/ ...)
  --exclude <glob>            skip matching paths (repeatable; 'examples', 'docs/**', '*.Dockerfile')
  --fix --to <version>        rewrite pins to <version> (with --runtime <one>, --dry-run, --fix-ranges)
  -v, --version               print the version
  -h, --help                  show this help

Exit codes: 0 no finding at or above --fail-on, 1 findings, 2 usage or I/O error.
`

/** Where `run` writes and what it reads from the environment; tests replace it. */
export interface CliIo {
  stdout: (text: string) => void
  stderr: (text: string) => void
  env: Readonly<Record<string, string | undefined>>
  cwd: string
}

/** Parsed command line. */
export interface CliOptions {
  dir: string
  json: boolean
  runtimes: Runtime[]
  failOn: Severity
  date: string | undefined
  includeFixtures: boolean
  exclude: string[]
  fix: boolean
  to: string | undefined
  dryRun: boolean
  fixRanges: boolean
  help: boolean
  version: boolean
}

class UsageError extends Error {}

/**
 * Parses the arguments (without `node` and the script path).
 *
 * @throws UsageError (exit 2) on unknown options, bad values or flags used without `--fix`.
 */
export function parseCliArgs(argv: readonly string[]): CliOptions {
  let parsed
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: {
        json: { type: 'boolean' },
        runtime: { type: 'string' },
        'fail-on': { type: 'string' },
        date: { type: 'string' },
        'include-fixtures': { type: 'boolean' },
        exclude: { type: 'string', multiple: true },
        fix: { type: 'boolean' },
        to: { type: 'string' },
        'dry-run': { type: 'boolean' },
        'fix-ranges': { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
    })
  } catch (err) {
    throw new UsageError(err instanceof Error ? err.message : String(err))
  }
  const v = parsed.values
  if (parsed.positionals.length > 1) throw new UsageError(`expected one directory, got ${parsed.positionals.length}`)

  let runtimes: Runtime[] = [...RUNTIMES]
  if (v.runtime !== undefined) {
    const list = v.runtime.split(',').map((r) => r.trim().toLowerCase()).filter((r) => r !== '')
    const bad = list.filter((r) => !RUNTIMES.includes(r as Runtime))
    if (list.length === 0 || bad.length > 0) throw new UsageError(`--runtime takes node, python and/or go, got "${v.runtime}"`)
    runtimes = [...new Set(list)] as Runtime[]
  }

  const failOn = (v['fail-on'] ?? 'error').toLowerCase()
  if (!SEVERITIES.includes(failOn as Severity)) throw new UsageError(`--fail-on takes error, warning or info, got "${v['fail-on']}"`)

  const fix = v.fix === true
  if (!fix) {
    for (const flag of ['to', 'dry-run', 'fix-ranges'] as const) {
      if (v[flag] !== undefined) throw new UsageError(`--${flag} only works together with --fix`)
    }
  } else {
    if (v.to === undefined || v.to.trim() === '') throw new UsageError('--fix needs --to <version>')
    if (v.json) throw new UsageError('--fix cannot be combined with --json')
  }

  return {
    dir: parsed.positionals[0] ?? '.',
    json: v.json === true,
    runtimes,
    failOn: failOn as Severity,
    date: v.date,
    includeFixtures: v['include-fixtures'] === true,
    exclude: v.exclude ?? [],
    fix,
    to: v.to,
    dryRun: v['dry-run'] === true,
    fixRanges: v['fix-ranges'] === true,
    help: v.help === true,
    version: v.version === true,
  }
}

/** What reading a directory produced: the pins, and the files that could not be fully read. */
export interface ReadResult {
  sources: Source[]
  diagnostics: Diagnostic[]
}

/**
 * Every pin in the directory, read with the three runtime extractors, plus a diagnostic for each
 * file with a YAML/TOML/JSON syntax error (never silent: docs/TASKS.md constraint 9).
 */
export async function readDirectory(dir: string, files: readonly string[], runtimes: readonly Runtime[] = RUNTIMES): Promise<ReadResult> {
  const sources: Source[] = []
  const diagnostics: Diagnostic[] = []
  for (const file of files) {
    if (!CANDIDATE.test(file) && !GITHUB_YAML.test(file)) continue
    const path = resolve(dir, file)
    const info = await stat(path)
    if (info.size > MAX_FILE_BYTES) continue
    // A leading byte-order mark is not part of the file's content: without this a BOM package.json
    // yields no pins and every line-1 column is off by one. One place, so no extractor needs to know.
    const text = splitBom(await readFile(path, 'utf8')).body
    sources.push(...extractNode(file, text), ...extractPython(file, text), ...extractGo(file, text))
    diagnostics.push(...diagnoseFile(file, text, runtimes))
  }
  return { sources, diagnostics }
}

/** Every pin in the directory, read with the three runtime extractors. */
export async function collectSources(dir: string, files: readonly string[]): Promise<Source[]> {
  return (await readDirectory(dir, files)).sources
}

function sortFindings(findings: Finding[]): Finding[] {
  return findings.sort(
    (a, b) =>
      RANK[a.severity] - RANK[b.severity] ||
      (a.sources[0]?.file ?? '').localeCompare(b.sources[0]?.file ?? '') ||
      (a.sources[0]?.line ?? 0) - (b.sources[0]?.line ?? 0) ||
      a.code.localeCompare(b.code),
  )
}

/**
 * Checks a directory and builds the report (no output, no exit code).
 *
 * @throws RangeError for an invalid `date`; I/O errors from reading the directory.
 */
export async function checkDirectory(
  dir: string,
  options: { runtimes?: readonly Runtime[]; date?: string; includeFixtures?: boolean; exclude?: readonly string[] } = {},
): Promise<CheckReport> {
  const runtimes = options.runtimes ?? RUNTIMES
  const date = checkDate(options.date)
  const snapshot = bundledSnapshot()
  const resolveAlias = createAliasResolver(snapshot, date)
  const scan = await scanFiles(dir, { includeFixtures: options.includeFixtures, exclude: options.exclude })
  const files = scan.files
  const roots = projectRootsOf(files)
  // A12: tie every source to the project roots it serves before comparing or judging EOL.
  const read = await readDirectory(dir, files, runtimes)
  const sources = bindSources(
    read.sources.filter((s) => runtimes.includes(s.runtime)),
    roots,
    manifestRuntimesOf(files),
  )
  const findings = sortFindings([
    ...compareSources(sources, roots, { resolveAlias }),
    ...eolFindings(sources, roots, { snapshot, date }),
  ])
  // Floating and unreadable pins are already findings; the list is for pins that had nothing to compare with.
  const singleSource = groupByScope(sources, roots)
    .filter((g) => g.sources.length === 1)
    .filter((g) => {
      const c = (g.sources[0] as Source).constraint
      return c.kind !== 'unknown' && !(c.kind === 'alias' && isFloatingAlias(c.alias))
    })
    .map((g) => {
      const s = g.sources[0] as Source
      return { root: g.root, runtime: g.runtime, file: s.file, line: s.line, raw: s.raw }
    })
  return { directory: dir, date, dataDate: snapshot.fetchedAt, roots, sources, findings, singleSource, excludedFiles: scan.excluded, diagnostics: read.diagnostics, resolveAlias }
}

const defaultIo = (): CliIo => ({
  stdout: (t) => process.stdout.write(t),
  stderr: (t) => process.stderr.write(t),
  env: process.env,
  cwd: process.cwd(),
})

/** The text of the plan for people: what changed, what was left alone and why. */
function formatFixSummary(plan: FixPlan, options: CliOptions, dryRun: boolean): string {
  const files = plan.files.size
  const lines = [
    `runtime-pin-check --fix --to ${plan.target}${options.fixRanges ? ' --fix-ranges' : ''}${dryRun ? ' (dry run: nothing written)' : ''}`,
    plan.edits.length === 0
      ? 'nothing to change'
      : `${dryRun ? 'would change' : 'changed'} ${plan.edits.length} pin${plan.edits.length === 1 ? '' : 's'} in ${files} file${files === 1 ? '' : 's'}:`,
  ]
  for (const e of plan.edits) lines.push(`  ${e.file}:${e.line}  ${e.from} -> ${e.to}`)
  if (plan.unchanged.length > 0) lines.push(`already at ${plan.target}: ${plan.unchanged.length} pin${plan.unchanged.length === 1 ? '' : 's'}`)
  if (plan.skipped.length > 0) {
    lines.push(`left alone (${plan.skipped.length}); nothing is guessed:`)
    // Pins on one line for one reason (a CI matrix of eight versions) are listed together.
    const groups = new Map<string, { file: string; line: number; raws: string[]; reason: string; detail: string }>()
    for (const s of plan.skipped) {
      const key = `${s.source.file}\0${s.source.line}\0${s.reason}`
      const group = groups.get(key)
      if (group) group.raws.push(s.source.raw)
      else groups.set(key, { file: s.source.file, line: s.source.line, raws: [s.source.raw], reason: s.reason, detail: s.detail })
    }
    for (const g of groups.values()) lines.push(`  ${g.file}:${g.line}  ${g.raws.map((r) => `"${r}"`).join(', ')} (${g.reason}): ${g.detail}`)
  }
  return `${lines.join('\n')}\n`
}

/**
 * `--fix --to <version>`: moves every exact/partial pin (and, with `--fix-ranges`, every range) to
 * one version, keeping each pin's style and every other byte of its file (src/fix.ts decides what is
 * safe). `--dry-run` prints a unified diff on stdout and writes nothing. Reads the same files as the
 * check (fixtures and `--exclude` respected), refuses files that are not valid UTF-8, and never
 * writes a file that changed since it was read.
 *
 * @returns 0 when done (including "nothing to change"); 2 for a usage or I/O error.
 */
export async function runFix(options: CliOptions, io: CliIo): Promise<number> {
  const dir = resolve(io.cwd, options.dir)
  try {
    if (!(await stat(dir)).isDirectory()) throw new Error(`${options.dir} is not a directory`)
  } catch (err) {
    io.stderr(`runtime-pin-check: cannot read ${options.dir}: ${(err as Error).message}\n`)
    return 2
  }
  const written: string[] = []
  try {
    const scan = await scanFiles(dir, { includeFixtures: options.includeFixtures, exclude: options.exclude })
    const sources = (await collectSources(dir, scan.files)).filter((s) => options.runtimes.includes(s.runtime))
    // Keep the exact bytes: a file that is not valid UTF-8 is never rewritten.
    const originals = new Map<string, Buffer>()
    const texts = new Map<string, string>() // without the BOM: the coordinates the sources use
    const boms = new Map<string, string>() // '' or the BOM each file starts with, written back as it was
    for (const file of new Set(sources.map((s) => s.file))) {
      const bytes = await readFile(resolve(dir, file))
      const text = exactUtf8(bytes)
      originals.set(file, bytes)
      if (text === undefined) continue
      const { bom, body } = splitBom(text)
      texts.set(file, body)
      boms.set(file, bom)
    }
    const plan = planFix({
      sources,
      files: texts,
      to: options.to as string,
      ...(options.runtimes.length === 1 ? { runtime: options.runtimes[0] as Runtime } : {}),
      fixRanges: options.fixRanges,
    })
    if (options.dryRun) {
      // The diff shows the file as it is on disk (BOM included), so `git apply` matches line 1.
      for (const [file, after] of plan.files) {
        const bom = boms.get(file) as string
        io.stdout(unifiedDiff(file, bom + (texts.get(file) as string), bom + after))
      }
      io.stderr(formatFixSummary(plan, options, true))
      return 0
    }
    for (const [file, after] of plan.files) {
      const path = resolve(dir, file)
      // The file must still be what the plan was made from.
      if (!(await readFile(path)).equals(originals.get(file) as Buffer)) {
        throw new Error(`${file} changed while --fix was running; nothing more was written, run it again`)
      }
      await writeFile(path, (boms.get(file) as string) + after, 'utf8')
      written.push(file)
    }
    io.stdout(formatFixSummary(plan, options, false))
    return 0
  } catch (err) {
    const done = written.length > 0 ? ` (already written: ${written.join(', ')})` : ''
    io.stderr(`runtime-pin-check: ${err instanceof FixError ? err.message : (err as Error).message}${done}\n`)
    return 2
  }
}

/**
 * Runs the command line and returns the exit code (it never calls `process.exit`).
 *
 * @param argv - Arguments without `node` and the script path.
 */
export async function run(argv: readonly string[], io: CliIo = defaultIo()): Promise<number> {
  let options: CliOptions
  try {
    options = parseCliArgs(argv)
  } catch (err) {
    io.stderr(`runtime-pin-check: ${(err as Error).message}\n\n${USAGE}`)
    return 2
  }
  if (options.version) {
    io.stdout(`${VERSION}\n`)
    return 0
  }
  if (options.help) {
    io.stdout(USAGE)
    return 0
  }
  if (options.fix) return runFix(options, io)

  const dir = resolve(io.cwd, options.dir)
  try {
    const info = await stat(dir)
    if (!info.isDirectory()) throw new Error(`${options.dir} is not a directory`)
  } catch (err) {
    io.stderr(`runtime-pin-check: cannot read ${options.dir}: ${(err as Error).message}\n`)
    return 2
  }

  let report: CheckReport
  try {
    report = await checkDirectory(dir, {
      runtimes: options.runtimes,
      date: options.date,
      includeFixtures: options.includeFixtures,
      exclude: options.exclude,
    })
  } catch (err) {
    io.stderr(`runtime-pin-check: ${(err as Error).message}\n`)
    return 2
  }
  report.directory = options.dir

  const text = options.json ? formatJson(report) : formatText(report)
  io.stdout(text)
  if (io.env.GITHUB_ACTIONS === 'true') {
    // Paths in annotations are relative to the workspace (the working directory in Actions).
    const pathOf = (file: string) => relative(io.cwd, resolve(dir, file)).split(sep).join('/')
    const annotations = formatAnnotations(report.findings, pathOf) + formatDiagnosticAnnotations(report.diagnostics, pathOf)
    // With --json, stdout must stay valid JSON; the runner reads workflow commands from stderr too.
    if (options.json) io.stderr(annotations)
    else io.stdout(annotations)
  }
  return failsAt(report.findings, options.failOn) ? 1 : 0
}

/** True when this module is the program being run (not imported by a test or another module). */
function isMain(): boolean {
  const entry = process.argv[1]
  if (entry === undefined) return false
  try {
    // npm runs the bin through a symlink (node_modules/.bin/runtime-pin-check): compare real paths.
    return import.meta.url === pathToFileURL(realpathSync(entry)).href
  } catch {
    return false
  }
}

if (isMain()) {
  run(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code
    },
    (err: unknown) => {
      process.stderr.write(`runtime-pin-check: ${err instanceof Error ? err.message : String(err)}\n`)
      process.exitCode = 2
    },
  )
}
