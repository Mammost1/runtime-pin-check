import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { compareSources } from '../../../src/compare'
import { extractPython } from '../../../src/extract/python'

const real = (f: string) => readFileSync(new URL(`../../fixtures/python/${f}`, import.meta.url), 'utf8')
const pick = (s: ReturnType<typeof extractPython>) => s.map((x) => [x.kind, x.line, x.raw, x.constraint])

describe('dispatch', () => {
  it('returns [] for files it does not handle and never throws', () => {
    expect(extractPython('README.md', 'python 3.12')).toEqual([])
    expect(extractPython('package.json', '{"engines":{"python":"3"}}')).toEqual([])
    for (const f of ['.python-version', 'pyproject.toml', 'runtime.txt', '.tool-versions', 'mise.toml', 'Dockerfile', '.github/workflows/a.yml']) {
      expect(() => extractPython(f, '\u0000{{[[\n= = =\n')).not.toThrow()
    }
  })
})

describe('.python-version (real: Zyphra/Zonos, Mindwerks/worldengine)', () => {
  it('a single line without a trailing newline', () => {
    expect(extractPython('.python-version', real('zyphra-zonos.python-version'))).toEqual([
      { runtime: 'python', file: '.python-version', line: 1, column: 1, raw: '3.12', kind: 'python-version', constraint: { kind: 'partial', version: '3.12' } },
    ])
  })
  it('several versions: one source per line, in order', () => {
    const s = extractPython('.python-version', real('mindwerks-worldengine.python-version'))
    expect(s.map((x) => [x.line, x.raw, x.constraint.kind])).toEqual([[1, '3.14.0', 'exact'], [2, '3.13.7', 'exact'], [3, '3.12.11', 'exact'], [4, '3.11.13', 'exact'], [5, '3.10.16', 'exact'], [6, '3.9.21', 'exact']])
  })
  it('skips comments and blanks, keeps the line number, handles CRLF, system and non-versions', () => {
    const s = extractPython('app/.python-version', '# pinned\r\n\r\n3.11.4 # lts\r\nsystem\r\npypy3.10-7.3.15\r\n')
    expect(s.map((x) => [x.file, x.line, x.raw, x.constraint.kind])).toEqual([
      ['app/.python-version', 3, '3.11.4', 'exact'],
      ['app/.python-version', 4, 'system', 'alias'],
      ['app/.python-version', 5, 'pypy3.10-7.3.15', 'unknown'],
    ])
  })
})

describe('pyproject.toml (real: hcaptcha-challenger, pallets/flask, keephq/keep, PyGaze)', () => {
  it('project.requires-python, with the line and the column of the value inside the quotes', () => {
    const [s] = extractPython('pyproject.toml', real('qin2dim-hcaptcha-challenger.pyproject.toml'))
    expect(s).toMatchObject({ kind: 'requires-python', line: 18, raw: '>=3.10', constraint: { kind: 'range', range: '>=3.10.0' } })
    expect(s?.column).toBe(20)
    expect(extractPython('pyproject.toml', real('pallets-flask.pyproject.toml'))).toHaveLength(1)
  })
  it('Poetry tool.poetry.dependencies.python, and not python-dotenv or python-json-logger', () => {
    expect(pick(extractPython('pyproject.toml', real('keephq-keep.pyproject.toml')))).toEqual([
      ['poetry-python', 9, '>=3.11,<3.14', { kind: 'range', range: '>=3.11.0 <3.14.0-0' }],
    ])
    expect(pick(extractPython('services/api/pyproject.toml', real('esdalmaijer-pygaze.pyproject.toml')))).toEqual([
      ['poetry-python', 19, '>= 3.7', { kind: 'range', range: '>=3.7.0' }],
    ])
  })
  it('both fields in one file are two sources; PEP 440 and Poetry operators convert', () => {
    const text = `[project]\nrequires-python = "~=3.10"\n[tool.poetry.dependencies]\npython = "^3.9"\n`
    expect(pick(extractPython('pyproject.toml', text))).toEqual([
      ['requires-python', 2, '~=3.10', { kind: 'range', range: '>=3.10.0 <4.0.0-0' }],
      ['poetry-python', 4, '^3.9', { kind: 'range', range: '>=3.9.0 <4.0.0-0' }],
    ])
    expect(extractPython('pyproject.toml', '[project]\nrequires-python = ">=3.9, <=3.13"\n')[0]?.constraint).toEqual({ kind: 'range', range: '>=3.9.0 <=3.13.0' })
  })
  it('a field that is not a string, or a file that is not valid TOML, is UNPARSEABLE, not skipped', () => {
    const table = extractPython('pyproject.toml', '[tool.poetry.dependencies]\npython = { version = "^3.9" }\n')
    expect(table[0]?.constraint).toMatchObject({ kind: 'unknown' })
    // A file that is not valid TOML gives no sources: the syntax error is reported once, as a diagnostic.
    expect(extractPython('pyproject.toml', '[project\nrequires-python = ">=3.9"\n')).toEqual([])
    expect(extractPython('pyproject.toml', '[project]\nrequires-python = ">=3.9"\n[oops\n')).toEqual([])
  })
  it('no python field means no source', () => {
    expect(extractPython('pyproject.toml', '[tool.black]\nline-length = 100\n')).toEqual([])
    expect(extractPython('pyproject.toml', '')).toEqual([])
  })
})

