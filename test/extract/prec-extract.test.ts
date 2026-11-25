/**
 * rpc-prec-extract (docs/TASKS.md A12): `${{ env.X }}` resolves from `env:`, and a Docker image is a
 * runtime pin only when it is the runtime's official image or a well-known mirror. Shapes come
 * from the corpus (bench/corpus.md: F-resolvable 13, F-misparse 1).
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { bindSources, compareSources } from '../../src/compare'
import { extractGo } from '../../src/extract/go'
import { extractNode } from '../../src/extract/node'
import { extractPython } from '../../src/extract/python'
import { cleanWorkflowPath, isRuntimeImage, parseGitlabCi, parseWorkflow } from '../../src/extract/shared'
import type { Source } from '../../src/types'

const fixture = (f: string) => readFileSync(new URL(`./shared/fixtures/${f}`, import.meta.url), 'utf8')
const wf = (head: string, stepWith: string, stepExtra = '') => `${head}jobs:\n  a:\n    steps:\n      - uses: actions/setup-node@v4\n${stepExtra}        with:\n          node-version: ${stepWith}\n`
const WORKFLOW = '.github/workflows/ci.yml'

describe('parseWorkflow: ${{ env.X }} (corpus F-resolvable, DRYTRIX/TimeTracker)', () => {
  it('real ci.yml: workflow-level env NODE_VERSION resolves for every setup-node step; the with value keeps its own line', () => {
    const all = parseWorkflow(fixture('drytrix-timetracker.ci.yml')).filter((s) => s.uses.startsWith('actions/setup-node@'))
    const steps = all.filter((s) => s.with['node-version']?.value === '${{ env.NODE_VERSION }}')
    expect(all).toHaveLength(3)
    expect(steps.map((s) => s.with['node-version']?.line)).toEqual([463, 541])
    for (const step of steps) {
      expect(step.with['node-version']?.env).toEqual({ name: 'NODE_VERSION', value: '20', quoted: true, line: 26, column: 18 })
    }
    // The third setup-node step has a literal '24': nothing to resolve.
    expect(all[2]?.with['node-version']).toMatchObject({ value: '24', quoted: true })
    expect(all[2]?.with['node-version']?.env).toBeUndefined()
  })

  it('real build-desktop.yml resolves too', () => {
    const steps = parseWorkflow(fixture('drytrix-timetracker.build-desktop.yml')).filter((s) => s.uses.startsWith('actions/setup-node@'))
    expect(steps.length).toBeGreaterThan(0)
    expect(steps.every((s) => s.with['node-version']?.env !== undefined)).toBe(true)
  })

  it('looks in the step, then the job, then the workflow', () => {
    const text = (stepEnv: string, jobEnv: string, topEnv: string) =>
      `${topEnv}jobs:\n  a:\n${jobEnv}    steps:\n      - uses: actions/setup-node@v4\n${stepEnv}        with:\n          node-version: \${{ env.V }}\n`
    const top = 'env:\n  V: "18"\n'
    const job = '    env:\n      V: "20"\n'
    const step = '        env:\n          V: "22"\n'
    const value = (t: string) => parseWorkflow(t)[0]?.with['node-version']?.env?.value
    expect(value(text(step, job, top))).toBe('22')
    expect(value(text('', job, top))).toBe('20')
    expect(value(text('', '', top))).toBe('18')
    expect(value(text('', '', ''))).toBeUndefined()
  })

  it('accepts spacing variants; does not resolve an env value that is an expression, a longer string, or another name', () => {
    const top = 'env:\n  V: "20"\n  E: ${{ github.event.inputs.v }}\n'
    expect(parseWorkflow(wf(top, '${{env.V}}'))[0]?.with['node-version']?.env?.value).toBe('20')
    expect(parseWorkflow(wf(top, '${{   env.V   }}'))[0]?.with['node-version']?.env?.value).toBe('20')
    expect(parseWorkflow(wf(top, '${{ env.E }}'))[0]?.with['node-version']?.env).toBeUndefined()
    expect(parseWorkflow(wf(top, '${{ env.V }}.x'))[0]?.with['node-version']?.env).toBeUndefined()
    expect(parseWorkflow(wf(top, '${{ env.MISSING }}'))[0]?.with['node-version']?.env).toBeUndefined()
    expect(parseWorkflow(wf(top, '${{ vars.V }}'))[0]?.with['node-version']?.env).toBeUndefined()
  })
})

describe('extractors use the resolved env value, and still point at the `with:` input as written', () => {
  it('node: real DRYTRIX ci.yml gives partial 20 with raw ${{ env.NODE_VERSION }} at line 463 and a column at raw', () => {
    const text = fixture('drytrix-timetracker.ci.yml')
    const s = extractNode(WORKFLOW, text).filter((x) => x.kind === 'setup-node')
    expect(s.map((x) => x.line)).toEqual([463, 541, 597])
    expect(s[0]).toMatchObject({ line: 463, raw: '${{ env.NODE_VERSION }}', constraint: { kind: 'partial', version: '20' } })
    expect(s[2]).toMatchObject({ raw: '24', constraint: { kind: 'partial', version: '24' } })
    for (const x of s) {
      expect(x.constraint.kind, `line ${x.line}`).toBe('partial')
      expect((text.split(/\r?\n/)[x.line - 1] ?? '').startsWith(x.raw, (x.column ?? 0) - 1)).toBe(true)
    }
  })

  it('node: an undefined env var stays UNPARSEABLE (unknown), as before', () => {
    expect(extractNode(WORKFLOW, wf('', '${{ env.NOPE }}'))[0]?.constraint.kind).toBe('unknown')
  })

  it('python and go: env value is the constraint; an unquoted 3.10 in env still trips the YAML-number guard', () => {
    const py = (v: string, head: string) => `${head}jobs:\n  a:\n    steps:\n      - uses: actions/setup-python@v5\n        with:\n          python-version: ${v}\n`
    expect(extractPython(WORKFLOW, py('${{ env.PY }}', 'env:\n  PY: "3.11"\n'))[0]).toMatchObject({ raw: '${{ env.PY }}', constraint: { kind: 'partial', version: '3.11' } })
    expect(extractPython(WORKFLOW, py('${{ env.PY }}', 'env:\n  PY: 3.10\n'))[0]?.constraint).toMatchObject({ kind: 'unknown' })
    expect(extractPython(WORKFLOW, py('${{ env.PY }}', ''))[0]?.constraint).toMatchObject({ kind: 'unknown' })
    const go = `env:\n  GO: "1.22"\njobs:\n  a:\n    steps:\n      - uses: actions/setup-go@v5\n        with:\n          go-version: \${{ env.GO }}\n`
    expect(extractGo(WORKFLOW, go)[0]).toMatchObject({ raw: '${{ env.GO }}', constraint: { kind: 'partial', version: '1.22' } })
  })
})

describe('isRuntimeImage: official images and well-known mirrors only (A12)', () => {
  const yes: [string, 'node' | 'python' | 'go'][] = [
    ['node', 'node'], ['library/node', 'node'], ['docker.io/node', 'node'], ['docker.io/library/node', 'node'], ['public.ecr.aws/docker/library/node', 'node'],
    ['cimg/node', 'node'], ['circleci/node', 'node'], ['public.ecr.aws/lambda/nodejs', 'node'], ['mcr.microsoft.com/devcontainers/javascript-node', 'node'], ['mirror.gcr.io/library/node', 'node'], ['NODE', 'node'],
    ['python', 'python'], ['library/python', 'python'], ['docker.io/library/python', 'python'], ['public.ecr.aws/docker/library/python', 'python'], ['cimg/python', 'python'], ['circleci/python', 'python'], ['public.ecr.aws/lambda/python', 'python'],
    ['golang', 'go'], ['library/golang', 'go'], ['docker.io/golang', 'go'], ['docker.io/library/golang', 'go'], ['public.ecr.aws/docker/library/golang', 'go'], ['cimg/go', 'go'], ['circleci/golang', 'go'],
  ]
  const no: [string, 'node' | 'python' | 'go'][] = [
    ['mcr.microsoft.com/playwright/python', 'python'], ['mcr.microsoft.com/playwright', 'node'], ['someuser/node', 'node'], ['docker.io/someuser/python', 'python'], ['ghcr.io/org/golang', 'go'],
    ['registry.example.com/team/node', 'node'], ['nodejs', 'node'], ['python3', 'python'], ['golang-ci', 'go'], ['alpine', 'node'], ['node', 'python'], ['python', 'go'], ['cimg/node', 'python'], ['', 'node'], ['chef', 'node'],
  ]
  it.each(yes)('%s is the %s image', (image, runtime) => expect(isRuntimeImage(image, runtime)).toBe(true))
  it.each(no)('%s is not the %s image', (image, runtime) => expect(isRuntimeImage(image, runtime)).toBe(false))
})

describe('Dockerfile images (corpus F-misparse: openenv/OpenEnv playwright/python)', () => {
  it('real OpenEnv Dockerfile: FROM mcr.microsoft.com/playwright/python:v1.44.0-jammy is not a Python pin', () => {
    const text = fixture('openenv-openenv.browsergym.Dockerfile')
    expect(extractPython('envs/browsergym_env/server/Dockerfile', text)).toEqual([])
    expect(extractNode('envs/browsergym_env/server/Dockerfile', text)).toEqual([])
    expect(extractGo('envs/browsergym_env/server/Dockerfile', text)).toEqual([])
  })
  it('third-party images named like a runtime are ignored in all three extractors; official ones and mirrors still count', () => {
    const text = 'FROM someuser/python:3.8\nFROM ghcr.io/org/node:14\nFROM registry.example.com/golang:1.10\nFROM docker.io/library/python:3.12\nFROM cimg/node:20.11\nFROM public.ecr.aws/docker/library/golang:1.22\nFROM node:22\n'
    expect(extractPython('Dockerfile', text).map((s) => [s.line, s.constraint.kind])).toEqual([[4, 'partial']])
    expect(extractNode('Dockerfile', text).map((s) => s.line)).toEqual([5, 7])
    expect(extractGo('Dockerfile', text).map((s) => s.line)).toEqual([6])
  })
  it('a bare `nodejs` image is not an official image any more; the Lambda one is', () => {
    expect(extractNode('Dockerfile', 'FROM nodejs:20\n')).toEqual([])
    expect(extractNode('Dockerfile', 'FROM public.ecr.aws/lambda/nodejs:24\n')).toHaveLength(1)
  })
  it('.gitlab-ci.yml uses the same list', () => {
    const ci = 'a:\n  image: registry.example.com/team/node:18\nb:\n  image: node:20\nc:\n  image: cimg/node:22.1\nd:\n  image: mcr.microsoft.com/playwright:v1.44.0\n'
    expect(parseGitlabCi(ci).map((i) => i.job)).toEqual(['a', 'b', 'c', 'd'])
    expect(extractNode('.gitlab-ci.yml', ci).map((s) => s.line)).toEqual([4, 6])
  })
})

describe('Source.paths (A13): repo-relative paths named by the same step or job', () => {
  it('cleanWorkflowPath', () => {
    const clean = (p: string) => cleanWorkflowPath(p)
    expect(clean('frontend/package-lock.json')).toBe('frontend/package-lock.json')
    expect(clean('./services/web/')).toBe('services/web')
    expect(clean('.')).toBe('.')
    expect(clean('./')).toBe('.')
    expect(clean("'apps/api/go.sum'")).toBe('apps/api/go.sum')
    // Globs are kept as written (never cut to a prefix): the binding ignores them (A14).
    expect(clean('frontend/**/package-lock.json')).toBe('frontend/**/package-lock.json')
    expect(clean('packages/*/package.json')).toBe('packages/*/package.json')
    expect(clean('**/package-lock.json')).toBe('**/package-lock.json')
    expect(clean('./apps/{a,b}/go.sum')).toBe('apps/{a,b}/go.sum')
    expect(clean('*.json')).toBe('*.json')
    expect(clean('!frontend/ignored')).toBeUndefined()
    expect(clean('/abs/path')).toBeUndefined()
    expect(clean('../outside')).toBeUndefined()
    expect(clean('${{ matrix.dir }}/x')).toBeUndefined()
    expect(clean('')).toBeUndefined()
  })

  const node = (inputs: string, extra = '', more = '') =>
    `jobs:\n  a:\n    steps:\n      - uses: actions/setup-node@v4\n${extra}        with:\n          node-version: 22\n${inputs}${more}`

  it('node: cache-dependency-path, node-version-file and the step working-directory', () => {
    const text = node('          cache-dependency-path: frontend/package-lock.json\n          node-version-file: services/web/.nvmrc\n', '        working-directory: ./tools/\n')
    expect(extractNode(WORKFLOW, text)[0]?.paths).toEqual(['frontend/package-lock.json', 'services/web/.nvmrc', 'tools'])
  })

  it('node: the working-directory of other steps in the job is included, the other jobs are not', () => {
    const text = `${node('')}      - run: npm test\n        working-directory: apps/web\n  b:\n    steps:\n      - run: x\n        working-directory: elsewhere\n`
    expect(extractNode(WORKFLOW, text)[0]?.paths).toEqual(['apps/web'])
  })

  it('node: a multi-line cache-dependency-path keeps globs as written, drops negations; matrix sources share the paths', () => {
    const text = `jobs:\n  a:\n    strategy:\n      matrix:\n        n: [20, 22]\n    steps:\n      - uses: actions/setup-node@v4\n        with:\n          node-version: \${{ matrix.n }}\n          cache-dependency-path: |\n            frontend/**/package-lock.json\n            !frontend/legacy\n            **/yarn.lock\n            api/package-lock.json\n`
    const s = extractNode(WORKFLOW, text)
    expect(s).toHaveLength(2)
    for (const x of s) expect(x.paths).toEqual(['frontend/**/package-lock.json', '**/yarn.lock', 'api/package-lock.json'])
  })

  it('node: expressions and absolute paths are left out; a step with no path has no paths field', () => {
    const text = node('          cache-dependency-path: ${{ matrix.dir }}/package-lock.json\n')
    expect(extractNode(WORKFLOW, text)[0]?.paths).toBeUndefined()
    expect('paths' in (extractNode(WORKFLOW, node(''))[0] ?? {})).toBe(false)
  })

  it('real DRYTRIX ci.yml: the two env-resolved setup-node steps name no path; the desktop one names its lockfile and its job directory', () => {
    const byLine = Object.fromEntries(extractNode(WORKFLOW, fixture('drytrix-timetracker.ci.yml')).map((s) => [s.line, s.paths]))
    expect(byLine[463]).toBeUndefined()
    expect(byLine[541]).toBeUndefined()
    expect(byLine[597]).toEqual(['desktop/package-lock.json', 'desktop'])
  })

  it('python and go: version files, cache paths and job directories', () => {
    const py = `jobs:\n  a:\n    steps:\n      - uses: actions/setup-python@v5\n        with:\n          python-version: '3.12'\n          cache-dependency-path: backend/requirements.txt\n      - run: pytest\n        working-directory: backend\n      - uses: actions/setup-python@v5\n        with:\n          python-version-file: libs/core/.python-version\n`
    const sources = extractPython(WORKFLOW, py)
    expect(sources).toHaveLength(1)
    expect(sources[0]?.paths).toEqual(['backend/requirements.txt', 'backend'])
    const go = `jobs:\n  a:\n    steps:\n      - uses: actions/setup-go@v5\n        with:\n          go-version: '1.22'\n          go-version-file: services/api/go.mod\n          cache-dependency-path: services/api/go.sum\n`
    expect(extractGo(WORKFLOW, go)[0]?.paths).toEqual(['services/api/go.mod', 'services/api/go.sum'])
  })

  it('only workflow sources carry paths', () => {
    expect(extractPython('Dockerfile', 'FROM python:3.12\n')[0]?.paths).toBeUndefined()
    expect(extractNode('.nvmrc', '22\n')[0]?.paths).toBeUndefined()
  })
})

