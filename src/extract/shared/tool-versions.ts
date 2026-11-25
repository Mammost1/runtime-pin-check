/** `.tool-versions` (asdf, and mise's legacy format) parser. Pure; never throws. */

/** One line of a `.tool-versions` file. */
export interface ToolEntry {
  /** Tool name as written (`nodejs`, `golang`, `python`). */
  tool: string
  /** Every version on the line, as written (`22.12.0`, `ref:master`, `system`). Empty when the line names only a tool. */
  versions: string[]
  /** 1-based line. */
  line: number
}

/**
 * Lists the tools of a `.tool-versions` file. Blank lines and `#` comments (whole-line or trailing)
 * are skipped; fields are separated by any run of whitespace (chainlink aligns them with spaces).
 */
export function parseToolVersions(text: string): ToolEntry[] {
  try {
    const out: ToolEntry[] = []
    text.split(/\r?\n/).forEach((raw, i) => {
      const body = raw.replace(/(^|\s)#.*$/, '').trim()
      if (body === '') return
      const [tool, ...versions] = body.split(/\s+/)
      if (tool === undefined) return
      out.push({ tool, versions, line: i + 1 })
    })
    return out
  } catch {
    return []
  }
}