describe('runtime.txt (real: CodeForPhilly/chime, stefmolin/Hands-On-Data-Analysis-with-Pandas)', () => {
  it('python-3.7.6 is exact, python-3.7 is a prefix', () => {
    expect(pick(extractPython('runtime.txt', real('codeforphilly-chime.runtime.txt')))).toEqual([['runtime-txt', 1, 'python-3.7.6', { kind: 'exact', version: '3.7.6' }]])
    expect(pick(extractPython('runtime.txt', real('stefmolin-hands-on-data-analysis.runtime.txt')))).toEqual([['runtime-txt', 1, 'python-3.7', { kind: 'partial', version: '3.7' }]])
  })
  it('a runtime.txt for another language is not ours; leading blank lines keep the line number', () => {
    expect(extractPython('runtime.txt', 'node-18\n')).toEqual([])
    expect(extractPython('runtime.txt', '\n\npython-3.12.1\n')[0]).toMatchObject({ line: 3, raw: 'python-3.12.1' })
    expect(extractPython('runtime.txt', '')).toEqual([])
  })
})

describe('.tool-versions and mise', () => {
  it('authgear: python line only; chainlink: aligned columns', () => {
    expect(pick(extractPython('.tool-versions', real('authgear-authgear-server.tool-versions')))).toEqual([['tool-versions', 3, '3.12.1', { kind: 'exact', version: '3.12.1' }]])
    expect(pick(extractPython('.tool-versions', real('smartcontractkit-chainlink.tool-versions')))).toEqual([['tool-versions', 9, '3.10.5', { kind: 'exact', version: '3.10.5' }]])
  })
  it('only the first version of a line is the pin (asdf uses the first; the rest are fallbacks)', () => {
    expect(pick(extractPython('.tool-versions', 'python 3.12.1 3.11.4\n'))).toEqual([['tool-versions', 1, '3.12.1', { kind: 'exact', version: '3.12.1' }]])
    expect(extractPython('.tool-versions', 'python ref:main\n')[0]?.constraint.kind).toBe('unknown')
  })
  it('mise [tools] python in every mise file name, array takes the first, other tools ignored', () => {
    const text = '[tools]\nnode = "22"\npython = ["3.12", "3.11"]\n'
    for (const f of ['mise.toml', '.mise.toml', 'mise.local.toml', '.mise.dev.toml', 'sub/mise.toml', '.config/mise.toml', '.config/mise/config.toml']) {
      expect(pick(extractPython(f, text)), f).toEqual([['mise', 3, '3.12', { kind: 'partial', version: '3.12' }]])
    }
    expect(extractPython('pyproject.toml.mise', text)).toEqual([])
    expect(extractPython('mise.toml', '[tools]\n"core:python" = "3.12"\n')).toEqual([])
  })
})

