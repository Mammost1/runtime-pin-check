/**
 * File-level read diagnostics (docs/TASKS.md constraint 9): a YAML, TOML or JSON syntax error is
 * reported with its file, line and column instead of silently dropping pins. A broken file is not
 * a finding (it has no runtime to compare) and never changes the exit code.
 */
import type { Diagnostic, Runtime } from '../types'
import { loadYamlAll } from './shared/yaml-util'
import { parseTomlDetailed } from './shared'

/**
 * The YAML files the extractors read as CI files: top-level `.github/workflows/*.yml|yaml` (GitHub
 * ignores subfolders, so `.github/workflows/resources/*.yaml` are NOT workflows) and composite
 * `action.yml|yaml` where the extractors recognise them (docs/TASKS.md A15).
 */
const WORKFLOW_YAML = /(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/i
const ACTION_YAML = /(^|\/)action\.ya?ml$/i
const GITLAB_YAML = /(^|\/)\.gitlab-ci\.ya?ml$/i
const MISE_TOML = /(^|\/)(\.?mise(\..+)?\.toml|\.config\/mise\/config(\..+)?\.toml|\.config\/mise\.toml)$/i

function firstLine(text: string): string {
  return (text.split('\n')[0] ?? '').trim()
}

function yamlDiagnostic(file: string, text: string): Diagnostic | undefined {
  const docs = loadYamlAll(text)
  if (!docs) return { file, line: 1, message: 'YAML could not be parsed at all; no pins were read from this file.' }
  // A multi-document stream is valid YAML; the errors of every document count, in file order.
  const errors = docs.flatMap((y) => y.doc.errors.map((e) => ({ e, y })))
  const first = errors[0]
  if (!first) return undefined
  const { line, column } = first.y.pos(first.e.pos[0])
  const more = errors.length > 1 ? ` (${errors.length - 1} more error${errors.length === 2 ? '' : 's'} in this file)` : ''
  return {
    file,
    line,
    column,
    message: `YAML syntax error: ${firstLine(first.e.message)}${more}. Pins before this point were read; pins after it may not have been.`,
  }
}

function tomlDiagnostic(file: string, text: string): Diagnostic | undefined {
  const r = parseTomlDetailed(text)
  if (!('error' in r)) return undefined
  return { file, line: r.error.line, column: r.error.column, message: `TOML syntax error: ${r.error.message}. No pins were read from this file.` }
}

function jsonDiagnostic(file: string, text: string): Diagnostic | undefined {
  try {
    JSON.parse(text)
    return undefined
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    let line = 1
    let column: number | undefined
    const lc = /\(line (\d+) column (\d+)\)/.exec(message)
    const pos = /position (\d+)/.exec(message)
    if (lc) {
      line = Number(lc[1])
      column = Number(lc[2])
    } else if (pos) {
      const before = text.slice(0, Number(pos[1]))
      line = before.split('\n').length
      column = Number(pos[1]) - (before.lastIndexOf('\n') + 1) + 1
    }
    const d: Diagnostic = { file, line, message: `JSON syntax error: ${message.replace(/\s*\(line \d+ column \d+\)/, '')}. No pins were read from this file.` }
    if (column !== undefined) d.column = column
    return d
  }
}

/**
 * The parse error of one file, if it has one. Only files the extractors read are checked: GitHub
 * workflows and composite actions and `.gitlab-ci.yml` (YAML), `pyproject.toml` and mise files
 * (TOML), `package.json` (JSON). `runtimes` limits the check to files that matter for the
 * selected runtimes (`package.json` is Node's, `pyproject.toml` Python's).
 *
 * @param file - Repo-relative path with `/` separators.
 * @param text - The file's content (byte-order mark already removed).
 */
export function diagnoseFile(file: string, text: string, runtimes: readonly Runtime[] = ['node', 'python', 'go']): Diagnostic[] {
  try {
    const base = file.slice(file.lastIndexOf('/') + 1)
    let d: Diagnostic | undefined
    if (WORKFLOW_YAML.test(file) || ACTION_YAML.test(file) || GITLAB_YAML.test(file)) d = yamlDiagnostic(file, text)
    else if (base === 'package.json' && runtimes.includes('node')) d = jsonDiagnostic(file, text)
    else if (base === 'pyproject.toml' && runtimes.includes('python')) d = tomlDiagnostic(file, text)
    else if (MISE_TOML.test(file)) d = tomlDiagnostic(file, text)
    return d ? [d] : []
  } catch {
    return []
  }
}
