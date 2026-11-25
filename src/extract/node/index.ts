/**
 * Node pins (docs/TASKS.md, Extractors and A8): `extractNode(file, text)` reads one file and
 * returns every Node version it pins, or [] for a file it does not handle. Pure; never throws.
 */
import type { Source } from '../../types'
import { extractDockerfile, extractGitlabCi, extractWorkflow } from './ci'
import { extractPackageJson } from './package-json'
import { extractMise, extractToolVersions, extractVersionFile } from './version-files'

const WORKFLOW = /(^|\/)\.github\/(workflows\/[^/]+|actions\/.+\/action)\.ya?ml$/i
const ACTION = /(^|\/)action\.ya?ml$/i
const GITLAB = /(^|\/)\.gitlab-ci\.ya?ml$/i
const MISE = /(^|\/)(\.?mise(\.[\w-]+)?\.toml|\.config\/mise(\/config)?\.toml|mise\/config\.toml)$/i
const DOCKERFILE = /^(Dockerfile(\..+)?|.+\.Dockerfile)$/i
/** `Dockerfile.md` and friends are documents about a Dockerfile, not one. */
const NOT_DOCKERFILE = /\.(md|markdown|txt|rst|json|ya?ml|toml|sh|bak|orig)$/i

/** The Node pins in one file. `file` is repo-relative with '/' separators. */
export function extractNode(file: string, text: string): Source[] {
  try {
    const base = file.slice(file.lastIndexOf('/') + 1)
    if (base === '.nvmrc') return extractVersionFile(file, text, 'nvmrc')
    if (base === '.node-version') return extractVersionFile(file, text, 'node-version')
    if (base === 'package.json') return extractPackageJson(file, text)
    if (base === '.tool-versions') return extractToolVersions(file, text)
    if (MISE.test(file)) return extractMise(file, text)
    if (DOCKERFILE.test(base) && !NOT_DOCKERFILE.test(base)) return extractDockerfile(file, text)
    if (GITLAB.test(file)) return extractGitlabCi(file, text)
    if (WORKFLOW.test(file) || ACTION.test(file)) return extractWorkflow(file, text)
    return []
  } catch {
    return []
  }
}
