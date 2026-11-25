/**
 * Turns the raw text of a version pin into a `Constraint`, and a constraint into a semver range.
 * Node pins use npm semver syntax; Python pins use PEP 440 specifiers (plus Poetry's `^`/`~`);
 * Go pins use `1.22`, `1.22.3` or `go1.22.3`. Nothing here guesses: text that does not fit
 * becomes an `unknown` constraint carrying the reason.
 */
import semver from 'semver'
import type { Constraint, Runtime } from './types'

/** Aliases that float to whatever is newest: reported as FLOATING_ALIAS, never compared. */
const FLOATING = new Set(['latest', 'node', 'stable', 'current', 'system', 'oldstable'])

/** Alias words each runtime accepts in version files and CI inputs. */
const ALIAS = /^(lts\/\*|lts\/[a-z][a-z-]*|lts|latest|node|stable|current|system|oldstable)$/i

/** Docker tag words that name an image variant, not a version (`python:slim`, `golang:alpine`). */
const DOCKER_VARIANTS = new Set([
  'alpine',
  'slim',
  'bookworm',
  'bullseye',
  'buster',
  'stretch',
  'jessie',
  'trixie',
  'noble',
  'jammy',
  'focal',
  'windowsservercore',
  'nanoserver',
])

/** True for `latest`, `node`, `stable` and the like: pins that move by themselves. */
export function isFloatingAlias(alias: string): boolean {
  return FLOATING.has(alias.toLowerCase())
}

const EXACT = /^\d+\.\d+\.\d+$/
const PARTIAL = /^(\d+)(?:\.(\d+))?(?:\.[xX*])?$/

function versionPart(text: string, runtime: Runtime): string {
  let t = text.trim()
  if (runtime === 'go') t = t.replace(/^go(?=\d)/, '')
  if (runtime === 'python') {
    t = t.replace(/^python-?(?=\d)/i, '')
    // CPython free-threaded builds (`3.14t`, actions/setup-python) are that CPython version.
    t = t.replace(/^(\d+\.\d+(?:\.\d+)?)t$/i, '$1')
  }
  return t.replace(/^[vV](?=\d)/, '')
}

/** Exact or partial when the text is a plain version (`22`, `22.11`, `22.x`, `v22.11.0`). */
function plainVersion(text: string): Constraint | undefined {
  if (EXACT.test(text)) return { kind: 'exact', version: text }
  const m = PARTIAL.exec(text)
  if (m) return { kind: 'partial', version: m[2] === undefined ? (m[1] as string) : `${m[1]}.${m[2]}` }
  return undefined
}

function pad(version: string): string {
  const parts = version.split('.')
  while (parts.length < 3) parts.push('0')
  return parts.slice(0, 3).join('.')
}

/** One PEP 440 / Poetry clause as semver, '' for a clause semver cannot express (`!=`), undefined if invalid. */
function pythonClause(clause: string): string | undefined {
  const m = /^(~=|===|==|!=|<=|>=|<|>|\^|~)?\s*(\d+(?:\.\d+){0,3})(\.\*)?$/.exec(clause.trim())
  if (!m) return undefined
  const op = m[1] ?? '=='
  const version = m[2] as string
  const wildcard = m[3] !== undefined
  const parts = version.split('.').map(Number)
  if (parts.length > 3) return undefined
  if (wildcard && op !== '==' && op !== '!=') return undefined
  switch (op) {
    case '===':
      return undefined
    case '!=':
      // An exclusion only narrows the range; semver has no "not equal", so it is left out.
      return ''
    case '==':
      // PEP 440 pads with zeros: '==3.10' is 3.10.0 only; '==3.10.*' is the whole 3.10 series.
      return wildcard ? partialRange(version) : `=${pad(version)}`
    case '~=': {
      if (parts.length < 2) return undefined
      const upper = parts.slice(0, -1)
      upper[upper.length - 1] = (upper[upper.length - 1] as number) + 1
      return `>=${pad(version)} <${pad(upper.join('.'))}-0`
    }
    case '<':
      return `<${pad(version)}-0`
    case '<=':
      return `<=${pad(version)}`
    case '>':
      return `>${pad(version)}`
    case '>=':
      return `>=${pad(version)}`
    case '^':
    case '~':
      return semver.validRange(`${op}${version}`) ?? undefined
    default:
      return undefined
  }
}

