import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { diagnoseFile } from '../../src/extract/diagnose'
import { extractGo } from '../../src/extract/go'
import { extractNode } from '../../src/extract/node'
import { extractPython } from '../../src/extract/python'
import { parseGitlabCi, parseWorkflow } from '../../src/extract/shared'

const shared = (f: string) => readFileSync(new URL(`./shared/fixtures/${f}`, import.meta.url), 'utf8')
const WF = '.github/workflows/ci.yml'

describe('broken workflow YAML (the silent drop found while building the corpus fixtures)', () => {
  /** The real DRYTRIX/TimeTracker ci.yml with the damage my own fetch did to it: `\n` inside a block scalar became a real newline. */
  const damaged = shared('drytrix-timetracker.ci.yml').replace('indent=4) + "\\n")', 'indent=4) + "\n")')

  it('really is damaged: the parser stops at the error and every later setup-node step is gone (so it must be reported)', () => {
    expect(damaged).not.toBe(shared('drytrix-timetracker.ci.yml'))
    expect(parseWorkflow(damaged).length).toBe(14)
    expect(extractNode(WF, damaged).filter((s) => s.kind === 'setup-node')).toEqual([])
    expect(extractNode(WF, shared('drytrix-timetracker.ci.yml')).filter((s) => s.kind === 'setup-node')).toHaveLength(3)
  })

  it('gives one diagnostic with file, line, column and the parser message, and says what was and was not read', () => {
    const d = diagnoseFile(WF, damaged)
    expect(d).toHaveLength(1)
    expect(d[0]).toMatchObject({ file: WF, line: 386, column: 1 })
    expect(d[0]?.message).toMatch(/^YAML syntax error: /)
    expect(d[0]?.message).toContain('1 more error')
    expect(d[0]?.message).toContain('Pins before this point were read; pins after it may not have been')
  })

  it('a small broken workflow: the steps before the error are still extracted and exactly one diagnostic is reported', () => {
    const text = 'jobs:\n  a:\n    steps:\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 22\n      - run: |\n          echo ok\n  bad: [unclosed\n'
    expect(extractNode(WF, text).map((s) => s.raw)).toEqual(['22'])
    const d = diagnoseFile(WF, text)
    expect(d).toHaveLength(1)
    expect(d[0]?.line).toBeGreaterThanOrEqual(9)
    expect(d[0]?.message).toContain('YAML syntax error')
  })

  it('also .gitlab-ci.yml, composite actions and any file under .github/workflows/', () => {
    for (const file of ['.gitlab-ci.yml', 'services/api/.gitlab-ci.yml', '.github/actions/setup/action.yml', '.github/workflows/sub/action.yaml', '.GitHub/Workflows/Ci.Yml']) {
      expect(diagnoseFile(file, 'a: [unclosed\n'), file).toHaveLength(1)
    }
    expect(diagnoseFile('docs/example.yml', 'a: [unclosed\n')).toEqual([])
  })

  it('valid workflows and empty files have no diagnostic', () => {
    expect(diagnoseFile(WF, '')).toEqual([])
    expect(diagnoseFile(WF, 'on: push\njobs: {}\n')).toEqual([])
  })
})

describe('broken package.json', () => {
  it('reports the JSON error with line and column', () => {
    const d = diagnoseFile('package.json', '{\n  "name": "x",\n  "engines": { "node": ">=20" }\n  "private": true\n}\n')
    expect(d).toHaveLength(1)
    expect(d[0]).toMatchObject({ file: 'package.json', line: 4 })
    expect(d[0]?.column).toBeGreaterThan(0)
    expect(d[0]?.message).toMatch(/^JSON syntax error: .*No pins were read from this file\.$/)
  })
  it('a package.json in a sub-project, a truncated file and a file that is not JSON at all', () => {
    expect(diagnoseFile('apps/web/package.json', '{ "name": "x"')).toHaveLength(1)
    expect(diagnoseFile('package.json', 'not json')[0]).toMatchObject({ line: 1 })
  })
  it('valid package.json: none; only when the node runtime is selected', () => {
    expect(diagnoseFile('package.json', '{ "name": "x", "engines": { "node": ">=20" } }')).toEqual([])
    expect(diagnoseFile('package.json', '{ broken', ['go'])).toEqual([])
    expect(diagnoseFile('package.json', '{ broken', ['node'])).toHaveLength(1)
  })
})

describe('broken pyproject.toml and mise.toml', () => {
  it('pyproject.toml: line, column and message', () => {
    const d = diagnoseFile('pyproject.toml', '[project]\nname = "x"\nrequires-python = ">=3.9\n')
    expect(d).toHaveLength(1)
    expect(d[0]).toMatchObject({ file: 'pyproject.toml', line: 3 })
    expect(d[0]?.column).toBeGreaterThan(0)
    expect(d[0]?.message).toMatch(/^TOML syntax error: .*No pins were read from this file\.$/)
  })
  it('mise.toml and its name variants', () => {
    for (const file of ['mise.toml', '.mise.toml', 'mise.local.toml', '.mise.dev.toml', 'sub/mise.toml', '.config/mise.toml', '.config/mise/config.toml']) {
      const d = diagnoseFile(file, '[tools\nnode = "22"\n')
      expect(d, file).toHaveLength(1)
      expect(d[0]?.line, file).toBe(1)
    }
  })
  it('valid files, other toml files, and the runtime filter', () => {
    expect(diagnoseFile('pyproject.toml', '[project]\nrequires-python = ">=3.9"\n')).toEqual([])
    expect(diagnoseFile('mise.toml', '[tools]\nnode = "22"\n')).toEqual([])
    expect(diagnoseFile('Cargo.toml', '[broken')).toEqual([])
    expect(diagnoseFile('pyproject.toml', '[broken', ['node', 'go'])).toEqual([])
  })
})

