/** Container and CI files: Dockerfile `FROM`, GitHub `actions/setup-node`, GitLab `image:`. */
import { dockerTagConstraint } from '../../constraint'
import { parseDockerfile, parseGitlabCi, parseWorkflow, workflowSourcePaths } from '../shared'
import type { Constraint, Source } from '../../types'
import { isNodeImage, nodeConstraint, nodeSource } from './util'

/** A tag with an unresolved variable, or a digest with no tag, is `unknown` (never guessed); otherwise Docker tag rules apply. */
function tagConstraint(tag: string | undefined, digest?: string): Constraint {
  // A digest is immutable, so a digest-only reference is not floating; the version it holds is unknown.
  if (tag === undefined && digest !== undefined) return { kind: 'unknown', reason: 'pinned by digest, the version is not in the reference' }
  if (tag !== undefined && /\$/.test(tag)) return { kind: 'unknown', reason: 'tag contains an unresolved variable' }
  return dockerTagConstraint(tag, 'node')
}

/**
 * Dockerfile: every `FROM` of a Node image, multi-stage included. A global `ARG` default that
 * fills the tag is substituted; the Source then points at the `ARG` value, the text a fix would
 * edit (listed once however many stages use it), while the constraint is read from the whole tag (`18.18.2-slim`, `22.17.0-bullseye-slim`).
 * A `FROM` of an earlier stage that happens to be named `node` is not an image.
 */
export function extractDockerfile(file: string, text: string): Source[] {
  const out: Source[] = []
  const stages = new Set<string>()
  // Several stages can read one ARG; that is one pin at one place, listed once.
  const seenArgs = new Set<string>()
  for (const from of parseDockerfile(text)) {
    // `FROM <stage>` never has a tag or digest; `FROM node:22` is always an image.
    const isStage = from.tag === undefined && from.digest === undefined && stages.has(from.image.toLowerCase())
    if (from.stage) stages.add(from.stage.toLowerCase())
    if (isStage || !isNodeImage(from.image)) continue
    const constraint = tagConstraint(from.tag, from.digest)
    if (from.arg) {
      const value = new RegExp(`\\b${from.arg.name}=(["']?)([^\\s"']*)`).exec(text.split(/\r?\n/)[from.arg.line - 1] ?? '')
      if (value) {
        const line = text.split(/\r?\n/)[from.arg.line - 1] as string
        const column = value.index + value[0].length - (value[2] as string).length + 1
        const key = `${from.arg.line}:${column}`
        if (!seenArgs.has(key)) {
          seenArgs.add(key)
          out.push(nodeSource(file, 'dockerfile', from.arg.line, value[2] as string, constraint, { column: Math.min(column, line.length + 1) }))
        }
        continue
      }
    }
    const raw = from.tag ?? from.raw
    const column = from.tag !== undefined && !from.arg && from.raw.startsWith(`${from.image}:`) ? from.column + from.image.length + 1 : from.column
    out.push(nodeSource(file, 'dockerfile', from.line, raw, constraint, { column }))
  }
  return out
}

/** `working-directory` as a project root relative to the repo: `./a/` becomes `a`; templates are left out. */
function projectRoot(dir: string | undefined): string | undefined {
  if (dir === undefined || /\$\{\{/.test(dir) || dir.startsWith('/')) return undefined
  const clean = dir.replace(/^(\.\/)+/, '').replace(/\/+$/, '')
  return clean === '' ? '.' : clean
}

/**
 * GitHub workflows and composite actions: `node-version` of every `actions/setup-node` step. Each
 * value of a matrix it points to is its own matrix Source. `node-version-file` is a reference to
 * a file that is read on its own, not a pin. Only the step's own `working-directory` (or the
 * `defaults.run` one) scopes it; a job that works in a subdirectory elsewhere does not.
 */
export function extractWorkflow(file: string, text: string): Source[] {
  const out: Source[] = []
  for (const step of parseWorkflow(text)) {
    if (!/^actions\/setup-node(@|$)/i.test(step.uses)) continue
    const input = step.with['node-version']
    if (!input) continue
    const dir = projectRoot(step.workingDirectory)
    const paths = workflowSourcePaths(step)
    const base = dir === undefined ? { paths } : { workingDirectory: dir, paths }
    const ref = /^\$\{\{\s*matrix\.([A-Za-z0-9_-]+)\s*\}\}$/.exec(input.value.trim())
    const m = input.resolved ?? (ref ? step.matrix[ref[1] as string] : undefined)
    if (m) {
      if (m.expression !== undefined || m.values.length === 0) {
        // The matrix is computed (fromJSON, ...): there is nothing static to read.
        out.push(nodeSource(file, 'setup-node', input.line, input.value, { kind: 'unknown', reason: 'matrix is computed by an expression' }, { ...base, matrix: true, column: input.column }))
        continue
      }
      m.values.forEach((value, i) => {
        out.push(nodeSource(file, 'setup-node', m.lines[i] as number, value, nodeConstraint(value), { ...base, matrix: true, column: m.columns[i] as number }))
      })
      continue
    }
    // `${{ env.X }}` resolved from an `env:` of the step, job or workflow: the constraint is the env value,
    // the source still points at the `with:` input as written (docs/TASKS.md A12).
    out.push(nodeSource(file, 'setup-node', input.line, input.value, nodeConstraint(input.env?.value ?? input.value), { ...base, column: input.column }))
  }
  return out
}

/** `.gitlab-ci.yml`: every `image:` of a Node image; a `${VAR}` tag is `unknown`, not a crash. */
export function extractGitlabCi(file: string, text: string): Source[] {
  const out: Source[] = []
  for (const img of parseGitlabCi(text)) {
    if (!isNodeImage(img.image)) continue
    const constraint = tagConstraint(img.tag, img.digest)
    const raw = img.tag ?? img.raw
    const column = img.tag !== undefined && img.raw.startsWith(`${img.image}:`) ? img.column + img.image.length + 1 : img.column
    out.push(nodeSource(file, 'gitlab-ci', img.line, raw, constraint, { column }))
  }
  return out
}
