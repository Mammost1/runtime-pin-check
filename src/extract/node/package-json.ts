/** `package.json`: `engines.node`, `volta.node` and `devEngines.runtime` (name `node`). */
import type { Source } from '../../types'
import { nodeConstraint, nodeSource } from './util'

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function position(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, offset)
  const line = before.split('\n').length
  return { line, column: offset - (before.lastIndexOf('\n') + 1) + 1 }
}

/** Offset of the first `"key": ` after `from` whose value is the string `raw`; the value's first character. */
function findValue(text: string, from: number, key: string, raw: string, within?: { start: number; end: number }): number | undefined {
  const re = new RegExp(`"${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s*:\\s*"`, 'g')
  re.lastIndex = from
  const escaped = JSON.stringify(raw).slice(1, -1)
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const at = m.index + m[0].length
    if (within && at > within.end) return undefined
    if (text.startsWith(escaped, at) && text[at + escaped.length] === '"') return at
  }
  return undefined
}

/** Offset of the `{` that opens the object value of top-level-ish key `key` (first match), or undefined. */
function objectStart(text: string, key: string): number | undefined {
  const m = new RegExp(`"${key}"\\s*:\\s*[\\[{]`).exec(text)
  return m ? m.index : undefined
}

export function extractPackageJson(file: string, text: string): Source[] {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return []
  }
  if (!isObject(json)) return []
  const out: Source[] = []

  const add = (kind: string, parentKey: string, key: string, value: unknown, near?: (at: number) => boolean): void => {
    const parent = objectStart(text, parentKey) ?? 0
    if (typeof value === 'string') {
      let at = findValue(text, parent, key, value)
      if (near) {
        // devEngines: pick the match that sits inside the object whose name is node.
        let from = parent
        for (let n = 0; n < 50; n++) {
          at = findValue(text, from, key, value)
          if (at === undefined || near(at)) break
          from = at
        }
      }
      const pos = position(text, at ?? parent)
      out.push(nodeSource(file, kind, pos.line, value, nodeConstraint(value), at === undefined ? {} : { column: pos.column }))
    } else {
      const pos = position(text, parent)
      out.push(nodeSource(file, kind, pos.line, JSON.stringify(value), { kind: 'unknown', reason: 'expected a string' }))
    }
  }

  const engines = json.engines
  if (isObject(engines) && engines.node !== undefined) add('engines', 'engines', 'node', engines.node)

  const volta = json.volta
  if (isObject(volta) && volta.node !== undefined) add('volta', 'volta', 'node', volta.node)

  const dev = json.devEngines
  if (isObject(dev) && dev.runtime !== undefined) {
    const runtimes = Array.isArray(dev.runtime) ? dev.runtime : [dev.runtime]
    for (const rt of runtimes) {
      if (!isObject(rt) || rt.name !== 'node' || rt.version === undefined) continue
      const inNodeObject = (at: number): boolean => {
        const open = text.lastIndexOf('{', at)
        const close = text.indexOf('}', at)
        return /"name"\s*:\s*"node"/.test(text.slice(open, close < 0 ? undefined : close))
      }
      add('dev-engines', 'devEngines', 'version', rt.version, inNodeObject)
    }
  }
  return out
}