describe('Dockerfile (real: Spiker1992/python-event-sourcing)', () => {
  it('FROM python:slim is the floating alias latest, kind dockerfile, raw is the tag as written', () => {
    expect(pick(extractPython('Dockerfile', real('spiker1992-python-event-sourcing.Dockerfile')))).toEqual([['dockerfile', 1, 'slim', { kind: 'alias', alias: 'latest' }]])
  })
  it('tags, digests, registries and stages', () => {
    const text = `FROM python:3.11-slim AS py\nFROM docker.io/library/python:3.12.4-bookworm@sha256:${'a'.repeat(64)}\nFROM public.ecr.aws/docker/library/python:3.13\nFROM py AS final\nFROM node:22\n`
    const s = extractPython('Dockerfile', text)
    expect(s.map((x) => [x.line, x.raw, x.constraint])).toEqual([
      [1, '3.11-slim', { kind: 'partial', version: '3.11' }],
      [2, '3.12.4-bookworm', { kind: 'exact', version: '3.12.4' }],
      [3, '3.13', { kind: 'partial', version: '3.13' }],
    ])
    expect(s[0]?.column).toBe(13)
  })
  it('ARG default is substituted; raw keeps the text as written; an unresolved variable is UNPARSEABLE', () => {
    const s = extractPython('Dockerfile', 'ARG PY=3.12\nFROM python:${PY}-slim\nFROM python:${OTHER}\n')
    expect(s[0]).toMatchObject({ line: 2, raw: '${PY}-slim', constraint: { kind: 'partial', version: '3.12' } })
    expect(s[1]?.constraint).toMatchObject({ kind: 'unknown' })
  })
  it('Dockerfile name variants', () => {
    for (const f of ['Dockerfile.dev', 'api.Dockerfile', 'dev.dockerfile', 'docker/Dockerfile.prod', 'Dockerfile']) {
      expect(extractPython(f, 'FROM python:3.12'), f).toHaveLength(1)
    }
    expect(extractPython('Dockerfiles.md', 'FROM python:3.12')).toEqual([])
  })
})

describe('review N2: digest-only FROM is immutable, not floating', () => {
  const digest = `sha256:${'a'.repeat(64)}`
  it('python@sha256 is unknown with a pinned-by-digest reason; tag + digest still reads the tag; no tag and no digest is latest', () => {
    const s = extractPython('Dockerfile', `FROM python@${digest}\nFROM python:3.12@${digest}\nFROM python\n`)
    expect(s[0]?.constraint).toEqual({ kind: 'unknown', reason: 'image is pinned by digest only, so its version cannot be read' })
    expect(s[1]?.constraint).toEqual({ kind: 'partial', version: '3.12' })
    expect(s[2]?.constraint).toEqual({ kind: 'alias', alias: 'latest' })
  })
})

describe('review N1: mise columns point at the version text, not at the TOML value token', () => {
  it('string, number, array (also continued on the next line) and inline table', () => {
    const text = '[tools]\npython = "3.12"\n'
    const at = (t: string) => extractPython('mise.toml', t)[0]
    expect(at(text)).toMatchObject({ line: 2, column: 11, raw: '3.12' })
    for (const t of ['[tools]\npython = "3.12"\n', '[tools]\npython = ["3.12", "3.11"]\n', '[tools]\npython = { version = "3.12" }\n', '[tools]\n  python    =   "3.12"\n']) {
      const s = at(t)
      expect((t.split('\n')[(s?.line ?? 1) - 1] ?? '').slice((s?.column ?? 1) - 1).startsWith(s?.raw ?? '?'), t).toBe(true)
    }
    expect(at('[tools]\npython = ["3.12", "3.11"]\n')).toMatchObject({ line: 2, column: 12, raw: '3.12' })
    expect(at("[tools]\npython = { version = '3.11', postinstall = \"3.99\" }\n")).toMatchObject({ line: 2, column: 23, raw: '3.11' })
    expect(at('[tools]\npython = [\n  "3.10",\n  "3.9",\n]\n')).toMatchObject({ line: 3, column: 4, raw: '3.10' })
    expect(at('[tools]\n  python    =   "3.12"\n')).toMatchObject({ line: 2, column: 18, raw: '3.12' })
  })
})

