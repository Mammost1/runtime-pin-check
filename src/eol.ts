/**
 * End-of-life data and checks (docs/TASKS.md, Finding codes). Everything here is offline: the data
 * is the snapshot in `data/eol.json`, built by `scripts/update-eol.mjs` from endoflife.date and
 * shipped with the package. Three things use it:
 *
 * - `createAliasResolver` turns `lts/*`, `lts/iron`, `lts/-1` into a semver range, so
 *   `compareSources` can compare an alias with the other pins.
 * - `eolFindings` reports EOL_RUNTIME (every version a source allows is past end-of-life) and
 *   EOL_SOON (the last of them ends within 90 days).
 * - `checkDate` validates the `--date` option so results can be reproduced on any day.
 */
import semver from 'semver'
import snapshotData from '../data/eol.json'
import { scopesOf } from './compare'
import { describeConstraint, isFloatingAlias, toRange } from './constraint'
import type { AliasResolver, Finding, FindingCode, Runtime, Severity, Source, SourceRef } from './types'

/** How many days ahead of the check date an end-of-life counts as "soon". */
export const EOL_SOON_DAYS = 90

/** One release line of a runtime, as stored in the snapshot. Dates are `YYYY-MM-DD`. */
export interface EolCycle {
  /** The line: `22` for Node, `3.12` for Python, `1.25` for Go. */
  cycle: string
  /** Date support ends, or null when it has not been announced (the newest Go lines). */
  eolFrom: string | null
  /** Date the line became LTS (Node), or null. */
  ltsFrom: string | null
  /** Newest release of the line at fetch time, e.g. `22.23.5`, or null. */
  latest: string | null
  /** Node LTS codename in lower case (`iron`), when known. */
  codename?: string | null
}

/** One data source recorded in the snapshot, with its terms. */
export interface EolSource {
  name: string
  url: string
  license: string
  copyright: string
  /** What was taken from it. */
  usedFor: string
}

/** The shipped end-of-life data. */
export interface EolSnapshot {
  schema: 1
  /** `YYYY-MM-DD` the snapshot was fetched. */
  fetchedAt: string
  /** Credit line to show wherever the data is shown (CC/MIT notice requirement). */
  attribution: string
  sources: EolSource[]
  products: Record<Runtime, EolCycle[]>
}

const RUNTIMES: readonly Runtime[] = ['node', 'python', 'go']
const DATE = /^\d{4}-\d{2}-\d{2}$/

function fail(message: string): never {
  throw new TypeError(`Invalid end-of-life snapshot: ${message}`)
}

function validDate(value: string): boolean {
  if (!DATE.test(value)) return false
  const d = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}

function optionalDate(value: unknown, where: string): string | null {
  if (value === null) return null
  if (typeof value !== 'string' || !validDate(value)) fail(`${where} must be YYYY-MM-DD or null, got ${JSON.stringify(value)}`)
  return value
}

function text(value: unknown, where: string): string {
  if (typeof value !== 'string' || value === '') fail(`${where} must be a non-empty string`)
  return value
}

/**
 * Checks the shape of a snapshot read from JSON and returns it typed. Throws a `TypeError` that
 * names the offending field, so a hand-edited or half-written file is never used silently.
 */
export function parseSnapshot(data: unknown): EolSnapshot {
  if (typeof data !== 'object' || data === null) return fail('the file is not an object')
  const d = data as Record<string, unknown>
  if (d.schema !== 1) fail(`schema must be 1, got ${JSON.stringify(d.schema)}`)
  const fetchedAt = text(d.fetchedAt, 'fetchedAt')
  if (!validDate(fetchedAt)) fail(`fetchedAt must be YYYY-MM-DD, got "${fetchedAt}"`)
  const attribution = text(d.attribution, 'attribution')
  if (!Array.isArray(d.sources) || d.sources.length === 0) fail('sources must list at least one source')
  const sources = d.sources.map((s: unknown, i): EolSource => {
    const o = (typeof s === 'object' && s !== null ? s : {}) as Record<string, unknown>
    return {
      name: text(o.name, `sources[${i}].name`),
      url: text(o.url, `sources[${i}].url`),
      license: text(o.license, `sources[${i}].license`),
      copyright: text(o.copyright, `sources[${i}].copyright`),
      usedFor: text(o.usedFor, `sources[${i}].usedFor`),
    }
  })
  const rawProducts = (typeof d.products === 'object' && d.products !== null ? d.products : {}) as Record<string, unknown>
  const products = {} as Record<Runtime, EolCycle[]>
  for (const runtime of RUNTIMES) {
    const list = rawProducts[runtime]
    if (!Array.isArray(list) || list.length === 0) fail(`products.${runtime} must list at least one release line`)
    products[runtime] = list.map((c: unknown, i): EolCycle => {
      const where = `products.${runtime}[${i}]`
      const o = (typeof c === 'object' && c !== null ? c : {}) as Record<string, unknown>
      const cycle = text(o.cycle, `${where}.cycle`)
      if (!/^\d+(\.\d+)?$/.test(cycle)) fail(`${where}.cycle must look like 22 or 3.12, got "${cycle}"`)
      const out: EolCycle = {
        cycle,
        eolFrom: optionalDate(o.eolFrom, `${where}.eolFrom`),
        ltsFrom: optionalDate(o.ltsFrom, `${where}.ltsFrom`),
        latest: o.latest === null || typeof o.latest === 'string' ? (o.latest ?? null) : fail(`${where}.latest must be a string or null`),
      }
      if (o.codename !== undefined) {
        if (o.codename !== null && typeof o.codename !== 'string') fail(`${where}.codename must be a string or null`)
        out.codename = o.codename
      }
      return out
    })
  }
  return { schema: 1, fetchedAt, attribution, sources, products }
}

