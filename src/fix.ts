/**
 * `--fix` (docs/TASKS.md, CLI, constraint 10): move pins to one version without damaging anything else.
 *
 * Pure: no file access. The caller reads the files, calls `planFix`, then writes `plan.files` (or
 * prints `unifiedDiff` for `--dry-run`). Four rules keep the edit safe:
 *
 * 1. A source is rewritten only when its syntax is fully understood: an exact or partial version
 *    (any precision) and, with `fixRanges`, a range. Matrix entries, aliases, unreadable values,
 *    Docker references pinned by digest, files that hold several versions on purpose, lockfiles and
 *    sources whose `line`/`column` do not point at `raw` are never touched; each is reported in
 *    `plan.skipped` with the reason. Nothing is guessed.
 * 2. Only the bytes of `raw` change. Everything else, including line endings, a byte-order mark and
 *    a missing final newline, stays as it was.
 * 3. Each rewritten file is read again with the extractors: every edited source must now read as the
 *    new value at the same place and every other source must be unchanged. If not, that file is left
 *    alone (`reread`).
 * 4. A range that already allows the whole target is left as it is; rewriting it would only narrow it.
 */
import semver from 'semver'
import { parseConstraint, toRange } from './constraint'
import { extractGo } from './extract/go/index'
import { extractNode } from './extract/node/index'
import { extractPython } from './extract/python/index'
import type { Constraint, Runtime, Source } from './types'

/** Why a source was not rewritten. */
export type SkipReason =
  | 'matrix' // a CI matrix entry is a deliberate multi-version test
  | 'alias' // `lts/*`, `latest`, an image variant: no version to move
  | 'unparseable' // the extractor could not read the value
  | 'range' // a range, and `--fix-ranges` was not given
  | 'range-allows-target' // the range already allows the whole target
  | 'digest' // a Docker reference pinned by `@sha256:...`: a new tag would no longer match it
  | 'syntax' // the new text would be invalid where the old one is written (an unquoted YAML value starting with `>`)
  | 'multi-version-file' // several versions in one version file, on purpose
  | 'precision' // `--to` has fewer parts than this pin needs
  | 'no-column' // the extractor gave no column, so the position is unknown
  | 'raw-not-at-column' // the text at line:column is not `raw` (stale or wrong source)
  | 'lockfile' // lockfiles are never edited
  | 'file-unreadable' // the caller did not supply this file's text
  | 'conflict' // two sources want different values for the same bytes
  | 'reread' // the rewritten file did not read back as expected

/** One source that was left alone, with the reason. */
export interface SkippedSource {
  source: Source
  reason: SkipReason
  /** A sentence for the user. */
  detail: string
}

/** One replacement of `raw` by a new version text, at a known place. */
export interface FixEdit {
  file: string
  /** 1-based line of the value. */
  line: number
  /** 1-based column of the value (UTF-16 units from the start of the line). */
  column: number
  /** The text now at that place. */
  from: string
  /** The text to put there. */
  to: string
  /** The sources this edit moves (more than one when several share the same bytes). */
  sources: Source[]
}

/** What `planFix` decided. */
export interface FixPlan {
  /** The target as given. */
  target: string
  edits: FixEdit[]
  /** Sources already at the target: nothing to do. */
  unchanged: Source[]
  skipped: SkippedSource[]
  /** The new text of every file that changes (only files with at least one edit). */
  files: Map<string, string>
}

/** Options of `planFix`. */
export interface FixOptions {
  /** Every pin found in the repo (from the extractors). */
  sources: readonly Source[]
  /** The current text of each file named by a source, keyed by the same repo-relative path. */
  files: ReadonlyMap<string, string>
  /** The version to move to: `24` or `24.1.0` (exact or partial; never a range or an alias). */
  to: string
  /** Fix only this runtime. Needed when pins of more than one runtime could be fixed. */
  runtime?: Runtime
  /** Also rewrite range sources, to `>=<unit of --to>`. Default false. */
  fixRanges?: boolean
}

/** Thrown for a request that cannot be carried out; the CLI prints the message and exits 2. */
export class FixError extends Error {
  override name = 'FixError'
}

const LOCKFILES = new Set([
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lock',
  'bun.lockb',
  'poetry.lock',
  'uv.lock',
  'pdm.lock',
  'Pipfile.lock',
  'go.sum',
  'go.work.sum',
])

/** True for a lockfile (never edited). */
export function isLockfile(file: string): boolean {
  const base = file.slice(file.lastIndexOf('/') + 1)
  return LOCKFILES.has(base) || /\.lock$|-lock\.(json|ya?ml)$/i.test(base)
}

