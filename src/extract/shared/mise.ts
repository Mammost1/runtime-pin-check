/** `mise.toml` / `.mise.toml` `[tools]` parser. Pure; never throws. */
import { locateTomlKey, locateTomlTable, parseToml } from './toml'

/** One tool of a mise `[tools]` table. */
export interface MiseTool {
  /** Tool name as written (`node`, `go`, `"core:node"`'s unquoted `core:node`). */
  tool: string
  /** Versions as written: one for `node = "22"`, several for an array, `version` for an inline table. */
  versions: string[]
  /** 1-based line of the tool key. */
  line: number
  /** 1-based column of the value. */
  column?: number
}

function versionsOf(value: unknown): string[] | undefined {
  if (typeof value === 'string') return [value]
  if (typeof value === 'number') return [String(value)]
  if (Array.isArray(value)) {
    const list = value.filter((v): v is string | number => typeof v === 'string' || typeof v === 'number').map(String)
    return list.length === value.length ? list : undefined
  }
  if (value && typeof value === 'object') {
    const v = (value as Record<string, unknown>).version
    return v === undefined ? undefined : versionsOf(v)
  }
  return undefined
}

/**
 * Lists the `[tools]` entries of a mise config, with the line of each key. A tool whose value has
 * no readable version (an inline table without `version`) is returned with `versions: []`.
 * Invalid TOML gives []. `idiomatic_version_file_enable_tools` and other settings are not pins and
 * are ignored.
 */
export function parseMise(text: string): MiseTool[] {
  try {
    const data = parseToml(text)
    const tools = data?.tools
    if (!tools || typeof tools !== 'object' || Array.isArray(tools)) return []
    const out: MiseTool[] = []
    for (const [tool, value] of Object.entries(tools as Record<string, unknown>)) {
      // `node = "22"` under [tools], or the table form `[tools.node]` with a `version` key (or the
      // header itself when it has none). A line is never invented: no location, no entry.
      const where = locateTomlKey(text, ['tools'], tool) ?? locateTomlKey(text, ['tools', tool], 'version')
      const line = where?.line ?? locateTomlTable(text, ['tools', tool]) ?? locateTomlTable(text, ['tools'])
      if (line === undefined) continue
      const entry: MiseTool = { tool, versions: versionsOf(value) ?? [], line }
      if (where) entry.column = where.column
      out.push(entry)
    }
    return out
  } catch {
    return []
  }
}
