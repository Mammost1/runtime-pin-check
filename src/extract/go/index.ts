/**
 * Go version pins (docs/TASKS.md, Extractors): `go.mod` (`go` and `toolchain` directives),
 * `.tool-versions` (`golang`/`go`), `mise.toml`, `Dockerfile*` (`FROM golang:`), and
 * `actions/setup-go` (`go-version`; `go-version-file` is a reference, not a pin).
 * Not read in v1: `go.work`, and `GOTOOLCHAIN` in the environment.
 */
import type { Source } from '../../types'
import { baseName, dockerfileSources, guardColumns, isDockerfile, isMiseFile, isToolVersions, isWorkflowFile, miseSources, toolVersionsSources, workflowSources } from '../python/adapters'
import { goModSources } from './gomod'

const GO_TOOLS = ['golang', 'go'] as const

function dispatch(file: string, text: string): Source[] {
  if (baseName(file) === 'go.mod') return goModSources(file, text)
  if (isToolVersions(file)) return toolVersionsSources(file, text, 'go', GO_TOOLS)
  if (isMiseFile(file)) return miseSources(file, text, 'go', GO_TOOLS)
  if (isDockerfile(file)) return dockerfileSources(file, text, 'go')
  if (isWorkflowFile(file)) return workflowSources(file, text, 'go', 'actions/setup-go', 'go-version')
  return []
}

/**
 * Extracts the Go pins of one file. Returns [] for files it does not handle. Pure; never throws.
 *
 * @param file - Repo-relative path with `/` separators.
 * @param text - The file's content.
 */
export function extractGo(file: string, text: string): Source[] {
  try {
    return guardColumns(text, dispatch(file, text))
  } catch {
    return []
  }
}