/**
 * Version files that list several versions on purpose (pyenv reads every line of `.python-version`).
 * Moving each line to one version would produce duplicates, so such a file is left alone.
 */
const MULTI_VERSION_KINDS = new Set(['python-version', 'nvmrc', 'node-version'])

/** `prefix` + version tokens + `suffix` of a pin text, e.g. `v` `22.22.3` ``, `` `18.18.2` `-slim`. */
interface Shape {
  prefix: string
  /** Numeric tokens, e.g. ['22', '11'] for `22.11.x`. */
  numbers: string[]
  /** The wildcard tail kept as written, e.g. `.x` in `22.x`; '' when none. */
  wildcard: string
  suffix: string
}

const SHAPE = /^([A-Za-z-]*)(\d+(?:\.\d+){0,2})(\.[xX*])?(.*)$/s

function shapeOf(raw: string): Shape | undefined {
  const m = SHAPE.exec(raw)
  if (!m) return undefined
  return { prefix: m[1] as string, numbers: (m[2] as string).split('.'), wildcard: m[3] ?? '', suffix: m[4] as string }
}

/** The parts of the target as numbers text: `24.1.0` -> ['24', '1', '0']. */
function targetParts(to: Constraint): string[] {
  return to.kind === 'exact' || to.kind === 'partial' ? to.version.split('.') : []
}

/**
 * The new text for one exact/partial pin: its own prefix, suffix and wildcard kept, its version
 * rewritten to as many parts of the target as it had. Undefined when the target has fewer parts.
 */
function restyle(raw: string, target: string[]): string | undefined {
  const shape = shapeOf(raw)
  if (!shape || shape.numbers.length > target.length) return undefined
  return `${shape.prefix}${target.slice(0, shape.numbers.length).join('.')}${shape.wildcard}${shape.suffix}`
}

/** `>=` plus the unit a range is moved to: the major for Node, major.minor for Python and Go. */
function rangeText(runtime: Runtime, target: string[]): string | undefined {
  const parts = runtime === 'node' ? 1 : 2
  return target.length < parts ? undefined : `>=${target.slice(0, parts).join('.')}`
}

/** Why an unquoted YAML value with this text would not read as written, or undefined when it is safe. */
function yamlHazard(text: string): string | undefined {
  if (text.startsWith('>') || text.startsWith('|')) return 'cannot start with ">" or "|" in unquoted YAML (it opens a block scalar)'
  // A plain number is read as a number: `3.10` becomes 3.1 and loses its zero.
  if (/^\d+\.\d+$/.test(text) && String(Number(text)) !== text) return `would be read by YAML as the number ${Number(text)}`
  return undefined
}

type Decision = { edit: string } | { same: true } | { skip: SkipReason; detail: string }

function decide(source: Source, to: Constraint, target: string[], toText: string, fixRanges: boolean): Decision {
  if (source.matrix === true) {
    return { skip: 'matrix', detail: 'a CI matrix entry is a deliberate multi-version test; edit it by hand' }
  }
  const c = source.constraint
  switch (c.kind) {
    case 'alias':
      return { skip: 'alias', detail: `"${source.raw}" names no fixed version` }
    case 'unknown':
      return { skip: 'unparseable', detail: `the value could not be read (${c.reason})` }
    case 'exact':
    case 'partial': {
      const next = restyle(source.raw, target)
      if (next === undefined) {
        const need = c.kind === 'exact' ? 'a full version such as 24.1.0' : 'major.minor such as 24.1'
        return { skip: 'precision', detail: `"${source.raw}" needs --to to be ${need}` }
      }
      // An exact pin needs the full target; a 1-part --to cannot make one (restyle returned undefined).
      return next === source.raw ? { same: true } : { edit: next }
    }
    case 'range': {
      if (!fixRanges) return { skip: 'range', detail: `"${source.raw}" is a range; pass --fix-ranges to rewrite it` }
      const targetRange = toRange(to)
      if (targetRange !== undefined && semver.subset(targetRange, c.range)) {
        return { skip: 'range-allows-target', detail: `"${source.raw}" already allows ${toText}` }
      }
      // The go.mod directive is a bare minimum version, not a range expression.
      const text = source.kind === 'go-mod' ? restyle(source.raw, target) : rangeText(source.runtime, target)
      if (text === undefined) {
        return { skip: 'precision', detail: `"${source.raw}" needs --to to have more parts (for example 1.27)` }
      }
      return text === source.raw ? { same: true } : { edit: text }
    }
  }
}

/** Start offset of every line (lines end at '\n'; a '\r' before it stays part of the line). */
function lineStarts(text: string): number[] {
  const starts = [0]
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1)
  return starts
}

