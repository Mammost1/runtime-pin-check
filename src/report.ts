/**
 * Output of the CLI: a plain-text report grouped by project root, a JSON document, and GitHub
 * Actions annotations. Pure functions over the findings; the CLI decides where they are written.
 */
import { describeConstraint, isFloatingAlias } from './constraint'
import type { AliasResolver, Diagnostic, Finding, Runtime, Severity, Source } from './types'

/** Everything one check produced, as the report needs it. */
export interface CheckReport {
  /** The scanned directory as the user gave it. */
  directory: string
  /** `YYYY-MM-DD` the EOL checks and alias resolution used. */
  date: string
  /** `YYYY-MM-DD` the bundled EOL data was fetched. */
  dataDate: string
  roots: string[]
  sources: Source[]
  findings: Finding[]
  /** Scopes (root + runtime) with exactly one source: listed, never a finding (SINGLE_SOURCE). */
  singleSource: { root: string; runtime: Runtime; file: string; line: number; raw: string }[]
  /** Files skipped by the fixture rule or `--exclude` (docs/TASKS.md A10). */
  excludedFiles: number
  /** Files with a YAML/TOML/JSON syntax error: read as far as possible and reported, never silent. */
  diagnostics: Diagnostic[]
  /** Resolves `lts/*` style aliases on `date`, for explaining them in the report. */
  resolveAlias: AliasResolver
}

const RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 }

/** True when at least one finding is at or above `failOn` (the CLI's exit code 1 rule). */
export function failsAt(findings: readonly Finding[], failOn: Severity): boolean {
  return findings.some((f) => RANK[f.severity] <= RANK[failOn])
}

/** Counts of findings per severity. */
export function countBySeverity(findings: readonly Finding[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { error: 0, warning: 0, info: 0 }
  for (const f of findings) counts[f.severity]++
  return counts
}

/** A semver range as people say it: `>=26.0.0 <27.0.0-0` → `26.x`, `>=3.12.0 <3.13.0-0` → `3.12.x`. */
export function humanRange(range: string): string {
  const major = /^>=(\d+)\.0\.0 <(\d+)\.0\.0-0$/.exec(range)
  if (major && Number(major[2]) === Number(major[1]) + 1) return `${major[1]}.x`
  const minor = /^>=(\d+)\.(\d+)\.0 <(\d+)\.(\d+)\.0-0$/.exec(range)
  if (minor && minor[1] === minor[3] && Number(minor[4]) === Number(minor[2]) + 1) return `${minor[1]}.${minor[2]}.x`
  return range
}

/**
 * Why an alias pin compared the way it did: `lts/*` on 2026-11-25 means Node 26.x. Aliases move
 * with new releases, so a pin that agreed last month can conflict today; the note makes that visible.
 */
export function aliasNote(runtime: Runtime, alias: string, date: string, resolve: AliasResolver): string | undefined {
  if (isFloatingAlias(alias)) return undefined
  const range = resolve(runtime, alias)
  if (!range) return undefined
  return `${alias} means ${runtime} ${humanRange(range)} on ${date}, per the bundled release data; it moves when a new line becomes LTS`
}

function scopeLabel(scopes: readonly string[], roots: readonly string[]): string {
  if (scopes.length === 0) return 'not tied to a project'
  if (roots.length > 1 && scopes.length === roots.length) return 'every project root'
  return scopes.map((s) => (s === '.' ? '. (repo root)' : s)).join(', ')
}

function pad(text: string, width: number): string {
  return text.length >= width ? `${text} ` : text + ' '.repeat(width - text.length)
}

/** Sources `bindSources` left UNBOUND (docs/TASKS.md A12), in file order. */
export function unboundSources(sources: readonly Source[]): Source[] {
  return sources
    .filter((s) => s.boundTo !== undefined && s.boundTo.length === 0)
    .sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1))
}

