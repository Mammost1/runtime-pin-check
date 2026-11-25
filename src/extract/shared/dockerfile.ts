/**
 * Dockerfile `FROM` parser. Handles line continuations, comments, `--platform=` flags, `AS stage`,
 * and substitutes global `ARG` defaults into `FROM` (docs/TASKS.md A8). Pure; never throws.
 */
import { splitImageRef } from './imageref'

/** One `FROM` instruction. */
export interface DockerFrom {
  /** Image name with registry and path, `ARG` defaults substituted (e.g. `node`, `public.ecr.aws/lambda/nodejs`). */
  image: string
  /** Tag, `ARG` defaults substituted; a variable with no default stays raw (`${NODE_VERSION}-alpine`). */
  tag?: string
  /** Digest without the `@` (e.g. `sha256:ab…`). */
  digest?: string
  /** 1-based line of the `FROM` keyword. */
  line: number
  /** 1-based column of the image reference as written. */
  column: number
  /** Stage name after `AS`. */
  stage?: string
  /** The image reference exactly as written, before any substitution (`node:${NODE_VERSION}-alpine`). */
  raw: string
  /** Set when a global `ARG` default was substituted: the first such variable and its `ARG` line. */
  arg?: { name: string; line: number }
}

interface Logical {
  /** Instruction text with continuations joined by a single space. */
  text: string
  line: number
  /** Offsets: column in the first physical line where `text` starts (after leading whitespace). */
  firstColumn: number
}

function logicalLines(text: string): Logical[] {
  const physical = text.split(/\r?\n/)
  let escape = '\\'
  for (const l of physical) {
    const m = /^\s*#\s*([A-Za-z]+)\s*=\s*(\S+)\s*$/.exec(l)
    if (!m) break
    if ((m[1] as string).toLowerCase() === 'escape' && (m[2] === '`' || m[2] === '\\')) escape = m[2] as string
  }
  const out: Logical[] = []
  for (let i = 0; i < physical.length; i++) {
    const raw = physical[i] as string
    if (/^\s*#/.test(raw) || raw.trim() === '') continue
    const firstColumn = raw.length - raw.trimStart().length + 1
    let joined = raw.trimStart()
    const startLine = i + 1
    let continuing = joined.trimEnd().endsWith(escape)
    while (continuing && i + 1 < physical.length) {
      if (joined.trimEnd().endsWith(escape)) joined = joined.trimEnd().slice(0, -1)
      i++
      const next = physical[i] as string
      if (/^\s*#/.test(next)) {
        // A comment line inside a continuation is dropped; the continuation goes on.
        joined += ' '
        continue
      }
      joined += ` ${next.trim()}`
      continuing = next.trimEnd().endsWith(escape)
    }
    if (joined.trimEnd().endsWith(escape)) joined = joined.trimEnd().slice(0, -1)
    out.push({ text: joined.trim(), line: startLine, firstColumn })
  }
  return out
}

function unquote(v: string): string {
  const m = /^(["'])(.*)\1$/.exec(v)
  return m ? (m[2] as string) : v
}

/** `${VAR}`, `${VAR:-x}`, `${VAR-x}` and `$VAR`, replaced from `args`; unresolved ones stay as written. */
function substitute(
  s: string,
  args: ReadonlyMap<string, { value: string | undefined; line: number }>,
): { text: string; arg?: { name: string; line: number } } {
  let arg: { name: string; line: number } | undefined
  const text = s.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?:(:?-)([^}]*))?\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (whole, braced, op, fallback, bare) => {
    const name = (braced ?? bare) as string
    const known = args.get(name)
    if (known && known.value !== undefined && known.value !== '') {
      arg ??= { name, line: known.line }
      return known.value
    }
    if (op !== undefined && fallback !== undefined) return fallback as string
    return whole
  })
  return arg ? { text, arg } : { text }
}

/**
 * Lists every `FROM` of a Dockerfile in order. Global `ARG` defaults (those before the first
 * `FROM`) are substituted into the image reference; a variable without a default stays raw so the
 * caller can report it. Anything that is not a `FROM` is ignored.
 *
 * @example
 * parseDockerfile('ARG V=22\nFROM node:${V}-alpine AS build')
 * // [{ image: 'node', tag: '22-alpine', line: 2, stage: 'build', raw: 'node:${V}-alpine', … }]
 */
export function parseDockerfile(text: string): DockerFrom[] {
  try {
    const out: DockerFrom[] = []
    const args = new Map<string, { value: string | undefined; line: number }>()
    let seenFrom = false
    for (const ins of logicalLines(text)) {
      const word = /^([A-Za-z]+)\b/.exec(ins.text)
      const keyword = word ? (word[1] as string).toUpperCase() : ''
      if (keyword === 'ARG' && !seenFrom) {
        for (const tok of ins.text.slice(3).trim().split(/\s+/)) {
          const eq = tok.indexOf('=')
          if (eq < 0) args.set(tok, { value: undefined, line: ins.line })
          else args.set(tok.slice(0, eq), { value: unquote(tok.slice(eq + 1)), line: ins.line })
        }
        continue
      }
      if (keyword !== 'FROM') continue
      seenFrom = true
      const tokens = ins.text.slice(4).trim().split(/\s+/).filter((t) => t !== '')
      let i = 0
      while (i < tokens.length && (tokens[i] as string).startsWith('--')) i++
      const rawRef = tokens[i]
      if (rawRef === undefined) continue
      const as = (tokens[i + 1] ?? '').toUpperCase() === 'AS' ? tokens[i + 2] : undefined
      const sub = substitute(rawRef, args)
      const parts = splitImageRef(sub.text)
      const column = ins.firstColumn + ins.text.indexOf(rawRef)
      const from: DockerFrom = { image: parts.image, line: ins.line, column, raw: rawRef }
      if (parts.tag !== undefined) from.tag = parts.tag
      if (parts.digest !== undefined) from.digest = parts.digest
      if (as !== undefined) from.stage = as
      if (sub.arg) from.arg = sub.arg
      out.push(from)
    }
    return out
  } catch {
    return []
  }
}
