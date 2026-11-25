/**
 * Which Docker images are a runtime's own image (docs/TASKS.md A12). An image maps to a runtime
 * only when it is the official image or a well-known mirror of it; any other repository whose name
 * merely ends in `/python` (for example `mcr.microsoft.com/playwright/python`, whose tag is the
 * Playwright version) is not a runtime pin and is ignored, never guessed.
 */
import type { Runtime } from '../../types'

/** Registries that serve Docker Hub's `library/<name>` images under another host. */
const LIBRARY_HOSTS = ['docker.io', 'index.docker.io', 'registry-1.docker.io', 'registry.hub.docker.com', 'mirror.gcr.io', 'public.ecr.aws/docker']

/** Official and well-known images per runtime, after the library host and `library/` are removed. */
const IMAGES: Record<Runtime, readonly string[]> = {
  node: ['node', 'cimg/node', 'circleci/node', 'public.ecr.aws/lambda/nodejs', 'mcr.microsoft.com/devcontainers/javascript-node'],
  python: ['python', 'cimg/python', 'circleci/python', 'public.ecr.aws/lambda/python'],
  go: ['golang', 'cimg/go', 'circleci/golang'],
}

/** `docker.io/library/node` and `public.ecr.aws/docker/library/node` become `node`; other names stay. */
function canonicalImage(image: string): string {
  let n = image.trim().toLowerCase()
  for (const host of LIBRARY_HOSTS) {
    if (n.startsWith(`${host}/`)) {
      n = n.slice(host.length + 1)
      break
    }
  }
  return n.startsWith('library/') ? n.slice('library/'.length) : n
}

/**
 * True when `image` (a name without tag or digest, registry and path included) is the official
 * image of `runtime` or a well-known mirror: `node`, `library/node`, `docker.io/library/node`,
 * `public.ecr.aws/docker/library/node`, `cimg/node`, `public.ecr.aws/lambda/nodejs`, and so on.
 */
export function isRuntimeImage(image: string, runtime: Runtime): boolean {
  return IMAGES[runtime].includes(canonicalImage(image))
}