let bundled: EolSnapshot | undefined

/** The snapshot shipped in `data/eol.json`, validated once. */
export function bundledSnapshot(): EolSnapshot {
  bundled ??= parseSnapshot(snapshotData)
  return bundled
}

/**
 * The date to check against as `YYYY-MM-DD`. Without an argument: today in UTC.
 *
 * @throws RangeError when the text is not a real calendar date in `YYYY-MM-DD` form.
 */
export function checkDate(input?: string): string {
  if (input === undefined) return new Date().toISOString().slice(0, 10)
  if (!validDate(input)) throw new RangeError(`--date must be a real date as YYYY-MM-DD, got "${input}"`)
  return input
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** The semver span of one release line: `22` → `>=22.0.0 <23.0.0-0`, `3.12` → `>=3.12.0 <3.13.0-0`. */
function cycleRange(cycle: string): string {
  const parts = cycle.split('.')
  const major = Number(parts[0])
  if (parts.length === 1) return `>=${major}.0.0 <${major + 1}.0.0-0`
  const minor = Number(parts[1])
  return `>=${major}.${minor}.0 <${major}.${minor + 1}.0-0`
}

/** Upper bound (exclusive) of the newest known line: versions from here on are not in the snapshot. */
function newestBound(cycles: readonly EolCycle[]): string {
  let best = '0.0.0'
  for (const c of cycles) {
    const upper = cycleRange(c.cycle).split(' <')[1]?.replace(/-0$/, '') ?? '0.0.0'
    if (semver.gt(upper, best)) best = upper
  }
  return best
}

function byCycleDesc(a: EolCycle, b: EolCycle): number {
  return semver.rcompare(semver.coerce(a.cycle) ?? '0.0.0', semver.coerce(b.cycle) ?? '0.0.0')
}

/**
 * Resolves Node aliases against a snapshot: `lts/*` (and bare `lts`) is the newest line that was
 * already LTS on `date`, `lts/-1` the one before it, `lts/<codename>` the line with that codename.
 * Python and Go have no such aliases, and unknown codenames resolve to nothing (the comparison then
 * reports the alias as unreadable rather than guessing). `latest`/`node`/`stable` are never resolved
 * here; they are FLOATING_ALIAS findings.
 *
 * @param snapshot - Defaults to the bundled snapshot.
 * @param date - `YYYY-MM-DD`, defaults to today (UTC); decides which line is "current LTS".
 */
export function createAliasResolver(snapshot: EolSnapshot = bundledSnapshot(), date: string = checkDate()): AliasResolver {
  const lts = snapshot.products.node.filter((c) => c.ltsFrom !== null && c.ltsFrom <= date).sort(byCycleDesc)
  return (runtime, alias) => {
    if (runtime !== 'node') return undefined
    const a = alias.toLowerCase()
    let line: EolCycle | undefined
    if (a === 'lts/*' || a === 'lts') line = lts[0]
    else {
      const back = /^lts\/-(\d+)$/.exec(a)
      if (back) line = lts[Number(back[1])]
      else {
        const name = /^lts\/([a-z][a-z-]*)$/.exec(a)?.[1]
        if (name) line = snapshot.products.node.find((c) => c.codename === name)
      }
    }
    return line ? cycleRange(line.cycle) : undefined
  }
}

const SEVERITY: Partial<Record<FindingCode, Severity>> = { EOL_RUNTIME: 'warning', EOL_SOON: 'info' }

function ref(s: Source): SourceRef {
  return { file: s.file, line: s.line, raw: s.raw, constraint: s.constraint }
}

function list(cycles: readonly EolCycle[]): string {
  const names = cycles.map((c) => c.cycle)
  return names.length <= 4 ? names.join(', ') : `${names.slice(0, 4).join(', ')} and ${names.length - 4} more`
}

/** The range of versions a source allows, or undefined when it allows nothing we can judge. */
function allowedRange(source: Source, resolve: AliasResolver): string | undefined {
  const c = source.constraint
  if (c.kind === 'unknown') return undefined
  if (c.kind === 'alias') {
    if (isFloatingAlias(c.alias)) return undefined
    const range = resolve(source.runtime, c.alias)
    return range && semver.validRange(range) ? range : undefined
  }
  const range = toRange(c)
  return range !== undefined && semver.validRange(range) ? range : undefined
}

function judge(source: Source, range: string, cycles: readonly EolCycle[], date: string): { code: FindingCode; message: string } | undefined {
  // A range that reaches past the newest line includes versions the snapshot does not know: not EOL.
  if (semver.intersects(range, `>=${newestBound(cycles)}`)) return undefined
  const allowed = cycles.filter((c) => semver.intersects(range, cycleRange(c.cycle))).sort(byCycleDesc)
  if (allowed.length === 0) return undefined
  const pin = `${source.runtime} ${describeConstraint(source.constraint)}`
  const where = `${source.file}:${source.line}`
  const ended = (c: EolCycle): boolean => c.eolFrom !== null && c.eolFrom <= date
  if (allowed.every(ended)) {
    const last = allowed.map((c) => c.eolFrom as string).sort().at(-1) as string
    const what =
      allowed.length === 1
        ? `${source.runtime} ${(allowed[0] as EolCycle).cycle} reached end-of-life on ${last}`
        : `every ${source.runtime} line it allows (${list(allowed)}) is past end-of-life; the newest of them ended on ${last}`
    return { code: 'EOL_RUNTIME', message: `${where} pins ${pin} ("${source.raw}"): ${what} (check date ${date}).` }
  }
  if (allowed.every((c) => c.eolFrom !== null)) {
    const last = allowed.map((c) => c.eolFrom as string).sort().at(-1) as string
    const limit = addDays(date, EOL_SOON_DAYS)
    if (last <= limit) {
      const what =
        allowed.length === 1
          ? `${source.runtime} ${(allowed[0] as EolCycle).cycle} reaches end-of-life on ${last}`
          : `the newest ${source.runtime} line it allows reaches end-of-life on ${last}`
      return { code: 'EOL_SOON', message: `${where} pins ${pin} ("${source.raw}"): ${what}, within ${EOL_SOON_DAYS} days of the check date ${date}.` }
    }
  }
  return undefined
}

/** Options of `eolFindings`. */
export interface EolOptions {
  /** Defaults to the bundled snapshot. */
  snapshot?: EolSnapshot
  /** `YYYY-MM-DD`; defaults to today (UTC). Use it to reproduce a result. */
  date?: string
}

/**
 * EOL_RUNTIME and EOL_SOON findings for a set of sources.
 *
 * A source is judged on every version it allows: EOL_RUNTIME when all of them are past end-of-life on
 * the check date, EOL_SOON when none is supported beyond `EOL_SOON_DAYS` days from it. A range that
 * also allows versions newer than the snapshot knows is never reported. Floating aliases, unreadable
 * sources and unresolvable aliases produce nothing here (the comparison reports them). CI matrix
 * entries are judged like any other source. Output order matches `compareSources`: severity, then
 * file and line; a source shared by several project roots is reported once with every root in `scopes`.
 *
 * @param sources - Every source found in the repo.
 * @param roots - Project roots (relative, `.` = repo root); defaults to the repo root only.
 * @throws RangeError when `options.date` is not a real `YYYY-MM-DD` date.
 */
export function eolFindings(sources: readonly Source[], roots: readonly string[] = ['.'], options: EolOptions = {}): Finding[] {
  const snapshot = options.snapshot ?? bundledSnapshot()
  const date = checkDate(options.date)
  const resolve = createAliasResolver(snapshot, date)
  const found = new Map<string, Finding>()
  for (const source of sources) {
    const range = allowedRange(source, resolve)
    if (range === undefined) continue
    const verdict = judge(source, range, snapshot.products[source.runtime], date)
    if (!verdict) continue
    const key = `${verdict.code}\u0000${source.runtime}\u0000${source.file}:${source.line}\u0000${source.raw}`
    const existing = found.get(key)
    const scopes = scopesOf(source, roots)
    if (existing) {
      for (const s of scopes) if (!existing.scopes.includes(s)) existing.scopes.push(s)
      continue
    }
    found.set(key, {
      code: verdict.code,
      severity: SEVERITY[verdict.code] as Severity,
      runtime: source.runtime,
      sources: [ref(source)],
      scopes: [...scopes],
      message: verdict.message,
    })
  }
  const order: Record<Severity, number> = { error: 0, warning: 1, info: 2 }
  const out = [...found.values()]
  for (const f of out) f.scopes.sort()
  return out.sort(
    (a, b) =>
      order[a.severity] - order[b.severity] ||
      (a.sources[0]?.file ?? '').localeCompare(b.sources[0]?.file ?? '') ||
      (a.sources[0]?.line ?? 0) - (b.sources[0]?.line ?? 0) ||
      a.code.localeCompare(b.code),
  )
}