describe('review F3: composite action under .github/workflows/<dir>/', () => {
  it('is read like any other workflow file', () => {
    const text = 'runs:\n  using: composite\n  steps:\n    - uses: actions/setup-python@v5\n      with:\n        python-version: "3.11"\n'
    expect(extractPython('.github/workflows/env/action.yml', text)[0]).toMatchObject({ raw: '3.11', line: 6 })
    expect(extractPython('.github/workflows/a/b/action.yaml', text)).toHaveLength(1)
  })
})

describe('review F2: inline-table pyproject is read, not skipped', () => {
  it('project = { requires-python = ... } and Poetry dependencies = { python = ... }', () => {
    const a = extractPython('pyproject.toml', 'project = { name = "x", requires-python = ">=3.9" }\n')
    expect(a).toHaveLength(1)
    expect(a[0]).toMatchObject({ kind: 'requires-python', line: 1, raw: '>=3.9', constraint: { kind: 'range', range: '>=3.9.0' } })
    const b = extractPython('pyproject.toml', '[tool.poetry]\nname = "x"\ndependencies = { python = "^3.9", requests = "*" }\n')
    expect(b).toHaveLength(1)
    expect(b[0]).toMatchObject({ kind: 'poetry-python', line: 3, raw: '^3.9', constraint: { kind: 'range', range: '>=3.9.0 <4.0.0-0' } })
    expect(extractPython('pyproject.toml', 'project = { name = "x" }\n')).toEqual([])
  })
})

