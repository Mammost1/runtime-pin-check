/**
 * Python version pins (docs/TASKS.md, Extractors): `.python-version`, `pyproject.toml`
 * (`project.requires-python`, Poetry `tool.poetry.dependencies.python`), `.tool-versions`
 * (`python`), `mise.toml`, `Dockerfile*` (`FROM python:`), `actions/setup-python`, `runtime.txt`.
 * Not read in v1: `Pipfile`, `setup.py`/`setup.cfg`, `tox.ini`, and actions other than
 * `actions/setup-python` (for example `astral-sh/setup-uv`).
 */
import type { Source } from '../../types'
import { baseName, dockerfileSources, guardColumns, isDockerfile, isMiseFile, isToolVersions, isWorkflowFile, miseSources, toolVersionsSources, workflowSources } from './adapters'
import { pythonVersionFile, pyprojectSources, runtimeTxtSources } from './files'

function dispatch(file: string, text: string): Source[] {
  const name = baseName(file)
  if (name === '.python-version') return pythonVersionFile(file, text)
  if (name === 'pyproject.toml') return pyprojectSources(file, text)
  if (name === 'runtime.txt') return runtimeTxtSources(file, text)
  if (isToolVersions(file)) return toolVersionsSources(file, text, 'python', ['python'])
  if (isMiseFile(file)) return miseSources(file, text, 'python', ['python'])
  if (isDockerfile(file)) return dockerfileSources(file, text, 'python')
  if (isWorkflowFile(file)) return workflowSources(file, text, 'python', 'actions/setup-python', 'python-version')
  return []
}

/**
 * Extracts the Python pins of one file. Returns [] for files it does not handle. Pure; never throws.
 *
 * @param file - Repo-relative path with `/` separators.
 * @param text - The file's content.
 */
export function extractPython(file: string, text: string): Source[] {
  try {
    return guardColumns(text, dispatch(file, text))
  } catch {
    return []
  }
}
