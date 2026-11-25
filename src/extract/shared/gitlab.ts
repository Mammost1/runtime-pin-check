/** `.gitlab-ci.yml` image parser. Pure; never throws. */
import { splitImageRef } from './imageref'
import { entries, getPair, loadYamlAll, resolveNode, scalarText, isMap } from './yaml-util'
import type { Yaml } from './yaml-util'

/** One `image:` of a GitLab CI file. */
export interface GitlabImage {
  /** Image name with registry and path (`node`). */
  image: string
  /** Tag as written; `${NODE_VERSION}`-style variables are NOT resolved and stay raw. */
  tag?: string
  digest?: string
  /** 1-based line and column of the image reference. */
  line: number
  column: number
  /** Job name; `default` for the top-level `image:` and for `default: image:`. */
  job: string
  /** The reference exactly as written. */
  raw: string
}

function imageOf(y: Yaml, node: unknown, job: string): GitlabImage | undefined {
  const direct = scalarText(y, node)
  const target = direct ?? scalarText(y, getPair(y, node, 'name')?.value)
  if (!target || target.text === '') return undefined
  const parts = splitImageRef(target.text)
  const out: GitlabImage = { image: parts.image, line: target.line, column: target.column, job, raw: target.text }
  if (parts.tag !== undefined) out.tag = parts.tag
  if (parts.digest !== undefined) out.digest = parts.digest
  return out
}

/**
 * Lists every `image:` in a `.gitlab-ci.yml`: the top-level one, `default: image:` and each job's
 * (a plain string or `{name: …}`). Hidden template jobs (`.name`) are included. `extends:` and
 * `include:` are not followed; YAML merge keys (`<<: *x`) are.
 */
export function parseGitlabCi(text: string): GitlabImage[] {
  try {
    return (loadYamlAll(text) ?? []).flatMap((y) => parseGitlabDocument(y))
  } catch {
    return []
  }
}

function parseGitlabDocument(y: Yaml): GitlabImage[] {
  try {
    const root = resolveNode(y, y.doc.contents)
    if (!isMap(root)) return []
    const out: GitlabImage[] = []
    const top = getPair(y, root, 'image')
    if (top) {
      const found = imageOf(y, top.value, 'default')
      if (found) out.push(found)
    }
    for (const { key, value } of entries(y, root)) {
      if (key === 'image') continue
      if (key === 'default') {
        const found = imageOf(y, getPair(y, value, 'image')?.value, 'default')
        if (found) out.push(found)
        continue
      }
      if (['stages', 'variables', 'include', 'workflow', 'services', 'cache', 'before_script', 'after_script'].includes(key)) continue
      const pair = getPair(y, value, 'image')
      if (!pair) continue
      const found = imageOf(y, pair.value, key)
      if (found) out.push(found)
    }
    return out
  } catch {
    return []
  }
}