describe('GitHub workflows (real: pallets/flask tests.yaml)', () => {
  it('a matrix becomes one source per value with its own line and matrix: true; 3.14t is CPython 3.14, PyPy is UNPARSEABLE (rpc-harden F3)', () => {
    const s = extractPython('.github/workflows/tests.yaml', real('pallets-flask.tests.yaml'))
    expect(s.map((x) => [x.line, x.raw, x.constraint.kind, x.matrix])).toEqual([
      [20, '3.15', 'partial', true],
      [21, '3.14', 'partial', true],
      [22, '3.14t', 'partial', true],
      [25, '3.13', 'partial', true],
      [26, '3.12', 'partial', true],
      [27, '3.11', 'partial', true],
      [28, 'pypy-3.11', 'unknown', true],
    ])
    // python-version-file: pyproject.toml is a reference, not a pin.
    expect(s.some((x) => x.raw === 'pyproject.toml')).toBe(false)
  })

  const wf = (steps: string, extra = '') => `${extra}jobs:\n  a:\n    steps:\n${steps}`
  it('literal versions, ranges and the path-case variants GitHub accepts', () => {
    const text = wf(`      - uses: actions/setup-python@v5\n        with:\n          python-version: '3.12'\n`)
    for (const f of ['.github/workflows/ci.yml', '.GitHub/workflows/Ci.Yml', '.github/Workflows/a.yaml', '.github/actions/setup/action.yml']) {
      expect(extractPython(f, text), f).toHaveLength(1)
    }
    expect(extractPython('packages/a/.github/workflows/ci.yml', text)).toEqual([])
    expect(extractPython('.github/ISSUE_TEMPLATE/x.yml', text)).toEqual([])
    expect(extractPython('.github/workflows/ci.yml', wf(`      - uses: actions/setup-python@v5\n        with:\n          python-version: ">=3.9"\n`))[0]?.constraint).toEqual({ kind: 'range', range: '>=3.9.0' })
  })
  it('an unquoted 3.10 is read by YAML as 3.1: reported as UNPARSEABLE with that reason, a quoted one is fine', () => {
    const bad = extractPython('.github/workflows/ci.yml', wf(`      - uses: actions/setup-python@v5\n        with:\n          python-version: 3.10\n`))
    expect(bad[0]).toMatchObject({ raw: '3.10', constraint: { kind: 'unknown' } })
    expect((bad[0]?.constraint as { reason: string }).reason).toContain('number 3.1')
    const good = extractPython('.github/workflows/ci.yml', wf(`      - uses: actions/setup-python@v5\n        with:\n          python-version: '3.10'\n`))
    expect(good[0]?.constraint).toEqual({ kind: 'partial', version: '3.10' })
    const matrix = extractPython('.github/workflows/ci.yml', `jobs:\n  a:\n    strategy:\n      matrix:\n        py: [3.9, 3.10]\n    steps:\n      - uses: actions/setup-python@v5\n        with:\n          python-version: \${{ matrix.py }}\n`)
    expect(matrix.map((x) => x.constraint.kind)).toEqual(['partial', 'unknown'])
  })
  it('a block scalar listing several versions gives one source per line', () => {
    const s = extractPython('.github/workflows/ci.yml', wf(`      - uses: actions/setup-python@v5\n        with:\n          python-version: |\n            3.9\n            3.12\n`))
    expect(s.map((x) => [x.line, x.raw])).toEqual([[7, '3.9'], [8, '3.12']])
  })
  it('workingDirectory: only the step\'s own working-directory (or defaults.run) is used, nothing is inferred from run steps', () => {
    const own = extractPython('.github/workflows/ci.yml', wf(`      - uses: actions/setup-python@v5\n        working-directory: ./svc/\n        with:\n          python-version: '3.12'\n`))
    expect(own[0]?.workingDirectory).toBe('svc')
    const defaults = extractPython('.github/workflows/ci.yml', `defaults:\n  run:\n    working-directory: backend\n${wf(`      - uses: actions/setup-python@v5\n        with:\n          python-version: '3.12'\n`)}`)
    expect(defaults[0]?.workingDirectory).toBe('backend')
    const runStep = extractPython('.github/workflows/ci.yml', wf(`      - uses: actions/setup-python@v5\n        with:\n          python-version: '3.12'\n      - run: pytest\n        working-directory: backend\n`))
    expect(runStep[0]?.workingDirectory).toBeUndefined()
    const expr = extractPython('.github/workflows/ci.yml', wf(`      - uses: actions/setup-python@v5\n        working-directory: \${{ matrix.dir }}\n        with:\n          python-version: '3.12'\n`))
    expect(expr[0]?.workingDirectory).toBeUndefined()
  })
  it('review F1 regression: a run step at the repo root plus one in services/api must not narrow the scope, so the root conflict is still found', () => {
    const workflow = wf(`      - uses: actions/setup-python@v5\n        with:\n          python-version: '3.12'\n      - run: pip install -e .\n      - run: pytest\n        working-directory: services/api\n`)
    const sources = [
      ...extractPython('.github/workflows/ci.yml', workflow),
      ...extractPython('pyproject.toml', '[project]\nrequires-python = ">=3.8,<3.11"\n'),
    ]
    expect(sources.find((x) => x.kind === 'setup-python')?.workingDirectory).toBeUndefined()
    const findings = compareSources(sources, ['.', 'services/api'])
    expect(findings.some((f) => f.code === 'OUTSIDE_RANGE' && f.scopes.includes('.'))).toBe(true)
  })
  it('other actions and expression values', () => {
    expect(extractPython('.github/workflows/ci.yml', wf(`      - uses: actions/setup-node@v4\n        with:\n          python-version: '3.12'\n`))).toEqual([])
    const e = extractPython('.github/workflows/ci.yml', wf(`      - uses: actions/setup-python@v5\n        with:\n          python-version: \${{ inputs.py }}\n`))
    expect(e[0]?.constraint).toMatchObject({ kind: 'unknown' })
  })
})

