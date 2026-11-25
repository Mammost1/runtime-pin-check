import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseWorkflow } from '../../../src/extract/shared'

const real = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8')
const setup = (text: string, name: string) => parseWorkflow(text).filter((s) => s.uses.startsWith(`actions/${name}@`))

describe('parseWorkflow on real workflows (fixtures named owner-repo.file)', () => {
  it('pallets/flask: ${{ matrix.python }} resolves to the matrix with a line per value; quoted vs plain', () => {
    const [matrixed, fromFile] = setup(real('pallets-flask.tests.yaml'), 'setup-python')
    const input = matrixed?.with['python-version']
    expect(input).toMatchObject({ value: '${{ matrix.python }}', line: 41, matrixKey: 'python' })
    expect(input?.resolved?.values).toEqual(['3.15', '3.14', '3.14t', '3.13', '3.12', '3.11', 'pypy-3.11'])
    expect(input?.resolved?.lines).toEqual([20, 21, 22, 25, 26, 27, 28])
    // The key only appears under `include`, so its line is its first occurrence.
    expect(matrixed?.matrix.python?.line).toBe(20)
    expect(matrixed?.job).toBe('tests')
    // A file reference is a plain input, not a matrix.
    expect(fromFile?.with['python-version-file']).toMatchObject({ value: 'pyproject.toml', line: 58 })
    expect(fromFile?.with['python-version-file']?.matrixKey).toBeUndefined()
  })

  it('gin-gonic/gin: flow-sequence matrix gives the same line for each value; literal go-version stays a literal', () => {
    const [literal, matrixed] = setup(real('gin-gonic-gin.gin.yml'), 'setup-go')
    expect(literal?.with['go-version']).toMatchObject({ value: '^1', line: 25, quoted: true })
    expect(matrixed?.with['go-version']?.resolved?.values).toEqual(['1.26', '1.27'])
    expect(matrixed?.with['go-version']?.resolved?.lines).toEqual([39, 39])
    expect(matrixed?.with['go-version']?.resolved?.quoted).toEqual([true, true])
  })

  it('Fillo001/greenledger (.GitHub/workflows/Ci.Yml): node-version-file is a reference; run steps carry the project directories', () => {
    const steps = setup(real('fillo001-greenledger.Ci.yml'), 'setup-node')
    expect(steps).toHaveLength(2)
    expect(steps[0]?.with['node-version-file']).toMatchObject({ value: '.nvmrc', line: 14 })
    expect(steps[0]?.with['node-version']).toBeUndefined()
    expect(steps[0]?.job).toBe('backend')
    expect(steps[0]?.jobWorkingDirectories).toEqual(['backend'])
    expect(steps[1]?.jobWorkingDirectories).toEqual(['frontend'])
    expect(steps[0]?.workingDirectory).toBeUndefined()
  })

  it('vitejs/vite: a matrix key referenced inside a longer string is not resolved', () => {
    const step = parseWorkflow(real('vitejs-vite.ci.yml')).find((s) => s.with.runtime?.value.includes('matrix.node_version'))
    expect(step?.with.runtime?.matrixKey).toBeUndefined()
    expect(step?.matrix.node_version?.values.length).toBeGreaterThan(0)
  })
})

describe('parseWorkflow syntax', () => {
  const wf = (body: string) => `name: ci\non: push\njobs:\n  t:\n    runs-on: ubuntu-latest\n${body}`

  it('reads an unquoted 3.10 as written and flags it unquoted (YAML reads it as 3.1)', () => {
    const [s] = parseWorkflow(wf(`    steps:\n      - uses: actions/setup-python@v5\n        with:\n          python-version: 3.10\n`))
    expect(s?.with['python-version']).toMatchObject({ value: '3.10', quoted: false, line: 9 })
  })

  it('block-sequence matrix: one line per value; include adds new values and new keys; exclude ignored', () => {
    const text = wf(`    strategy:
      matrix:
        node:
          - 18
          - "20"
        include:
          - node: 22
          - node: 20
        exclude:
          - node: 18
    steps:
      - uses: actions/setup-node@v4
        with:
          node-version: \${{ matrix.node }}
`)
    const [s] = parseWorkflow(text)
    const node = s?.with['node-version']?.resolved
    expect(node?.values).toEqual(['18', '20', '22'])
    expect(node?.lines).toEqual([9, 10, 12])
    expect(node?.quoted).toEqual([false, true, false])
  })

  it('matrix given as an expression cannot be read: no resolution, expression recorded', () => {
    const text = wf(`    strategy:\n      matrix:\n        node: \${{ fromJSON(needs.x.outputs.v) }}\n    steps:\n      - uses: actions/setup-node@v4\n        with:\n          node-version: \${{ matrix.node }}\n`)
    const [s] = parseWorkflow(text)
    expect(s?.matrix.node?.expression).toContain('fromJSON')
    expect(s?.with['node-version']?.matrixKey).toBeUndefined()
  })

  it('working-directory: step wins over job defaults over workflow defaults', () => {
    const text = `defaults:\n  run:\n    working-directory: top\njobs:\n  a:\n    steps:\n      - uses: actions/setup-go@v5\n  b:\n    defaults:\n      run:\n        working-directory: job\n    steps:\n      - uses: actions/setup-go@v5\n      - uses: actions/setup-go@v5\n        working-directory: step\n`
    expect(parseWorkflow(text).map((s) => s.workingDirectory)).toEqual(['top', 'job', 'step'])
  })

  it('reads composite action steps (runs.steps) and ignores steps without uses', () => {
    const text = `runs:\n  using: composite\n  steps:\n    - run: echo\n    - uses: actions/setup-go@v5\n      with:\n        go-version-file: go.mod\n`
    const steps = parseWorkflow(text)
    expect(steps).toHaveLength(1)
    expect(steps[0]).toMatchObject({ job: '', uses: 'actions/setup-go@v5', line: 5 })
  })

  it('follows YAML anchors and aliases', () => {
    const text = `jobs:\n  a:\n    strategy:\n      matrix:\n        v: &vs [1.22, 1.23]\n    steps:\n      - uses: actions/setup-go@v5\n        with:\n          go-version: \${{ matrix.v }}\n`
    expect(parseWorkflow(text)[0]?.with['go-version']?.resolved?.values).toEqual(['1.22', '1.23'])
  })

  it('returns [] for invalid or unrelated YAML and never throws', () => {
    expect(parseWorkflow('')).toEqual([])
    expect(parseWorkflow('- just\n- a list\n')).toEqual([])
    expect(parseWorkflow('jobs: [unclosed')).toEqual([])
    for (const junk of ['\u0000', '{{{{', 'a: &x\n  b: *x\n', 'jobs:\n  a:\n    steps: 5\n', 'jobs:\n  a:\n    steps:\n      - uses: [1]\n']) {
      expect(() => parseWorkflow(junk)).not.toThrow()
    }
  })
})
