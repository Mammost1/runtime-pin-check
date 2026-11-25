/**
 * Runtime-parameterised adapters from the shared format parsers (src/extract/shared) to `Source`s.
 * Used by the python and go extractors; the version meaning stays in `parseConstraint` /
 * `dockerTagConstraint`. Everything here is pure and never throws (docs/TASKS.md A8).
 */
import { dockerTagConstraint, parseConstraint } from '../../constraint'
import type { Constraint, Runtime, Source } from '../../types'
import {
  parseDockerfile,
  parseMise,
  parseToolVersions,
  isRuntimeImage,
  parseWorkflow,
  splitImageRef,
  workflowSourcePaths,
} from '../shared'
import type { WorkflowInput, WorkflowStep } from '../shared'

/** The last path segment of a repo-relative file path. */
export function baseName(file: string): string {
  return file.slice(file.lastIndexOf('/') + 1)
}

/** `Dockerfile`, `Dockerfile.dev`, `app.Dockerfile`, `dev.dockerfile` (any case). */
export function isDockerfile(file: string): boolean {
  return /^(.+\.)?dockerfile(\..+)?$/i.test(baseName(file))
}

/**
 * `.github/workflows/*.yml|yaml`, composite actions under `.github/workflows/<dir>/action.yml` and
 * `.github/actions/**\/action.yml`, at the repo root, in any letter case.
 */
export function isWorkflowFile(file: string): boolean {
  return /^\.github\/(workflows\/([^/]+|.+\/action)|actions\/.+\/action)\.ya?ml$/i.test(file)
}

/** `mise.toml`, `.mise.toml`, `mise.local.toml`, `.mise.<env>.toml`, `.config/mise.toml`, `.config/mise/config.toml`. */
export function isMiseFile(file: string): boolean {
  if (/^\.?mise(\..+)?\.toml$/i.test(baseName(file))) return true
  return /(^|\/)\.config\/mise(\/config(\..+)?)?\.toml$/i.test(file) || /(^|\/)\.config\/mise\/config(\..+)?\.toml$/i.test(file)
}

/** True for the file `.tool-versions`. */
export function isToolVersions(file: string): boolean {
  return baseName(file) === '.tool-versions'
}

/** A value read as text: what the YAML number rule does to an unquoted `3.10` or `1.20`. */
export function yamlNumberPitfall(text: string, quoted: boolean): string | undefined {
  if (quoted) return undefined
  if (/^\d+\.\d*0$/.test(text)) {
    const read = String(Number(text))
    return `unquoted ${text} is read by YAML as the number ${read}; write it in quotes ('${text}')`
  }
  return undefined
}

/** Builds a constraint, turning the unquoted-number pitfall into an `unknown` with a clear reason. */
export function ciConstraint(text: string, quoted: boolean, runtime: Runtime): Constraint {
  const pitfall = yamlNumberPitfall(text, quoted)
  return pitfall ? { kind: 'unknown', reason: pitfall } : parseConstraint(text, runtime)
}

