/** `go.mod` directives: `go 1.22` (a minimum) and `toolchain go1.22.3` (an exact toolchain). */
import { parseConstraint } from '../../constraint'
import type { Constraint, Source } from '../../types'

/**
 * Reads the top-level `go` and `toolchain` directives. Lines inside `( … )` blocks (`require`,
 * `replace`, …) are skipped, `//` comments are ignored.
 *
 * - `go 1.22` / `go 1.22.3`: the module's minimum Go version, so the constraint is `>=1.22.0` /
 *   `>=1.22.3` (docs/TASKS.md A8). `raw` stays as written.
 * - `toolchain go1.22.3`: exact. `toolchain default` and `toolchain local` choose the toolchain
 *   at build time and become `unknown` with that reason.
 */
export function goModSources(file: string, text: string): Source[] {
  const out: Source[] = []
  let depth = 0
  text.split(/\r?\n/).forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, '')
    const openers = (code.match(/\(/g) ?? []).length
    const closers = (code.match(/\)/g) ?? []).length
    const inBlock = depth > 0
    depth = Math.max(0, depth + openers - closers)
    if (inBlock) return
    const m = /^(\s*)(go|toolchain)\s+(\S+)\s*$/.exec(code)
    if (!m) return
    const directive = m[2] as string
    const raw = m[3] as string
    const column = (m[1] as string).length + directive.length + (code.slice((m[1] as string).length + directive.length).length - code.slice((m[1] as string).length + directive.length).trimStart().length) + 1
    let constraint: Constraint
    if (directive === 'go') {
      const exact = /^\d+\.\d+(\.\d+)?$/.test(raw)
      constraint = exact ? parseConstraint(`>=${raw}`, 'go') : { kind: 'unknown', reason: `go directive ${raw} is not a plain version` }
    } else if (raw === 'default' || raw === 'local') {
      constraint = { kind: 'unknown', reason: `toolchain ${raw} selects the toolchain at build time` }
    } else {
      constraint = parseConstraint(raw, 'go')
    }
    out.push({ runtime: 'go', file, line: i + 1, column, raw, kind: directive === 'go' ? 'go-mod' : 'go-toolchain', constraint })
  })
  return out
}
