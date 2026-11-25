/**
 * Shared shapes of runtime-pin-check (docs/TASKS.md, Domain model). Extractors build `Source`s,
 * `compare.ts` turns them into `Finding`s. Changes here need a ruling: other tasks build on them.
 */

/** The runtimes this tool compares. */
export type Runtime = 'node' | 'python' | 'go'

/** How serious a finding is. */
export type Severity = 'error' | 'warning' | 'info'

/**
 * A pinned version, normalised from the raw text of a source.
 * - `exact`: one release, e.g. `22.11.0`.
 * - `partial`: a version prefix, e.g. `22` or `22.11`: any release with that prefix.
 * - `range`: a semver range, e.g. `>=20 <23` or `^22`, already converted to semver syntax.
 * - `alias`: a name resolved elsewhere, e.g. `lts/*`, `lts/iron`, `latest`, `node`, `stable`.
 * - `unknown`: text the parser could not interpret; it yields an UNPARSEABLE finding.
 */
export type Constraint =
  | { kind: 'exact'; version: string }
  | { kind: 'partial'; version: string }
  | { kind: 'range'; range: string }
  | { kind: 'alias'; alias: string }
  | { kind: 'unknown'; reason: string }

export type ConstraintKind = Constraint['kind']

/** One place in the repo that pins a runtime version. */
export interface Source {
  runtime: Runtime
  /** Path relative to the scanned directory, with '/' separators (e.g. `packages/a/.nvmrc`). */
  file: string
  /** 1-based line of the value. */
  line: number
  /** 1-based column of the value, when the extractor knows it. */
  column?: number
  /** The value exactly as written in the file (e.g. `v22`, `>=20 <23`, `22-alpine`). */
  raw: string
  /** Extractor id, e.g. `nvmrc`, `engines`, `dockerfile`, `setup-node`. */
  kind: string
  constraint: Constraint
  /**
   * A CI matrix entry: a deliberate multi-version test. Compared only against range sources,
   * never against other pins (docs/TASKS.md, Extractors).
   */
  matrix?: boolean
  /**
   * For a CI step that sets `working-directory`: the project root it applies to (relative path,
   * `.` for the repo root). Without it, a root-level CI/tool file applies to every project root.
   */
  workingDirectory?: string
  /**
   * Repo-relative paths that the same CI step or job names (`cache-dependency-path`,
   * `node-version-file`, `python-version-file`, `go-version-file`, the `working-directory` of the
   * job's steps). Set by extractors; used to bind a root CI source to the sub-projects it builds
   * (docs/TASKS.md A12).
   */
  paths?: string[]
  /**
   * Project roots this source belongs to, as decided by `bindSources` (docs/TASKS.md A12).
   * `[]` means UNBOUND: not tied to any project, so it is never compared with other pins.
   * Absent until `bindSources` runs.
   */
  boundTo?: string[]
}

/**
 * A file the tool could not (fully) read: a YAML, TOML or JSON syntax error. Not a finding: a broken
 * file has no runtime to compare. Reported in `--json` (`diagnostics`), in the text report and as a
 * GitHub `::warning`; it never changes the exit code (docs/TASKS.md constraint 9: no silent skips).
 */
export interface Diagnostic {
  /** Repo-relative path with `/` separators. */
  file: string
  /** 1-based line of the error. */
  line: number
  /** 1-based column of the error, when the parser knows it. */
  column?: number
  /** English explanation including what was and was not read. */
  message: string
}

/** Stable machine codes of every finding. */
export type FindingCode =
  | 'VERSION_CONFLICT'
  | 'OUTSIDE_RANGE'
  | 'PRECISION_MISMATCH'
  | 'EOL_RUNTIME'
  | 'EOL_SOON'
  | 'FLOATING_ALIAS'
  | 'UNPARSEABLE'

/** A source as cited by a finding. */
export interface SourceRef {
  file: string
  line: number
  raw: string
  constraint: Constraint
}

/** One problem, with every source involved. */
export interface Finding {
  code: FindingCode
  severity: Severity
  runtime: Runtime
  /** Every source involved, in a stable order (file, then line). */
  sources: SourceRef[]
  /** Project roots (relative paths, `.` = repo root) where this finding applies. */
  scopes: string[]
  /** English explanation naming the files and lines. */
  message: string
}

/**
 * Resolves an alias such as `lts/iron` or `lts/*` to a semver range, or returns undefined when it
 * cannot. Supplied by the EOL snapshot (rpc-eol); comparison works without it.
 */
export type AliasResolver = (runtime: Runtime, alias: string) => string | undefined

/** Options of `compareSources`. */
export interface CompareOptions {
  resolveAlias?: AliasResolver
}

/** The sources of one runtime in one project root, as `compareSources` grouped them. */
export interface Scope {
  root: string
  runtime: Runtime
  sources: Source[]
}