/** Offset of `line`:`column` in `text`, or undefined when the position does not exist. */
function offsetOf(starts: readonly number[], text: string, line: number, column: number): number | undefined {
  const start = starts[line - 1]
  if (start === undefined || column < 1) return undefined
  const end = line < starts.length ? (starts[line] as number) - 1 : text.length
  const at = start + column - 1
  return at <= end ? at : undefined
}

function extractAll(file: string, text: string): Source[] {
  return [...extractNode(file, text), ...extractPython(file, text), ...extractGo(file, text)]
}

const keyOf = (s: { file: string; line: number; column?: number | undefined; kind: string; runtime: string }): string =>
  `${s.file}\0${s.line}\0${s.column ?? ''}\0${s.kind}\0${s.runtime}`

/**
 * Applies edits to one file's text. Only the replaced bytes change.
 *
 * @param text - The file as it is now.
 * @param edits - Edits for this file; their positions refer to `text`.
 * @throws RangeError when an edit's position does not hold its `from` text, or two edits overlap.
 */
export function applyEdits(text: string, edits: readonly Pick<FixEdit, 'line' | 'column' | 'from' | 'to'>[]): string {
  const starts = lineStarts(text)
  const placed = edits
    .map((e) => {
      const at = offsetOf(starts, text, e.line, e.column)
      if (at === undefined || !text.startsWith(e.from, at) || e.from.includes('\n')) {
        throw new RangeError(`line ${e.line}, column ${e.column} does not hold "${e.from}"`)
      }
      return { at, e }
    })
    .sort((a, b) => a.at - b.at)
  for (let i = 1; i < placed.length; i++) {
    const before = placed[i - 1] as (typeof placed)[number]
    if (before.at + before.e.from.length > (placed[i] as (typeof placed)[number]).at) {
      throw new RangeError(`edits at line ${before.e.line} overlap`)
    }
  }
  let out = ''
  let cursor = 0
  for (const { at, e } of placed) {
    out += text.slice(cursor, at) + e.to
    cursor = at + e.from.length
  }
  return out + text.slice(cursor)
}

/** True when the string is not a version the fixer can move to. */
function parseTarget(to: string): { constraint: Constraint; parts: string[] } {
  const constraint = parseConstraint(to.trim(), 'node')
  const parts = targetParts(constraint)
  if (parts.length === 0) {
    throw new FixError(`--to must be a version such as 24 or 24.1.0, got "${to}"`)
  }
  return { constraint, parts }
}

/**
 * Plans the rewrite of every pin to `options.to`. Nothing is written; see the module comment for
 * what is rewritten and what is skipped.
 *
 * @param options - The pins, the file texts, the target and the switches.
 * @returns The edits, the pins already at the target, the skipped pins with reasons, and the new
 *   text of every changed file.
 * @throws FixError when `to` is not a version, or pins of several runtimes could be fixed and no
 *   `runtime` was given.
 */
