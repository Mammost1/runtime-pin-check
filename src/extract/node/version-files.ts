/**
 * Plain version files: `.nvmrc`, `.node-version`, `.tool-versions` (`nodejs`) and mise (`node`).
 */
import { parseMise, parseToolVersions } from '../shared'
import type { Source } from '../../types'
import { columnOf, nodeConstraint, nodeSource } from './util'

/** `.nvmrc` / `.node-version`: the first line that is not blank or a comment holds the version. */
export function extractVersionFile(file: string, text: string, kind: 'nvmrc' | 'node-version'): Source[] {
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const raw = (lines[i] as string).trim()
    if (raw === '' || raw.startsWith('#')) continue
    const column = (lines[i] as string).indexOf(raw) + 1
    return [nodeSource(file, kind, i + 1, raw, nodeConstraint(raw), { column })]
  }
  return []
}

/**
 * `.tool-versions`: the `nodejs` (or `node`) line. asdf uses the first version on the line and
 * keeps the rest as fallbacks, so only the first is a pin. A line naming the tool with no version
 * is a recognised field with nothing to read: `unknown`.
 */
export function extractToolVersions(file: string, text: string): Source[] {
  const out: Source[] = []
  for (const entry of parseToolVersions(text)) {
    if (entry.tool !== 'nodejs' && entry.tool !== 'node') continue
    const raw = entry.versions[0]
    if (raw === undefined) {
      out.push(nodeSource(file, 'tool-versions', entry.line, entry.tool, { kind: 'unknown', reason: 'no version on the line' }))
      continue
    }
    const column = columnOf(text, entry.line, raw, (text.split(/\r?\n/)[entry.line - 1] ?? '').indexOf(entry.tool) + entry.tool.length)
    out.push(nodeSource(file, 'tool-versions', entry.line, raw, nodeConstraint(raw), column === undefined ? {} : { column }))
  }
  return out
}

/** Column of `raw` itself: the TOML value token starts at a quote, `[` or `{`, one or more characters before it. */
function miseColumn(text: string, line: number, valueColumn: number | undefined, raw: string): { column?: number } {
  if (valueColumn === undefined) return {}
  const l = text.split(/\r?\n/)[line - 1] ?? ''
  let from = valueColumn - 1
  if (l[from] === '{') from += Math.max(l.slice(from).search(/\bversion\b/), 0)
  const column = columnOf(text, line, raw, from)
  return column === undefined ? {} : { column }
}

/**
 * mise `[tools]`: `node` (also `nodejs`, `core:node`). An array lists several installed versions,
 * the first is the active one. A tool with no readable version is not a pin and is skipped.
 */
export function extractMise(file: string, text: string): Source[] {
  const out: Source[] = []
  for (const tool of parseMise(text)) {
    if (!['node', 'nodejs', 'core:node'].includes(tool.tool)) continue
    const raw = tool.versions[0]
    if (raw === undefined) continue
    out.push(nodeSource(file, 'mise', tool.line, raw, nodeConstraint(raw), miseColumn(text, tool.line, tool.column, raw)))
  }
  return out
}
