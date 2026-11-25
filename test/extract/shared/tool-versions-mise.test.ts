import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { locateTomlKey, locateTomlTable, parseDockerfile, parseMise, parseToolVersions } from '../../../src/extract/shared'

const real = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8')

describe('parseToolVersions', () => {
  it('gitlabhq/gitlabhq: comments and blank lines skipped, several versions on one line', () => {
    const entries = parseToolVersions(real('gitlabhq-gitlabhq.tool-versions'))
    expect(entries.find((e) => e.tool === 'nodejs')).toEqual({ tool: 'nodejs', versions: ['22.23.1'], line: 2 })
    expect(entries.find((e) => e.tool === 'ruby')).toEqual({ tool: 'ruby', versions: ['3.4.10', '3.3.11'], line: 3 })
  })

  it('smartcontractkit/chainlink: columns aligned with runs of spaces', () => {
    const entries = parseToolVersions(real('smartcontractkit-chainlink.tool-versions'))
    expect(entries.find((e) => e.tool === 'golang')).toEqual({ tool: 'golang', versions: ['1.27.3'], line: 1 })
    expect(entries.find((e) => e.tool === 'nodejs')).toEqual({ tool: 'nodejs', versions: ['22.12.0'], line: 3 })
    expect(entries.find((e) => e.tool === 'python')).toEqual({ tool: 'python', versions: ['3.10.5'], line: 9 })
  })

  it('handles trailing comments, ref: and system, tool-only lines, CRLF', () => {
    expect(parseToolVersions('nodejs 22.1.0 # lts\r\npython ref:master system\r\nruby\r\n# c\r\n')).toEqual([
      { tool: 'nodejs', versions: ['22.1.0'], line: 1 },
      { tool: 'python', versions: ['ref:master', 'system'], line: 2 },
      { tool: 'ruby', versions: [], line: 3 },
    ])
  })

  it('never throws', () => {
    expect(parseToolVersions('')).toEqual([])
    expect(() => parseToolVersions('\u0000 \u0001')).not.toThrow()
  })
})

describe('parseMise', () => {
  it('conventional-changelog/commitlint (.mise.toml): plain strings with line and column', () => {
    expect(parseMise(real('conventional-changelog-commitlint.mise.toml'))).toEqual([
      { tool: 'node', versions: ['22'], line: 2, column: 8 },
      { tool: 'pnpm', versions: ['12'], line: 3, column: 8 },
    ])
  })

  it('butlerx/wetty (.mise.toml): lts alias and aligned columns', () => {
    const node = parseMise(real('butlerx-wetty.mise.toml')).find((t) => t.tool === 'node')
    expect(node).toMatchObject({ versions: ['lts'], line: 2 })
  })

  it('metabase/metabase (mise.toml, 116 lines): [tools] only; idiomatic_version_file_enable_tools is not a pin', () => {
    const tools = parseMise(real('metabase-metabase.mise.toml'))
    expect(tools.find((t) => t.tool === 'python')).toMatchObject({ versions: ['3.12'], line: 68 })
    expect(tools.find((t) => t.tool === 'java')?.versions).toEqual(['temurin-25.0.3+9.0.LTS'])
    expect(tools.some((t) => t.tool.includes('idiomatic'))).toBe(false)
  })

  it('reads arrays, inline tables with version, numbers, quoted keys and dotted keys', () => {
    const text = `[tools]\nnode = ["22", "20"]\ngo = { version = "1.22", postinstall = "x" }\npython = 3.12\n"core:ruby" = "3.3"\nrust = { foo = 1 }\n`
    expect(parseMise(text).map((t) => [t.tool, t.versions, t.line])).toEqual([
      ['node', ['22', '20'], 2],
      ['go', ['1.22'], 3],
      ['python', ['3.12'], 4],
      ['core:ruby', ['3.3'], 5],
      ['rust', [], 6],
    ])
    expect(parseMise('tools.node = "22"\n')[0]).toMatchObject({ tool: 'node', versions: ['22'], line: 1 })
  })

  it('returns [] for invalid TOML, a missing [tools] table, and garbage; never throws', () => {
    expect(parseMise('[tools\nnode = ')).toEqual([])
    expect(parseMise('[env]\nA = "1"\n')).toEqual([])
    expect(parseMise('')).toEqual([])
    expect(() => parseMise('\u0000')).not.toThrow()
  })
})