/** Takes `.` or a clean relative directory; anything else (absolute, expression) is undefined. */
export function cleanDirectory(dir: string): string | undefined {
  const d = dir.trim().replace(/^\.\//, '').replace(/\/+$/, '')
  if (d === '' || d === '.') return '.'
  if (d.startsWith('/') || d.includes('${{') || d.includes('..')) return undefined
  return d
}

// ---------- Dockerfile ----------

/** A tag gives the version; a digest with no tag is immutable but names no version, so it is not `latest`. */
function dockerConstraint(tag: string | undefined, digest: string | undefined, runtime: Runtime): Constraint {
  if (tag === undefined && digest !== undefined) {
    return { kind: 'unknown', reason: 'image is pinned by digest only, so its version cannot be read' }
  }
  return dockerTagConstraint(tag, runtime)
}

/**
 * Sources for every `FROM <image>` that is the runtime's official image or a well-known mirror
 * (docs/TASKS.md A12). Other images, even ones named `.../python`, are not runtime pins.
 */
export function dockerfileSources(file: string, text: string, runtime: Runtime): Source[] {
  const out: Source[] = []
  for (const from of parseDockerfile(text)) {
    if (!isRuntimeImage(from.image, runtime)) continue
    const written = splitImageRef(from.raw)
    const raw = written.tag ?? from.raw
    const tagOffset = written.tag === undefined ? 0 : written.image.length + 1
    out.push({
      runtime,
      file,
      line: from.line,
      column: from.column + tagOffset,
      raw,
      kind: 'dockerfile',
      constraint: dockerConstraint(from.tag, from.digest, runtime),
    })
  }
  return out
}

// ---------- .tool-versions and mise ----------

/** The first version of each `.tool-versions` line whose tool is one of `tools` (asdf uses the first). */
export function toolVersionsSources(file: string, text: string, runtime: Runtime, tools: readonly string[]): Source[] {
  const out: Source[] = []
  const lines = text.split(/\r?\n/)
  for (const entry of parseToolVersions(text)) {
    if (!tools.includes(entry.tool)) continue
    const raw = entry.versions[0]
    const source: Source = {
      runtime,
      file,
      line: entry.line,
      raw: raw ?? '',
      kind: 'tool-versions',
      constraint: raw === undefined ? { kind: 'unknown', reason: 'no version after the tool name' } : parseConstraint(raw, runtime),
    }
    // The version starts after the tool name; searching from there keeps `go 1.22` from matching inside the name.
    const lineText = lines[entry.line - 1] ?? ''
    const toolEnd = lineText.indexOf(entry.tool) + entry.tool.length
    const at = raw === undefined ? -1 : lineText.indexOf(raw, toolEnd)
    if (at >= 0) source.column = at + 1
    out.push(source)
  }
  return out
}

/**
 * Where the first version's text sits: `parseMise` reports the value token (a quote, `[` or `{`),
 * but `--fix` needs the version text itself. Looks on the key's line, then on the next few lines
 * (an array may continue below its key). Returns the original position when the text is not found.
 */
function miseRawPosition(lines: readonly string[], line: number, column: number | undefined, raw: string): { line: number; column?: number } {
  for (let k = 0; k < 20 && line - 1 + k < lines.length; k++) {
    const text = lines[line - 1 + k] as string
    const from = k === 0 && column !== undefined ? column - 1 : 0
    let rest = text.slice(from)
    let offset = from
    if (k === 0 && rest.startsWith('{')) {
      const m = /version\s*=\s*["']?/.exec(rest)
      if (m) {
        offset += m.index + m[0].length
        rest = text.slice(offset)
      }
    }
    const at = rest.indexOf(raw)
    if (at >= 0) return { line: line + k, column: offset + at + 1 }
  }
  return column === undefined ? { line } : { line, column }
}

/** The first version of each mise `[tools]` entry whose tool is one of `tools`. */
export function miseSources(file: string, text: string, runtime: Runtime, tools: readonly string[]): Source[] {
  const out: Source[] = []
  const lines = text.split(/\r?\n/)
  for (const entry of parseMise(text)) {
    if (!tools.includes(entry.tool)) continue
    const raw = entry.versions[0]
    const where = raw === undefined ? miseRawPosition([], entry.line, entry.column, '') : miseRawPosition(lines, entry.line, entry.column, raw)
    const source: Source = {
      runtime,
      file,
      line: where.line,
      raw: raw ?? '',
      kind: 'mise',
      constraint: raw === undefined ? { kind: 'unknown', reason: 'no version in the mise tool entry' } : parseConstraint(raw, runtime),
    }
    if (where.column !== undefined) source.column = where.column
    out.push(source)
  }
  return out
}

// ---------- GitHub workflows ----------

/**
 * The directory a step's `uses:` applies to: its own `working-directory` or the workflow's / job's
 * `defaults.run.working-directory`. Nothing is inferred from the `run:` steps of the same job: a run
 * step without `working-directory` works in the repo root, which the shared parser does not report,
 * so inferring would narrow the scope and hide a real conflict (docs/TASKS.md, review F1).
 */
function stepDirectory(step: WorkflowStep): string | undefined {
  return step.workingDirectory === undefined ? undefined : cleanDirectory(step.workingDirectory)
}

function inputSources(step: WorkflowStep, input: WorkflowInput, file: string, runtime: Runtime, kind: string, dir: string | undefined): Source[] {
  const base = { runtime, file, kind } as const
  const paths = workflowSourcePaths(step)
  const withDir = (s: Source): Source => {
    if (dir !== undefined) s.workingDirectory = dir
    if (paths.length > 0) s.paths = paths
    return s
  }
  const resolved = input.resolved
  if (resolved) {
    return resolved.values.map((value, i) =>
      withDir({
        ...base,
        line: resolved.lines[i] as number,
        column: resolved.columns[i] as number,
        raw: value,
        constraint: ciConstraint(value, resolved.quoted[i] as boolean, runtime),
        matrix: true,
      }),
    )
  }
  if (input.env) {
    // `${{ env.X }}` defined in an `env:` of the step, job or workflow: the constraint is the env value, the
    // source still points at the `with:` input as written.
    return [withDir({ ...base, line: input.line, column: input.column, raw: input.value, constraint: ciConstraint(input.env.value, input.env.quoted, runtime) })]
  }
  if (/^\$\{\{/.test(input.value) || (input.value.includes('${{') && !input.quoted)) {
    return [withDir({ ...base, line: input.line, column: input.column, raw: input.value, constraint: { kind: 'unknown', reason: 'value is a workflow expression that cannot be read statically' } })]
  }
  if (!input.quoted && input.value.includes('\n')) {
    // A block scalar listing several versions, one per line (the content starts on the line after `|`).
    return input.value
      .split('\n')
      .map((v, i) => ({ v: v.trim(), i }))
      .filter(({ v }) => v !== '')
      .map(({ v, i }) => withDir({ ...base, line: input.line + 1 + i, raw: v, constraint: parseConstraint(v, runtime) }))
  }
  return [withDir({ ...base, line: input.line, column: input.column, raw: input.value, constraint: ciConstraint(input.value, input.quoted, runtime) })]
}

/**
 * Sources of every `uses: <action>` step for the given action (`actions/setup-python`) from its
 * version input (`python-version`). A `*-version-file` input is a reference, not a pin, and gives
 * nothing. Matrix values become one source each with `matrix: true`.
 */
export function workflowSources(file: string, text: string, runtime: Runtime, action: string, input: string): Source[] {
  const out: Source[] = []
  const name = action.toLowerCase()
  for (const step of parseWorkflow(text)) {
    const used = step.uses.toLowerCase()
    if (used !== name && !used.startsWith(`${name}@`)) continue
    const value = step.with[input]
    if (!value) continue
    out.push(...inputSources(step, value, file, runtime, action.slice(action.lastIndexOf('/') + 1), stepDirectory(step)))
  }
  // Block-scalar versions (`|`, `>-`, `|2`, one per line or just one) are on the lines after the header
  // line the parser reports; move such a source to its own line and column, or leave it without one.
  const lines = text.split(/\r?\n/)
  for (const source of out) {
    if (source.raw === '') continue
    if (source.column !== undefined && lines[source.line - 1]?.startsWith(source.raw, source.column - 1)) continue
    delete source.column
    const own = lines[source.line - 1] ?? ''
    if (own.trim() === source.raw) {
      // A version listed alone on its line (one per line in a block scalar).
      source.column = own.indexOf(source.raw) + 1
      continue
    }
    const header = lines[source.line - 1] ?? ''
    if (/[|>][+-]?\d*\s*(#.*)?$/.test(header)) {
      for (let k = 1; k <= 20; k++) {
        const below = lines[source.line - 1 + k]
        if (below === undefined) break
        if (below.trim() === source.raw) {
          source.line += k
          source.column = below.indexOf(source.raw) + 1
          break
        }
      }
    }
  }
  return out
}

/**
 * Final guard for every extractor: a `column` is kept only when the text at that column on that line
 * really is `raw`. A wrong byte offset would let `--fix` edit the wrong bytes, so when the position
 * cannot be vouched for (a value split over several lines, a folded or escaped string) it is dropped.
 */
export function guardColumns(text: string, sources: Source[]): Source[] {
  const lines = text.split(/\r?\n/)
  for (const source of sources) {
    if (source.column === undefined) continue
    if (!(lines[source.line - 1] ?? '').startsWith(source.raw, source.column - 1)) delete source.column
  }
  return sources
}
