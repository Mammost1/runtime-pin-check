/**
 * Per-scope comparison (docs/TASKS.md, Domain model and Finding codes). Sources are grouped by
 * project root and runtime; within a group every pair of pins is checked for overlap.
 * EOL findings are not produced here (rpc-eol adds them).
 */
import semver from 'semver'
import { describeConstraint, isFloatingAlias, toRange } from './constraint'
import type { CompareOptions, Finding, FindingCode, Runtime, Scope, Severity, Source, SourceRef } from './types'

const MANIFESTS = new Set(['package.json', 'pyproject.toml', 'go.mod'])

function dirOf(file: string): string {
  const i = file.lastIndexOf('/')
  return i < 0 ? '.' : file.slice(0, i)
}

function baseOf(file: string): string {
  return file.slice(file.lastIndexOf('/') + 1)
}

function normalizeDir(dir: string): string {
  const d = dir.replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+$/, '')
  return d === '' ? '.' : d
}

/**
 * True for a repo-level CI or tool file that applies to every project root: anything under
 * `.github/` (any letter case: `.GitHub/` exists in the wild), `.gitlab-ci.yml`, and root-level
 * version files (`.nvmrc`, `.tool-versions`, `mise.toml` …). Root manifests and Dockerfiles belong
 * to the repo-root project only.
 */