describe('locateTomlKey (for pyproject.toml: requires-python, poetry python)', () => {
  const pyproject = `[build-system]\nrequires = ["hatchling"]\n\n[project]\nname = "x"\nrequires-python = ">=3.10"  # floor\n\n[tool.poetry.dependencies]\npython = "^3.9"\n\n[[tool.x]]\npython = "no"\n`
  it('finds a key inside a table, with the value text and column', () => {
    expect(locateTomlKey(pyproject, ['project'], 'requires-python')).toEqual({ line: 6, column: 19, raw: '">=3.10"' })
    expect(locateTomlKey(pyproject, ['tool', 'poetry', 'dependencies'], 'python')).toMatchObject({ line: 9, raw: '"^3.9"' })
  })
  it('does not confuse tables, arrays of tables or missing keys', () => {
    expect(locateTomlKey(pyproject, ['project'], 'python')).toBeUndefined()
    expect(locateTomlKey(pyproject, ['tool', 'x'], 'python')).toBeUndefined()
    expect(locateTomlKey('', [], 'a')).toBeUndefined()
  })
  it('understands top-level dotted keys', () => {
    expect(locateTomlKey('tools.node = "22"\n', ['tools'], 'node')).toMatchObject({ line: 1, raw: '"22"' })
  })
})

describe('review F1: no catastrophic backtracking on table headers', () => {
  const within = (ms: number, fn: () => unknown) => {
    const t0 = performance.now()
    fn()
    expect(performance.now() - t0).toBeLessThan(ms)
  }
  it('a line of "[" plus 20,000 spaces (no closing bracket) returns at once from locateTomlKey and parseMise on valid TOML', () => {
    const bad = `[${' '.repeat(20000)}`
    within(200, () => locateTomlKey(bad, ['tools'], 'node'))
    within(200, () => locateTomlTable(bad, ['tools']))
    const valid = `[tools]\nnode = "22"\nnote = \"\"\"\n${bad}\n\"\"\"\n`
    within(200, () => expect(parseMise(valid)[0]).toMatchObject({ tool: 'node', versions: ['22'], line: 2 }))
  })
  it('headers with inner spaces still work', () => {
    expect(locateTomlKey('[ tools ]\nnode = "22"\n', ['tools'], 'node')).toMatchObject({ line: 2 })
    expect(locateTomlKey('[  tool . poetry . dependencies  ] # c\npython = "^3.9"\n', ['tool', 'poetry', 'dependencies'], 'python')).toMatchObject({ line: 2, raw: '"^3.9"' })
  })
  it('the Dockerfile parser directive regex is linear too', () => {
    const t0 = performance.now()
    parseDockerfile(`# a = x${' '.repeat(20000)}y\nFROM node:22\n`)
    expect(performance.now() - t0).toBeLessThan(200)
  })
})

describe('review F2: mise [tools.<name>] table form reports its real line', () => {
  it('version key inside the table', () => {
    expect(parseMise('[tools.node]\nversion = "22"\n')).toEqual([{ tool: 'node', versions: ['22'], line: 2, column: 11 }])
    expect(parseMise('[tools]\ngo = "1.22"\n[tools.python]\nversion = ["3.12", "3.11"]\npostinstall = "x"\n')).toEqual([
      { tool: 'go', versions: ['1.22'], line: 2, column: 6 },
      { tool: 'python', versions: ['3.12', '3.11'], line: 4, column: 11 },
    ])
  })
  it('top-level dotted key', () => {
    expect(parseMise('tools.node.version = "22"\n')[0]).toMatchObject({ tool: 'node', versions: ['22'], line: 1 })
  })
  it('a table without a version key points at its header; the line is never invented', () => {
    expect(parseMise('# c\n\n[tools.node]\npostinstall = "x"\n')).toEqual([{ tool: 'node', versions: [], line: 3 }])
  })
})

describe('locateTomlTable', () => {
  it('finds a header line, tolerating spaces, and does not match arrays of tables', () => {
    expect(locateTomlTable('a = 1\n[ tools . node ]\n', ['tools', 'node'])).toBe(2)
    expect(locateTomlTable('[[tools.node]]\n', ['tools', 'node'])).toBeUndefined()
    expect(locateTomlTable('', ['x'])).toBeUndefined()
  })
})
