/**
 * TOML helpers. `smol-toml` gives values but no positions, so the tables are located by a small
 * line scanner that only has to understand table headers and `key =` lines (docs/TASKS.md A8).
 * Pure; never throws.
 */
import { parse } from 'smol-toml'

/** Where a key's value sits in the file. */
export interface TomlLocation {
  /** 1-based line of the key. */
  line: number
  /** 1-based column of the value start. */
  column: number
  /** The value text exactly as written on that line (`"22"`, `["22", "20"]`, `{ version = "22" }`). */
  raw: string
}

/**
 * A `[table.header]` line. The capture is unambiguous (`[^\]]*`, trimmed in code) so a crafted line
 * such as `[` followed by thousands of spaces cannot cause catastrophic backtracking.
 */
const HEADER = /^\s*\[(?!\[)([^\]]*)\]\s*(#.*)?$/

function stripKey(key: string): string {
  return key.trim().replace(/^(["'])(.*)\1$/, '$2')
}

/** Splits `a."b.c".d` on dots outside quotes. */
function splitDotted(path: string): string[] {
  const parts: string[] = []
  let cur = ''
  let quote = ''
  for (const ch of path) {
    if (quote) {
      if (ch === quote) quote = ''
      cur += ch
    } else if (ch === '"' || ch === "'") {
      quote = ch
      cur += ch
    } else if (ch === '.') {
      parts.push(stripKey(cur))
      cur = ''
    } else cur += ch
  }
  if (cur.trim() !== '') parts.push(stripKey(cur))
  return parts
}

/**
 * Finds `key` inside the table `table` (`['project']`, `['tool', 'poetry', 'dependencies']`; `[]`
 * is the top level). Dotted keys at the top level (`tools.node = "22"`) and in parent tables are
 * understood. A value that spans lines (an array) is returned as far as the first line.
 */
export function locateTomlKey(text: string, table: readonly string[], key: string): TomlLocation | undefined {
  try {
    let current: string[] = []
    const lines = text.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] as string
      const header = HEADER.exec(line)
      if (header) {
        current = splitDotted((header[1] as string).trim())
        continue
      }
      if (/^\s*\[\[/.test(line)) {
        current = ['\u0000array-of-tables']
        continue
      }
      const kv = /^(\s*)((?:"[^"]*"|'[^']*'|[A-Za-z0-9_-]+)(?:\s*\.\s*(?:"[^"]*"|'[^']*'|[A-Za-z0-9_-]+))*)\s*=\s*(.*)$/.exec(line)
      if (!kv) continue
      const full = [...current, ...splitDotted(kv[2] as string)]
      const want = [...table, key]
      if (full.length === want.length && full.every((p, k) => p === want[k])) {
        const rest = kv[3] as string
        const column = line.length - rest.length + 1
        return { line: i + 1, column, raw: rest.replace(/\s+#.*$/, '').trimEnd() }
      }
    }
    return undefined
  } catch {
    return undefined
  }
}

/**
 * The 1-based line of the table header `[a.b]` (and, as a fallback, of a top-level dotted or inline
 * `a = { … }` key) for `path`; undefined when the table is not written in the text.
 */
export function locateTomlTable(text: string, path: readonly string[]): number | undefined {
  try {
    const lines = text.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      const header = HEADER.exec(lines[i] as string)
      if (!header) continue
      const got = splitDotted((header[1] as string).trim())
      if (got.length === path.length && got.every((p, k) => p === path[k])) return i + 1
    }
    if (path.length === 1) return locateTomlKey(text, [], path[0] as string)?.line
    return undefined
  } catch {
    return undefined
  }
}

/** Parses TOML; undefined when it is not valid TOML. */
export function parseToml(text: string): Record<string, unknown> | undefined {
  try {
    return parse(text) as Record<string, unknown>
  } catch {
    return undefined
  }
}

/** The error of a TOML text that does not parse, with the position `smol-toml` reports. */
export interface TomlProblem {
  line: number
  column: number
  message: string
}

/** Like `parseToml`, but returns the syntax error (line, column, first line of the message) instead of dropping it. */
export function parseTomlDetailed(text: string): { data: Record<string, unknown> } | { error: TomlProblem } {
  try {
    return { data: parse(text) as Record<string, unknown> }
  } catch (err) {
    const e = err as { line?: unknown; column?: unknown; message?: unknown }
    const first = String(e.message ?? 'invalid TOML').split('\n')[0] as string
    return {
      error: {
        line: typeof e.line === 'number' && e.line > 0 ? e.line : 1,
        column: typeof e.column === 'number' && e.column > 0 ? e.column : 1,
        message: first.replace(/^Invalid TOML document:\s*/i, ''),
      },
    }
  }
}