export function isSharedFile(file: string): boolean {
  const f = file.replace(/\\/g, '/')
  if (/^\.github\//i.test(f)) return true
  if (f.includes('/')) return false
  const base = baseOf(f)
  if (MANIFESTS.has(base)) return false
  if (/^dockerfile/i.test(base) || /\.dockerfile$/i.test(base)) return false
  return true
}

/** The deepest project root that contains `dir` (`.` when none does). */
function deepestRoot(dir: string, roots: readonly string[]): string {
  let best = '.'
  for (const r of roots) {
    if (r === '.') continue
    if ((dir === r || dir.startsWith(`${r}/`)) && r.length > best.length) best = r
  }
  return best
}

/**
 * The project roots a source applies to. After `bindSources` this is `source.boundTo` (`[]` for an
 * UNBOUND source). Without binding it falls back to the pre-A12 rule: the deepest containing root,
 * or every root for a shared CI/tool file (only the `workingDirectory` root when a step sets one).
 *
 * @param roots - Project roots from `findProjectRoots` (relative, `.` = repo root).
 */
export function scopesOf(source: Source, roots: readonly string[]): string[] {
  if (source.boundTo !== undefined) return [...source.boundTo]
  const all = roots.length > 0 ? [...roots] : ['.']
  if (isSharedFile(source.file)) {
    if (source.workingDirectory === undefined) return all
    return [deepestRoot(normalizeDir(source.workingDirectory), all)]
  }
  return [deepestRoot(dirOf(source.file.replace(/\\/g, '/')), all)]
}

/** Tool pin files that version managers look up from the working directory upwards. */
function toolPinKind(file: string): string | undefined {
  const base = baseOf(file)
  if (base === '.nvmrc' || base === '.node-version' || base === '.python-version' || base === '.tool-versions') return base
  if (/^\.?mise(\.[\w-]+)?\.toml$/i.test(base)) return 'mise'
  return undefined
}

/** CI files at the repo root: `.github/**` (any letter case) and `.gitlab-ci.yml`. */
function isRootCiFile(file: string): boolean {
  return /^\.github\//i.test(file) || /^\.gitlab-ci\.ya?ml$/i.test(file)
}

/** A Dockerfile (`Dockerfile`, `Dockerfile.dev`, `api.Dockerfile`) or a Compose file, in any folder. */
function isContainerFile(file: string): boolean {
  const base = baseOf(file)
  return /^dockerfile/i.test(base) || /\.dockerfile$/i.test(base) || /^(docker-)?compose(\.[\w-]+)*\.ya?ml$/i.test(base)
}

/** Paths written as globs (`**\/package-lock.json`) name no single project (A14): ignored. */
function isGlobPath(path: string): boolean {
  return /[*?[{]/.test(path)
}

/** The parent directories of `dir`, nearest first, up to but not including `stop`. */
function dirsBetween(dir: string, stop: string): string[] {
  const out: string[] = []
  let d = dir
  while (d !== stop && d !== '.') {
    out.push(d)
    const i = d.lastIndexOf('/')
    d = i < 0 ? '.' : d.slice(0, i)
  }
  return out
}

/**
 * Binds every source to the project roots it really belongs to (docs/TASKS.md A12) and returns
 * copies with `boundTo` set. Precision over recall: when the files do not say which project a
 * source serves, it is UNBOUND (`[]`) and is never compared with other pins.
 *
 * - A file inside a project root binds to its nearest enclosing root only.
 * - A tool pin file (`.nvmrc`, `.node-version`, `.python-version`, `.tool-versions`, `mise.toml`)
 *   also binds to every project root below its directory that has no pin file of the same kind
 *   for that runtime on the way down (nvm, pyenv, asdf and mise look upwards).
 * - A root CI setup step (`.github/**`, `.gitlab-ci.yml`), and any Dockerfile or Compose file whose
 *   nearest project root is the repo root (root, `docker/`, `deploy/`, `.devcontainer/` …; A14),
 *   binds to its `workingDirectory` root when set; else to the repo root if the repo root has a
 *   manifest for that runtime (`package.json`, `pyproject.toml`/`setup.py`/`setup.cfg`, `go.mod`);
 *   else to the roots named by `source.paths` (glob paths ignored); else it is UNBOUND.
 *
 * @param roots - Project roots (relative, `.` = repo root).
 * @param manifests - `manifestRuntimesOf(files)`: runtimes whose manifest each directory holds.
 */
export function bindSources(
  sources: readonly Source[],
  roots: readonly string[],
  manifests: ReadonlyMap<string, ReadonlySet<Runtime>>,
): Source[] {
  const all = roots.length > 0 ? [...roots] : ['.']
  const pinDirs = new Set<string>()
  for (const s of sources) {
    const kind = toolPinKind(s.file)
    if (kind) pinDirs.add(`${s.runtime}\u0000${kind}\u0000${dirOf(s.file)}`)
  }
  const bindOne = (s: Source): string[] => {
    const file = s.file.replace(/\\/g, '/')
    const dir = dirOf(file)
    const kind = toolPinKind(file)
    // A12 + A14: root CI, and any Dockerfile/Compose file whose nearest project root is the repo root
    // (docker/, deploy/, .devcontainer/ …), say nothing about which project they serve by location.
    if (isRootCiFile(file) || (!kind && isContainerFile(file) && deepestRoot(dir, all) === '.')) {
      if (s.workingDirectory !== undefined) return [deepestRoot(normalizeDir(s.workingDirectory), all)]
      if (manifests.get('.')?.has(s.runtime)) return ['.']
      const named = (s.paths ?? []).filter((p) => !isGlobPath(p)).map((p) => deepestRoot(normalizeDir(p), all))
      return [...new Set(named)].sort()
    }
    if (kind) {
      const below = all.filter((r) => r === dir || dir === '.' || r.startsWith(`${dir}/`))
      if (below.length === 0) return [deepestRoot(dir, all)]
      return below.filter((r) => !dirsBetween(r, dir).some((d) => pinDirs.has(`${s.runtime}\u0000${kind}\u0000${d}`)))
    }
    return [deepestRoot(dir, all)]
  }
  return sources.map((s) => ({ ...s, boundTo: bindOne(s) }))
}

/** Groups sources by project root and runtime, in a stable order. */
export function groupByScope(sources: readonly Source[], roots: readonly string[]): Scope[] {
  const groups = new Map<string, Scope>()
  for (const source of sources) {
    for (const root of scopesOf(source, roots)) {
      const key = `${root}\u0000${source.runtime}`
      let g = groups.get(key)
      if (!g) groups.set(key, (g = { root, runtime: source.runtime, sources: [] }))
      g.sources.push(source)
    }
  }
  return [...groups.values()].sort((a, b) => (a.root === b.root ? a.runtime.localeCompare(b.runtime) : a.root < b.root ? -1 : 1))
}

function ref(s: Source): SourceRef {
  return { file: s.file, line: s.line, raw: s.raw, constraint: s.constraint }
}

function where(s: Source): string {
  return `${s.file}:${s.line}`
}

function byPosition(a: Source, b: Source): number {
  return a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1
}

const SEVERITY: Record<FindingCode, Severity> = {
  VERSION_CONFLICT: 'error',
  OUTSIDE_RANGE: 'error',
  PRECISION_MISMATCH: 'info',
  EOL_RUNTIME: 'warning',
  EOL_SOON: 'info',
  FLOATING_ALIAS: 'info',
  UNPARSEABLE: 'info',
}

const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 }

/** A source ready for comparison: its range, and whether it is a pin (one version or a prefix). */
interface Comparable {
  source: Source
  range: string
  pin: boolean
}

function comparable(source: Source, options: CompareOptions): Comparable | undefined {
  const c = source.constraint
  if (c.kind === 'alias') {
    if (isFloatingAlias(c.alias)) return undefined
    const range = options.resolveAlias?.(source.runtime, c.alias)
    return range && semver.validRange(range) ? { source, range, pin: true } : undefined
  }
  const range = toRange(c)
  if (range === undefined) return undefined
  return { source, range, pin: c.kind === 'exact' || c.kind === 'partial' }
}

function overlaps(a: string, b: string): boolean {
  try {
    return semver.intersects(a, b)
  } catch {
    // Both ranges were validated; treat a library failure as "no evidence of a conflict".
    return true
  }
}

function pinText(s: Source): string {
  return `${s.runtime} ${describeConstraint(s.constraint)}`
}

class Collector {
  private readonly found = new Map<string, Finding>()

  /** `scope` undefined = an UNBOUND source: the finding gets no scope. */
  add(code: FindingCode, runtime: Runtime, sources: Source[], scope: string | undefined, message: string): void {
    const ordered = [...sources].sort(byPosition)
    const key = `${code}\u0000${runtime}\u0000${ordered.map((s) => `${where(s)}\u0000${s.raw}`).join('\u0001')}`
    const existing = this.found.get(key)
    if (existing) {
      if (scope !== undefined && !existing.scopes.includes(scope)) existing.scopes.push(scope)
      return
    }
    this.found.set(key, { code, severity: SEVERITY[code], runtime, sources: ordered.map(ref), scopes: scope === undefined ? [] : [scope], message })
  }

  findings(): Finding[] {
    const list = [...this.found.values()]
    for (const f of list) f.scopes.sort()
    return list.sort(
      (a, b) =>
        SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
        (a.sources[0]?.file ?? '').localeCompare(b.sources[0]?.file ?? '') ||
        (a.sources[0]?.line ?? 0) - (b.sources[0]?.line ?? 0) ||
        a.code.localeCompare(b.code),
    )
  }
}

function outsideRange(out: Collector, scope: Scope, pin: Comparable, range: Comparable): void {
  if (overlaps(pin.range, range.range)) return
  out.add(
    'OUTSIDE_RANGE',
    scope.runtime,
    [pin.source, range.source],
    scope.root,
    `${where(pin.source)} pins ${pinText(pin.source)}, outside the range ${describeConstraint(range.source.constraint)} required by ${where(range.source)}.`,
  )
}

/** True when some two of the comparables have no version in common. */
function anyDisjoint(list: readonly Comparable[]): boolean {
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) if (!overlaps((list[i] as Comparable).range, (list[j] as Comparable).range)) return true
  }
  return false
}