/** The human-readable report. Deterministic for a given input (no colours, no timings). */
export function formatText(report: CheckReport): string {
  const lines: string[] = []
  const counts = countBySeverity(report.findings)
  const pins = report.sources.length
  lines.push(
    `runtime-pin-check: ${pins} pin${pins === 1 ? '' : 's'} in ${report.roots.length} project root${report.roots.length === 1 ? '' : 's'}, ` +
      `checked on ${report.date} (end-of-life data from ${report.dataDate})`,
  )
  lines.push('')

  if (report.findings.length === 0) {
    lines.push(pins === 0 ? 'No Node, Python or Go version pins found.' : 'No problems found.')
  } else {
    const groups = new Map<string, Finding[]>()
    for (const f of report.findings) {
      const key = scopeLabel(f.scopes, report.roots)
      const list = groups.get(key)
      if (list) list.push(f)
      else groups.set(key, [f])
    }
    for (const [label, findings] of groups) {
      lines.push(label)
      for (const f of findings) {
        lines.push(`  ${pad(f.severity, 8)}${pad(f.code, 19)}${f.runtime}`)
        lines.push(`    ${f.message}`)
        const width = Math.max(...f.sources.map((s) => `${s.file}:${s.line}`.length)) + 2
        for (const s of f.sources) {
          lines.push(`      ${pad(`${s.file}:${s.line}`, width)}${s.raw}`)
          if (s.constraint.kind === 'alias') {
            const note = aliasNote(f.runtime, s.constraint.alias, report.date, report.resolveAlias)
            if (note) lines.push(`      ${' '.repeat(width)}(${note})`)
          }
        }
      }
      lines.push('')
    }
    if (lines[lines.length - 1] === '') lines.pop()
  }

  const unbound = unboundSources(report.sources)
  if (unbound.length > 0) {
    lines.push('')
    lines.push('Not tied to a project (no working-directory, no root manifest, no path naming a project; compared with nothing):')
    for (const s of unbound) lines.push(`  ${s.runtime} ${s.raw}  ${s.file}:${s.line}`)
  }

  if (report.singleSource.length > 0) {
    lines.push('')
    lines.push('Pinned in one place only (nothing to compare):')
    for (const s of report.singleSource) {
      lines.push(`  ${s.root === '.' ? '. (repo root)' : s.root}  ${s.runtime} ${s.raw}  ${s.file}:${s.line}`)
    }
  }

  if (report.diagnostics.length > 0) {
    lines.push('')
    lines.push('Could not fully read (syntax errors; they do not change the exit code):')
    for (const d of report.diagnostics) lines.push(`  ${d.file}:${d.line}${d.column === undefined ? '' : `:${d.column}`}  ${d.message}`)
  }

  lines.push('')
  lines.push(`${counts.error} error${counts.error === 1 ? '' : 's'}, ${counts.warning} warning${counts.warning === 1 ? '' : 's'}, ${counts.info} info`)
  if (report.excludedFiles > 0) {
    const n = report.excludedFiles
    lines.push(`${n} file${n === 1 ? '' : 's'} skipped by exclusion (fixture folders and --exclude; --include-fixtures scans fixtures)`)
  }
  return `${lines.join('\n')}\n`
}

/** The `--json` document. Stable field names; `schema` changes only on a breaking change. */
export function formatJson(report: CheckReport): string {
  const counts = countBySeverity(report.findings)
  const doc = {
    schema: 1,
    directory: report.directory,
    date: report.date,
    eolDataDate: report.dataDate,
    roots: report.roots,
    summary: {
      ...counts,
      sources: report.sources.length,
      excludedFiles: report.excludedFiles,
      singleSource: report.singleSource,
      unbound: unboundSources(report.sources).map((s) => ({ runtime: s.runtime, file: s.file, line: s.line, raw: s.raw })),
      unreadable: report.diagnostics.length,
    },
    diagnostics: report.diagnostics,
    findings: report.findings.map((f) => ({
      ...f,
      sources: f.sources.map((s) => {
        const note = s.constraint.kind === 'alias' ? aliasNote(f.runtime, s.constraint.alias, report.date, report.resolveAlias) : undefined
        return note ? { ...s, note } : s
      }),
    })),
    sources: report.sources.map((s) => ({ ...s, constraintText: describeConstraint(s.constraint) })),
  }
  return `${JSON.stringify(doc, null, 2)}\n`
}

/** Escapes text for a workflow command message (GitHub's rules for `%`, CR and LF). */
function escapeData(text: string): string {
  return text.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
}

/** Escapes a workflow command property value (also `:` and `,`). */
function escapeProperty(text: string): string {
  return escapeData(text).replace(/:/g, '%3A').replace(/,/g, '%2C')
}

const COMMAND: Record<Severity, string> = { error: 'error', warning: 'warning', info: 'notice' }

/**
 * GitHub Actions annotations, one per finding, placed on its first source:
 * `::error file=.nvmrc,line=1,title=OUTSIDE_RANGE::…`. Info findings become `::notice`.
 *
 * @param pathOf - Maps a repo-relative path to the path GitHub expects (relative to the workspace).
 */
export function formatAnnotations(findings: readonly Finding[], pathOf: (file: string) => string = (f) => f): string {
  const lines = findings.map((f) => {
    const first = f.sources[0]
    const props = first ? `file=${escapeProperty(pathOf(first.file))},line=${first.line},title=${escapeProperty(f.code)}` : `title=${escapeProperty(f.code)}`
    return `::${COMMAND[f.severity]} ${props}::${escapeData(f.message)}`
  })
  return lines.length > 0 ? `${lines.join('\n')}\n` : ''
}

/**
 * One `::warning` per file that could not be fully read, on the line of its syntax error:
 * `::warning file=.github/workflows/ci.yml,line=12,col=5,title=UNREADABLE_FILE::YAML syntax error: …`.
 */
export function formatDiagnosticAnnotations(diagnostics: readonly Diagnostic[], pathOf: (file: string) => string = (f) => f): string {
  const lines = diagnostics.map((d) => {
    const col = d.column === undefined ? '' : `,col=${d.column}`
    return `::warning file=${escapeProperty(pathOf(d.file))},line=${d.line}${col},title=UNREADABLE_FILE::${escapeData(d.message)}`
  })
  return lines.length > 0 ? `${lines.join('\n')}\n` : ''
}