describe('rpc-pygo-column: every Source from .tool-versions and block-scalar workflows has a column that points at raw', () => {
  const at = (text: string, source: { line: number; column?: number; raw: string }) => (text.split(/\r?\n/)[source.line - 1] ?? '').slice((source.column ?? 0) - 1, (source.column ?? 0) - 1 + source.raw.length)

  it('real .tool-versions files (authgear, chainlink with aligned columns)', () => {
    for (const f of ['authgear-authgear-server.tool-versions', 'smartcontractkit-chainlink.tool-versions']) {
      const text = real(f)
      const sources = extractPython('.tool-versions', text)
      expect(sources.length, f).toBeGreaterThan(0)
      for (const s of sources) {
        expect(s.column, f).toBeGreaterThan(0)
        expect(at(text, s), f).toBe(s.raw)
      }
    }
  })
  it('odd spacing, CRLF, a tool name that is a prefix of the version, and several versions on a line', () => {
    const text = 'nodejs 22.1.0\r\n  python\t\t3.12.1   3.11.4 # c\r\npython3 3.9\r\n'
    const [s] = extractPython('.tool-versions', text)
    expect(s).toMatchObject({ line: 2, raw: '3.12.1' })
    expect(at(text, s as never)).toBe('3.12.1')
  })
  it('a python line with no version has no column and is unknown', () => {
    expect(extractPython('.tool-versions', 'python\n')[0]).toMatchObject({ constraint: { kind: 'unknown' } })
    expect(extractPython('.tool-versions', 'python\n')[0]?.column).toBeUndefined()
  })
  it('block-scalar setup-python versions get a column too', () => {
    const text = `jobs:\n  a:\n    steps:\n      - uses: actions/setup-python@v5\n        with:\n          python-version: |\n            3.9\n            3.12\n`
    const sources = extractPython('.github/workflows/ci.yml', text)
    expect(sources.map((x) => [x.raw, x.column])).toEqual([['3.9', 13], ['3.12', 13]])
    for (const s of sources) expect(at(text, s)).toBe(s.raw)
  })
})

describe('rpc-pygo-column review F1: a column is either exactly raw or absent, never a wrong offset', () => {
  const wf = (value: string) => `jobs:\n  a:\n    steps:\n      - uses: actions/setup-python@v5\n        with:\n          python-version: ${value}\n`
  const slice = (text: string, s: { line: number; column?: number; raw: string }) => (text.split(/\r?\n/)[s.line - 1] ?? '').slice((s.column ?? 0) - 1, (s.column ?? 0) - 1 + s.raw.length)

  it('literal block with a single version moves to its own line and column', () => {
    const text = wf('|\n            3.12\n')
    const sources = extractPython('.github/workflows/ci.yml', text)
    expect(sources.map((x) => [x.line, x.column, x.raw])).toEqual([[7, 13, '3.12']])
    expect(slice(text, sources[0] as never)).toBe('3.12')
  })
  it('folded >-, an explicit indentation indicator |2 and a keep indicator |+', () => {
    for (const header of ['>-', '|2', '|+', '|-', '>']) {
      const text = wf(`${header}\n            3.11\n`)
      const sources = extractPython('.github/workflows/ci.yml', text)
      expect(sources, header).toHaveLength(1)
      expect(sources[0]?.line, header).toBe(7)
      expect(slice(text, sources[0] as never), header).toBe('3.11')
    }
  })
  it('a multi-line double-quoted string gets no column (its text is spread over lines), never a wrong one', () => {
    const text = wf('"3.9\n            3.12"\n')
    for (const s of extractPython('.github/workflows/ci.yml', text)) {
      if (s.column !== undefined) expect(slice(text, s)).toBe(s.raw)
    }
  })
  it('every Source in every form above either has a column equal to raw or has none', () => {
    const forms = ['|\n            3.12\n', '>-\n            3.12\n', '|2\n            3.12\n', '"3.9\n            3.12"\n', "'3.9\n            3.12'\n", '|\n            3.9\n            3.12\n']
    for (const form of forms) {
      const text = wf(form)
      for (const s of extractPython('.github/workflows/ci.yml', text)) {
        if (s.column !== undefined) expect(slice(text, s), form).toBe(s.raw)
      }
    }
  })
  it('the guard also covers other files: a Dockerfile tag on a continuation line has no column', () => {
    const text = 'FROM python:\\\n  3.12-slim\n'
    for (const s of extractPython('Dockerfile', text)) {
      if (s.column !== undefined) expect(slice(text, s)).toBe(s.raw)
    }
  })
})