/** `18 (.nvmrc:1), 22 (Dockerfile:1, Dockerfile:7)`: sources grouped by the version they pin. */
function groupedList(sources: readonly Source[]): { text: string; groups: number; files: number } {
  const groups = new Map<string, Source[]>()
  for (const s of [...sources].sort(byPosition)) {
    const key = describeConstraint(s.constraint)
    const list = groups.get(key)
    if (list) list.push(s)
    else groups.set(key, [s])
  }
  const text = [...groups].map(([version, list]) => `${version} (${list.map(where).join(', ')})`).join(', ')
  return { text, groups: groups.size, files: new Set(sources.map((s) => s.file)).size }
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

/**
 * One VERSION_CONFLICT for the scope (docs/TASKS.md A10): every pin when two pins cannot both hold,
 * plus every range source when two ranges have nothing in common, grouped by version.
 */
function versionConflict(out: Collector, scope: Scope, pins: readonly Comparable[], ranges: readonly Comparable[]): void {
  const involved: Source[] = []
  if (anyDisjoint(pins)) involved.push(...pins.map((p) => p.source))
  if (anyDisjoint(ranges)) involved.push(...ranges.map((r) => r.source))
  if (involved.length === 0) return
  const { text, groups, files } = groupedList(involved)
  out.add(
    'VERSION_CONFLICT',
    scope.runtime,
    involved,
    scope.root,
    `${scope.runtime}: ${groups} different versions across ${plural(files, 'file')}: ${text}; no version satisfies all of them.`,
  )
}

/** How many version components a plain pin states: `22` → 1, `22.11` → 2, `22.11.0` → 3. */
function precisionOf(c: Source['constraint']): number {
  return c.kind === 'exact' ? 3 : c.kind === 'partial' ? c.version.split('.').length : 0
}

/**
 * One PRECISION_MISMATCH for the scope: each coarser pin with the finer pins it includes
 * (`24 (.nvmrc:1) includes 24.22.2 (a.yml:9)`). Only pins that really agree are put together:
 * a 24.x pin and a 26.x pin never share a group (rpc-harden F1).
 */
function precisionMismatch(out: Collector, scope: Scope, pins: readonly Comparable[]): void {
  const plain = pins.filter((p) => precisionOf(p.source.constraint) > 0)
  const groups: { coarse: Source; finer: Source[] }[] = []
  for (const coarse of [...plain].sort((a, b) => byPosition(a.source, b.source))) {
    const level = precisionOf(coarse.source.constraint)
    if (level === 3) continue
    const finer = plain
      .filter((p) => precisionOf(p.source.constraint) > level && overlaps(coarse.range, p.range))
      .map((p) => p.source)
      .sort(byPosition)
    // 22.11 inside a group led by 22 adds nothing when its finer pins are already listed there.
    const covered = groups.some((g) => g.finer.includes(coarse.source) && finer.every((f) => g.finer.includes(f)))
    if (finer.length > 0 && !covered) groups.push({ coarse: coarse.source, finer })
  }
  if (groups.length === 0) return
  const involved = new Set<Source>()
  for (const g of groups) {
    involved.add(g.coarse)
    for (const f of g.finer) involved.add(f)
  }
  const pin = (s: Source) => `${describeConstraint(s.constraint)} (${where(s)})`
  const text = groups.map((g) => `${pin(g.coarse)} includes ${g.finer.map(pin).join(', ')}`).join('; ')
  out.add(
    'PRECISION_MISMATCH',
    scope.runtime,
    [...involved],
    scope.root,
    `${scope.runtime}: pins that agree but are written at different precision: ${text}.`,
  )
}

/**
 * The findings one source earns on its own (UNPARSEABLE, FLOATING_ALIAS, an alias the resolver
 * cannot place), or the source ready for comparison.
 */
function checkAlone(out: Collector, source: Source, scope: string | undefined, options: CompareOptions): Comparable | undefined {
  const c = source.constraint
  if (c.kind === 'unknown') {
    out.add('UNPARSEABLE', source.runtime, [source], scope, `${where(source)}: could not read "${source.raw}" as a ${source.runtime} version (${c.reason}).`)
    return undefined
  }
  if (c.kind === 'alias' && isFloatingAlias(c.alias)) {
    out.add(
      'FLOATING_ALIAS',
      source.runtime,
      [source],
      scope,
      `${where(source)} pins ${source.runtime} to "${source.raw}", which moves with every new release; pin a version instead.`,
    )
    return undefined
  }
  const cmp = comparable(source, options)
  if (!cmp && c.kind === 'alias' && options.resolveAlias) {
    // Constraint 9: with a resolver, an alias it cannot resolve is reported, never skipped.
    out.add(
      'UNPARSEABLE',
      source.runtime,
      [source],
      scope,
      `${where(source)}: the ${source.runtime} alias "${source.raw}" does not match any release line in the bundled data.`,
    )
  }
  return cmp
}

/**
 * Compares the sources of every project root and runtime and returns the findings, most severe
 * first. A finding that several roots share (a root-level file against another) is reported once
 * with every root in `scopes`.
 *
 * Rules (docs/TASKS.md A10): a pin (exact/partial/resolved alias) outside a range source →
 * OUTSIDE_RANGE, one per (pin, range) pair since each is a separate fix; pins that cannot all hold,
 * or ranges with nothing in common → ONE VERSION_CONFLICT per runtime and scope listing every pin
 * (and every range) grouped by version; agreeing pins written at different precision → ONE
 * PRECISION_MISMATCH per runtime and scope. CI matrix entries are checked only against ranges. `latest`/`node`/`stable` → FLOATING_ALIAS and are not compared;
 * text the extractor could not parse → UNPARSEABLE. Scopes with a single source produce nothing.
 * Sources bound by `bindSources` are grouped by `boundTo`; UNBOUND ones (`boundTo: []`) only get
 * UNPARSEABLE / FLOATING_ALIAS findings, with no scope (docs/TASKS.md A12).
 *
 * @param sources - Every source found in the repo.
 * @param roots - Project roots (relative, `.` = repo root); defaults to the repo root only.
 */
export function compareSources(sources: readonly Source[], roots: readonly string[] = ['.'], options: CompareOptions = {}): Finding[] {
  const out = new Collector()
  // UNBOUND sources (A12): their own problems are still reported, they are compared with nothing.
  for (const source of [...sources].sort(byPosition)) {
    if (source.boundTo !== undefined && source.boundTo.length === 0) checkAlone(out, source, undefined, options)
  }
  for (const scope of groupByScope(sources, roots)) {
    const pins: Comparable[] = []
    const matrix: Comparable[] = []
    for (const source of [...scope.sources].sort(byPosition)) {
      const cmp = checkAlone(out, source, scope.root, options)
      if (cmp) (source.matrix ? matrix : pins).push(cmp)
    }
    const fixed = pins.filter((p) => p.pin)
    const ranges = pins.filter((p) => !p.pin)
    for (const p of [...fixed, ...matrix]) for (const r of ranges) outsideRange(out, scope, p, r)
    versionConflict(out, scope, fixed, ranges)
    precisionMismatch(out, scope, fixed)
  }
  return out.findings()
}
