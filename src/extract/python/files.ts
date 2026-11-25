/** Python-specific single-purpose files: `.python-version`, `pyproject.toml`, `runtime.txt`. */
import { parseConstraint } from '../../constraint'
import type { Source } from '../../types'
import { locateTomlKey, parseToml } from '../shared'

/**
 * `.python-version`: one source per non-comment line (pyenv reads several versions; every one is a
 * pin the repo declares). A line that is not a version (`pypy3.10-7.3.15`, `miniconda3-latest`)
 * becomes an `unknown` source.
 */
export function pythonVersionFile(file: string, text: string): Source[] {
  const out: Source[] = []
  text.split(/\r?\n/).forEach((line, i) => {
    const body = line.replace(/(^|\s)#.*$/, '').trim()
    if (body === '') return
    out.push({
      runtime: 'python',
      file,
      line: i + 1,
      column: line.indexOf(body) + 1,
      raw: body,
      kind: 'python-version',
      constraint: parseConstraint(body, 'python'),
    })
  })
  return out
}

/** `runtime.txt` (Heroku): `python-3.7.6`. Only a first line that starts with `python-` is a Python pin. */
export function runtimeTxtSources(file: string, text: string): Source[] {
  const lines = text.split(/\r?\n/)
  const index = lines.findIndex((l) => l.trim() !== '')
  if (index < 0) return []
  const body = (lines[index] as string).trim()
  if (!/^python-/i.test(body)) return []
  return [
    {
      runtime: 'python',
      file,
      line: index + 1,
      column: (lines[index] as string).indexOf(body) + 1,
      raw: body,
      kind: 'runtime-txt',
      constraint: parseConstraint(body, 'python'),
    },
  ]
}

/**
 * Finds a key that `locateTomlKey` cannot (an inline table such as `project = { requires-python = ">=3.9" }`):
 * the line holding `key = "value"`, else the line of the table's own key, else line 1.
 */
function fallbackLocation(text: string, key: string, tableKey: string): { line: number; column: number; raw: string } {
  const lines = text.split(/\r?\n/)
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`(^|[\\s{,])"?${escaped}"?\\s*=\\s*(["'])`)
  for (let i = 0; i < lines.length; i++) {
    const m = re.exec(lines[i] as string)
    if (m) {
      const column = (m.index as number) + (m[0] as string).length + 1
      return { line: i + 1, column, raw: (lines[i] as string).slice(column - 1) }
    }
  }
  const owner = locateTomlKey(text, [], tableKey)
  return { line: owner?.line ?? 1, column: owner?.column ?? 1, raw: '' }
}

function tomlString(raw: string): { text: string; quoted: boolean } | undefined {
  const m = /^(["'])(.*)\1$/.exec(raw.trim())
  return m ? { text: m[2] as string, quoted: true } : undefined
}

/**
 * `pyproject.toml`: `project.requires-python` (PEP 440) and Poetry's `tool.poetry.dependencies.python`.
 * A file that is not valid TOML gives no sources: the syntax error is reported once, as a
 * diagnostic, by `diagnoseFile`.
 */
export function pyprojectSources(file: string, text: string): Source[] {
  const data = parseToml(text)
  // A file that is not valid TOML has no readable fields: `diagnoseFile` reports the syntax error and
  // nothing is guessed from the text (a second, partial report would contradict it).
  if (data === undefined) return []
  const out: Source[] = []
  const fields: { table: string[]; key: string; kind: string; value: unknown }[] = [
    { table: ['project'], key: 'requires-python', kind: 'requires-python', value: (data?.project as Record<string, unknown> | undefined)?.['requires-python'] },
    {
      table: ['tool', 'poetry', 'dependencies'],
      key: 'python',
      kind: 'poetry-python',
      value: ((data?.tool as Record<string, unknown> | undefined)?.poetry as Record<string, unknown> | undefined)?.dependencies
        ? (((data?.tool as Record<string, unknown>).poetry as Record<string, unknown>).dependencies as Record<string, unknown>).python
        : undefined,
    },
  ]
  for (const f of fields) {
    if (f.value === undefined) continue
    const located = locateTomlKey(text, f.table, f.key)
    const where = located ?? fallbackLocation(text, f.key, f.table[0] as string)
    if (!where) continue
    const written = tomlString(where.raw)
    const raw = written ? written.text : where.raw
    const column = located ? where.column + (written ? 1 : 0) : where.column
    const base = { runtime: 'python', file, line: where.line, column, raw, kind: f.kind } as const
    if (typeof f.value !== 'string') {
      out.push({ ...base, constraint: { kind: 'unknown', reason: `${f.table.join('.')}.${f.key} is not a plain string` } })
    } else {
      out.push({ ...base, raw: f.value, constraint: parseConstraint(f.value, 'python') })
    }
  }
  return out
}