export function planFix(options: FixOptions): FixPlan {
  const { constraint: to, parts } = parseTarget(options.to)
  const toText = options.to.trim()
  const fixRanges = options.fixRanges === true
  const considered = options.sources.filter((s) => options.runtime === undefined || s.runtime === options.runtime)

  const skipped: SkippedSource[] = []
  const skip = (source: Source, reason: SkipReason, detail: string): void => {
    skipped.push({ source, reason, detail })
  }

  // Which runtimes have something this run could change? Several means --to is ambiguous.
  if (options.runtime === undefined) {
    const fixable = new Set(
      considered
        .filter((s) => s.matrix !== true && (s.constraint.kind === 'exact' || s.constraint.kind === 'partial' || (fixRanges && s.constraint.kind === 'range')))
        .map((s) => s.runtime),
    )
    if (fixable.size > 1) {
      throw new FixError(`pins of several runtimes (${[...fixable].sort().join(', ')}) could be fixed: --to ${toText} cannot fit all of them; pass --runtime <one>`)
    }
  }

  // How many version sources does each multi-version-capable file hold?
  const perFile = new Map<string, number>()
  for (const s of considered) perFile.set(`${s.file}\0${s.kind}`, (perFile.get(`${s.file}\0${s.kind}`) ?? 0) + 1)

  const unchanged: Source[] = []
  const wanted = new Map<string, { source: Source; to: string; sources: Source[] }>()
  const textStarts = new Map<string, number[]>()

  for (const source of considered) {
    if (isLockfile(source.file)) {
      skip(source, 'lockfile', 'lockfiles are never edited')
      continue
    }
    const text = options.files.get(source.file)
    if (text === undefined) {
      skip(source, 'file-unreadable', 'the file could not be read as UTF-8 text')
      continue
    }
    if (MULTI_VERSION_KINDS.has(source.kind) && (perFile.get(`${source.file}\0${source.kind}`) ?? 0) > 1) {
      skip(source, 'multi-version-file', 'the file lists several versions on purpose; edit it by hand')
      continue
    }
    const decision = decide(source, to, parts, toText, fixRanges)
    if ('same' in decision) {
      unchanged.push(source)
      continue
    }
    if ('skip' in decision) {
      skip(source, decision.skip, decision.detail)
      continue
    }
    // The position must really hold `raw`; a source with no column or a stale one is never guessed.
    if (source.column === undefined) {
      skip(source, 'no-column', 'the extractor gave no column, so the exact position is unknown')
      continue
    }
    let starts = textStarts.get(source.file)
    if (!starts) {
      starts = lineStarts(text)
      textStarts.set(source.file, starts)
    }
    const at = offsetOf(starts, text, source.line, source.column)
    if (at === undefined || source.raw === '' || !text.startsWith(source.raw, at) || source.raw.includes('\n')) {
      skip(source, 'raw-not-at-column', `"${source.raw}" is not at line ${source.line}, column ${source.column}`)
      continue
    }
    // A digest after the tag pins the exact image; a new tag with the old digest would not match.
    if (text.charAt(at + source.raw.length) === '@') {
      skip(source, 'digest', 'the reference is pinned by a digest (@sha256:...); a new version needs a new digest')
      continue
    }
    // Unquoted YAML does not always read as the text written: `>=24` opens a block scalar and `3.10`
    // is the number 3.1. Such a value must be quoted first; the edit would change its meaning.
    const quoted = text.charAt(at - 1) === '"' || text.charAt(at - 1) === "'"
    if (/\.ya?ml$/i.test(source.file) && !quoted) {
      const hazard = yamlHazard(decision.edit)
      if (hazard !== undefined) {
        skip(source, 'syntax', `"${decision.edit}" ${hazard}; quote the value first, then run --fix again`)
        continue
      }
    }
    const key = `${source.file}\0${source.line}\0${source.column}`
    const known = wanted.get(key)
    if (known === undefined) wanted.set(key, { source, to: decision.edit, sources: [source] })
    else if (known.to === decision.edit && known.source.raw === source.raw) known.sources.push(source)
    else {
      skip(source, 'conflict', 'two pins at the same place want different values')
      skip(known.source, 'conflict', 'two pins at the same place want different values')
      wanted.delete(key)
    }
  }

  // Group edits by file, verify each file by reading it again, then build the plan.
  const byFile = new Map<string, FixEdit[]>()
  for (const { source, to: next, sources } of wanted.values()) {
    const edit: FixEdit = { file: source.file, line: source.line, column: source.column as number, from: source.raw, to: next, sources }
    byFile.set(source.file, [...(byFile.get(source.file) ?? []), edit])
  }

  const edits: FixEdit[] = []
  const files = new Map<string, string>()
  for (const [file, fileEdits] of [...byFile].sort(([a], [b]) => a.localeCompare(b))) {
    const before = options.files.get(file) as string
    let after: string
    try {
      after = applyEdits(before, fileEdits)
    } catch (err) {
      for (const e of fileEdits) for (const s of e.sources) skip(s, 'conflict', (err as Error).message)
      continue
    }
    const problem = rereadProblem(file, before, after, fileEdits)
    if (problem !== undefined) {
      for (const e of fileEdits) for (const s of e.sources) skip(s, 'reread', problem)
      continue
    }
    edits.push(...fileEdits.sort((a, b) => a.line - b.line || a.column - b.column))
    files.set(file, after)
  }

  skipped.sort((a, b) => a.source.file.localeCompare(b.source.file) || a.source.line - b.source.line)
  return { target: toText, edits, unchanged, skipped, files }
}

/**
 * (Exported for tests.) Reads the rewritten file with the extractors and compares: edited sources show the new value at
 * the same place, every other source is identical, and no source appeared or disappeared.
 * Returns a sentence describing the first difference, or undefined when all is as expected.
 */
