/**
 * GitHub workflow (and composite action) parser: every step that has `uses:`, with its `with:`
 * inputs, the `working-directory` that applies, and the job's matrix; `${{ matrix.x }}` inputs are
 * resolved to the matrix values with their own line numbers (docs/TASKS.md A8). Pure; never throws.
 */
import { entries, getPair, isMap, isScalar, items, loadYamlAll, resolveNode, scalarText } from './yaml-util'
import type { Yaml } from './yaml-util'

/** The values of one matrix key, in document order, each with its position. */
export interface MatrixEntry {
  /** Each value as written (`'3.10'` and `3.10` both give `3.10`; see `quoted`). */
  values: string[]
  /** 1-based line and column of each value, parallel to `values`. */
  lines: number[]
  columns: number[]
  /** True per value when it was written in quotes. An unquoted `3.10` is the number 3.1 to YAML. */
  quoted: boolean[]
  /** 1-based line of the matrix key. */
  line: number
  /** Set when the key's value is an expression (`${{ fromJSON(…) }}`) that cannot be read statically. */
  expression?: string
}

/** One `with:` input of a step. */
export interface WorkflowInput {
  /** The value as written (`20`, `'3.10'`, `${{ matrix.node }}`). */
  value: string
  line: number
  column: number
  /** True when written in quotes. */
  quoted: boolean
  /** Set when the whole value is `${{ matrix.<key> }}` and that key exists in the job's matrix. */
  matrixKey?: string
  /** The matrix values `${{ matrix.<key> }}` stands for. Present exactly when `matrixKey` is. */
  resolved?: MatrixEntry
  /**
   * Set when the whole value is `${{ env.<NAME> }}` and `NAME` is defined as a plain value in the
   * `env:` of the same step, job or workflow (searched in that order). `value`, `line` and `column`
   * still describe the `with:` input as written; `env` is where the version really comes from.
   * An env value that is itself an expression is not resolved.
   */
  env?: { name: string; value: string; quoted: boolean; line: number; column: number }
}

/** One step that has `uses:`. */
export interface WorkflowStep {
  /** The `uses:` value as written (`actions/setup-node@v4`). */
  uses: string
  /** 1-based line and column of the `uses:` value. */
  line: number
  column: number
  /** Job name (`''` for the steps of a composite action). */
  job: string
  with: Record<string, WorkflowInput>
  /** The job's matrix (keys of `strategy.matrix`, plus keys that only appear under `include`). */
  matrix: Record<string, MatrixEntry>
  /** The step's `working-directory`, or the job's / workflow's `defaults.run.working-directory`. */
  workingDirectory?: string
  /**
   * Every distinct `working-directory` set anywhere in the same job (on `run:` steps or in
   * `defaults.run`), in order. A `uses:` step such as `setup-node` has none of its own, but its job
   * usually works in one project directory; the runtime module decides whether that applies.
   */
  jobWorkingDirectories: string[]
  /**
   * Repo-relative paths this step names (docs/TASKS.md A13): `cache-dependency-path`, `node-version-file`,
   * `python-version-file`, `go-version-file`, and its own `working-directory`. Cleaned by `cleanWorkflowPath`;
   * entries that are expressions, negations, absolute or `..` paths are left out; globs are kept as written.
   */
  paths: string[]
}

const PATH_INPUTS = ['cache-dependency-path', 'node-version-file', 'python-version-file', 'go-version-file', 'working-directory']

/**
 * A path written in a workflow as a repo-relative path: leading `./` and trailing `/` removed. A glob
 * (`*`, `?`, `[`, `{`) is kept exactly as written: it does not name one directory, and cutting it to a
 * prefix would invent one (`apps/*\/x` is not `apps`), so the binding (docs/TASKS.md A14) ignores glob
 * entries itself. A negation (`!x`), an expression (`${{ }}`), an absolute path or a `..` path gives
 * undefined. `.` stays `.` (the repo root).
 */
