import { describe, expect, it } from 'vitest'
import { describeConstraint, dockerTagConstraint, isFloatingAlias, parseConstraint, toRange } from '../src/constraint'

// Raw forms come from real files listed in docs/recon.md section 5.

describe('parseConstraint: node', () => {
  it.each([
    ['22.22.1', { kind: 'exact', version: '22.22.1' }],
    ['v22.22.3', { kind: 'exact', version: '22.22.3' }],
    ['22', { kind: 'partial', version: '22' }],
    ['v22', { kind: 'partial', version: '22' }],
    ['22.11', { kind: 'partial', version: '22.11' }],
    ['14.x', { kind: 'partial', version: '14' }],
    [' 20.x \n', { kind: 'partial', version: '20' }],
    ['lts/*', { kind: 'alias', alias: 'lts/*' }],
    ['lts/Iron', { kind: 'alias', alias: 'lts/iron' }],
    ['lts', { kind: 'alias', alias: 'lts' }],
    ['node', { kind: 'alias', alias: 'node' }],
  ])('%j', (raw, expected) => {
    expect(parseConstraint(raw, 'node')).toEqual(expected)
  })

  it('converts semver ranges, including || alternatives', () => {
    expect(parseConstraint('>=20 <23', 'node')).toEqual({ kind: 'range', range: '>=20.0.0 <23.0.0-0' })
    expect(parseConstraint('>=20 <23 || >=24 <25', 'node')).toEqual({
      kind: 'range',
      range: '>=20.0.0 <23.0.0-0||>=24.0.0 <25.0.0-0',
    })
    expect(parseConstraint('^22', 'node').kind).toBe('range')
  })

  it('never guesses: variables and junk are unknown with a reason', () => {
    expect(parseConstraint('${NODE_VERSION}', 'node')).toMatchObject({ kind: 'unknown' })
    expect(parseConstraint('${{ matrix.node-version }}', 'node')).toMatchObject({ kind: 'unknown' })
    expect(parseConstraint('twenty-two', 'node')).toMatchObject({ kind: 'unknown' })
    expect(parseConstraint('  ', 'node')).toEqual({ kind: 'unknown', reason: 'empty value' })
  })
})

describe('parseConstraint: python', () => {
  it.each([
    ['3.12', { kind: 'partial', version: '3.12' }],
    ['3.12.11', { kind: 'exact', version: '3.12.11' }],
    ['python-3.7.6', { kind: 'exact', version: '3.7.6' }],
    ['python-3.7', { kind: 'partial', version: '3.7' }],
  ])('%j', (raw, expected) => {
    expect(parseConstraint(raw, 'python')).toEqual(expected)
  })

  it.each([
    ['>=3.8', '>=3.8.0'],
    ['>=3.10,<3.14', '>=3.10.0 <3.14.0-0'],
    ['>=3.9, <=3.13', '>=3.9.0 <=3.13.0'],
    ['^3.10', '>=3.10.0 <4.0.0-0'],
    ['~3.10', '>=3.10.0 <3.11.0-0'],
    ['~=3.11', '>=3.11.0 <4.0.0-0'],
    ['~=3.11.2', '>=3.11.2 <3.12.0-0'],
    ['==3.11.*', '>=3.11.0 <3.12.0-0'],
    ['==3.10', '3.10.0'],
    ['>=3.9,!=3.9.1', '>=3.9.0'],
    ['>=3.9,<3.10 || >=3.11', '>=3.9.0 <3.10.0-0||>=3.11.0'],
  ])('PEP 440 / Poetry %j', (raw, range) => {
    expect(parseConstraint(raw, 'python')).toEqual({ kind: 'range', range })
  })

  it('keeps what semver cannot express as unknown', () => {
    expect(parseConstraint('===3.10', 'python').kind).toBe('unknown')
    expect(parseConstraint('>=3.13.0rc1', 'python').kind).toBe('unknown')
    expect(parseConstraint('~=3', 'python').kind).toBe('unknown')
  })
})