describe('no false diagnostics on real files', () => {
  it('every real workflow, gitlab, mise and package.json fixture parses cleanly', () => {
    const files: [string, string][] = [
      ['vitejs-vite.ci.yml', WF], ['pallets-flask.tests.yaml', '.github/workflows/tests.yaml'], ['gin-gonic-gin.gin.yml', '.github/workflows/gin.yml'],
      ['fillo001-greenledger.Ci.yml', '.GitHub/workflows/Ci.Yml'], ['drytrix-timetracker.ci.yml', WF], ['drytrix-timetracker.build-desktop.yml', '.github/workflows/build-desktop.yml'],
      ['manfredsteger-polly.gitlab-ci.yml', '.gitlab-ci.yml'],
      ['conventional-changelog-commitlint.mise.toml', '.mise.toml'], ['metabase-metabase.mise.toml', 'mise.toml'], ['butlerx-wetty.mise.toml', '.mise.toml'],
    ]
    for (const [fixture, as] of files) expect(diagnoseFile(as, shared(fixture)), fixture).toEqual([])
    for (const f of readdirSync(new URL('../fixtures/node', import.meta.url)).filter((x) => x.endsWith('.package.json'))) {
      expect(diagnoseFile('package.json', readFileSync(new URL(`../fixtures/node/${f}`, import.meta.url), 'utf8')), f).toEqual([])
    }
    for (const f of readdirSync(new URL('../fixtures/python', import.meta.url)).filter((x) => x.endsWith('.pyproject.toml'))) {
      expect(diagnoseFile('pyproject.toml', readFileSync(new URL(`../fixtures/python/${f}`, import.meta.url), 'utf8')), f).toEqual([])
    }
  })
  it('never throws', () => {
    for (const file of ['package.json', 'pyproject.toml', 'mise.toml', WF, '.gitlab-ci.yml', 'README.md']) {
      expect(() => diagnoseFile(file, '\u0000{{[[\n= = =\n&a *a\n')).not.toThrow()
    }
  })
})

describe('rpc-diag-scope (A15): only real workflow files are parsed as workflows; valid multi-document YAML is not an error', () => {
  const KIND = '.github/workflows/resources/kind-config.yaml'
  const RESOURCES = '.github/workflows/resources/test-resources.yaml'
  const TOP = '.github/workflows/chronograf-cypress-tests.yaml'

  it('influxdata/chronograf: the valid multi-document Kubernetes YAML under .github/workflows/resources/ gives no diagnostic and no sources', () => {
    for (const [fixture, as] of [['influxdata-chronograf.resources.kind-config.yaml', KIND], ['influxdata-chronograf.resources.test-resources.yaml', RESOURCES]] as const) {
      const text = shared(fixture)
      expect(diagnoseFile(as, text), as).toEqual([])
      expect(extractNode(as, text), as).toEqual([])
      expect(extractPython(as, text), as).toEqual([])
      expect(extractGo(as, text), as).toEqual([])
    }
  })

  it('the real top-level workflow beside them is still a workflow: no false diagnostic, and a broken copy is reported', () => {
    const text = shared('influxdata-chronograf.cypress-tests.yaml')
    expect(diagnoseFile(TOP, text)).toEqual([])
    const broken = diagnoseFile(TOP, `${text}\njobs: [unclosed\n`)
    expect(broken).toHaveLength(1)
    expect(broken[0]?.message).toContain('YAML syntax error')
  })

  it('subfolders of .github/workflows/ are not workflows, even when broken; composite actions are still read wherever they were', () => {
    expect(diagnoseFile('.github/workflows/resources/x.yml', 'a: [unclosed\n')).toEqual([])
    expect(diagnoseFile('.github/workflows/sub/deeper/helper.yaml', 'a: [unclosed\n')).toEqual([])
    expect(diagnoseFile('.github/workflows/sub/action.yml', 'a: [unclosed\n')).toHaveLength(1)
    expect(diagnoseFile('.github/actions/setup/action.yaml', 'a: [unclosed\n')).toHaveLength(1)
    expect(diagnoseFile('.github/workflows/ci.yml', 'a: [unclosed\n')).toHaveLength(1)
  })

  it('a multi-document stream in a file that IS read is valid YAML: every document is read and no diagnostic', () => {
    const doc = (v: string) => `jobs:\n  a:\n    steps:\n      - uses: actions/setup-node@v4\n        with:\n          node-version: ${v}\n`
    const text = `---\n${doc('20')}---\n${doc('22')}`
    expect(diagnoseFile(WF, text)).toEqual([])
    expect(parseWorkflow(text).map((s) => s.with['node-version']?.value)).toEqual(['20', '22'])
    expect(extractNode(WF, text).map((s) => [s.line, s.raw])).toEqual([[7, '20'], [14, '22']])
    expect(parseGitlabCi('a:\n  image: node:18\n---\nb:\n  image: node:20\n').map((i) => i.tag)).toEqual(['18', '20'])
  })

  it('a real syntax error in the SECOND document is still reported, on its own line', () => {
    const text = 'jobs: {}\n---\njobs:\n  a: [unclosed\n'
    const d = diagnoseFile(WF, text)
    expect(d).toHaveLength(1)
    expect(d[0]?.line).toBeGreaterThanOrEqual(4)
  })
})
