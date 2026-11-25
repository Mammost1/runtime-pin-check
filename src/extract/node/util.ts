/** Helpers shared by the Node extractors. */
import { isRuntimeImage } from '../shared'
import { parseConstraint } from '../../constraint'
import type { Constraint, Source } from '../../types'

/** Builds a Node `Source`. `extra` carries `matrix` / `workingDirectory` / `column` / `paths`. */
export function nodeSource(
  file: string,
  kind: string,
  line: number,
  raw: string,
  constraint: Constraint,
  extra: Partial<Pick<Source, 'column' | 'matrix' | 'workingDirectory' | 'paths'>> = {},
): Source {
  const source: Source = { runtime: 'node', file, line, raw, kind, constraint }
  if (extra.column !== undefined) source.column = extra.column
  if (extra.matrix) source.matrix = true
  if (extra.workingDirectory !== undefined) source.workingDirectory = extra.workingDirectory
  if (extra.paths !== undefined && extra.paths.length > 0) source.paths = extra.paths
  return source
}

/** The constraint of a version written in a file; a variable or template is `unknown`, never guessed. */
export function nodeConstraint(raw: string): Constraint {
  return parseConstraint(raw, 'node')
}

/** True when `image` is the official Node image or a well-known mirror (docs/TASKS.md A12). */
export function isNodeImage(image: string): boolean {
  return isRuntimeImage(image, 'node')
}

/** 1-based column of `needle` in line `line` of `text` (searching from `from`), or undefined. */
export function columnOf(text: string, line: number, needle: string, from = 0): number | undefined {
  const l = text.split(/\r?\n/)[line - 1]
  if (l === undefined) return undefined
  const i = l.indexOf(needle, from)
  return i < 0 ? undefined : i + 1
}