describe('review E1: a glob in cache-dependency-path must not bind the source to a made-up directory', () => {
  const ci = (glob: string) => `jobs:\n  a:\n    steps:\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 22\n          cache-dependency-path: ${glob}\n`
  const nvmrc: Source = { runtime: 'node', file: '.nvmrc', line: 1, raw: '20', kind: 'nvmrc', constraint: { kind: 'partial', version: '20' } }
  const roots = ['.', 'apps/a', 'apps/b']
  const manifests = new Map([['apps/a', new Set(['node' as const])], ['apps/b', new Set(['node' as const])]])

  it('repro: root CI with apps/*/package-lock.json and a manifest-less root is UNBOUND and gives no false VERSION_CONFLICT against .nvmrc', () => {
    const sources = [nvmrc, ...extractNode(WORKFLOW, ci('apps/*/package-lock.json'))]
    expect(sources[1]?.paths).toEqual(['apps/*/package-lock.json'])
    const bound = bindSources(sources, roots, manifests)
    expect(bound.find((s) => s.kind === 'setup-node')?.boundTo).toEqual([])
    const findings = compareSources(bound, roots)
    expect(findings.filter((f) => f.code === 'VERSION_CONFLICT' || f.code === 'OUTSIDE_RANGE')).toEqual([])
  })

  it('every glob character form stays untruncated and is ignored by the binding', () => {
    for (const glob of ['apps/*/package-lock.json', 'apps/**/package-lock.json', 'apps/?/package-lock.json', 'apps/[ab]/package-lock.json', 'apps/{a,b}/package-lock.json']) {
      const [source] = extractNode(WORKFLOW, ci(glob))
      expect(source?.paths, glob).toEqual([glob])
      const bound = bindSources([source as never], roots, manifests)
      expect(bound[0]?.boundTo, glob).toEqual([])
    }
  })

  it('a literal path still binds: apps/a/package-lock.json goes to apps/a', () => {
    const [source] = extractNode(WORKFLOW, ci('apps/a/package-lock.json'))
    expect(bindSources([source as never], roots, manifests)[0]?.boundTo).toEqual(['apps/a'])
  })
})