export function cleanWorkflowPath(raw: string): string | undefined {
  let p = raw.trim().replace(/^["']|["']$/g, '')
  if (p === '' || p.startsWith('!') || p.startsWith('/') || p.includes('${{') || p.split('/').includes('..')) return undefined
  p = p.replace(/^(\.\/)+/, '')
  const segments = p.split('/').filter((x) => x !== '' && x !== '.')
  return segments.length === 0 ? '.' : segments.join('/')
}

const ENV_REF = /^\$\{\{\s*env\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}$/
const MATRIX_REF = /^\$\{\{\s*matrix\.([A-Za-z0-9_-]+)\s*\}\}$/

function readMatrix(y: Yaml, matrixNode: unknown): Record<string, MatrixEntry> {
  const out: Record<string, MatrixEntry> = {}
  const add = (key: string, line: number, node: unknown): void => {
    const target = (out[key] ??= { values: [], lines: [], columns: [], quoted: [], line })
    const one = scalarText(y, node)
    const list = one ? [one] : items(y, node).map((n) => scalarText(y, n)).filter((s): s is NonNullable<typeof s> => s !== undefined)
    if (one && /^\$\{\{/.test(one.text)) {
      target.expression = one.text
      return
    }
    for (const v of list) {
      if (target.values.includes(v.text)) continue
      target.values.push(v.text)
      target.lines.push(v.line)
      target.columns.push(v.column)
      target.quoted.push(v.quoted)
    }
  }
  for (const { key, value, line } of entries(y, matrixNode)) {
    if (key === 'exclude') continue
    if (key === 'include') {
      for (const inc of items(y, value)) for (const e of entries(y, inc)) add(e.key, e.line, e.value)
      continue
    }
    add(key, line, value)
  }
  return out
}

/** The plain value of `name` in an `env:` map, or undefined (also for an expression value). */
function envValue(y: Yaml, envNode: unknown, name: string): { value: string; quoted: boolean; line: number; column: number } | undefined {
  const found = entries(y, envNode).find((e) => e.key === name)
  const v = found ? scalarText(y, found.value) : undefined
  if (!v || v.text === '' || v.text.includes('${{')) return undefined
  return { value: v.text, quoted: v.quoted, line: v.line, column: v.column }
}

function stepsOf(y: Yaml, job: string, node: unknown, matrix: Record<string, MatrixEntry>, inherited: string | undefined, out: WorkflowStep[], jobEnv?: unknown, workflowEnv?: unknown): void {
  const list = items(y, getPair(y, node, 'steps')?.value ?? node)
  const dirs: string[] = inherited === undefined ? [] : [inherited]
  for (const step of list) {
    const d = scalarText(y, getPair(y, step, 'working-directory')?.value)?.text
    if (d !== undefined && !dirs.includes(d)) dirs.push(d)
  }
  for (const step of list) {
    const uses = scalarText(y, getPair(y, step, 'uses')?.value)
    if (!uses || uses.text === '') continue
    const inputs: Record<string, WorkflowInput> = {}
    for (const { key, value } of entries(y, getPair(y, step, 'with')?.value)) {
      const v = scalarText(y, value)
      if (!v) continue
      const input: WorkflowInput = { value: v.text, line: v.line, column: v.column, quoted: v.quoted }
      const ref = MATRIX_REF.exec(v.text)
      const hit = ref ? matrix[ref[1] as string] : undefined
      if (ref && hit && hit.values.length > 0) {
        input.matrixKey = ref[1] as string
        input.resolved = hit
      }
      const envRef = ENV_REF.exec(v.text)
      if (envRef) {
        const name = envRef[1] as string
        const hitEnv = envValue(y, getPair(y, step, 'env')?.value, name) ?? envValue(y, jobEnv, name) ?? envValue(y, workflowEnv, name)
        if (hitEnv) input.env = { name, ...hitEnv }
      }
      inputs[key] = input
    }
    const own = scalarText(y, getPair(y, step, 'working-directory')?.value)
    const wd = own?.text ?? scalarText(y, getPair(y, step, 'with')?.value && getPair(y, getPair(y, step, 'with')?.value, 'working-directory')?.value)?.text ?? inherited
    const paths: string[] = []
    for (const [key, input] of Object.entries(inputs)) {
      if (!PATH_INPUTS.includes(key)) continue
      for (const piece of input.value.split(/\r?\n/)) {
        const cleaned = cleanWorkflowPath(piece)
        if (cleaned !== undefined && !paths.includes(cleaned)) paths.push(cleaned)
      }
    }
    const ownDir = own?.text === undefined ? undefined : cleanWorkflowPath(own.text)
    if (ownDir !== undefined && !paths.includes(ownDir)) paths.push(ownDir)
    const entry: WorkflowStep = { uses: uses.text, line: uses.line, column: uses.column, job, with: inputs, matrix, jobWorkingDirectories: dirs, paths }
    if (wd !== undefined) entry.workingDirectory = wd
    out.push(entry)
  }
}

function defaultsWd(y: Yaml, node: unknown): string | undefined {
  return scalarText(y, getPair(y, getPair(y, getPair(y, node, 'defaults')?.value, 'run')?.value, 'working-directory')?.value)?.text
}

/**
 * Lists every `uses:` step of a workflow (`jobs.*.steps`) or composite action (`runs.steps`).
 * Reusable-workflow jobs (`jobs.x.uses`) are not steps and are skipped.
 */
export function parseWorkflow(text: string): WorkflowStep[] {
  try {
    // A multi-document stream is valid YAML: every document is read.
    return (loadYamlAll(text) ?? []).flatMap((y) => parseWorkflowDocument(y))
  } catch {
    return []
  }
}

function parseWorkflowDocument(y: Yaml): WorkflowStep[] {
  try {
    const root = resolveNode(y, y.doc.contents)
    if (!isMap(root)) return []
    const out: WorkflowStep[] = []
    const topWd = defaultsWd(y, root)
    const topEnv = getPair(y, root, 'env')?.value
    for (const { key, value } of entries(y, getPair(y, root, 'jobs')?.value)) {
      const matrixNode = getPair(y, getPair(y, value, 'strategy')?.value, 'matrix')?.value
      const matrix = isScalar(resolveNode(y, matrixNode)) ? {} : readMatrix(y, matrixNode)
      stepsOf(y, key, getPair(y, value, 'steps')?.value, matrix, defaultsWd(y, value) ?? topWd, out, getPair(y, value, 'env')?.value, topEnv)
    }
    const composite = getPair(y, getPair(y, root, 'runs')?.value, 'steps')?.value
    if (composite) stepsOf(y, '', composite, {}, undefined, out)
    return out
  } catch {
    return []
  }
}

/**
 * The paths a workflow step is tied to (docs/TASKS.md A13): the step's own (`paths`) plus the
 * `working-directory` values used anywhere in its job, cleaned and without duplicates. Used to bind a
 * root CI source to the sub-projects it builds; empty when the step names no path.
 */
export function workflowSourcePaths(step: WorkflowStep): string[] {
  const out = [...step.paths]
  for (const dir of step.jobWorkingDirectories) {
    const cleaned = cleanWorkflowPath(dir)
    if (cleaned !== undefined && !out.includes(cleaned)) out.push(cleaned)
  }
  return out
}