describe('rpc-pygo-column review F1: invariant over every real python fixture', () => {
  it('each Source with a column has raw at that column; none points at a wrong offset', () => {
    const names: Record<string, string> = {
      'zyphra-zonos.python-version': '.python-version', 'mindwerks-worldengine.python-version': '.python-version',
      'qin2dim-hcaptcha-challenger.pyproject.toml': 'pyproject.toml', 'keephq-keep.pyproject.toml': 'pyproject.toml', 'esdalmaijer-pygaze.pyproject.toml': 'pyproject.toml', 'pallets-flask.pyproject.toml': 'pyproject.toml',
      'codeforphilly-chime.runtime.txt': 'runtime.txt', 'stefmolin-hands-on-data-analysis.runtime.txt': 'runtime.txt',
      'authgear-authgear-server.tool-versions': '.tool-versions', 'smartcontractkit-chainlink.tool-versions': '.tool-versions',
      'spiker1992-python-event-sourcing.Dockerfile': 'Dockerfile', 'pallets-flask.tests.yaml': '.github/workflows/tests.yaml',
    }
    let checked = 0
    for (const [f, as] of Object.entries(names)) {
      const text = real(f)
      for (const s of extractPython(as, text)) {
        if (s.column === undefined) continue
        checked++
        expect((text.split(/\r?\n/)[s.line - 1] ?? '').startsWith(s.raw, s.column - 1), `${f}:${s.line}`).toBe(true)
      }
    }
    expect(checked).toBeGreaterThan(15)
  })
})

describe('review R1: a broken pyproject.toml is reported once (diagnostic) and gives no sources', () => {
  it('no sources, no junk UNPARSEABLE: not for requires-python, not for Poetry python, not for the lookalike key', () => {
    for (const text of [
      '[project]\nname = "x"\nrequires-python = ">=3.9\n',
      '[tool.poetry.dependencies]\npython = "^3.9"\n[broken\n',
      '[project]\nrequires-python = ">=3.9"\n[tool.poetry.dependencies]\npython = "^3.10"\nbad bad\n',
      'requires-python = =\n',
    ]) {
      expect(extractPython('pyproject.toml', text), text).toEqual([])
    }
  })
})

describe('rpc-harden F7: .gitlab-ci.yml python images', () => {
  const text = 'image: python:3.12\ntest:\n  image: python:3.9-slim\nlint:\n  image:\n    name: python:3.11\nother:\n  image: myorg/python:3.1\nweb:\n  image: node:18\n'
  it('reads the top-level, job-level and {name:} images of official python only', () => {
    const s = extractPython('.gitlab-ci.yml', text)
    expect(s.map((x) => [x.line, x.raw, x.constraint, x.kind])).toEqual([
      [1, '3.12', { kind: 'partial', version: '3.12' }, 'gitlab-ci'],
      [3, '3.9-slim', { kind: 'partial', version: '3.9' }, 'gitlab-ci'],
      [6, '3.11', { kind: 'partial', version: '3.11' }, 'gitlab-ci'],
    ])
    for (const x of s) expect(text.split('\n')[x.line - 1]?.slice((x.column as number) - 1).startsWith(x.raw)).toBe(true)
  })
})