export function rereadProblem(file: string, before: string, after: string, edits: readonly FixEdit[]): string | undefined {
  const was = extractAll(file, before)
  const now = extractAll(file, after)
  if (was.length !== now.length) return `the file read as ${was.length} pins before and ${now.length} after the edit`
  const edited = new Map<string, FixEdit>()
  for (const e of edits) for (const s of e.sources) edited.set(keyOf(s), e)
  const nowByKey = new Map(now.map((s) => [keyOf(s), s] as const))
  for (const s of was) {
    const key = keyOf(s)
    const found = nowByKey.get(key)
    if (found === undefined) return `the pin at line ${s.line} was no longer found after the edit`
    const edit = edited.get(key)
    if (edit === undefined) {
      if (found.raw !== s.raw || found.constraint.kind !== s.constraint.kind) return `the pin at line ${s.line} changed although it was not edited`
    } else if (found.raw !== edit.to) {
      return `line ${s.line} reads as "${found.raw}" after the edit, not "${edit.to}"`
    } else if (found.constraint.kind !== s.constraint.kind) {
      // The text is as intended but the file no longer means a version there (for example YAML
      // reading an unquoted number differently).
      const why = found.constraint.kind === 'unknown' ? `: ${found.constraint.reason}` : ''
      return `line ${s.line} still reads "${found.raw}" after the edit, but no longer as a ${s.constraint.kind} version (now ${found.constraint.kind}${why})`
    }
  }
  return undefined
}

/** The UTF-8 byte-order mark as a character (3 bytes in the file). */
export const BOM = '\uFEFF'

/**
 * Splits off ONE leading byte-order mark (Windows editors write one), so the rest has the line and
 * column numbers an editor shows. A second BOM is not stripped: it is content, and is not guessed
 * away. `bom + body` is always the original text.
 */
export function splitBom(text: string): { bom: string; body: string } {
  return text.startsWith(BOM) ? { bom: BOM, body: text.slice(1) } : { bom: '', body: text }
}

/**
 * Decodes a file only when it survives a round trip through UTF-8, so writing it back cannot
 * change a byte outside the edits. Returns undefined for a file that is not valid UTF-8.
 */
export function exactUtf8(bytes: Buffer): string | undefined {
  const text = bytes.toString('utf8')
  return Buffer.from(text, 'utf8').equals(bytes) ? text : undefined
}

/** Lines of a text without the empty piece after a final newline, and whether it ended in one. */
function linesOf(text: string): { lines: string[]; finalNewline: boolean } {
  const lines = text.split('\n')
  const finalNewline = lines.length > 1 && lines[lines.length - 1] === ''
  if (finalNewline) lines.pop()
  return { lines, finalNewline }
}

/**
 * A unified diff (`diff -u` style, 3 lines of context) between two versions of one file that have
 * the same number of lines, which is true of every `--fix` edit (a value is replaced in place).
 *
 * @param file - Repo-relative path, shown as `a/<file>` and `b/<file>`.
 * @throws RangeError when the texts have a different number of lines.
 */
export function unifiedDiff(file: string, before: string, after: string, context = 3): string {
  const a = linesOf(before)
  const b = linesOf(after)
  if (a.lines.length !== b.lines.length) throw new RangeError('unifiedDiff compares texts with the same number of lines')
  const changed: number[] = []
  a.lines.forEach((line, i) => {
    if (line !== b.lines[i]) changed.push(i)
  })
  if (changed.length === 0) return ''

  // Group changes whose context would touch or overlap into one hunk.
  const groups: [number, number][] = []
  for (const i of changed) {
    const last = groups[groups.length - 1]
    if (last && i - last[1] <= 2 * context) last[1] = i
    else groups.push([i, i])
  }
  const noEol = '\\ No newline at end of file'
  const out = [`--- a/${file}`, `+++ b/${file}`]
  const total = a.lines.length
  const range = (start: number, len: number): string => (len === 1 ? `${start}` : `${start},${len}`)
  for (const [first, lastChange] of groups) {
    const from = Math.max(0, first - context)
    const to = Math.min(total - 1, lastChange + context)
    const len = to - from + 1
    out.push(`@@ -${range(from + 1, len)} +${range(from + 1, len)} @@`)
    for (let i = from; i <= to; ) {
      if (a.lines[i] === b.lines[i]) {
        out.push(` ${a.lines[i] as string}`)
        if (i === total - 1 && !a.finalNewline) out.push(noEol)
        i++
        continue
      }
      // A run of changed lines: all the removed lines, then all the added ones, as diff -u prints them.
      let end = i
      while (end + 1 <= to && a.lines[end + 1] !== b.lines[end + 1]) end++
      const endsFile = end === total - 1 && !a.finalNewline
      for (let k = i; k <= end; k++) out.push(`-${a.lines[k] as string}`)
      if (endsFile) out.push(noEol)
      for (let k = i; k <= end; k++) out.push(`+${b.lines[k] as string}`)
      if (endsFile) out.push(noEol)
      i = end + 1
    }
  }
  return `${out.join('\n')}\n`
}