function pythonRange(text: string): string | undefined {
  const alternatives: string[] = []
  for (const alt of text.split(/\|\|?/)) {
    const clauses = alt.split(',').map((c) => c.trim()).filter((c) => c !== '')
    if (clauses.length === 0) return undefined
    const converted: string[] = []
    for (const clause of clauses) {
      const r = pythonClause(clause)
      if (r === undefined) return undefined
      if (r !== '') converted.push(r)
    }
    alternatives.push(converted.length > 0 ? converted.join(' ') : '*')
  }
  return semver.validRange(alternatives.join(' || ')) ?? undefined
}

/**
 * Parses the raw text of one pin for a runtime.
 *
 * @example
 * parseConstraint('v22', 'node')             // { kind: 'partial', version: '22' }
 * parseConstraint('>=20 <23', 'node')        // { kind: 'range', range: '>=20.0.0 <23.0.0-0' }
 * parseConstraint('>=3.10,<3.14', 'python')  // { kind: 'range', range: '>=3.10.0 <3.14.0-0' }
 * parseConstraint('go1.24.4', 'go')          // { kind: 'exact', version: '1.24.4' }
 * parseConstraint('lts/iron', 'node')        // { kind: 'alias', alias: 'lts/iron' }
 */
export function parseConstraint(raw: string, runtime: Runtime): Constraint {
  const text = versionPart(raw, runtime)
  if (text === '') return { kind: 'unknown', reason: 'empty value' }
  if (ALIAS.test(text)) return { kind: 'alias', alias: text.toLowerCase() }
  if (runtime === 'python' && /^(pypy|graalpy)/i.test(text)) {
    return { kind: 'unknown', reason: 'a PyPy/GraalPy build; its version is not compared with CPython pins' }
  }
  const plain = plainVersion(text)
  if (plain) return plain
  if (/\$\{|\$\(|\{\{/.test(text)) return { kind: 'unknown', reason: 'contains a variable or template expression' }
  const range = runtime === 'python' ? pythonRange(text) : semver.validRange(text)
  if (range) return { kind: 'range', range }
  return { kind: 'unknown', reason: `not a ${runtime} version or version range` }
}

/**
 * The constraint of a Docker image tag: the version part only (`22-alpine` → partial 22,
 * `22.11.0-bookworm-slim` → exact, `lts-alpine` → alias lts). A missing tag or a variant-only tag
 * (`slim`, `alpine`) means `latest`. A digest (`@sha256:…`) is ignored.
 */
export function dockerTagConstraint(tag: string | undefined, runtime: Runtime): Constraint {
  const t = (tag ?? '').split('@')[0]?.trim() ?? ''
  if (t === '') return { kind: 'alias', alias: 'latest' }
  if (/\$\{?[A-Za-z_]/.test(t)) return { kind: 'unknown', reason: 'tag contains an unresolved variable' }
  const head = t.split('-')[0] as string
  const plain = plainVersion(versionPart(head, runtime))
  if (plain) return plain
  const word = head.toLowerCase()
  // A variant may carry its own OS version (`alpine3.20`, `windowsservercore1809`): still no runtime version.
  if (DOCKER_VARIANTS.has(word.replace(/[\d.]+$/, ''))) return { kind: 'alias', alias: 'latest' }
  if (ALIAS.test(word)) return { kind: 'alias', alias: word }
  // Node images are also tagged by LTS codename (`node:iron`, `node:jod-alpine`).
  if (runtime === 'node' && /^[a-z]+$/.test(word)) return { kind: 'alias', alias: `lts/${word}` }
  return { kind: 'unknown', reason: 'tag has no recognisable version' }
}

function partialRange(version: string): string {
  const parts = version.split('.').map(Number)
  if (parts.length === 1) return `>=${parts[0]}.0.0 <${(parts[0] as number) + 1}.0.0-0`
  if (parts.length === 2) return `>=${parts[0]}.${parts[1]}.0 <${parts[0]}.${(parts[1] as number) + 1}.0-0`
  return `=${pad(version)}`
}

/**
 * The semver range a constraint allows, for comparison (`partial 22` → `>=22.0.0 <23.0.0-0`).
 * Aliases and unknown constraints have none and return undefined.
 */
export function toRange(c: Constraint): string | undefined {
  switch (c.kind) {
    case 'exact':
      return c.version
    case 'partial':
      return partialRange(c.version)
    case 'range':
      return c.range
    default:
      return undefined
  }
}

/** Human-readable form of a constraint for messages (`22`, `>=20 <23`, `lts/iron`). */
export function describeConstraint(c: Constraint): string {
  switch (c.kind) {
    case 'exact':
    case 'partial':
      return c.version
    case 'range':
      return c.range
    case 'alias':
      return c.alias
    case 'unknown':
      return `unparseable (${c.reason})`
  }
}