describe('parseConstraint: go', () => {
  it.each([
    ['1.24.0', { kind: 'exact', version: '1.24.0' }],
    ['go1.24.4', { kind: 'exact', version: '1.24.4' }],
    ['1.22', { kind: 'partial', version: '1.22' }],
    ['stable', { kind: 'alias', alias: 'stable' }],
    ['oldstable', { kind: 'alias', alias: 'oldstable' }],
    ['latest', { kind: 'alias', alias: 'latest' }],
  ])('%j', (raw, expected) => {
    expect(parseConstraint(raw, 'go')).toEqual(expected)
  })

  it('reads a minimum-version range', () => {
    expect(parseConstraint('>=1.22', 'go')).toEqual({ kind: 'range', range: '>=1.22.0' })
  })
})

describe('dockerTagConstraint', () => {
  it.each([
    ['22-alpine', 'node', { kind: 'partial', version: '22' }],
    ['22.11.0-bookworm-slim', 'node', { kind: 'exact', version: '22.11.0' }],
    ['22.23.1-bookworm-slim@sha256:813a0000', 'node', { kind: 'exact', version: '22.23.1' }],
    ['22-alpine@sha256:abc', 'node', { kind: 'partial', version: '22' }],
    ['lts-alpine@sha256:abc', 'node', { kind: 'alias', alias: 'lts' }],
    ['iron-alpine', 'node', { kind: 'alias', alias: 'lts/iron' }],
    ['24', 'node', { kind: 'partial', version: '24' }],
    ['3.12-slim-bookworm', 'python', { kind: 'partial', version: '3.12' }],
    ['slim', 'python', { kind: 'alias', alias: 'latest' }],
    ['slim-buster', 'python', { kind: 'alias', alias: 'latest' }],
    ['alpine', 'go', { kind: 'alias', alias: 'latest' }],
    ['1.24-alpine', 'go', { kind: 'partial', version: '1.24' }],
    ['alpine3.20', 'node', { kind: 'alias', alias: 'latest' }],
    ['alpine3.19', 'go', { kind: 'alias', alias: 'latest' }],
    ['slim-bookworm', 'python', { kind: 'alias', alias: 'latest' }],
    ['22-alpine3.20', 'node', { kind: 'partial', version: '22' }],
  ] as const)('%s (%s)', (tag, runtime, expected) => {
    expect(dockerTagConstraint(tag, runtime)).toEqual(expected)
  })

  it('treats a missing tag as latest and a variable as unknown', () => {
    expect(dockerTagConstraint(undefined, 'node')).toEqual({ kind: 'alias', alias: 'latest' })
    expect(dockerTagConstraint('', 'node')).toEqual({ kind: 'alias', alias: 'latest' })
    expect(dockerTagConstraint('${NODE_VERSION}-bullseye-slim', 'node').kind).toBe('unknown')
  })
})

describe('toRange and helpers', () => {
  it('converts every comparable kind to a semver range', () => {
    expect(toRange({ kind: 'partial', version: '22' })).toBe('>=22.0.0 <23.0.0-0')
    expect(toRange({ kind: 'partial', version: '22.11' })).toBe('>=22.11.0 <22.12.0-0')
    expect(toRange({ kind: 'exact', version: '22.11.0' })).toBe('22.11.0')
    expect(toRange({ kind: 'range', range: '>=20.0.0' })).toBe('>=20.0.0')
    expect(toRange({ kind: 'alias', alias: 'lts/*' })).toBeUndefined()
    expect(toRange({ kind: 'unknown', reason: 'x' })).toBeUndefined()
  })

  it('knows which aliases float', () => {
    for (const a of ['latest', 'node', 'stable', 'Current']) expect(isFloatingAlias(a)).toBe(true)
    for (const a of ['lts', 'lts/*', 'lts/iron']) expect(isFloatingAlias(a)).toBe(false)
  })

  it('describes constraints for messages', () => {
    expect(describeConstraint({ kind: 'partial', version: '22' })).toBe('22')
    expect(describeConstraint({ kind: 'alias', alias: 'lts/iron' })).toBe('lts/iron')
    expect(describeConstraint({ kind: 'unknown', reason: 'empty value' })).toBe('unparseable (empty value)')
  })
})
