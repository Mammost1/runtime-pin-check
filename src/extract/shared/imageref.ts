/**
 * Splits a Docker image reference such as `public.ecr.aws/lambda/nodejs:24` or
 * `node:22.11.0-bookworm-slim@sha256:ab…` into its parts. Format only: no runtime knowledge.
 */

/** The parts of an image reference. `image` keeps any registry and path (`public.ecr.aws/lambda/nodejs`). */
export interface ImageRef {
  image: string
  tag?: string
  digest?: string
}

/**
 * Splits `name[:tag][@digest]`. A colon belongs to the tag only when it comes after the last `/`,
 * so a registry port (`localhost:5000/node`) is not mistaken for a tag.
 */
export function splitImageRef(ref: string): ImageRef {
  let rest = ref
  let digest: string | undefined
  const at = rest.indexOf('@')
  if (at >= 0) {
    digest = rest.slice(at + 1)
    rest = rest.slice(0, at)
  }
  const colon = rest.lastIndexOf(':')
  const tagColon = colon > rest.lastIndexOf('/') ? colon : -1
  const out: ImageRef = { image: tagColon >= 0 ? rest.slice(0, tagColon) : rest }
  if (tagColon >= 0) out.tag = rest.slice(tagColon + 1)
  if (digest !== undefined && digest !== '') out.digest = digest
  return out
}
